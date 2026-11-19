// The iOS app from end to end, inside the app itself (a hosted test: it runs in the app's process,
// on the simulator), driven by mobile/scripts/smoke-ios.mjs (`npm run smoke:ios`), which starts the
// machine (SmokeMachine.kt: an SSH server on this Mac's loopback running the real `pine service`
// with the scripted model) and answers what the test asks of the Mac. Without that run's folder
// (PINE_SMOKE_DIR) every test here is skipped.
//
// It is the test of the web view's hardening in PineViewController.swift and PinePlugin.swift,
// which no other suite reaches: each is a named check, written to the run's folder and failing the
// run. The page is driven as a person would, through its own elements, by JavaScript evaluated in
// it (WebKit counts that as a user's gesture). The run's folder is on the Mac: a simulator's app
// reads and writes the Mac's files.
import Capacitor
import UIKit
import WebKit
import XCTest
@testable import App

@MainActor
final class SmokeTests: XCTestCase {
	private var dir: URL!
	private var machine: [String: String] = [:]
	private var asked = 0
	/** WebKit's objects made for the delegate, kept for the run: they are never let go of half made. */
	private static var kept: [AnyObject] = []
	private var kept: [AnyObject] {
		get { Self.kept }
		set { Self.kept = newValue }
	}

	override func setUp() async throws {
		guard let path = ProcessInfo.processInfo.environment["PINE_SMOKE_DIR"] else { throw XCTSkip("Run by npm run smoke:ios in mobile/.") }
		dir = URL(fileURLWithPath: path)
		machine = try JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent("machine.json"))) as! [String: String]
	}

	// ---- the first start, the machine, the hardening, the app's life, the status bar ----------------

	func testFromFirstStartToTheAgents() async throws {
		let vc = try await bridge()
		let web = try XCTUnwrap(vc.webView)
		let plugin = try XCTUnwrap(vc.plugin)
		var opened: [String] = []
		plugin.opener = { opened.append($0.absoluteString) }

		step("the first start: the page asks for a machine and shows the phone's key")
		try await until("the Gate's Choose a machine", "document.body.innerText.includes('Choose a machine')")
		let key = try await until("the phone's key", "document.body.innerText.match(/ssh-ed25519 \\S+ pine-ios/)?.[0] ?? ''") as! String
		try (key + "\n").write(to: URL(fileURLWithPath: machine["keys"]!), atomically: true, encoding: .utf8)
		try key.write(to: dir.appendingPathComponent("key.txt"), atomically: true, encoding: .utf8)

		step("Share hands the key to the system's share sheet")
		try await click("Share")
		try await waitFor("the share sheet") { vc.presentedViewController is UIActivityViewController }
		check("the key goes to the share sheet", vc.presentedViewController is UIActivityViewController, true)
		vc.dismiss(animated: false)

		let host = machine["host"]!
		step("adding \(host)")
		try await js("""
			const i = document.querySelector('input[placeholder="you@server"]');
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, \(quoted(host)));
			i.dispatchEvent(new Event('input', { bubbles: true }));
			return true;
			""")
		try await click("Add")
		try await until("the machine in the list", "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Use')")
		try await click("Use")

		step("the host key is put to the owner, with the machine's fingerprint")
		let shown = try await until("the host key's fingerprint", "document.querySelector('[data-slot=host-key-fingerprint]')?.textContent ?? ''") as! String
		check("the fingerprint shown is the machine's", shown, machine["fingerprint"]!)
		try await js("document.querySelector('[data-slot=trust-host-key]').click(); return true")

		step("connected: the agents of that pine")
		try await connected(seconds: 120)
		seen("first start to the agents: main and scout are in the side bar", try await agentsShown(), true)
		try await mac("shot agents.png")
		let layout = try await js("const s = document.querySelector('[data-slot=sidebar][data-mobile]')?.getBoundingClientRect(); return JSON.stringify({ inner: innerWidth, innerH: innerHeight, scroll: document.documentElement.scrollWidth, screen: screen.width, sheet: s && [s.left, s.top, s.width, s.height], vv: visualViewport && [visualViewport.offsetLeft, visualViewport.offsetTop, visualViewport.width, visualViewport.scale] })") as? String ?? ""
		check("the page fits the screen's width, not zoomed into a field", try await js("return document.documentElement.scrollWidth <= innerWidth && innerWidth === screen.width && visualViewport.scale === 1") as? Bool, true, detail: layout)
		// The sheet is put away by its own button, as the owner would.
		try await until("the side bar put away", "(() => { const open = document.querySelector('[data-slot=sidebar][data-mobile]'); open && document.querySelector('[aria-label=\"Hide the sidebar\"]')?.click(); return !open; })()")

		step("the page's hardening")
		let here = "return location.href"
		let home = try await js(here) as? String ?? "none"
		check("the page is the app's own (capacitor://localhost)", home.hasPrefix("capacitor://localhost"), true, detail: home)
		seen("Capacitor's bridge runs under the page's policy", try await js("return typeof Capacitor === 'object' && Capacitor.isNativePlatform() && Capacitor.getPlatform()"), "ios")
		seen("the policy is the page's own (script-src 'self')", try await js("return /script-src 'self'(;|$)/.test(document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content ?? '')"), true)
		seen("an inline script added to the page does not run", try await js("return await new Promise((r) => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.append(s); setTimeout(() => r(window.__inline === 1), 300); })"), false)
		check("the page's UI delegate is pine's", web.uiDelegate === vc.pageUI, true)
		let ui = try XCTUnwrap(vc.pageUI)
		// The page has no way to ask for the camera or the microphone: WebKit offers getUserMedia only
		// to an app that says why it would use them (Info.plist), and Pine says it of neither.
		for (what, constraints) in [("camera", "{ video: true }"), ("microphone", "{ audio: true }")] {
			let got = try await js("const m = navigator.mediaDevices; if (!m || !m.getUserMedia) return 'no way to ask'; return await m.getUserMedia(\(constraints)).then(() => 'given', (e) => e.name)") as? String
			check("permission denial: the page cannot have the \(what)", got != nil && got != "given", true, detail: got ?? "nil")
		}
		// Were it offered, the delegate says no: asked here as WebKit would ask it (Capacitor's says yes).
		let frame = try made(WKFrameInfo.self)
		let origin = try made(WKSecurityOrigin.self)
		for (what, type) in [("camera", WKMediaCaptureType.camera), ("microphone", .microphone), ("camera and microphone", .cameraAndMicrophone)] {
			var decision: WKPermissionDecision?
			ui.webView(web, requestMediaCapturePermissionFor: origin, initiatedByFrame: frame, type: type) { decision = $0 }
			check("permission denial: the UI delegate refuses the \(what)", decision, .deny)
		}
		var motionDecision: WKPermissionDecision?
		ui.webView(web, requestDeviceOrientationAndMotionPermissionFor: origin, initiatedByFrame: frame) { motionDecision = $0 }
		check("permission denial: the UI delegate refuses the motion sensors", motionDecision, .deny)
		let motion = try await js("return typeof DeviceOrientationEvent.requestPermission !== 'function' ? 'no way to ask' : await DeviceOrientationEvent.requestPermission().then((r) => r, (e) => e.name)") as? String
		check("permission denial: the page cannot have the motion sensors", motion != nil && motion != "granted", true, detail: motion ?? "nil")
		seen("no file access: a file: address cannot be fetched", try await js("return await fetch('file:///etc/hosts').then(() => 'read', () => 'refused')"), "refused")
		check("link previews are off", web.allowsLinkPreview, false)
		check("the page lies below the status bar, and does not scroll under it", web.scrollView.adjustedContentInset.top >= vc.view.safeAreaInsets.top && vc.view.safeAreaInsets.top > 0 && !web.scrollView.isScrollEnabled, true, detail: "inset \(web.scrollView.adjustedContentInset.top), safe area \(vc.view.safeAreaInsets.top), scrolls \(web.scrollView.isScrollEnabled)")

		let tone = "pine-media://daemon/agents/scout/image?path=tone.wav"
		// What the scheme answers, asked as WebKit asks it (a fetch from the page would need a CORS answer the desktop does not give either).
		let off = await vc.media.answer(URLRequest(url: URL(string: "pine-media://daemon/not/a/media/path")!), in: web)
		check("media: a path off the list is 404", off.status, 404)
		var part = URLRequest(url: URL(string: tone)!)
		part.setValue("bytes=0-99", forHTTPHeaderField: "Range")
		let got = await vc.media.answer(part, in: web)
		check("media: a sound is answered in parts (206, content-range)", "\(got.status) \(got.header("content-range") ?? "none") \(got.body.count)", "206 bytes 0-99/\(machine["toneBytes"]!) 100")
		seen("media: a sound plays", try await js("""
			const a = new Audio('\(tone)');
			return await new Promise((r) => {
				a.onerror = () => r('error ' + (a.error && a.error.code));
				a.onloadedmetadata = () => a.play().then(() => { a.pause(); r('played ' + Math.round(a.duration)); }, (e) => r('not played: ' + e.name));
				setTimeout(() => r('no answer'), 10000);
			});
			"""), "played 1")

		let windowsBefore = webViews(in: vc.view.window)
		seen("no window: window.open gives nothing", try await js("return [window.open('https://example.com/'), window.open('sms:+15555550100'), window.open('file:///etc/hosts')].every((w) => w === null)"), true)
		try await settle()
		check("no window: no second web view, the page where it is", [webViews(in: vc.view.window) == windowsBefore && windowsBefore == 1, try await js(here) as? String == home], [true, true])
		check("no window: an address of the web is handed to Safari, nothing else", opened, ["https://example.com/"])
		opened.removeAll()

		for address in ["file:///etc/hosts", "sms:+15555550100", "tel:+15555550100", "itms-apps://apps.apple.com/", "intent://x#Intent;scheme=market;end"] {
			try await js("location.href = \(quoted(address)); return true")
			try await settle()
		}
		check("navigation: other schemes lead nowhere (file:, sms:, tel:, itms-apps:, intent:)", [try await js(here) as? String ?? "", opened.joined()], [home, ""])
		check("navigation: the app stays in front", UIApplication.shared.applicationState == .active, true)
		try await js("location.href = 'https://example.com/'; return true")
		try await settle()
		check("navigation: an address of the web is handed to Safari, not loaded in the page", [try await js(here) as? String ?? "", opened.joined()], [home, "https://example.com/"])

		step("back from the background, still on the machine")
		var left = 0
		let gone = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in left += 1 }
		defer { NotificationCenter.default.removeObserver(gone) }
		try await mac("background")
		try await waitFor("the app in front again") { UIApplication.shared.applicationState == .active }
		check("the app went to the background", left > 0, true)
		try await connected(seconds: 60)
		check("still connected after going to the background and back", plugin.pines?.connected, true)

		step("the status bar takes the theme: light icons on a dark theme, dark ones on a light theme")
		try await bars(vc, theme: try await js("return (await window.pine.call('GET', '/themes')).data.theme") as! String, dark: true, shot: "bars-dark.png")
		let set = try await js("return (await window.pine.call('POST', '/settings', { key: 'ui.theme', value: 'github-light' })).ok")
		XCTAssertEqual(set as? Bool, true, "the theme could not be set")
		try await js("location.reload(); return true")
		try await connected(seconds: 60)
		try await bars(vc, theme: "github-light", dark: false, shot: "bars-light.png")
	}

	// ---- the Keychain key, after the app was started again --------------------------------------------

	func testTheKeySurvivesARelaunch() async throws {
		_ = try await bridge()
		let before = try String(contentsOf: dir.appendingPathComponent("key.txt"), encoding: .utf8)
		let now = try await until("the phone's key from the plugin", "return (await Capacitor.Plugins.Pine.publicKey()).key", body: true) as? String
		check("the Keychain key survives a relaunch of the app", now, before)
	}

	// ---- helpers --------------------------------------------------------------------------------------

	private func step(_ text: String) { print("- \(text)") }

	/** A named check: written to the run's folder for the script to list, and a failure of this test when it does not hold. */
	private func check<T: Equatable>(_ name: String, _ got: T, _ want: T, detail: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
		let ok = got == want
		let text = ok ? "ok\t\(name)\n" : "NOT OK\t\(name)\t\(detail ?? "got \(got), wanted \(want)")\n"
		let out = dir.appendingPathComponent("checks.txt")
		if let h = try? FileHandle(forWritingTo: out) {
			h.seekToEndOfFile()
			h.write(Data(text.utf8))
			try? h.close()
		} else {
			try? text.write(to: out, atomically: true, encoding: .utf8)
		}
		XCTAssert(ok, "\(name): \(detail ?? "got \(got), wanted \(want)")", file: file, line: line)
	}

	/** A named check of what the page gave back. */
	private func seen(_ name: String, _ got: Any?, _ want: Int) { check(name, (got as? NSNumber)?.intValue, want) }
	private func seen(_ name: String, _ got: Any?, _ want: String) { check(name, got as? String, want) }
	private func seen(_ name: String, _ got: Any?, _ want: Bool) { check(name, (got as? NSNumber)?.boolValue, want) }

	/** The app's bridge view controller, once its page has loaded. */
	private func bridge() async throws -> PineViewController {
		var found: PineViewController?
		try await waitFor("the app's window") {
			found = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController as? PineViewController }.first
			return found?.webView != nil && found?.plugin != nil
		}
		try await until("the page", "document.readyState === 'complete' && !!window.pine")
		return found!
	}

	private var web: WKWebView? {
		(UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow?.rootViewController as? PineViewController }.first)?.webView
	}

	/** Runs `body` as an async function in the page and gives back what it returns. */
	@discardableResult
	private func js(_ body: String) async throws -> Any? {
		guard let web else { throw Missing(what: "the web view") }
		return try await web.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
	}

	/** Waits until `expression` (or a function body, with `body`) is truthy in the page, and gives it back. */
	@discardableResult
	private func until(_ what: String, _ expression: String, body: Bool = false, seconds: Double = 90) async throws -> Any {
		var last: Any?
		let deadline = Date().addingTimeInterval(seconds)
		while Date() < deadline {
			last = try? await js(body ? expression : "return \(expression)")
			if let v = last, !(v is NSNull), (v as? String) != "", (v as? NSNumber)?.boolValue != false { return v }
			try await Task.sleep(for: .milliseconds(300))
		}
		let screen = (try? await js("return document.body.innerText.slice(0, 1500)")) as? String ?? ""
		throw Missing(what: "\(what). On screen: \(screen)")
	}

	private func waitFor(_ what: String, seconds: Double = 30, _ ok: () -> Bool) async throws {
		let deadline = Date().addingTimeInterval(seconds)
		while !ok() {
			if Date() > deadline { throw Missing(what: what) }
			try await Task.sleep(for: .milliseconds(200))
		}
	}

	private func click(_ text: String) async throws {
		try await until("the button \(text)", "(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === \(quoted(text)) && !b.disabled); b?.click(); return !!b; })()")
	}

	private func settle() async throws { try await Task.sleep(for: .milliseconds(1500)) }

	/** The page past the Gate, on the machine's pine. */
	private func connected(seconds: Double) async throws {
		try await until("the page past the Gate", "!/Choose a machine|is not reached|Connecting to|Starting pine/.test(document.body.innerText) && window.pine && (await window.pine.call('GET', '/agents')).ok", body: false, seconds: seconds)
	}

	private func agentsShown() async throws -> Any {
		// On a phone the side bar is a sheet, opened by the page's own button. The page puts the sheet away when
		// another conversation comes to the front (the main one does, once connected): it is opened again until it stays.
		return try await until("main and scout in the side bar", """
			(() => {
				const t = [...document.querySelectorAll('[data-slot=agent-label]')].map((e) => e.textContent);
				if (t.some((x) => x.includes('main')) && t.some((x) => x.includes('scout'))) return true;
				if (!document.querySelector('[role=dialog]')) (document.querySelector('[aria-label="Show the sidebar"]') ?? document.querySelector('[data-sidebar=trigger]'))?.click();
				return false;
			})()
			""")
	}

	private func webViews(in view: UIView?) -> Int {
		guard let view else { return 0 }
		return (view is WKWebView ? 1 : 0) + view.subviews.reduce(0) { $0 + webViews(in: $1) }
	}

	/** Asks the Mac for something only it can do (a screenshot, the app sent to the background) and waits for it to be done. */
	private func mac(_ command: String) async throws {
		asked += 1
		let done = dir.appendingPathComponent("done-\(asked)")
		try command.write(to: dir.appendingPathComponent("ask-\(asked)"), atomically: true, encoding: .utf8)
		try await waitFor("the Mac to \(command)", seconds: 60) { FileManager.default.fileExists(atPath: done.path) }
	}

	/** The status bar's style and the colour under it (the window's top left corner), for a theme of the machine's pine. */
	private func bars(_ vc: PineViewController, theme: String, dark: Bool, shot: String) async throws {
		let bg = try await js("return (await window.pine.call('GET', '/themes')).data.themes.find((t) => t.id === \(quoted(theme)))?.colors?.bg?.slice(0, 7).toLowerCase()") as? String ?? "none"
		var colour = ""
		let style: UIStatusBarStyle = dark ? .lightContent : .darkContent
		try? await waitFor("the status bar in \(bg) (\(theme))") {
			colour = topLeft(vc.view.window)
			return near(colour, bg) && vc.preferredStatusBarStyle == style
		}
		check("status bar: \(dark ? "light icons on the dark" : "dark icons on the light") theme \(theme)", vc.preferredStatusBarStyle == style, true)
		check("status bar: the colour under it is the theme's (\(theme))", near(colour, bg), true, detail: "\(colour), the theme's \(bg)")
		try await mac("shot \(shot)")
	}

	/**
	 * Two #rrggbb colours a few steps apart at most in each channel. What the screen draws goes through a
	 * colour space of its own; and the page focuses its message box when it starts, so that WebKit pushes it
	 * up above the keyboard and the top of the page's own surface (a shade off its background) lies under the bar.
	 */
	private func near(_ a: String, _ b: String) -> Bool {
		let channels = { (c: String) in stride(from: 1, to: 7, by: 2).compactMap { i in c.count == 7 ? Int(c.dropFirst(i).prefix(2), radix: 16) : nil } }
		let (x, y) = (channels(a), channels(b))
		return x.count == 3 && y.count == 3 && zip(x, y).allSatisfy { abs($0 - $1) <= 6 }
	}

	private func topLeft(_ window: UIWindow?) -> String {
		guard let window else { return "" }
		let format = UIGraphicsImageRendererFormat()
		format.scale = 1
		let shot = UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
			window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
		}
		// The pixel at (2, 2), drawn into one pixel of a known layout: the first row and column may be an edge's blend.
		var rgba = [UInt8](repeating: 0, count: 4)
		guard let cg = shot.cgImage, let one = CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return "" }
		one.draw(cg, in: CGRect(x: -2, y: -CGFloat(cg.height) + 3, width: CGFloat(cg.width), height: CGFloat(cg.height)))
		return "#" + rgba.prefix(3).map { String(format: "%02x", $0) }.joined()
	}

	/** One of WebKit's objects that only WebKit makes (a frame, an origin), to ask the delegate with: it reads neither. */
	private func made<T>(_ type: T.Type) throws -> T {
		guard let cls = NSClassFromString(String(describing: type)) as? NSObject.Type, let made = cls.init() as? T else { throw Missing(what: "a \(type)") }
		kept.append(made as AnyObject)
		return made
	}

	private func quoted(_ s: String) -> String {
		String(decoding: try! JSONSerialization.data(withJSONObject: [s]), as: UTF8.self).dropFirst().dropLast().description
	}
}

/** A scheme task of the test's own: what the media scheme answers, recorded. */
private final class Recorded: NSObject, WKURLSchemeTask {
	let request: URLRequest
	var response: HTTPURLResponse?
	var body = Data()
	var done: CheckedContinuation<Void, Never>?

	init(_ request: URLRequest) {
		self.request = request
	}

	var status: Int { response?.statusCode ?? 0 }
	func header(_ name: String) -> String? { response?.value(forHTTPHeaderField: name) }
	func didReceive(_ response: URLResponse) { self.response = response as? HTTPURLResponse }
	func didReceive(_ data: Data) { body.append(data) }
	func didFinish() { end() }
	func didFailWithError(_ error: Error) { end() }

	private func end() {
		done?.resume()
		done = nil
	}
}

private extension MediaScheme {
	@MainActor func answer(_ request: URLRequest, in web: WKWebView) async -> Recorded {
		let task = Recorded(request)
		await withCheckedContinuation { (go: CheckedContinuation<Void, Never>) in
			task.done = go
			self.webView(web, start: task)
		}
		return task
	}
}

private struct Missing: Error, CustomStringConvertible {
	let what: String
	var description: String { "not seen: \(what)" }
}
