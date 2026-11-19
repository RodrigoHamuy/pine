// Where the page may go and what opens outside it: the desktop main process's `will-navigate`,
// `setWindowOpenHandler` and `openOutside`, for the WKWebView. And which of the page's requests are
// the daemon's pictures, video and sound. Links.kt on Android; the origins differ (mobile/cases/README.md).
import Foundation

/** The app's own origin, Capacitor's on iOS: the page and nothing else is served from it. */
public let appOrigin = "capacitor://localhost"

/** The scheme and host the page fetches the daemon's media under, which the app answers itself. */
public let mediaScheme = "pine-media"
public let mediaHost = "daemon"
public let mediaBase = "\(mediaScheme)://\(mediaHost)"

/** A request for the daemon's media: its path on the daemon and its query (`?...`, or empty). */
public struct MediaRequest: Equatable, Sendable {
	public let path: String
	public let search: String

	public init(path: String, search: String) {
		self.path = path
		self.search = search
	}
}

/** An address with nothing in front of its host but the scheme: no user, no password, no port. */
private func bare(_ u: URLComponents, scheme: String, host: String) -> Bool {
	u.scheme == scheme && u.host == host && u.port == nil && u.user == nil && u.password == nil
}

/** Only pages on the web open outside the app: a link in an answer never starts a program or opens a file. */
public func outside(_ url: String) -> Bool {
	guard let u = URLComponents(string: url), let scheme = u.scheme?.lowercased(), let host = u.host else { return false }
	return (scheme == "http" || scheme == "https") && !host.isEmpty
}

/** Whether an address is the page's own: the page stays the page. */
public func stays(_ url: String) -> Bool {
	guard let u = URLComponents(string: url) else { return false }
	return bare(u, scheme: "capacitor", host: "localhost")
}

/** The daemon's path and query of a request for its media, or nil for any other request. */
public func mediaRequest(_ url: String) -> MediaRequest? {
	guard let u = URLComponents(string: url), bare(u, scheme: mediaScheme, host: mediaHost) else { return nil }
	let path = u.percentEncodedPath
	guard path.hasPrefix("/") else { return nil }
	return MediaRequest(path: path, search: u.percentEncodedQuery.map { "?\($0)" } ?? "")
}
