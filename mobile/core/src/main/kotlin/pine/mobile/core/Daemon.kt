// What the page may ask the daemon for: one call of the control API in the owner's name, as
// `callDaemon` in desktop/electron/daemon.ts makes it. The plugin holds the token; the page never
// does. The request goes through a channel of the SSH session to the daemon's loopback port on the
// other machine: no port is bound on the phone, where every app could reach it.
package pine.mobile.core

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.Base64

/** What a call of the control API comes back as: JSON, or a picture as `{mime, base64}`. The same shape as `CallResult` in desktop/electron/daemon.ts. */
data class CallResult(val ok: Boolean, val status: Int, val data: Any)

/** Both ends of a connection to the daemon's port. */
interface Duplex : Closeable {
	val input: InputStream
	val output: OutputStream
}

/** A daemon to call: where it answers on its machine, the token it takes, and a way to open a connection to it. */
interface Daemon {
	val token: String
	val end: Loopback
	fun open(): Duplex
}

private fun failure(status: Int, error: String) = CallResult(false, status, JSONObject().put("error", error))

/**
 * One call of the control API. `body` is a JSON value (a `JSONObject`, a `JSONArray`, a string,
 * a number, a boolean or `JSONObject.NULL`), or null for none.
 */
fun callDaemon(daemon: Daemon?, method: String, url: String, body: Any?): CallResult {
	if (daemon == null) return failure(503, "pine is not running yet")
	if ((method != "GET" && method != "POST") || !url.startsWith("/") || url.startsWith("//") || url.any { it.isWhitespace() || it.isISOControl() }) return failure(400, "not a call of the control API")
	return try {
		daemon.open().use { conn ->
			send(daemon, conn, method, url, body?.let { json(it).toByteArray() })
			val res = readResponse(conn.input)
			val type = res.headers["content-type"] ?: ""
			val ok = res.status in 200..299
			if (type.startsWith("application/json")) CallResult(ok, res.status, parsed(res.body))
			// A picture: bytes and their kind.
			else CallResult(ok, res.status, JSONObject().put("mime", type).put("base64", Base64.getEncoder().encodeToString(res.body)))
		}
	} catch (e: Exception) {
		failure(0, "pine does not answer (${e.message ?: e.javaClass.simpleName})")
	}
}

/**
 * Writes a request on `conn`: the loopback as `Host`, the token unless `authorized` is false, and
 * never an `Origin` or `Sec-Fetch-Site` (the daemon refuses what a web page sends). `url` was
 * checked to hold no space or control character by the caller.
 */
internal fun send(daemon: Daemon, conn: Duplex, method: String, url: String, payload: ByteArray? = null, authorized: Boolean = true) {
	val head = buildString {
		append("$method $url HTTP/1.1\r\n")
		append("Host: ${daemon.end.hostHeader}\r\n")
		if (authorized) append("Authorization: Bearer ${daemon.token}\r\n")
		append("Connection: close\r\n")
		if (payload != null) append("Content-Type: application/json\r\nContent-Length: ${payload.size}\r\n")
		append("\r\n")
	}
	conn.output.write(head.toByteArray(Charsets.ISO_8859_1))
	payload?.let { conn.output.write(it) }
	conn.output.flush()
}

private fun json(value: Any): String = when (value) {
	is JSONObject, is JSONArray -> value.toString()
	is String -> JSONObject.quote(value)
	is Number, is Boolean -> JSONObject.wrap(value).toString()
	else -> if (value == JSONObject.NULL) "null" else throw IllegalArgumentException("not a JSON value: ${value.javaClass.simpleName}")
}

/** The answer's JSON, or `{}` when it is none, as `res.json().catch(() => ({}))`. */
private fun parsed(bytes: ByteArray): Any = try {
	val tokener = JSONTokener(bytes.toString(Charsets.UTF_8))
	val value = tokener.nextValue()
	if (tokener.more()) JSONObject() else value
} catch (e: Exception) {
	JSONObject()
}

/** An HTTP response as read from the connection: the status, the headers by lower-case name, the whole body. */
internal class Response(val status: Int, val headers: Map<String, String>, val body: ByteArray)

/** Reads an HTTP/1.1 response to a request sent with `Connection: close`: by its length, in chunks, or to the end. */
internal fun readResponse(input: InputStream): Response {
	val head = readHead(input)
	val body = when {
		head.chunked -> Chunked(input).readBytes()
		head.headers["content-length"] != null -> exactly(input, head.headers["content-length"]!!.toLong())
		else -> input.readBytes()
	}
	return Response(head.status, head.headers, body)
}

/** The status and the headers (by lower-case name) of an HTTP response. */
internal class Head(val status: Int, val headers: Map<String, String>) {
	val chunked: Boolean get() = headers["transfer-encoding"]?.lowercase()?.contains("chunked") == true
}

internal fun readHead(input: InputStream): Head {
	val statusLine = readLine(input) ?: throw IOException("the connection closed before an answer")
	val status = Regex("^HTTP/1\\.[01] ([0-9]{3})").find(statusLine)?.groupValues?.get(1)?.toInt() ?: throw IOException("not an HTTP answer: ${statusLine.take(80)}")
	val headers = mutableMapOf<String, String>()
	while (true) {
		val line = readLine(input) ?: throw IOException("the connection closed in the headers")
		if (line.isEmpty()) break
		val colon = line.indexOf(':')
		if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
	}
	return Head(status, headers)
}

/** The body after `head`, as it arrives: a video or the event stream is not read whole first. */
internal fun bodyStream(head: Head, input: InputStream): InputStream {
	if (head.chunked) return Chunked(input)
	val length = head.headers["content-length"]?.toLongOrNull() ?: return input
	return object : InputStream() {
		var left = length
		override fun read(): Int {
			if (left <= 0) return -1
			val b = input.read()
			if (b >= 0) left--
			return b
		}
		override fun read(b: ByteArray, off: Int, len: Int): Int {
			if (left <= 0) return -1
			val n = input.read(b, off, minOf(len.toLong(), left).toInt())
			if (n > 0) left -= n
			return n
		}
	}
}

/** A body sent in chunks, read one chunk at a time. */
private class Chunked(private val input: InputStream) : InputStream() {
	private var left = 0L
	private var done = false

	private fun next(): Boolean {
		if (done) return false
		if (left > 0) return true
		val size = readLine(input)?.substringBefore(';')?.trim()?.toLongOrNull(16) ?: throw IOException("a chunk without its size")
		if (size == 0L) {
			done = true
			return false
		}
		left = size
		return true
	}

	override fun read(): Int {
		val one = ByteArray(1)
		return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
	}

	override fun read(b: ByteArray, off: Int, len: Int): Int {
		if (len == 0) return 0
		if (!next()) return -1
		val n = input.read(b, off, minOf(len.toLong(), left).toInt())
		if (n < 0) throw IOException("the answer ended in a chunk")
		left -= n
		// The line break after a chunk.
		if (left == 0L) readLine(input)
		return n
	}
}

private fun readLine(input: InputStream): String? {
	val line = ByteArrayOutputStream()
	while (true) {
		val b = input.read()
		if (b < 0) return if (line.size() == 0) null else line.toString(Charsets.ISO_8859_1)
		if (b == '\n'.code) return line.toString(Charsets.ISO_8859_1).removeSuffix("\r")
		if (line.size() > 64 * 1024) throw IOException("a header line is too long")
		line.write(b)
	}
}

private fun exactly(input: InputStream, n: Long): ByteArray {
	if (n < 0 || n > Int.MAX_VALUE) throw IOException("an answer of $n bytes")
	val bytes = ByteArray(n.toInt())
	var at = 0
	while (at < bytes.size) {
		val r = input.read(bytes, at, bytes.size - at)
		if (r < 0) throw IOException("the answer ended after $at of $n bytes")
		at += r
	}
	return bytes
}

