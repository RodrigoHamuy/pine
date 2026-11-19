package pine.mobile.core

import javax.crypto.KeyGenerator
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
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
		// A backup restored on another phone has no Keystore key to open it with: as if nothing were kept.
		assertNull(SealedVault({ aes() }, shelf).read("ssh-key"))
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
}
