import Foundation
import Testing
@testable import PineCore

/** /health answers with `status`. */
func health(_ rig: Rig, _ status: Int) {
	rig.daemon[route: "/health"] = { x in
		x.head(status, ["content-type": "application/json"], length: 2)
		x.write("{}")
	}
}

/** The event stream opens and holds until `hold` is let go. */
func streams(_ rig: Rig, _ hold: Hold) {
	rig.daemon[route: "/events/stream"] = { x in
		stream(x, ": connected\n\n")
		await hold.wait()
	}
}

// A machine's pine held across the app's life, as HeldTest.kt proves it: checked with /health before
// it is used again, and connected anew when the event stream is lost five times in a row.
struct HeldTests {
	@Test("whether a daemon still answers is asked of health, without the token, and in a bounded time")
	func health200() async throws {
		try await withRig { rig in
			let hold = Hold()
			defer { hold.release() }
			let s = try await rig.connected()
			health(rig, 200)
			#expect(await answers(s))
			let seen = try #require(rig.daemon.seen.last)
			#expect(seen.url == "/health")
			#expect(seen.header("authorization") == nil)
			health(rig, 503)
			#expect(await !answers(s))
			rig.daemon[route: "/health"] = { _ in await hold.wait() }
			let started = ContinuousClock.now
			#expect(await !answers(s, within: .milliseconds(200)))
			#expect(ContinuousClock.now - started < .milliseconds(1500))
			rig.machine.behaviour = Machine.service(#"{"base":"http://127.0.0.1:\#(try freePort())","token":"t"}"#)
			#expect(await !answers(try await rig.connected()))
		}
	}

	@Test("a held session is used again while it answers, and made again when it does not")
	func reused() async throws {
		try await withRig { rig in
			let hold = Hold()
			defer { hold.release() }
			streams(rig, hold)
			health(rig, 200)
			let heard = Heard()
			let h = HeldRemote(remote: rig.remote, host: rig.host, on: heard, retry: .milliseconds(20))
			rig.atEnd { await h.stop() }
			let first = try await h.ensure()
			try await eventually("the stream open") { heard.ups.contains(true) }
			#expect(try await h.ensure() === first)
			#expect(rig.machine.commands == 1)
			health(rig, 503)
			let second = try await h.ensure()
			#expect(second !== first)
			#expect(rig.machine.commands == 2)
			try await eventually("the session that no longer answered was let go of") { rig.machine.leashesEnded == 1 }
			#expect(h.service === second)
		}
	}

	@Test("five losses in a row make a new SSH session")
	func fiveLosses() async throws {
		try await withRig { rig in
			let hold = Hold()
			defer { hold.release() }
			// Which session each attempt came in on.
			let sessions = Heard()
			rig.daemon[route: "/events/stream"] = { x in
				sessions.batch([rig.machine.commands])
				x.head(500, length: -1)
			}
			let heard = Heard()
			let h = HeldRemote(remote: rig.remote, host: rig.host, on: heard, failed: { e in heard.batch([e]) }, retry: .milliseconds(20))
			rig.atEnd { await h.stop() }
			let first = try await h.ensure()
			try await eventually("a second session") { rig.machine.commands >= 2 }
			streams(rig, hold)
			try await eventually("the stream open on it") { heard.ups.last == true }
			#expect(sessions.batches.filter { $0.first as? Int == 1 }.count == 5, "the first session was tried five times")
			#expect(Array(heard.ups.prefix(5)) == [false, false, false, false, false])
			#expect(h.service !== first)
			#expect(!first.isOpen)
			#expect(heard.batches.isEmpty, "nothing failed")
		}
	}

	@Test("a new session that cannot be made is said")
	func cannotBeMade() async throws {
		try await withRig { rig in
			rig.daemon[route: "/events/stream"] = { x in x.head(500, length: -1) }
			let failures = Heard()
			let h = HeldRemote(remote: rig.remote, host: rig.host, on: Heard(), failed: { e in failures.batch([e]) }, retry: .milliseconds(20))
			rig.atEnd { await h.stop() }
			try await h.ensure()
			try rig.known.forget(host: "127.0.0.1", port: rig.machine.port)
			try await eventually("the failure said") { !failures.batches.isEmpty }
			#expect((failures.batches.first?.first as? RemoteError)?.hostKey != nil)
			#expect(h.service == nil)
		}
	}
}
