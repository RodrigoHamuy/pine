import Testing
import PineCore

// Where the page may go, what opens outside it, and which of its requests are the daemon's media,
// as desktop/electron/main.ts decides for the desktop page. The cases are mobile/cases/links.json.
struct LinksTests {
	@Test("only web addresses open outside, the page stays on its origin, and media are the paths under the media scheme", arguments: try cases("links"))
	func link(_ c: Case) {
		let url = c.text("url")!
		switch c.text("rule")! {
		case "outside": #expect(outside(url) == c.expect as! Bool, "\(url)")
		case "stays": #expect(stays(url) == c.expect as! Bool, "\(url)")
		case "media":
			let want = (c.expect as! [String: Any]?).map { MediaRequest(path: $0["path"] as! String, search: $0["search"] as! String) }
			#expect(mediaRequest(url) == want, "\(url)")
		case let rule: Issue.record("links.json: no rule \"\(rule)\"")
		}
	}
}
