// Where the page may go and what opens outside it: the desktop main process's `will-navigate`,
// `setWindowOpenHandler` and `openOutside`, for the WebView. And which of the page's requests are
// the daemon's pictures, video and sound (mobile/src/plugin.ts: APP_ORIGIN and MEDIA_BASE).
package pine.mobile.core

import java.net.URI

/** The app's own origin, Capacitor's local server: the page and nothing else is served from it. */
const val APP_ORIGIN = "https://localhost"

/** Where on that origin the page fetches the daemon's media. */
const val MEDIA_PATH = "/_pine_media"

private fun parsed(url: String): URI? = runCatching { URI(url) }.getOrNull()

/** Only pages on the web open outside the app: a link in an answer never starts a program or opens a file. */
fun outside(url: String): Boolean {
	val u = parsed(url) ?: return false
	return (u.scheme.equals("http", true) || u.scheme.equals("https", true)) && !u.host.isNullOrEmpty()
}

/** Whether an address is the page's own: the page stays the page. */
fun stays(url: String): Boolean {
	val u = parsed(url) ?: return false
	return u.scheme == "https" && u.host == "localhost" && u.port == -1 && u.rawUserInfo == null
}

/** The daemon's path and query (`?...` or empty) of a request for its media, or null for any other request. */
fun mediaRequest(url: String): Pair<String, String>? {
	if (!stays(url)) return null
	val u = parsed(url) ?: return null
	val path = u.rawPath ?: return null
	if (!path.startsWith("$MEDIA_PATH/")) return null
	return path.removePrefix(MEDIA_PATH) to (u.rawQuery?.let { "?$it" } ?: "")
}
