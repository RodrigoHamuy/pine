// Pictures, video and sound the page shows straight from the daemon: `mediaFromDaemon` of
// desktop/electron/daemon.ts. The plugin answers the page's media addresses with this, so the
// rules are the desktop's: GET only, only the listed paths, the token added by the plugin, and
// only what is drawn or played.
package pine.mobile.core

import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import java.io.InputStream

/** What the page may show straight from the daemon: pictures, videos and sounds. Nothing else is served this way. */
val MEDIA: List<Regex> = listOf(Regex("^/media/tool/[^/]+$"), Regex("^/tasks/\\d+/images/\\d+$"), Regex("^/agents/[^/]+/image$"), Regex("^/agents/[^/]+/browser/frame$"))

/** An answer for the page: its status, its headers by lower-case name, and its body, read as it arrives (close it when done). */
class MediaAnswer(val status: Int, val headers: Map<String, String>, val body: InputStream)

private fun plain(status: Int, text: String) = MediaAnswer(status, mapOf("content-type" to "text/plain; charset=utf-8"), ByteArrayInputStream(text.toByteArray()))

/** One of the daemon's media, by its path on the daemon and the query that goes with it (`?...`, or empty). */
fun mediaFromDaemon(daemon: Daemon?, method: String, path: String, search: String): MediaAnswer {
	val target = path + search
	if (daemon == null || method != "GET" || !MEDIA.any { it.matches(path) } || (search.isNotEmpty() && !search.startsWith("?")) || target.any { it.isWhitespace() || it.isISOControl() }) return plain(404, "not found")
	val conn = try {
		daemon.open()
	} catch (e: Exception) {
		return plain(404, "not found")
	}
	try {
		send(daemon, conn, "GET", target)
		val head = readHead(conn.input)
		if (head.status !in 200..299) return plain(404, "not found").also { conn.close() }
		val type = head.headers["content-type"] ?: "application/octet-stream"
		// Only what is drawn or played. A page of HTML or a script under this name would be content from outside.
		if (!Regex("^(image|video|audio)/").containsMatchIn(type) || type.startsWith("image/svg")) return plain(415, "not shown").also { conn.close() }
		val headers = mutableMapOf("content-type" to type, "cache-control" to "no-store", "x-content-type-options" to "nosniff")
		// With its size: a player is told by it how long a video or a sound runs.
		if (!head.chunked) head.headers["content-length"]?.let { headers["content-length"] = it }
		val body = object : FilterInputStream(bodyStream(head, conn.input)) {
			override fun close() = conn.close()
		}
		return MediaAnswer(200, headers, body)
	} catch (e: Exception) {
		conn.close()
		return plain(404, "not found")
	}
}
