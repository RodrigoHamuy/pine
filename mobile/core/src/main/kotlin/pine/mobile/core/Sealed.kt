// A vault on a shelf: each value sealed with AES-GCM under a key the shelf does not hold. On the
// phone that key is one of the Android Keystore, which never leaves it: a backup of the app's data,
// or another app, reads nothing of what is sealed.
package pine.mobile.core

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SealedVault(private val key: () -> SecretKey, private val shelf: Shelf) : Vault {
	override fun read(name: String): ByteArray? {
		val sealed = shelf.get(PREFIX + name)?.let { runCatching { Base64.getDecoder().decode(it) }.getOrNull() } ?: return null
		if (sealed.size <= IV) return null
		// A value sealed under another key (the app's data restored on another phone) opens to nothing.
		return runCatching {
			Cipher.getInstance(MODE).run {
				init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV))
				updateAAD(name.toByteArray())
				doFinal(sealed, IV, sealed.size - IV)
			}
		}.getOrNull()
	}

	override fun write(name: String, value: ByteArray) {
		val cipher = Cipher.getInstance(MODE)
		// The Android Keystore picks the IV itself and refuses one given; elsewhere it is made here.
		runCatching { cipher.init(Cipher.ENCRYPT_MODE, key()) }.getOrElse {
			cipher.init(Cipher.ENCRYPT_MODE, key(), GCMParameterSpec(128, ByteArray(IV).also { SecureRandom().nextBytes(it) }))
		}
		cipher.updateAAD(name.toByteArray())
		val sealed = cipher.iv + cipher.doFinal(value)
		shelf.set(PREFIX + name, Base64.getEncoder().encodeToString(sealed))
	}

	override fun remove(name: String) = shelf.set(PREFIX + name, null)

	private companion object {
		const val PREFIX = "sealed:"
		const val MODE = "AES/GCM/NoPadding"
		const val IV = 12
	}
}
