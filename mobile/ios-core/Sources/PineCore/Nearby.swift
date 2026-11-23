// Computers that announce themselves on the local network: the Pine app's Bonjour record
// (`_pine._tcp`, its TXT record `v=1`, `id=<machine id>`, `service=<https origin>`), read as the
// phone keeps it, and the list of those found, which the plugin hands the page as `nearby` events.
// What a record says is not trusted: the machine id is only where the phone looks, and the pairing
// checks the host key against it and shows the owner four digits on both screens (ADR 0005).
// The same in the Kotlin core (Nearby.kt).
import Foundation

/** The Bonjour service type the Pine app announces itself with. */
public let NEARBY_TYPE = "_pine._tcp"

/** The meeting service the Pine app uses unless the owner names another (desktop/src/machines.ts `OFFICIAL_SERVICE`). */
public let OFFICIAL_SERVICE = "https://pine-main.drcmda.workers.dev"

/** A computer found on the network: its machine id and the meeting service it is reached through. */
public struct NearbyComputer: Equatable, Sendable {
	public let id: String
	public let service: String

	public init(id: String, service: String) {
		self.id = id
		self.service = service
	}

	/** As the page is told it. */
	public var json: [String: String] { ["id": id, "service": service] }
}

/**
 * What the phone keeps of a TXT record, its keys in any case (RFC 6763 says they are compared
 * without it); nil for a record it ignores: a version other than 1, no machine id or one of another
 * shape, a service that is not an https origin. A record without a service names the official one.
 * A key given without a value is `.some(nil)`.
 */
public func nearbyComputer(_ txt: [String: String?]) -> NearbyComputer? {
	var by: [String: String?] = [:]
	for (key, value) in txt { by[key.lowercased()] = value }
	guard case let .some(.some(v)) = by["v"], v == "1" else { return nil }
	guard case let .some(.some(id)) = by["id"], pairedFingerprint(id) != nil else { return nil }
	let service: String
	switch by["service"] {
	case .none: service = OFFICIAL_SERVICE
	case .some(.none): return nil
	case let .some(.some(given)):
		guard let origin = httpsOrigin(given)?.origin else { return nil }
		service = origin
	}
	return NearbyComputer(id: id, service: service)
}

/**
 * The computers found so far, by the name each service was announced under: one computer may be
 * found under two names (on two networks, or renamed "Pine (2)"), and is listed once.
 */
public final class NearbyFound: @unchecked Sendable {
	private let lock = NSLock()
	private var names: [String] = []
	private var byName: [String: NearbyComputer] = [:]

	public init() {}

	/** A service resolved: kept when its record is one the phone reads. True when the list changed. */
	@discardableResult
	public func found(_ name: String, _ computer: NearbyComputer?) -> Bool {
		lock.withLock {
			let before = listed()
			if let computer {
				if byName[name] == nil { names.append(name) }
				byName[name] = computer
			} else {
				forget(name)
			}
			return listed() != before
		}
	}

	/** A service gone from the network. True when the list changed. */
	@discardableResult
	public func lost(_ name: String) -> Bool {
		lock.withLock {
			let before = listed()
			forget(name)
			return listed() != before
		}
	}

	public func clear() {
		lock.withLock {
			names = []
			byName = [:]
		}
	}

	/** Each computer once, the first found first; a later service of the same machine id names its service. */
	public var list: [NearbyComputer] { lock.withLock { listed() } }

	/** What the page is told: `{computers: [{id, service}]}`. */
	public var event: [String: Any] { ["computers": list.map(\.json)] }

	private func forget(_ name: String) {
		byName[name] = nil
		names.removeAll { $0 == name }
	}

	private func listed() -> [NearbyComputer] {
		var order: [String] = []
		var last: [String: NearbyComputer] = [:]
		for name in names {
			guard let c = byName[name] else { continue }
			if last[c.id] == nil { order.append(c.id) }
			last[c.id] = c
		}
		return order.map { last[$0]! }
	}
}
