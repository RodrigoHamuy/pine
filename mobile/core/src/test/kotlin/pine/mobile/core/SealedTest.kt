package pine.mobile.core

import javax.crypto.KeyGenerator
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIsNot
import kotlin.test.assertNull
import kotlin.test.assertTrue

// What the phone keeps secret (its SSH key, the host keys it trusts) is sealed with a key the shelf
// does not hold: the Android Keystore's on the phone, one made here in the tests.
class SealedTest {
	private fun aes() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

	@Test
	fun `a sealed value reads back, is not on the shelf as it is, and is gone without its key`() {
		val shelf = MemoryShelf()
		val key = aes()
		val vault = SealedVault({ key }, shelf)
		val secret = "the phone's private key".toByteArray()
		vault.write("ssh-key", secret)
		assertContentEquals(secret, vault.read("ssh-key"))
		val kept = shelf.entries.values.joinToString()
		assertTrue(!kept.contains("private"), "only sealed text on the shelf")
		vault.write("other", secret)
		assertTrue(shelf.entries.values.distinct().size == 2, "each sealed apart")
		// A backup restored on another phone has no Keystore key to open it with: said, never taken for nothing kept.
		assertFailsWith<VaultError> { SealedVault({ aes() }, shelf).read("ssh-key") }
		assertNull(SealedVault({ aes() }, shelf).read("never-written"))
		vault.remove("ssh-key")
		assertNull(vault.read("ssh-key"))
		assertEquals(1, shelf.entries.size)
	}

	@Test
	fun `the phone's key made on a sealed vault stays the same key`() {
		val shelf = MemoryShelf()
		val key = aes()
		assertEquals(DeviceKey(SealedVault({ key }, shelf)).publicKey, DeviceKey(SealedVault({ key }, shelf)).publicKey)
	}

	@Test
	fun `a kept value that cannot be opened is never replaced, and a confirmed machine is not taken for an unknown one`() {
		val shelf = MemoryShelf()
		val key = aes()
		val first = DeviceKey(SealedVault({ key }, shelf)).publicKey
		KnownHosts(SealedVault({ key }, shelf)).confirm("box", 22, fingerprint(Machine.newHostKey().public))
		val kept = shelf.entries.toMap()
		// The Keystore key is gone, or the Keystore fails: what was kept cannot be opened.
		val lost = SealedVault({ aes() }, shelf)
		assertFailsWith<VaultError> { DeviceKey(lost).publicKey }
		val refused = assertFailsWith<RemoteError> { KnownHosts(lost).check("me@box", "box", 22, Machine.newHostKey().public) }
		assertIsNot<HostKeyError>(refused, "not put to the owner as a machine to trust")
		assertFailsWith<VaultError> { KnownHosts(lost).confirm("box", 22, fingerprint(Machine.newHostKey().public)) }
		assertEquals(kept, shelf.entries, "nothing overwritten")
		assertEquals(first, DeviceKey(SealedVault({ key }, shelf)).publicKey)
	}

	@Test
	fun `the phone's key is read from the vault only when it is first needed`() {
		val shelf = MemoryShelf()
		var opened = 0
		val key = aes()
		val device = DeviceKey(SealedVault({ opened++; key }, shelf))
		assertEquals(0, opened, "making it touches no key store")
		device.publicKey
		assertTrue(opened > 0)
	}
}
