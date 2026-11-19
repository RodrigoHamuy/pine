// The native plugin without iOS: the machines the owner added, the one in use, its connection and
// what the page is told about it, as Pines.kt on Android. It is what desktop/electron/main.ts does
// for the desktop page (`startService`, `use`, `pine:hosts-add`, `pine:hosts-forget`, `follow`),
// with one thing more: a host key the phone does not know yet is put to the owner in the page, and
// trusted on their yes.
import Foundation

/** Where the plugin keeps what is not secret (the app's UserDefaults): text by name, nil to remove. */
public protocol Shelf: Sendable {
	func get(_ name: String) -> String?
	func set(_ name: String, _ value: String?)
}

/** What the page is told: the desktop's `pine:service`, `pine:events` and `pine:connection`. Called from tasks of the core, never from the main thread. */
public protocol Page: Sendable {
	func service(_ state: [String: Any])
	func events(_ batch: [Any])
	func connection(_ up: Bool)
}

/** How many machines the list holds at most, as on the desktop. */
public let MAX_HOSTS = 20

/**
 * The pines of the owner's machines, one shown at a time: the whole of what the Capacitor plugin
 * asks of the core (ticket 06). Each machine used is held (`HeldRemote`) until it is forgotten or
 * the app ends, so that switching back is quick and an agent at work on one goes on; only the one
 * in use speaks to the page.
 *
 * The plugin's methods map one to one: `state`, `ready`, `retry`, `call`, `use`, `addHost`,
 * `forgetHost`, `prefs`, `publicKey`, `trust` (trustHostKey), `forgetKey` (forgetHostKey), `check`
 * on the app's return to the front, and `media` for the `pine-media:` scheme handler. What the
 * page is told comes through `Page`. The methods that throw throw a `RemoteError` whose `message`
 * is for the owner (or a `SecretStoreError` from the Keychain); the async ones are called from a
 * `Task` of the plugin. Everything here may be called from any thread.
 */
public final class Pines: @unchecked Sendable {
	private let remote: Remote
	private let known: KnownHosts
	private let shelf: Shelf
	private let page: Page
	private let retryEvery: Duration
	private let batch: Duration
	// Reentrant, as Kotlin's `synchronized`: the page is told under it, and a page that asks for the state as it is told stays safe.
	private let lock = NSRecursiveLock()
	private var held: [String: HeldRemote] = [:]
	/** Host keys seen and not known yet, by machine: what the owner's yes may trust. */
	private var unknown: [String: HostKeyRefusal] = [:]
	private var current: [String: Any] = ["status": "starting"]
	/** Which connection is the latest asked for: an older one that ends late changes nothing. */
	private var round = 0
	private var shown: String?
	private var begun = false
	private var closed = false
	/** Whether each held machine's event stream is up, by machine: what the page is told when it is shown again. */
	private var streams: [String: Bool] = [:]
	private var up = false

	public init(remote: Remote, shelf: Shelf, page: Page, retry: Duration = .seconds(1), batch: Duration = .milliseconds(24)) {
		self.remote = remote
		self.known = remote.known
		self.shelf = shelf
		self.page = page
		self.retryEvery = retry
		self.batch = batch
	}

	/** Whether the event stream of the machine in use is up. */
	public var connected: Bool { lock.withLock { up } }

	/** The machines, as the owner added them. */
	public var hosts: [String] {
		guard let text = shelf.get(Self.HOSTS), let list = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [Any] else { return [] }
		return list.compactMap { $0 as? String }
	}

	/** The machine in use: one of the list, or none. */
	public var inUse: String? { shelf.get(Self.USE).flatMap { hosts.contains($0) ? $0 : nil } }

	/** The page's own preferences, as the page gave them (JSON text): the core reads nothing in them. */
	public var prefs: String? {
		get { shelf.get(Self.PREFS) }
		set { shelf.set(Self.PREFS, newValue) }
	}

	/** This phone's public key, as a line for ~/.ssh/authorized_keys. */
	public func publicKey() throws -> String { try remote.key.publicKey() }

	/** The state as the page was last told it. */
	public func state() -> [String: Any] { lock.withLock { current } }

	/** The page has started: it is told the state, and on the first time the machine in use is connected to. */
	public func ready() {
		let first = lock.withLock {
			defer { begun = true }
			return !begun
		}
		if first { start(inUse) } else { page.service(state()) }
	}

	/** Add a machine: host, user@host or user@host:port, with a user, since a phone has no user name of its own. */
	@discardableResult
	public func addHost(_ value: String) throws -> [String] {
		guard let named = try sshHost(value) else { throw RemoteError("ssh", "Write the machine as you would after ssh: user@host, or user@host:port.") }
		if named.user == nil { throw RemoteError("ssh", "Name the user too: user@\(named.given). A phone has no user name of its own to sign in with.") }
		return try lock.withLock {
			let list = hosts
			if list.contains(named.given) { return list }
			if list.count >= MAX_HOSTS { throw RemoteError("ssh", "There are \(MAX_HOSTS) machines in the list already: forget one first.") }
			let next = list + [named.given]
			shelf.set(Self.HOSTS, Self.text(next))
			return next
		}
	}

	/**
	 * Take a machine out of the list and let go of its connection (a pine it started there stops).
	 * The one in use is refused while it is reached or being reached; one that could not be reached
	 * may go (its host key changed, say), and then no machine is in use.
	 */
	@discardableResult
	public func forgetHost(_ host: String) throws -> [String] {
		let (stop, wasInUse) = try lock.withLock { () throws -> (HeldRemote?, Bool) in
			let wasInUse = host == inUse
			if wasInUse && current["status"] as? String != "error" { throw RemoteError("ssh", "The app uses this machine now. Use another one first.") }
			if wasInUse { shelf.set(Self.USE, nil) }
			shelf.set(Self.HOSTS, Self.text(hosts.filter { $0 != host }))
			unknown[host] = nil
			streams[host] = nil
			return (held.removeValue(forKey: host), wasInUse)
		}
		if let stop { Task.detached { await stop.stop() } }
		if wasInUse { start(nil) }
		return hosts
	}

	/** Use the pine of a machine of the list: it is kept as the one in use, and connected to. */
	public func use(_ host: String) throws {
		guard hosts.contains(host) else { throw RemoteError("ssh", "That machine is not in the list: add it first.") }
		shelf.set(Self.USE, host)
		start(host)
	}

	/** Connect again to the machine in use. */
	public func retry() { start(inUse) }

	/**
	 * The owner's yes to the host key a connection stopped at: only the one the machine showed, never
	 * a key that changed. The machine in use is then connected to again.
	 */
	public func trust(host: String, fingerprint: String) throws {
		try lock.withLock {
			guard let seen = unknown[host] else { throw RemoteError("ssh", "No host key of \(host) waits for your yes: try again to connect.") }
			if seen.fingerprint != fingerprint { throw RemoteError("ssh", "That is not the key \(host) showed: try again to connect.") }
			try known.confirm(host: seen.host, port: seen.port, fingerprint: seen.fingerprint)
			unknown[host] = nil
		}
		if host == inUse { start(host) }
	}

	/** Forget the host key stored for a machine: the next connection shows its key again. */
	public func forgetKey(_ host: String) throws {
		guard let named = try? sshHost(host) else { return }
		try known.forget(host: named.host, port: named.port)
		lock.withLock { unknown[host] = nil }
	}

	/** One call of the control API to the pine in use (503 before there is one). */
	public func call(method: String, url: String, body: Any? = nil) async -> CallResult {
		await callDaemon(daemon(), method: method, url: url, body: body)
	}

	/** A picture, video or sound of the pine in use, under `mediaFromDaemon`'s rules; `range` is the page's `Range` header. */
	public func media(method: String, path: String, search: String, range: String? = nil) async -> MediaAnswer {
		await mediaFromDaemon(daemon(), method: method, path: path, search: search, range: range)
	}

	private func daemon() -> RemoteService? {
		lock.withLock {
			guard current["status"] as? String == "ready", let shown else { return nil }
			return held[shown]?.service
		}
	}

	/**
	 * The app came back to the front: the pine in use is asked whether it still answers (iOS may have
	 * cut the link meanwhile), and connected to again when it does not. A machine that could not be
	 * reached is tried again, except when its host key waits for the owner's yes. Returns when that is known.
	 */
	public func check() async {
		let found = lock.withLock { () -> (String, Int, RemoteService?)? in
			guard let host = shown else { return nil }
			let status = current["status"] as? String
			let kind = current["kind"] as? String ?? ""
			let again = status == "error" && host == inUse && ["ssh", "failed"].contains(kind) && current["fingerprint"] == nil
			if status != "ready" && !again { return nil }
			return (host, round, status == "ready" ? held[host]?.service : nil)
		}
		guard let (host, mine, service) = found else { return }
		if let service, service.isOpen, await answers(service) { return }
		let again = lock.withLock { () -> Int? in
			if mine != round { return nil }
			round += 1
			return round
		}
		guard let again else { return }
		show(again, Self.starting(host), host)
		await connect(host, again)
	}

	private func start(_ host: String?) {
		let mine = lock.withLock {
			round += 1
			return round
		}
		guard let host else { return show(mine, nobody(), nil) }
		show(mine, Self.starting(host), host)
		Task.detached { await self.connect(host, mine) }
	}

	private func connect(_ host: String, _ mine: Int) async {
		let h = lock.withLock { () -> HeldRemote? in
			if closed { return nil }
			if let h = held[host] { return h }
			let h = HeldRemote(remote: remote, host: host, on: Follow(self, host), failed: { [weak self] e in self?.lost(host, e) }, retry: retryEvery, batch: batch)
			held[host] = h
			return h
		}
		guard let h else { return }
		do {
			show(mine, Self.ready(try await h.ensure()), host)
		} catch {
			show(mine, failure(host, error), host)
		}
	}

	/**
	 * The page is told `next`, when it is still what the latest connection is about, and whether the
	 * shown machine's events flow when that changed: a held machine's stream may have been up all along.
	 */
	private func show(_ mine: Int, _ next: [String: Any], _ host: String?) {
		let told = lock.withLock { () -> (Bool, Bool)? in
			if mine != round || closed { return nil }
			let switched = shown != host
			let was = up
			up = next["status"] as? String == "ready" && host != nil && streams[host!] == true
			shown = host
			current = next
			// Told under the lock, so that the page hears the states in the order they were decided.
			page.service(next)
			return (switched || up != was, up)
		}
		if let (changed, now) = told, changed { page.connection(now) }
	}

	/** A held machine's events reach the page only while it is the one shown. */
	fileprivate func batch(_ host: String, _ events: [Any]) {
		if lock.withLock({ shown == host }) { page.events(events) }
	}

	fileprivate func stream(_ host: String, _ isUp: Bool) {
		let tell = lock.withLock { () -> Bool in
			if closed || held[host] == nil { return false }
			streams[host] = isUp
			if shown != host { return false }
			up = isUp
			return true
		}
		if tell { page.connection(isUp) }
	}

	/** A held machine whose session could not be made again after its stream was lost. */
	private func lost(_ host: String, _ e: Error) {
		guard let mine = lock.withLock({ shown == host ? round : nil }) else { return }
		show(mine, failure(host, e), host)
	}

	private func failure(_ host: String, _ e: Error) -> [String: Any] {
		var out: [String: Any] = ["status": "error", "host": host]
		switch e {
		case let e as RemoteError:
			if let key = e.hostKey {
				if !key.changed { lock.withLock { unknown[host] = key } }
				out["kind"] = "ssh"
				out["fingerprint"] = key.fingerprint
				out["changed"] = key.changed
				out["message"] = key.changed
					? "The host key of \(host) changed: it is now \(key.fingerprint), not the one this phone confirmed. Not connecting, since another machine may stand in for it. If that machine was reinstalled, forget it in the list of machines, add it again and confirm its new key."
					: "This phone does not know \(host) yet. Its host key's fingerprint is \(key.fingerprint). If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), press Trust this key to connect."
			} else {
				out["kind"] = e.kind
				out["message"] = e.message
			}
		default:
			out["kind"] = "failed"
			out["message"] = String(describing: e)
		}
		return out
	}

	private func nobody() -> [String: Any] {
		[
			"status": "error",
			"kind": "ssh",
			"message": hosts.isEmpty
				? "Add the machine whose pine this phone is to use, as you would write it after ssh: user@host, or user@host:port. Put this phone's key into ~/.ssh/authorized_keys there first."
				: "Choose the machine whose pine this phone is to use.",
		]
	}

	/** Lets go of every machine: a pine the app started there stops. */
	public func close() async {
		let all = lock.withLock {
			closed = true
			defer { held.removeAll() }
			return Array(held.values)
		}
		for h in all { await h.stop() }
	}

	private static let HOSTS = "hosts"
	private static let USE = "use"
	private static let PREFS = "prefs"

	private static func text(_ list: [String]) -> String {
		String(decoding: try! JSONSerialization.data(withJSONObject: list, options: [.withoutEscapingSlashes]), as: UTF8.self)
	}

	private static func starting(_ host: String) -> [String: Any] { ["status": "starting", "host": host] }

	private static func ready(_ s: RemoteService) -> [String: Any] {
		var out: [String: Any] = ["status": "ready", "mode": "on \(s.label)", "started": s.started, "home": "\(s.label):\(s.home)", "from": "ssh \(s.host)", "host": s.host, "label": s.label]
		if let v = s.version { out["version"] = v }
		return out
	}
}

/** A held machine's events, handed to the Pines that holds it. */
private final class Follow: EventHandlers, @unchecked Sendable {
	private weak var pines: Pines?
	private let host: String

	init(_ pines: Pines, _ host: String) {
		self.pines = pines
		self.host = host
	}

	func batch(_ events: [Any]) { pines?.batch(host, events) }
	func connection(_ up: Bool) { pines?.stream(host, up) }
}
