// What the page may ask the daemon for: one call of the control API in the owner's name, as
// `callDaemon` in desktop/electron/daemon.ts makes it, and Daemon.kt on Android. The core holds the
// token; the page never does. The request goes through a channel of the SSH session to the daemon's
// loopback port on the other machine: no port is bound on the phone, where every app could reach it.
import Foundation

/** What a call of the control API comes back as: JSON, or a picture as `{mime, base64}`. The same shape as `CallResult` in desktop/electron/daemon.ts. */
public struct CallResult: @unchecked Sendable {
	public let ok: Bool
	public let status: Int
	/** A JSON value as `JSONSerialization` gives it: a dictionary, an array, a string, a number, a boolean or `NSNull`. */
	public let data: Any

	/** As the page takes it: `{ok, status, data}`. */
	public var json: [String: Any] { ["ok": ok, "status": status, "data": data] }
}

/** A daemon to call: where it answers on its machine, the token it takes, and a way to open a connection to it. */
public protocol Daemon: Sendable {
	var token: String { get }
	var end: Loopback { get }
	func open() async throws -> Duplex
}

private func refusal(_ status: Int, _ error: String) -> CallResult { CallResult(ok: false, status: status, data: ["error": error]) }

/** Whether a text holds a space or a control character: it would end or split a line of the request. */
func unsafeText(_ text: String) -> Bool {
	text.unicodeScalars.contains { $0.properties.isWhitespace || $0.properties.generalCategory == .control }
}

/**
 * One call of the control API: GET or POST of a path of the daemon, never another host. `body` is a
 * JSON value (a dictionary, an array, a string, a number, a boolean or `NSNull`), or nil for none.
 * 503 before there is a daemon, 400 for what is not a call of the control API, status 0 when the
 * daemon does not answer.
 */
public func callDaemon(_ daemon: Daemon?, method: String, url: String, body: Any? = nil) async -> CallResult {
	guard let daemon else { return refusal(503, "pine is not running yet") }
	if (method != "GET" && method != "POST") || !url.hasPrefix("/") || url.hasPrefix("//") || unsafeText(url) { return refusal(400, "not a call of the control API") }
	var payload: [UInt8]?
	if let body {
		// Checked first: JSONSerialization stops the program on what it cannot write.
		guard JSONSerialization.isValidJSONObject([body]), let data = try? JSONSerialization.data(withJSONObject: body, options: [.fragmentsAllowed, .withoutEscapingSlashes]) else {
			return refusal(400, "the body of a call is JSON")
		}
		payload = Array(data)
	}
	let conn: Duplex
	do {
		conn = try await daemon.open()
	} catch {
		return refusal(0, "pine does not answer (\(error))")
	}
	defer { conn.close() }
	do {
		try await send(daemon, conn, method: method, url: url, payload: payload)
		let res = try await readResponse(Reader(conn))
		let type = res.headers["content-type"] ?? ""
		let ok = (200...299).contains(res.status)
		if type.hasPrefix("application/json") { return CallResult(ok: ok, status: res.status, data: parsed(res.body)) }
		// A picture: bytes and their kind.
		return CallResult(ok: ok, status: res.status, data: ["mime": type, "base64": Data(res.body).base64EncodedString()])
	} catch {
		return refusal(0, "pine does not answer (\(error))")
	}
}

/**
 * Writes a request on `conn`: the loopback as `Host`, the token unless `authorized` is false, and
 * never an `Origin` or `Sec-Fetch-Site` (the daemon refuses what a web page sends). `url` was
 * checked to hold no space or control character by the caller.
 */
func send(_ daemon: Daemon, _ conn: Duplex, method: String, url: String, payload: [UInt8]? = nil, authorized: Bool = true) async throws {
	var head = "\(method) \(url) HTTP/1.1\r\nHost: \(daemon.end.hostHeader)\r\n"
	if authorized { head += "Authorization: Bearer \(daemon.token)\r\n" }
	head += "Connection: close\r\n"
	if let payload { head += "Content-Type: application/json\r\nContent-Length: \(payload.count)\r\n" }
	head += "\r\n"
	try await conn.write(Array(head.utf8) + (payload ?? []))
}

/** The answer's JSON, or `{}` when it is none, as `res.json().catch(() => ({}))`. */
private func parsed(_ bytes: [UInt8]) -> Any {
	(try? JSONSerialization.jsonObject(with: Data(bytes), options: [.fragmentsAllowed])) ?? [String: Any]()
}

/** Something that is not an HTTP answer as expected. */
struct HTTPTrouble: Error, CustomStringConvertible {
	let description: String
	init(_ description: String) { self.description = description }
}

/** The bytes of a connection, read as an HTTP answer needs them: lines, a number of bytes, or what comes. */
final class Reader {
	private let conn: Duplex
	private var buffer: [UInt8] = []
	private var at = 0
	private var done = false

	init(_ conn: Duplex) {
		self.conn = conn
	}

	/** Reads more into the buffer; false at the end. */
	private func fill() async throws -> Bool {
		if done { return false }
		guard let more = try await conn.read() else {
			done = true
			return false
		}
		if at > 0 {
			buffer.removeFirst(at)
			at = 0
		}
		buffer.append(contentsOf: more)
		return true
	}

	/** The next line without its line break (ISO 8859-1), nil at the end. */
	func line() async throws -> String? {
		while true {
			if let nl = buffer[at...].firstIndex(of: 10) {
				var bytes = buffer[at..<nl]
				at = nl + 1
				if bytes.last == 13 { bytes = bytes.dropLast() }
				return String(bytes.map { Character(Unicode.Scalar($0)) })
			}
			if buffer.count - at > 64 * 1024 { throw HTTPTrouble("a header line is too long") }
			if try await !fill() {
				if at == buffer.count { return nil }
				let rest = buffer[at...]
				at = buffer.count
				return String(rest.map { Character(Unicode.Scalar($0)) })
			}
		}
	}

	/** At most `max` bytes, as soon as some are there; nil at the end. */
	func some(_ max: Int) async throws -> [UInt8]? {
		if at == buffer.count, try await !fill() { return nil }
		let n = min(max, buffer.count - at)
		defer { at += n }
		return Array(buffer[at..<(at + n)])
	}
}

/** The status and the headers (by lower-case name) of an HTTP answer. */
struct Head {
	let status: Int
	let headers: [String: String]
	var chunked: Bool { headers["transfer-encoding"]?.lowercased().contains("chunked") == true }
	var length: Int? { headers["content-length"].flatMap { Int($0) } }
}

func readHead(_ reader: Reader) async throws -> Head {
	guard let statusLine = try await reader.line() else { throw HTTPTrouble("the connection closed before an answer") }
	guard let m = statusLine.range(of: #"^HTTP/1\.[01] [0-9]{3}"#, options: .regularExpression) else { throw HTTPTrouble("not an HTTP answer: \(statusLine.prefix(80))") }
	let status = Int(statusLine[m].suffix(3))!
	var headers: [String: String] = [:]
	while true {
		guard let line = try await reader.line() else { throw HTTPTrouble("the connection closed in the headers") }
		if line.isEmpty { break }
		if let colon = line.firstIndex(of: ":"), colon != line.startIndex {
			headers[line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
		}
	}
	return Head(status: status, headers: headers)
}

/** The body after a head, as it arrives: by its length, in chunks, or to the end. A video or the event stream is not read whole first. */
final class Body {
	private let reader: Reader
	private let chunked: Bool
	/** Bytes left: of the body by its length, or of the current chunk. */
	private var left: Int?
	private var done = false

	init(_ head: Head, _ reader: Reader) {
		self.reader = reader
		self.chunked = head.chunked
		self.left = head.chunked ? 0 : head.length
	}

	/** The next bytes of the body, nil at its end. */
	func next() async throws -> [UInt8]? {
		if done { return nil }
		if chunked {
			if left == 0 {
				guard let line = try await reader.line(), let size = Int(line.split(separator: ";").first?.trimmingCharacters(in: .whitespaces) ?? "", radix: 16) else { throw HTTPTrouble("a chunk without its size") }
				if size == 0 {
					done = true
					return nil
				}
				left = size
			}
			guard let bytes = try await reader.some(left!) else { throw HTTPTrouble("the answer ended in a chunk") }
			left! -= bytes.count
			// The line break after a chunk.
			if left == 0 { _ = try await reader.line() }
			return bytes
		}
		if let l = left {
			if l == 0 {
				done = true
				return nil
			}
			guard let bytes = try await reader.some(l) else { throw HTTPTrouble("the answer ended before its length") }
			left = l - bytes.count
			return bytes
		}
		guard let bytes = try await reader.some(64 * 1024) else {
			done = true
			return nil
		}
		return bytes
	}

	/** The whole body. */
	func all() async throws -> [UInt8] {
		var out: [UInt8] = []
		while let bytes = try await next() { out.append(contentsOf: bytes) }
		return out
	}
}

/** An HTTP answer read whole: the status, the headers by lower-case name, the body. */
struct Response {
	let status: Int
	let headers: [String: String]
	let body: [UInt8]
}

/** Reads an HTTP/1.1 answer to a request sent with `Connection: close`. */
func readResponse(_ reader: Reader) async throws -> Response {
	let head = try await readHead(reader)
	return Response(status: head.status, headers: head.headers, body: try await Body(head, reader).all())
}
