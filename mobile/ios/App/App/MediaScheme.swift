// The daemon's pictures, video and sound for the page, at pine-media://daemon/<path on the daemon>:
// what PageClient.shouldInterceptRequest does on Android and the `pine-media:` protocol in
// desktop/electron/main.ts. The rules are the core's (`mediaRequest`, `mediaFromDaemon`): only the
// paths of the MEDIA list, only pictures, video and sound, never SVG. A video or a sound is answered
// in the parts the player asks for (206), so that it can seek.
import Foundation
import PineCore
import WebKit

final class MediaScheme: NSObject, WKURLSchemeHandler {
	/** The pines of the plugin, once it has loaded; before, every request is 404. */
	var pines: () -> Pines? = { nil }
	/** The tasks the web view has stopped: nothing more is told to them. */
	private var stopped = Set<ObjectIdentifier>()

	func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
		let request = task.request
		let id = ObjectIdentifier(task)
		let asked = request.url.flatMap { mediaRequest($0.absoluteString) }
		let pines = self.pines()
		Task { @MainActor in
			defer { self.stopped.remove(id) }
			let answer: MediaAnswer
			if let asked, let pines {
				answer = await pines.media(method: request.httpMethod ?? "GET", path: asked.path, search: asked.search, range: request.value(forHTTPHeaderField: "Range"))
			} else {
				answer = await mediaFromDaemon(nil, method: "GET", path: "", search: "")
			}
			guard self.live(id), let url = request.url else { return answer.body.close() }
			let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: answer.headers)!
			task.didReceive(response)
			do {
				while let data = try await answer.body.next() {
					guard self.live(id) else { return answer.body.close() }
					task.didReceive(data)
				}
				guard self.live(id) else { return }
				task.didFinish()
			} catch {
				if self.live(id) { task.didFailWithError(error) }
			}
		}
	}

	func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
		stopped.insert(ObjectIdentifier(task))
	}

	@MainActor private func live(_ id: ObjectIdentifier) -> Bool { !stopped.contains(id) }
}
