import Testing
import PineCore

// What `pine service` on the other machine says: its service line, and the words of a failure when
// it gives none. The cases are mobile/cases/service-lines.json and failures.json; ticket 04 reads
// them over a real SSH session too.
struct ServiceTests {
	let named = try! sshHost("me@127.0.0.1:2222")!

	private func matches(_ error: RemoteError, _ expect: [String: Any]) {
		#expect(error.kind == expect["kind"] as! String)
		#expect(error.message == (expect["message"] as! String).filled(["given": named.given, "label": named.label]))
	}

	@Test("the service line says where the daemon answers, or why it is not taken", arguments: try cases("service-lines"))
	func line(_ c: Case) throws {
		let expect = c.expect as! [String: Any]
		if let error = expect["error"] as? [String: Any] {
			do {
				let taken = try serviceLine(c.text("line")!, named: named)
				Issue.record("taken: \(taken)")
			} catch let e as RemoteError {
				matches(e, error)
			}
			return
		}
		let want = expect["service"] as! [String: Any]
		let s = try serviceLine(c.text("line")!, named: named)
		#expect(s.token == want["token"] as! String)
		#expect(s.home == want["home"] as! String)
		#expect(s.version == plain(want["version"]) as! String?)
		#expect(s.started == want["started"] as! Bool)
		#expect(s.end == Loopback(host: want["host"] as! String, port: want["port"] as! Int))
	}

	@Test("a command that gives no service line is said in words", arguments: try cases("failures"))
	func failed(_ c: Case) {
		matches(failure(given: named.given, stderr: c.text("stderr")!, exit: plain(c.fields["exit"]) as! Int?), c.expect as! [String: Any])
	}
}
