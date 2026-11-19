import Foundation
import Testing
@testable import PineCore

/** A daemon that notes whether it was asked anything, and answers nothing. */
private final class Untouched: Daemon, @unchecked Sendable {
	let token = "secret-token"
	let end = Loopback(host: "127.0.0.1", port: 7463)
	private let lock = NSLock()
	private var _opened = false
	var opened: Bool { lock.withLock { _opened } }

	func open() async throws -> Duplex {
		lock.withLock { _opened = true }
		throw HTTPTrouble("nobody")
	}
}

/** A connection that answers with fixed bytes and notes what was sent. */
private final class Canned: Duplex, @unchecked Sendable {
	private let lock = NSLock()
	private var answer: [UInt8]?
	private(set) var sent: [UInt8] = []

	init(_ answer: String) {
		self.answer = Array(answer.utf8)
	}

	func write(_ bytes: [UInt8]) async throws { lock.withLock { sent += bytes } }
	func read() async throws -> [UInt8]? {
		lock.withLock {
			defer { answer = nil }
			return answer
		}
	}
	func close() {}
}

/** A daemon that answers every request with a status and a content type, and an empty body. */
private final class Answering: Daemon, @unchecked Sendable {
	let token = "secret-token"
	let end = Loopback(host: "127.0.0.1", port: 7463)
	let conn: Canned

	init(status: Int, type: String?) {
		conn = Canned("HTTP/1.1 \(status) X\r\n\(type.map { "Content-Type: \($0)\r\n" } ?? "")Content-Length: 0\r\n\r\n")
	}

	func open() async throws -> Duplex { conn }
}

private func text(_ a: MediaAnswer) async throws -> String { String(decoding: try await a.body.all(), as: UTF8.self) }

/** Ten bytes, 0 to 9, as a video: sent with their length, or in chunks without one. */
private func video(_ rig: Rig, chunked: Bool) {
	rig.daemon[route: "/media/tool/clip"] = { x in
		x.head(200, ["content-type": "video/mp4"], length: chunked ? 0 : 10)
		x.write(Array(0..<5))
		x.write(Array(5..<10))
	}
}

// Pictures, video and sound straight from the daemon through a real SSH session, as MediaTest.kt
// proves `mediaFromDaemon` for Android: only the listed paths, only what is drawn or played, and
// for a player, the part of a video or a sound it asks for.
struct MediaDaemonTests {
	@Test("only the listed paths, and only what is drawn or played")
	func shown() async throws {
		try await withRig { rig in
			rig.daemon[route: "/media/tool/pic"] = { x in
				x.head(200, ["content-type": "image/png"], length: StandInDaemon.PNG.count)
				x.write(StandInDaemon.PNG)
			}
			rig.daemon[route: "/media/tool/clip"] = { x in
				// Sent in chunks, without a length: none is claimed.
				x.head(200, ["content-type": "video/mp4"], length: 0)
				x.write("MP4")
			}
			rig.daemon[route: "/media/tool/page"] = { x in
				x.head(200, ["content-type": "text/html"], length: 0)
				x.write("<script>")
			}
			rig.daemon[route: "/media/tool/drawing"] = { x in
				x.head(200, ["content-type": "image/svg+xml"], length: 0)
				x.write("<svg/>")
			}
			rig.daemon[route: "/media/tool/gone"] = { x in x.head(404, length: -1) }
			let s = try await rig.connected()
			let ok = await mediaFromDaemon(s, method: "GET", path: "/media/tool/pic", search: "?v=1")
			#expect(ok.status == 200)
			#expect(try await ok.body.all() == Data(StandInDaemon.PNG))
			#expect(ok.headers == ["content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-length": "\(StandInDaemon.PNG.count)"])
			let seen = try #require(rig.daemon.seen.first)
			#expect(seen.url == "/media/tool/pic?v=1")
			#expect(seen.method == "GET")
			#expect(seen.header("authorization") == "Bearer secret-token")
			#expect(seen.header("origin") == nil)

			let clip = await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "")
			#expect(clip.status == 200)
			#expect(try await text(clip) == "MP4")
			#expect(clip.headers["content-length"] == nil)

			let page = await mediaFromDaemon(s, method: "GET", path: "/media/tool/page", search: "")
			#expect(page.status == 415)
			#expect(try await text(page) == "not shown")
			#expect(await mediaFromDaemon(s, method: "GET", path: "/media/tool/drawing", search: "").status == 415)
			let gone = await mediaFromDaemon(s, method: "GET", path: "/media/tool/gone", search: "")
			#expect(gone.status == 404)
			#expect(try await text(gone) == "not found")
		}
	}

	@Test("a player gets the part of a video it asks for, and is told it may ask")
	func ranges() async throws {
		try await withRig { rig in
			video(rig, chunked: false)
			let s = try await rig.connected()
			let get = { (range: String?) in await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "", range: range) }

			let whole = await get(nil)
			#expect(whole.status == 200)
			#expect(whole.headers["accept-ranges"] == "bytes")
			#expect(whole.headers["content-length"] == "10")
			#expect(try await whole.body.all() == Data(0..<10))

			let part = await get("bytes=2-5")
			#expect(part.status == 206)
			#expect(part.headers["content-range"] == "bytes 2-5/10")
			#expect(part.headers["content-length"] == "4")
			#expect(part.headers["content-type"] == "video/mp4")
			#expect(part.headers["cache-control"] == "no-store")
			#expect(part.headers["x-content-type-options"] == "nosniff")
			#expect(try await part.body.all() == Data(2...5))
			// The daemon was asked for the part; this one (an older pine) sent the whole, and the phone cut it.
			#expect(rig.daemon.seen.last?.header("range") == "bytes=2-5")

			let first = await get("bytes=0-1")
			#expect(first.headers["content-range"] == "bytes 0-1/10")
			#expect(try await first.body.all() == Data([0, 1]))
			let tail = await get("bytes=-3")
			#expect(tail.headers["content-range"] == "bytes 7-9/10")
			#expect(try await tail.body.all() == Data(7...9))
			let open = await get("bytes=4-")
			#expect(open.headers["content-range"] == "bytes 4-9/10")
			#expect(try await open.body.all() == Data(4...9))
			let beyond = await get("bytes=6-100")
			#expect(beyond.headers["content-range"] == "bytes 6-9/10")
			#expect(try await beyond.body.all() == Data(6...9))

			let none = await get("bytes=10-")
			#expect(none.status == 416)
			#expect(none.headers["content-range"] == "bytes */10")
			// What is not one range of bytes gets the whole, as HTTP allows.
			#expect(await get("bytes=0-1,4-5").status == 200)
			#expect(await get("items=0-1").status == 200)
		}
	}

	@Test("a video sent without its length is still cut, and a picture is never")
	func rangesOfChunks() async throws {
		try await withRig { rig in
			video(rig, chunked: true)
			rig.daemon[route: "/media/tool/pic"] = { x in
				x.head(200, ["content-type": "image/png"], length: StandInDaemon.PNG.count)
				x.write(StandInDaemon.PNG)
			}
			let s = try await rig.connected()
			let part = await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "", range: "bytes=3-6")
			#expect(part.status == 206)
			#expect(part.headers["content-range"] == "bytes 3-6/10")
			#expect(try await part.body.all() == Data(3...6))
			let picture = await mediaFromDaemon(s, method: "GET", path: "/media/tool/pic", search: "", range: "bytes=0-1")
			#expect(picture.status == 200)
			#expect(picture.headers["content-range"] == nil)
			#expect(try await picture.body.all() == Data(StandInDaemon.PNG))
		}
	}

	@Test("a daemon that answers a part sends only that part, and the page gets its answer as it is")
	func rangesFromDaemon() async throws {
		try await withRig { rig in
			// A daemon of this version: one range of bytes, 206 with that part alone, 416 past the end.
			let clip = Array(UInt8(0)..<UInt8(100))
			rig.daemon[route: "/media/tool/clip"] = { x in
				let asked = x.request.header("range").flatMap { wholeMatch(#"bytes=(\d+)-(\d+)"#, $0) }
				guard let asked, let from = Int(asked[1]), let to = Int(asked[2]) else {
					x.head(200, ["content-type": "video/mp4", "accept-ranges": "bytes"], length: clip.count)
					x.write(clip)
					return
				}
				if from >= clip.count {
					x.head(416, ["content-type": "video/mp4", "content-range": "bytes */\(clip.count)"], length: -1)
					return
				}
				let part = Array(clip[from...min(to, clip.count - 1)])
				x.head(206, ["content-type": "video/mp4", "accept-ranges": "bytes", "content-range": "bytes \(from)-\(from + part.count - 1)/\(clip.count)"], length: part.count)
				x.write(part)
			}
			let s = try await rig.connected()
			let part = await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "", range: "bytes=90-94")
			#expect(part.status == 206)
			#expect(part.headers == ["content-type": "video/mp4", "cache-control": "no-store", "x-content-type-options": "nosniff", "accept-ranges": "bytes", "content-range": "bytes 90-94/100", "content-length": "5"])
			#expect(try await part.body.all() == Data(90...94))
			#expect(rig.daemon.seen.last?.header("range") == "bytes=90-94")

			let none = await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "", range: "bytes=100-120")
			#expect(none.status == 416)
			#expect(none.headers["content-range"] == "bytes */100")
		}
	}

	@Test("only a plain range of bytes is passed on to the daemon")
	func rangeHeaderKept() async throws {
		try await withRig { rig in
			video(rig, chunked: false)
			let s = try await rig.connected()
			let odd = await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "", range: "bytes=0-1\r\nX-Evil: 1")
			#expect(odd.status == 200)
			#expect(rig.daemon.seen.last?.header("range") == nil)
			#expect(rig.daemon.seen.last?.header("x-evil") == nil)
			_ = await mediaFromDaemon(s, method: "GET", path: "/media/tool/clip", search: "", range: "bytes=0-1,4-5")
			#expect(rig.daemon.seen.last?.header("range") == nil)
		}
	}

	@Test("before a daemon there are no media")
	func noDaemon() async throws {
		let r = await mediaFromDaemon(nil, method: "GET", path: "/media/tool/pic", search: "")
		#expect(r.status == 404)
		#expect(try await text(r) == "not found")
	}

	@Test("what is not one of the daemon's media never leaves the phone", arguments: try cases("media-paths"))
	func paths(_ c: Case) async throws {
		let daemon = Untouched()
		let r = await mediaFromDaemon(daemon, method: c.text("method")!, path: c.text("path")!, search: c.text("search")!)
		#expect(daemon.opened == c.expect as! Bool)
		if !daemon.opened {
			#expect(r.status == 404)
			#expect(try await text(r) == "not found")
		}
	}

	@Test("only what is drawn or played reaches the page", arguments: try cases("media-types"))
	func types(_ c: Case) async throws {
		let daemon = Answering(status: c.fields["status"] as! Int, type: c.text("contentType"))
		let r = await mediaFromDaemon(daemon, method: "GET", path: "/media/tool/pic", search: "")
		#expect(r.status == c.expect as! Int)
		#expect(String(decoding: daemon.conn.sent, as: UTF8.self).components(separatedBy: "\r\n")[0] == "GET /media/tool/pic HTTP/1.1")
	}
}
