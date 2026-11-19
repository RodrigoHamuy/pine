// Pictures, video and sound the page shows straight from the daemon: `mediaFromDaemon` of
// desktop/electron/daemon.ts, as Media.kt on Android. The app answers the page's `pine-media:`
// requests with these rules: GET only, only the listed paths, the token added by the app, and
// only what is drawn or played.
import Foundation

/** What the page may show straight from the daemon: pictures, videos and sounds. Nothing else is served this way. */
public let MEDIA = [#"/media/tool/[^/]+"#, #"/tasks/\d+/images/\d+"#, #"/agents/[^/]+/image"#, #"/agents/[^/]+/browser/frame"#]

/** Whether a request of the page is asked of the daemon at all; any other is answered 404 "not found" without leaving the phone. */
public func mediaAsked(method: String, path: String, search: String) -> Bool {
	let unsafe = (path + search).unicodeScalars.contains { $0.properties.isWhitespace || $0.properties.generalCategory == .control }
	return method == "GET" && MEDIA.contains { wholeMatch($0, path) != nil } && (search.isEmpty || search.hasPrefix("?")) && !unsafe
}

/**
 * The status the page gets for the daemon's answer to an asked request: 200 with the body, 415
 * "not shown", or 404 "not found". Only what is drawn or played: a page of HTML or a script
 * under a media name would be content from outside, and an SVG drawing can hold a script.
 */
public func mediaShown(status: Int, contentType: String?) -> Int {
	guard (200...299).contains(status) else { return 404 }
	let type = contentType ?? "application/octet-stream"
	let shown = ["image/", "video/", "audio/"].contains { type.hasPrefix($0) } && !type.hasPrefix("image/svg")
	return shown ? 200 : 415
}

/** The headers of a media answer that is shown. With its size when the daemon said it: a player is told by it how long a video or a sound runs. */
public func mediaHeaders(contentType: String, contentLength: String?) -> [String: String] {
	var headers = ["content-type": contentType, "cache-control": "no-store", "x-content-type-options": "nosniff"]
	if let contentLength { headers["content-length"] = contentLength }
	return headers
}
