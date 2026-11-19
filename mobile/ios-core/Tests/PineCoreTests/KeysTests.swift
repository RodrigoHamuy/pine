import Crypto
import Foundation
import NIOSSH
import Testing
@testable import PineCore

/** A store in memory: the app's keeps its secrets in the Keychain. It counts its reads, and can be made to fail. */
final class MemoryStore: SecretStore, @unchecked Sendable {
	var entries: [String: Data] = [:]
	var reads = 0
	var failing = false

	func read(_ name: String) throws -> Data? {
		reads += 1
		if failing { throw SecretStoreError(name: name, status: -25293) }
		return entries[name]
	}

	func write(_ name: String, _ value: Data) throws {
		if failing { throw SecretStoreError(name: name, status: -25293) }
		entries[name] = value
	}

	func remove(_ name: String) throws {
		if failing { throw SecretStoreError(name: name, status: -25293) }
		entries[name] = nil
	}
}

/** A host key of a machine, made here. */
func hostKey() -> NIOSSHPublicKey { NIOSSHPrivateKey(ed25519Key: Curve25519.Signing.PrivateKey()).publicKey }

struct KeysTests {
	// mobile/cases/fingerprints.json: what ssh-keygen -lf prints for each key.
	@Test("a host key's fingerprint is the one OpenSSH prints", arguments: try cases("fingerprints"))
	func printed(_ c: Case) {
		#expect(fingerprint(blob: Data(base64Encoded: c.text("blob")!)!) == c.expect as! String)
	}

	@Test("the phone makes its key once, and gives the public key as a line for authorized_keys")
	func deviceKey() throws {
		let store = MemoryStore()
		let line = try DeviceKey(store).publicKey()
		#expect(line.hasPrefix("ssh-ed25519 "))
		#expect(line.hasSuffix(" pine-ios"))
		// The same key the next time the app starts, from what the store holds.
		#expect(try DeviceKey(store).publicKey() == line)
		#expect(store.entries.count == 1)
		// Another phone, another key.
		#expect(try DeviceKey(MemoryStore()).publicKey() != line)
		// The key SSH signs with is that one.
		let signing = try DeviceKey(store).privateKey()
		#expect(String(openSSHPublicKey: signing.publicKey) + " pine-ios" == line)
	}

	@Test("ssh-keygen reads the public key line as an Ed25519 key")
	func sshKeygen() throws {
		let line = try DeviceKey(MemoryStore()).publicKey()
		let file = FileManager.default.temporaryDirectory.appendingPathComponent("pine-ios-\(UUID().uuidString).pub")
		try (line + "\n").write(to: file, atomically: true, encoding: .utf8)
		defer { try? FileManager.default.removeItem(at: file) }
		let run = Process()
		run.executableURL = URL(fileURLWithPath: "/usr/bin/ssh-keygen")
		run.arguments = ["-l", "-f", file.path]
		let out = Pipe()
		run.standardOutput = out
		try run.run()
		run.waitUntilExit()
		let printed = String(decoding: out.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
		#expect(run.terminationStatus == 0)
		#expect(printed.hasPrefix("256 SHA256:"))
		#expect(printed.contains("pine-ios (ED25519)"))
		// And its fingerprint is the one this core prints.
		let blob = Data(base64Encoded: String(line.split(separator: " ")[1]))!
		#expect(printed.contains(fingerprint(blob: blob) + " "))
	}

	@Test("the phone's key is read from the store only when it is first needed")
	func lazy() throws {
		let store = MemoryStore()
		let device = DeviceKey(store)
		#expect(store.reads == 0, "making it touches no key store")
		_ = try device.publicKey()
		#expect(store.reads > 0)
	}

	@Test("a kept key that cannot be read is never replaced")
	func keptKey() throws {
		let store = MemoryStore()
		let first = try DeviceKey(store).publicKey()
		let kept = store.entries
		store.failing = true
		#expect(throws: SecretStoreError.self) { try DeviceKey(store).publicKey() }
		store.failing = false
		#expect(store.entries == kept)
		#expect(try DeviceKey(store).publicKey() == first)
	}
}

struct KnownHostsTests {
	private func refusal(_ known: KnownHosts, _ key: NIOSSHPublicKey, port: Int = 22) -> RemoteError? {
		do {
			try known.check(given: "me@box", host: "box", port: port, key: key)
			return nil
		} catch let e as RemoteError {
			return e
		} catch {
			Issue.record("not a RemoteError: \(error)")
			return nil
		}
	}

	@Test("an unknown machine is refused with its fingerprint, and let in once that very fingerprint is confirmed")
	func firstUse() throws {
		let known = KnownHosts(MemoryStore())
		let key = hostKey()
		let seen = fingerprint(of: key)
		let unknown = try #require(refusal(known, key))
		#expect(unknown.kind == "ssh")
		#expect(unknown.hostKey == HostKeyRefusal(host: "box", port: 22, fingerprint: seen, changed: false))
		#expect(unknown.message.contains(seen))
		try known.confirm(host: "box", port: 22, fingerprint: seen)
		#expect(refusal(known, key) == nil)
		// Known by host and port: the same host on another port is another machine.
		#expect(refusal(known, key, port: 2222)?.hostKey?.changed == false)
		// The host's case does not make it another.
		#expect(try known.fingerprintOf(host: "BOX", port: 22) == seen)
	}

	@Test("a changed key is refused, and confirming another does not replace the one kept")
	func changed() throws {
		let known = KnownHosts(MemoryStore())
		let key = hostKey()
		try known.confirm(host: "box", port: 22, fingerprint: fingerprint(of: key))
		let other = hostKey()
		let refused = try #require(refusal(known, other))
		#expect(refused.hostKey == HostKeyRefusal(host: "box", port: 22, fingerprint: fingerprint(of: other), changed: true))
		try known.confirm(host: "box", port: 22, fingerprint: fingerprint(of: other))
		#expect(refusal(known, other)?.hostKey?.changed == true)
		// Forgotten (the machine was reinstalled), the new key can be confirmed.
		try known.forget(host: "box", port: 22)
		try known.confirm(host: "box", port: 22, fingerprint: fingerprint(of: other))
		#expect(refusal(known, other) == nil)
	}

	@Test("only a SHA256 fingerprint can be confirmed")
	func notAFingerprint() {
		let known = KnownHosts(MemoryStore())
		#expect(throws: (any Error).self) { try known.confirm(host: "box", port: 22, fingerprint: "yes") }
		#expect(throws: (any Error).self) { try known.confirm(host: "box", port: 22, fingerprint: "SHA256:short") }
	}

	@Test("a store that fails is not taken for a machine nobody confirmed")
	func failingStore() throws {
		let store = MemoryStore()
		let key = hostKey()
		try KnownHosts(store).confirm(host: "box", port: 22, fingerprint: fingerprint(of: key))
		let kept = store.entries
		store.failing = true
		let refused = try #require(refusal(KnownHosts(store), hostKey()))
		#expect(refused.kind == "ssh")
		#expect(refused.hostKey == nil, "not put to the owner as a machine to trust")
		#expect(refused.message.hasPrefix("Not connecting to me@box: "))
		#expect(throws: SecretStoreError.self) { try KnownHosts(store).confirm(host: "box", port: 22, fingerprint: fingerprint(of: hostKey())) }
		store.failing = false
		#expect(store.entries == kept, "nothing overwritten")
	}
}
