// A vault on a shelf: each value sealed with AES-GCM under a key the shelf does not hold. On the
// phone that key is one of the Android Keystore, which never leaves it: a backup of the app's data,
// or another app, reads nothing of what is sealed.
package pine.mobile.core

import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * A value is kept but cannot be opened: sealed under another key (the app's data restored on another
 * phone), or the key store failed. Never taken for a value that is not there, so nothing kept is
 * replaced or forgotten because of it.
 */
class VaultError(name: String, cause: Throwable?) : Exception(
	"The app's key store cannot open what it kept ($name). Try again after restarting the phone; if it stays so, clear the app's storage (Settings > Apps > Pine > Storage), then add this phone's new key on your machines and confirm their host keys again.",
	cause,
)

class SealedVault(private val key: () -> SecretKey, private val shelf: Shelf) : Vault {
	/** The value, null when none is kept, a `VaultError` when one is kept and cannot be opened. */
	override fun read(name: String): ByteArray? {
		val text = shelf.get(PREFIX + name) ?: return null
		return try {
			val sealed = Base64.getDecoder().decode(text)
			if (sealed.size <= IV) throw IllegalArgumentException("too short to be sealed")
			Cipher.getInstance(MODE).run {
				init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV))
				updateAAD(name.toByteArray())
				doFinal(sealed, IV, sealed.size - IV)
			}
		} catch (e: Exception) {
			throw VaultError(name, e)
		}
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
