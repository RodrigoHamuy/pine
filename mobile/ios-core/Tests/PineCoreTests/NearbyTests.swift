import Foundation
import Testing
@testable import PineCore

// What the phone keeps of a computer that announces itself on the network (Nearby.swift), and the
// list of those found. The same cases as the Kotlin core's NearbyTest.kt.
struct NearbyTests {
	let id = "EKN2VkO6uLv7SOTEAyIGDru_1I_cTOGadqwTlLFm-qs"

	func record(v: String? = "1", id: String? = nil, service: String?? = .some(OFFICIAL_SERVICE)) -> [String: String?] {
		var out: [String: String?] = [:]
		if let v { out["v"] = .some(v) }
		out["id"] = .some(id ?? self.id)
		if case let .some(service) = service { out["service"] = .some(service) }
		return out
	}

	@Test("a record of version 1 names a machine id and an https service")
	func read() {
		#expect(nearbyComputer(record()) == NearbyComputer(id: id, service: OFFICIAL_SERVICE))
		#expect(nearbyComputer(record(service: "https://pine-pr-57.drcmda.workers.dev")) == NearbyComputer(id: id, service: "https://pine-pr-57.drcmda.workers.dev"))
		#expect(nearbyComputer(record(service: "https://pine.example.com:8443")) == NearbyComputer(id: id, service: "https://pine.example.com:8443"))
		#expect(nearbyComputer(record(service: OFFICIAL_SERVICE + ":443")) == NearbyComputer(id: id, service: OFFICIAL_SERVICE), "without :443")
		#expect(nearbyComputer(record(service: "HTTPS://PINE.Example.com")) == NearbyComputer(id: id, service: "https://pine.example.com"), "in lower case")
		#expect(nearbyComputer(["V": "1", "ID": id, "Service": OFFICIAL_SERVICE]) == NearbyComputer(id: id, service: OFFICIAL_SERVICE), "keys in any case")
	}

	@Test("a record without a service names the official one")
	func official() {
		#expect(nearbyComputer(record(service: .none)) == NearbyComputer(id: id, service: OFFICIAL_SERVICE))
	}

	@Test("a record of another version, without a good machine id, or with a service that is not an https origin, is ignored")
	func ignored() {
		#expect(nearbyComputer(record(v: "2")) == nil)
		#expect(nearbyComputer(record(v: nil)) == nil)
		#expect(nearbyComputer(["v": "1", "service": OFFICIAL_SERVICE]) == nil)
		#expect(nearbyComputer(record(id: String(id.dropFirst()))) == nil)
		#expect(nearbyComputer(record(id: String(id.dropLast()) + "+")) == nil)
		for service in ["http://pine.example.com", "", "https://pine.example.com/", "https://pine.example.com/x", "https://me@pine.example.com", "javascript:alert(1)"] {
			#expect(nearbyComputer(record(service: .some(service))) == nil, "service \(service)")
		}
		#expect(nearbyComputer(record(service: .some(nil))) == nil, "a service key without a value")
	}

	@Test("the list holds each computer once, follows what is lost, and says when it changed")
	func list() {
		let found = NearbyFound()
		#expect((found.event["computers"] as? [[String: String]])?.isEmpty == true)
		#expect(found.found("Pine", NearbyComputer(id: id, service: OFFICIAL_SERVICE)))
		#expect(!found.found("Pine", NearbyComputer(id: id, service: OFFICIAL_SERVICE)), "the same again changes nothing")
		#expect(!found.found("Pine (2)", NearbyComputer(id: id, service: OFFICIAL_SERVICE)), "the same machine under another name is listed once")
		let other = String(repeating: "A", count: 43)
		#expect(found.found("Pine (3)", NearbyComputer(id: other, service: "https://pine.example.com")))
		#expect(found.list == [NearbyComputer(id: id, service: OFFICIAL_SERVICE), NearbyComputer(id: other, service: "https://pine.example.com")])
		#expect(!found.lost("Pine"), "still there under its other name")
		#expect(found.lost("Pine (2)"))
		#expect(found.found("Pine (3)", nil), "a record it no longer reads takes it out")
		#expect(found.list.isEmpty)
		#expect(!found.lost("never seen"))
	}
}
