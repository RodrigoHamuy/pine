package pine.mobile.core

import org.apache.sshd.common.config.keys.AuthorizedKeyEntry
import org.apache.sshd.common.config.keys.KeyUtils
import net.schmizz.sshj.common.Buffer
import org.junit.jupiter.api.TestFactory
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** A vault in memory: the Android one encrypts with a key of the Android Keystore. */
class MemoryVault : Vault {
	val entries = mutableMapOf<String, ByteArray>()
	override fun read(name: String) = entries[name]?.copyOf()
	override fun write(name: String, value: ByteArray) {
		entries[name] = value.copyOf()
	}
	override fun remove(name: String) {
		entries.remove(name)
	}
}

class KeysTest {
	@Test
	fun `the phone makes its key once, and gives the public key as a line for authorized_keys`() {
		val vault = MemoryVault()
		val key = DeviceKey(vault).publicKey
		assertTrue(key.startsWith("ssh-ed25519 "), key)
		// An SSH server reads it as an Ed25519 key.
		val parsed = AuthorizedKeyEntry.parseAuthorizedKeyEntry(key).resolvePublicKey(null, null)
		assertEquals("ssh-ed25519", KeyUtils.getKeyType(parsed))
		// The same key the next time the app starts, from what the vault holds.
		assertEquals(key, DeviceKey(vault).publicKey)
		assertEquals(1, vault.entries.size)
		// Another phone, another key.
		assertNotEquals(key, DeviceKey(MemoryVault()).publicKey)
	}

	// mobile/cases/fingerprints.json: what ssh-keygen -lf prints for each key.
	@TestFactory
	fun `a host key's fingerprint is the one OpenSSH prints`() = replay("fingerprints") { case ->
		val key = Buffer.PlainBuffer(Base64.getDecoder().decode(case.getString("blob"))).readPublicKey()
		assertEquals(android(case.get("expect")), fingerprint(key))
	}
}
