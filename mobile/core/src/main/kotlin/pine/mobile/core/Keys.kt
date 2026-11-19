// The phone's own SSH key, and the host keys the owner confirmed.
package pine.mobile.core

import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.Ed25519KeyFactory
import net.schmizz.sshj.userauth.keyprovider.KeyPairWrapper
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import java.security.MessageDigest
import java.security.PublicKey
import java.security.SecureRandom
import java.util.Base64

/**
 * Where the plugin keeps what it must not lose. The Android implementation encrypts every value
 * with a key of the Android Keystore, so that a backup or another app cannot read it.
 */
interface Vault {
	/** The value, or null when none is kept. One that is kept and cannot be opened throws (`VaultError`): it is never taken for none. */
	fun read(name: String): ByteArray?
	fun write(name: String, value: ByteArray)
	fun remove(name: String)
}

/**
 * The phone's SSH key: an Ed25519 key made on the phone the first time it is needed, so that no
 * private key has to be moved onto it. The owner puts `publicKey` into ~/.ssh/authorized_keys of
 * the machine that runs pine.
 */
class DeviceKey(private val vault: Vault) {
	// Read when first needed, not when made: the plugin makes it on the main thread, where the
	// Keystore is not to be asked. A key that is kept and cannot be opened throws, and is never replaced.
	private val seed: ByteArray by lazy {
		vault.read(NAME) ?: ByteArray(32).also {
			SecureRandom().nextBytes(it)
			vault.write(NAME, it)
		}
	}
	private val public: ByteArray by lazy { Ed25519PrivateKeyParameters(seed, 0).generatePublicKey().encoded }

	/** The public key as a line of authorized_keys. */
	val publicKey: String
		get() {
			val blob = Buffer.PlainBuffer().putString("ssh-ed25519").putBytes(public).compactData
			return "ssh-ed25519 ${Base64.getEncoder().encodeToString(blob)} pine-android"
		}

	internal fun provider(): KeyProvider = KeyPairWrapper(Ed25519KeyFactory.getPublicKey(public), Ed25519KeyFactory.getPrivateKey(seed))

	private companion object {
		const val NAME = "ssh-key-ed25519"
	}
}

/**
 * The machines' host keys the owner confirmed, by host and port: trust on first use. There is no
 * terminal on the phone to answer ssh's question, so the page asks it: an unknown key stops the
 * connection with its fingerprint, and the owner's yes is `confirm`. A changed key is refused
 * until the owner `forget`s the stored one (after reinstalling that machine, say).
 */
class KnownHosts(private val vault: Vault) {
	/** The confirmed fingerprint of a machine, if there is one. */
	fun fingerprintOf(host: String, port: Int): String? = vault.read(name(host, port))?.toString(Charsets.UTF_8)

	/** The owner's yes to the key with this fingerprint. A machine whose key is known already keeps it: forget it first. */
	fun confirm(host: String, port: Int, fingerprint: String) {
		require(Regex("^SHA256:[A-Za-z0-9+/]{43}$").matches(fingerprint)) { "not a SHA256 fingerprint: ${fingerprint.take(80)}" }
		if (fingerprintOf(host, port) == null) vault.write(name(host, port), fingerprint.toByteArray())
	}

	fun forget(host: String, port: Int) = vault.remove(name(host, port))

	/** Whether `key` is the one confirmed for that machine; a `HostKeyError` that says why not. `given` is the machine as the owner wrote it. */
	internal fun check(given: String, host: String, port: Int, key: PublicKey) {
		val seen = fingerprint(key)
		// A confirmed key that cannot be read is not an unknown one: the owner would be asked to trust whatever answers.
		val stored = try {
			fingerprintOf(host, port)
		} catch (e: VaultError) {
			throw RemoteError("ssh", "Not connecting to $given: ${e.message}")
		} ?: throw HostKeyError("$given is not among the machines this phone knows yet. Its host key's fingerprint is $seen: if that is what the machine shows (ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub there), confirm it.", host, port, seen, changed = false)
		if (stored != seen) throw HostKeyError("The host key of $given changed: it was $stored and is now $seen. Not connecting, since another machine may stand in for it. If that machine was reinstalled, forget its key and confirm the new one.", host, port, seen, changed = true)
	}

	private fun name(host: String, port: Int) = "host-key:${host.lowercase()}:$port"
}

/** A host key's fingerprint as OpenSSH prints it: SHA256 of the key's blob, in base64 without padding. */
fun fingerprint(key: PublicKey): String {
	val blob = Buffer.PlainBuffer().putPublicKey(key).compactData
	return "SHA256:" + Base64.getEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(blob))
}
