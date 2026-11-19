// The phone's own SSH key, and the host keys the owner confirmed: Keys.kt on Android.
import Crypto
import Foundation
import NIOSSH

/**
 * Where the app keeps what it must not lose. The app's store is the Keychain
 * (`KeychainSecretStore`); the tests keep it in memory.
 */
public protocol SecretStore: Sendable {
	/** The value, or nil when none is kept. One that is kept and cannot be read throws (`SecretStoreError`): it is never taken for none. */
	func read(_ name: String) throws -> Data?
	func write(_ name: String, _ value: Data) throws
	func remove(_ name: String) throws
}

/**
 * A value is kept but cannot be read, or the store failed (the phone was never unlocked since it
 * started, say). Never taken for a value that is not there, so nothing kept is replaced or
 * forgotten because of it.
 */
public struct SecretStoreError: Error, Equatable, CustomStringConvertible {
	public let name: String
	/** The Keychain's status code. */
	public let status: Int32

	public init(name: String, status: Int32) {
		self.name = name
		self.status = status
	}

	public var message: String {
		"The phone's Keychain cannot give what the app kept (\(name), status \(status)). Unlock the phone and try again; if it stays so, restart the phone."
	}

	public var description: String { message }
}

/**
 * The phone's SSH key: an Ed25519 key made on the phone the first time it is needed, so that no
 * private key has to be moved onto it. Its 32-byte seed is what the store keeps. The owner puts
 * `publicKey()` into ~/.ssh/authorized_keys of the machine that runs pine.
 */
public final class DeviceKey: @unchecked Sendable {
	private static let name = "ssh-key-ed25519"
	private let store: SecretStore
	private let lock = NSLock()
	private var seed: Data?

	public init(_ store: SecretStore) {
		self.store = store
	}

	// Read when first needed, not when made: the store may not be open yet when the app starts. A
	// key that is kept and cannot be read throws, and is never replaced.
	private func signing() throws -> Curve25519.Signing.PrivateKey {
		lock.lock()
		defer { lock.unlock() }
		if seed == nil {
			if let kept = try store.read(Self.name) {
				seed = kept
			} else {
				let made = Curve25519.Signing.PrivateKey().rawRepresentation
				try store.write(Self.name, made)
				seed = made
			}
		}
		return try Curve25519.Signing.PrivateKey(rawRepresentation: seed!)
	}

	/** The public key as a line of authorized_keys. */
	public func publicKey() throws -> String {
		var blob = Data()
		blob.appendSSHString(Data("ssh-ed25519".utf8))
		blob.appendSSHString(try signing().publicKey.rawRepresentation)
		return "ssh-ed25519 \(blob.base64EncodedString()) pine-ios"
	}

	/** The key SSH signs in with. */
	public func privateKey() throws -> NIOSSHPrivateKey {
		NIOSSHPrivateKey(ed25519Key: try signing())
	}
}

/** What `KnownHosts.confirm` refuses: anything that is not a SHA256 fingerprint as OpenSSH prints it. */
public struct NotAFingerprint: Error, CustomStringConvertible {
	public let given: String
	public var description: String { "not a SHA256 fingerprint: \(given.prefix(80))" }
}

/**
 * The machines' host keys the owner confirmed, by host and port: trust on first use. There is no
 * terminal on the phone to answer ssh's question, so the page asks it: an unknown key stops the
 * connection with its fingerprint, and the owner's yes is `confirm`. A changed key is refused
 * until the owner `forget`s the stored one (after reinstalling that machine, say).
 */
public struct KnownHosts: Sendable {
	private let store: SecretStore

	public init(_ store: SecretStore) {
		self.store = store
	}

	/** The confirmed fingerprint of a machine, if there is one. */
	public func fingerprintOf(host: String, port: Int) throws -> String? {
		try store.read(Self.name(host, port)).map { String(decoding: $0, as: UTF8.self) }
	}

	/** The owner's yes to the key with this fingerprint. A machine whose key is known already keeps it: forget it first. */
	public func confirm(host: String, port: Int, fingerprint: String) throws {
		guard wholeMatch("SHA256:[A-Za-z0-9+/]{43}", fingerprint) != nil else { throw NotAFingerprint(given: fingerprint) }
		if try fingerprintOf(host: host, port: port) == nil { try store.write(Self.name(host, port), Data(fingerprint.utf8)) }
	}

	public func forget(host: String, port: Int) throws {
		try store.remove(Self.name(host, port))
	}

	/** Whether `key` is the one confirmed for that machine; a `RemoteError` that says why not. `given` is the machine as the owner wrote it. */
	public func check(given: String, host: String, port: Int, key: NIOSSHPublicKey) throws {
		let seen = fingerprint(of: key)
		// A confirmed key that cannot be read is not an unknown one: the owner would be asked to trust whatever answers.
		let stored: String?
		do {
			stored = try fingerprintOf(host: host, port: port)
		} catch {
			throw RemoteError("ssh", "Not connecting to \(given): \(error)")
		}
		guard let stored else {
			throw RemoteError("ssh", "\(given) is not among the machines this phone knows yet. Its host key's fingerprint is \(seen): if that is what the machine shows (ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub there), confirm it.", hostKey: HostKeyRefusal(host: host, port: port, fingerprint: seen, changed: false))
		}
		if stored != seen {
			throw RemoteError("ssh", "The host key of \(given) changed: it was \(stored) and is now \(seen). Not connecting, since another machine may stand in for it. If that machine was reinstalled, forget its key and confirm the new one.", hostKey: HostKeyRefusal(host: host, port: port, fingerprint: seen, changed: true))
		}
	}

	private static func name(_ host: String, _ port: Int) -> String { "host-key:\(host.lowercased()):\(port)" }
}

/** A host key's fingerprint as OpenSSH prints it: SHA256 of the key's wire blob, in base64 without padding. */
public func fingerprint(blob: Data) -> String {
	let digest = Data(SHA256.hash(data: blob)).base64EncodedString()
	return "SHA256:" + digest.replacingOccurrences(of: "=", with: "")
}

/** The fingerprint of a key SSH was shown. Its blob is the second field of its OpenSSH line, the one form Apple's swift-nio-ssh makes public. */
public func fingerprint(of key: NIOSSHPublicKey) -> String {
	let fields = String(openSSHPublicKey: key).split(separator: " ")
	return fingerprint(blob: Data(base64Encoded: String(fields[1]))!)
}

extension Data {
	/** An SSH `string`: its length as four bytes, big-endian, then its bytes. */
	mutating func appendSSHString(_ bytes: Data) {
		let n = UInt32(bytes.count)
		append(contentsOf: [UInt8(n >> 24), UInt8(n >> 16 & 0xff), UInt8(n >> 8 & 0xff), UInt8(n & 0xff)])
		append(bytes)
	}
}
