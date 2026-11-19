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
			val payload = body?.let { json(it).toByteArray() }
			val head = buildString {
				append("$method $url HTTP/1.1\r\n")
				append("Host: ${daemon.end.hostHeader}\r\n")
				append("Authorization: Bearer ${daemon.token}\r\n")
				append("Connection: close\r\n")
				if (payload != null) append("Content-Type: application/json\r\nContent-Length: ${payload.size}\r\n")
				append("\r\n")
			}
			conn.output.write(head.toByteArray(Charsets.ISO_8859_1))
			payload?.let { conn.output.write(it) }
			conn.output.flush()
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
	val statusLine = readLine(input) ?: throw IOException("the connection closed before an answer")
	val status = Regex("^HTTP/1\\.[01] ([0-9]{3})").find(statusLine)?.groupValues?.get(1)?.toInt() ?: throw IOException("not an HTTP answer: ${statusLine.take(80)}")
	val headers = mutableMapOf<String, String>()
	while (true) {
		val line = readLine(input) ?: throw IOException("the connection closed in the headers")
		if (line.isEmpty()) break
		val colon = line.indexOf(':')
		if (colon > 0) headers[line.substring(0, colon).trim().lowercase()] = line.substring(colon + 1).trim()
	}
	val body = when {
		headers["transfer-encoding"]?.lowercase()?.contains("chunked") == true -> chunks(input)
		headers["content-length"] != null -> exactly(input, headers["content-length"]!!.toLong())
		else -> input.readBytes()
	}
	return Response(status, headers, body)
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

private fun chunks(input: InputStream): ByteArray {
	val out = ByteArrayOutputStream()
	while (true) {
		val size = readLine(input)?.substringBefore(';')?.trim()?.toLongOrNull(16) ?: throw IOException("a chunk without its size")
		if (size == 0L) {
			while (!readLine(input).isNullOrEmpty()) Unit
			return out.toByteArray()
		}
		out.write(exactly(input, size))
		readLine(input)
	}
}
