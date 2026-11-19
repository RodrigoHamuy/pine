package pine.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

// What names the other machine, and where its daemon may answer: test/remote.test.ts, on the phone.
class HostsTest {
	@Test
	fun `a host is a host, user@host or user@host-port, and never an option`() {
		assertNull(sshHost(""))
		assertNull(sshHost("  "))
		assertNull(sshHost(null))
		assertEquals(SshHost("user@server", "user", "server", 22, "server"), sshHost(" user@server "))
		assertEquals(SshHost("server.example.com", null, "server.example.com", 22, "server"), sshHost("server.example.com"))
		assertEquals(SshHost("me@box.lan:2222", "me", "box.lan", 2222, "box"), sshHost("me@box.lan:2222"))
		assertEquals("192.168.1.20", sshHost("me@192.168.1.20")?.label)
		for (bad in listOf("-oProxyCommand=x", "server; rm -rf ~", "a b", "\$(x)", "-J", "@server", "server:", "server:0", "server:65536", "server:22:22", "server:x", "a@b@c")) {
			val e = assertFailsWith<RemoteError>(bad) { sshHost(bad) }
			assertEquals("ssh", e.kind)
		}
	}

	@Test
	fun `the daemon is reached at the other machine's loopback, and nowhere else`() {
		assertEquals(Loopback("127.0.0.1", 7463), loopbackEnd("http://127.0.0.1:7463"))
		assertEquals(Loopback("127.0.0.2", 8080), loopbackEnd("http://127.0.0.2:8080"))
		assertEquals(Loopback("::1", 7463), loopbackEnd("http://[::1]:7463"))
		assertEquals("[::1]:7463", loopbackEnd("http://[::1]:7463").hostHeader)
		for (bad in listOf("http://10.0.0.5:7463", "http://localhost:7463", "http://evil.example:7463", "http://0.0.0.0:7463", "http://127.0.0.1", "https://127.0.0.1:7463", "http://127.0.0.1:7463@evil:1", "http://user:pw@127.0.0.1:7463", "nonsense")) {
			val e = assertFailsWith<RemoteError>(bad) { loopbackEnd(bad) }
			assertEquals("failed", e.kind)
		}
	}
}
