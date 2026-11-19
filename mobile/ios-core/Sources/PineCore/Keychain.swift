// The app's SecretStore: the phone's Keychain. Each value is a generic password of the app's own
// service, in the data-protection keychain, readable only after the phone's first unlock since it
// started and only on this device: not in a backup, not moved to another phone, not readable by
// another app. Tested only in the app (a test runner of SwiftPM has no entitlements for it).
#if canImport(Security)
import Foundation
import Security

public struct KeychainSecretStore: SecretStore {
	public let service: String

	public init(service: String = "dev.pmndre.pine") {
		self.service = service
	}

	private func query(_ name: String) -> [String: Any] {
		[
			kSecClass as String: kSecClassGenericPassword,
			kSecAttrService as String: service,
			kSecAttrAccount as String: name,
			kSecUseDataProtectionKeychain as String: true,
		]
	}

	public func read(_ name: String) throws -> Data? {
		var q = query(name)
		q[kSecReturnData as String] = true
		q[kSecMatchLimit as String] = kSecMatchLimitOne
		var found: CFTypeRef?
		let status = SecItemCopyMatching(q as CFDictionary, &found)
		if status == errSecItemNotFound { return nil }
		guard status == errSecSuccess, let data = found as? Data else { throw SecretStoreError(name: name, status: status) }
		return data
	}

	public func write(_ name: String, _ value: Data) throws {
		let attributes: [String: Any] = [
			kSecValueData as String: value,
			kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
		]
		var status = SecItemUpdate(query(name) as CFDictionary, attributes as CFDictionary)
		if status == errSecItemNotFound {
			status = SecItemAdd(query(name).merging(attributes) { $1 } as CFDictionary, nil)
		}
		guard status == errSecSuccess else { throw SecretStoreError(name: name, status: status) }
	}

	public func remove(_ name: String) throws {
		let status = SecItemDelete(query(name) as CFDictionary)
		guard status == errSecSuccess || status == errSecItemNotFound else { throw SecretStoreError(name: name, status: status) }
	}
}
#endif
