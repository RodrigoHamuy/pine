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

/** The body of a media answer, read as it arrives. `close()` it when it is not read to its end. */
public final class MediaBody: @unchecked Sendable {
	private let lock = NSLock()
	private var source: (() async throws -> [UInt8]?)?
	private let closing: @Sendable () -> Void

	init(source: @escaping () async throws -> [UInt8]?, close: @escaping @Sendable () -> Void) {
		self.source = source
		self.closing = close
	}

	/** A body of these bytes. */
	static func of(_ bytes: [UInt8]) -> MediaBody {
		var left: [UInt8]? = bytes.isEmpty ? nil : bytes
		return MediaBody(source: {
			defer { left = nil }
			return left
		}, close: {})
	}

	/** The next bytes, nil at the end. */
	public func next() async throws -> Data? {
		guard let source = lock.withLock({ self.source }) else { return nil }
		do {
			guard let bytes = try await source() else {
				close()
				return nil
			}
			return Data(bytes)
		} catch {
			close()
			throw error
		}
	}

	/** All of it. */
	public func all() async throws -> Data {
		var out = Data()
		while let more = try await next() { out.append(more) }
		return out
	}

	/** Lets go of the connection the body comes through. */
	public func close() {
		let had = lock.withLock {
			defer { source = nil }
			return source != nil
		}
		if had { closing() }
	}
}

/** An answer for the page: its status, its headers by lower-case name, and its body. */
public struct MediaAnswer: Sendable {
	public let status: Int
	public let headers: [String: String]
	public let body: MediaBody
}

private func plain(_ status: Int, _ text: String, _ extra: [String: String] = [:]) -> MediaAnswer {
	MediaAnswer(status: status, headers: ["content-type": "text/plain; charset=utf-8"].merging(extra) { $1 }, body: .of(Array(text.utf8)))
}

/** What a `Range` header asks of a body of `total` bytes. */
enum Asked: Equatable {
	/** Not a range the app answers (several, or not bytes): the whole is sent, as HTTP allows. */
	case whole
	case part(ClosedRange<Int>)
	/** A range that is not there: 416. */
	case none
}

/** The bytes a `Range` header asks for: `bytes=a-b`, `bytes=a-` or `bytes=-n`, one range only. */
func byteRange(_ header: String, total: Int) -> Asked {
	guard let m = wholeMatch(#"bytes=([0-9]{0,15})-([0-9]{0,15})"#, header.trimmingCharacters(in: .whitespaces)) else { return .whole }
	switch (Int(m[1]), Int(m[2])) {
	case (nil, nil):
		return .whole
	case (nil, let n?):
		// The last n bytes.
		return n == 0 || total == 0 ? .none : .part(max(0, total - n)...(total - 1))
	case (let first?, let last):
		if let last, last < first { return .whole }
		if first >= total { return .none }
		return .part(first...min(last ?? total - 1, total - 1))
	}
}

/**
 * One of the daemon's media, by its path on the daemon and the query that goes with it (`?...`, or
 * empty): `mediaFromDaemon` of desktop/electron/daemon.ts. `range` is the page's `Range` header:
 * a video or a sound is answered 206 with the part asked for, so that the player can seek. The
 * daemon sends the whole every time (`sendPicture` in src/http.ts knows no ranges), so the part is
 * cut here, and the header is not passed on.
 */
public func mediaFromDaemon(_ daemon: Daemon?, method: String, path: String, search: String, range: String? = nil) async -> MediaAnswer {
	guard let daemon, mediaAsked(method: method, path: path, search: search) else { return plain(404, "not found") }
	let conn: Duplex
	do {
		conn = try await daemon.open()
	} catch {
		return plain(404, "not found")
	}
	let close: @Sendable () -> Void = { conn.close() }
	do {
		try await send(daemon, conn, method: "GET", url: path + search)
		let reader = Reader(conn)
		let head = try await readHead(reader)
		let type = head.headers["content-type"] ?? "application/octet-stream"
		let status = mediaShown(status: head.status, contentType: head.headers["content-type"])
		if status != 200 {
			close()
			return status == 415 ? plain(415, "not shown") : plain(404, "not found")
		}
		let body = Body(head, reader)
		let length = head.chunked ? nil : head.headers["content-length"]
		guard type.hasPrefix("video/") || type.hasPrefix("audio/") else {
			return MediaAnswer(status: 200, headers: mediaHeaders(contentType: type, contentLength: length), body: MediaBody(source: body.next, close: close))
		}
		// A player asks for parts: it is told that it may, and how long the whole is.
		var total = length.flatMap { Int($0) }
		var whole: [UInt8]?
		if range != nil, total == nil {
			let all = try await body.all()
			whole = all
			total = all.count
		}
		var headers = mediaHeaders(contentType: type, contentLength: total.map(String.init))
		headers["accept-ranges"] = "bytes"
		let asked = range.flatMap { r in total.map { byteRange(r, total: $0) } } ?? .whole
		switch asked {
		case .whole:
			if let whole {
				close()
				return MediaAnswer(status: 200, headers: headers, body: .of(whole))
			}
			return MediaAnswer(status: 200, headers: headers, body: MediaBody(source: body.next, close: close))
		case .none:
			close()
			return plain(416, "not there", ["content-range": "bytes */\(total ?? 0)"])
		case .part(let part):
			headers["content-range"] = "bytes \(part.lowerBound)-\(part.upperBound)/\(total ?? 0)"
			headers["content-length"] = String(part.count)
			if let whole {
				close()
				return MediaAnswer(status: 206, headers: headers, body: .of(Array(whole[part])))
			}
			return MediaAnswer(status: 206, headers: headers, body: MediaBody(source: cut(body.next, part), close: close))
		}
	} catch {
		close()
		return plain(404, "not found")
	}
}

/** The bytes of `part` of what `next` gives, the rest skipped. */
private func cut(_ next: @escaping () async throws -> [UInt8]?, _ part: ClosedRange<Int>) -> () async throws -> [UInt8]? {
	var at = 0
	return {
		while at <= part.upperBound {
			guard let bytes = try await next() else { return nil }
			let start = at
			at += bytes.count
			let from = max(part.lowerBound, start), to = min(part.upperBound + 1, at)
			if from < to { return Array(bytes[(from - start)..<(to - start)]) }
		}
		return nil
	}
}
