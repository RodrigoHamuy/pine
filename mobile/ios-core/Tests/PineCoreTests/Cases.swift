import Foundation
import Testing

// The cases both cores replay (mobile/cases/README.md): one file per subject, each case a name, its
// input and what is expected. The Android core replays the very same files.

/** Where the case files lie: mobile/cases, beside this package. */
let casesDir = URL(fileURLWithPath: #filePath)
	.deletingLastPathComponent() // PineCoreTests
	.deletingLastPathComponent() // Tests
	.deletingLastPathComponent() // ios-core
	.deletingLastPathComponent() // mobile
	.appendingPathComponent("cases")

/** One case of a subject: its name and its fields as JSON gave them (`NSNull` for null). */
struct Case: @unchecked Sendable, CustomTestStringConvertible {
	let subject: String
	let fields: [String: Any]

	var name: String { fields["name"] as! String }
	var testDescription: String { name }

	/** A string field that may be null or absent. */
	func text(_ key: String) -> String? { fields[key] as? String }

	/** What iOS expects: the value, or the "ios" one of an object with exactly the keys "android" and "ios". */
	var expect: Any? {
		let value = fields["expect"]
		if let both = value as? [String: Any], Set(both.keys) == ["android", "ios"] { return plain(both["ios"]) }
		return plain(value)
	}
}

/** A JSON value as Swift compares it: JSON's null as nil. */
func plain(_ value: Any?) -> Any? { value is NSNull ? nil : value }

/** The cases of a subject; a file without cases, or with two cases of one name, is refused. */
func cases(_ subject: String) throws -> [Case] {
	let data = try Data(contentsOf: casesDir.appendingPathComponent("\(subject).json"))
	let file = try JSONSerialization.jsonObject(with: data) as! [String: Any]
	let list = (file["cases"] as! [[String: Any]]).map { Case(subject: subject, fields: $0) }
	precondition(!list.isEmpty, "\(subject).json has no cases")
	precondition(Set(list.map(\.name)).count == list.count, "\(subject).json: two cases share a name")
	return list
}

extension String {
	/** Text with a case's placeholders (`{given}`, `{label}`) filled in. */
	func filled(_ pairs: [String: String]) -> String {
		pairs.reduce(self) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
	}
}
