package pine.mobile.core

import org.apache.sshd.common.config.keys.AuthorizedKeyEntry
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.net.ServerSocket
import java.util.Base64
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// The pine of another machine over SSH, as test/remote.test.ts and desktop/test/daemon.test.ts
// prove it for the Mac: what reaches the daemon, what the page gets back, and the words of a failure.
class RemoteTest {
	private val vault = MemoryVault()
	private val key = DeviceKey(vault)
	private val daemon = StandInDaemon()
	private val service = Service(line(daemon.base))
	private val machine = Machine(AuthorizedKeyEntry.parseAuthorizedKeyEntry(key.publicKey).resolvePublicKey(null, null), service)
	private val known = KnownHosts(vault)
	private val remote = Remote(key, known, answerMs = 1_000)
	private val host get() = "me@127.0.0.1:${machine.port}"
	private val open = mutableListOf<RemoteService>()

	private fun line(base: String) = """{"base":"$base","token":"secret-token","mode":"attached","started":false,"home":"/home/me/.pine","version":"0.40.0"}"""

	/** A connection to a machine whose key the owner already confirmed. */
	private fun connected(): RemoteService {
		known.confirm("127.0.0.1", machine.port, machine.fingerprint)
		return remote.connect(host).also { open.add(it) }
	}

	private fun refused(): RemoteError = assertFailsWith<RemoteError> { remote.connect(host).also { open.add(it) } }

	private fun saying(err: String, code: Int, out: String = "") = Behaviour { _: InputStream, o: OutputStream, e: OutputStream ->
		o.write(out.toByteArray())
		e.write(err.toByteArray())
		code
	}

	@AfterTest
	fun end() {
		open.forEach { it.stop() }
		machine.close()
		daemon.close()
	}

	@Test
	fun `it runs the command of src-remote-ts, reads the service line and holds the daemon by stdin`() {
		val s = connected()
		assertEquals(listOf(Machine.expectedCommand), machine.commands.toList())
		assertEquals("secret-token", s.token)
		assertEquals("/home/me/.pine", s.home)
		assertEquals("0.40.0", s.version)
		assertFalse(s.started)
		assertEquals("127.0.0.1", s.label)
		assertEquals(host, s.host)
		assertFalse(service.leashEnded.count == 0L, "stdin is held while connected")
		s.stop()
		assertTrue(service.ended(), "stopping ends the session's stdin")
	}

	@Test
	fun `a call carries the token, no Origin, and the loopback as Host, through a channel of the session`() {
		val s = connected()
		val r = s.call("POST", "/agents/main/message?x=1", JSONObject().put("text", "hello"))
		assertTrue(r.ok)
		assertEquals(200, r.status)
		assertEquals("POST", (r.data as JSONObject).getString("method"))
		val seen = daemon.seen.single()
		assertEquals("/agents/main/message?x=1", seen.url)
		assertEquals("Bearer secret-token", seen.header("authorization"))
		assertEquals("application/json", seen.header("content-type"))
		assertEquals("""{"text":"hello"}""", seen.body)
		assertEquals(daemon.base.removePrefix("http://"), seen.header("host"))
		assertNull(seen.header("origin"))
		assertNull(seen.header("sec-fetch-site"))
		// Without a body, none is sent and no content type is claimed.
		s.call("GET", "/agents", null)
		assertNull(daemon.seen.last().header("content-type"))
		assertEquals("", daemon.seen.last().body)
	}

	@Test
	fun `answers come back as callDaemon gives them`() {
		val s = connected()
		assertEquals(true, (s.call("GET", "/streamed", null).data as JSONObject).getBoolean("streamed"))
		val missing = s.call("GET", "/missing", null)
		assertEquals(false, missing.ok)
		assertEquals(404, missing.status)
		assertEquals("not found", (missing.data as JSONObject).getString("error"))
		assertEquals(0, (s.call("GET", "/broken", null).data as JSONObject).length())
		// A picture: bytes and their kind.
		val picture = s.call("GET", "/picture", null).data as JSONObject
		assertEquals("image/png", picture.getString("mime"))
		assertEquals(StandInDaemon.PNG.toList(), Base64.getDecoder().decode(picture.getString("base64")).toList())
	}

	@Test
	fun `what is not a call of the control API is refused before it leaves the phone`() {
		val s = connected()
		for ((method, url) in listOf("PUT" to "/agents", "DELETE" to "/agents", "GET" to "agents", "GET" to "//evil.example/x", "GET" to "")) {
			val r = s.call(method, url, null)
			assertEquals(CallResult(false, 400, r.data), r)
			assertEquals("not a call of the control API", (r.data as JSONObject).getString("error"))
		}
		assertTrue(daemon.seen.isEmpty())
	}

	@Test
	fun `before a daemon there is nothing to call, and a daemon that does not answer is status 0`() {
		val before = callDaemon(null, "GET", "/agents", null)
		assertEquals(503, before.status)
		assertEquals("pine is not running yet", (before.data as JSONObject).getString("error"))
		val nobody = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { it.localPort }
		machine.behaviour = Service(line("http://127.0.0.1:$nobody"))
		val r = connected().call("GET", "/agents", null)
		assertEquals(false, r.ok)
		assertEquals(0, r.status)
		assertContains((r.data as JSONObject).getString("error"), "pine does not answer")
	}

	@Test
	fun `a service line that names anything but the other machine's loopback is not taken`() {
		machine.behaviour = Service(line("http://10.0.0.5:7463"))
		known.confirm("127.0.0.1", machine.port, machine.fingerprint)
		val e = refused()
		assertEquals("failed", e.kind)
		assertContains(e.message!!, "not a port of its own loopback")
	}

	@Test
	fun `pine missing, too old, without a home, or saying nonsense, is said in words`() {
		known.confirm("127.0.0.1", machine.port, machine.fingerprint)
		machine.behaviour = saying("pine is not installed there: no pine command on its PATH.\n", 127)
		refused().let {
			assertEquals("ssh", it.kind)
			assertContains(it.message!!, "pine is not installed on $host")
		}
		machine.behaviour = saying("error: unknown command \"service\"\n", 1)
		refused().let {
			assertEquals("ssh", it.kind)
			assertContains(it.message!!, "too old")
			assertContains(it.message!!, "pine update")
		}
		machine.behaviour = saying("", 1, """{"error":"no pine home at /home/me/.pine: run pine init there"}""" + "\n")
		refused().let {
			assertEquals("failed", it.kind)
			assertEquals("The pine on 127.0.0.1 did not start: no pine home at /home/me/.pine: run pine init there", it.message)
		}
		machine.behaviour = saying("", 0, "Welcome to the server!\n")
		refused().let {
			assertEquals("ssh", it.kind)
			assertContains(it.message!!, "not pine's service line: Welcome")
		}
		machine.behaviour = Behaviour { input, _, _ -> while (input.read() >= 0) Unit; 0 }
		refused().let {
			assertEquals("ssh", it.kind)
			assertContains(it.message!!, "did not answer over SSH within a minute")
		}
		machine.behaviour = Behaviour { input, _, err -> err.write("To authenticate, visit: https://login.tailscale.com/a/abc123\n".toByteArray()); err.flush(); while (input.read() >= 0) Unit; 0 }
		refused().let { assertContains(it.message!!, "Open https://login.tailscale.com/a/abc123") }
	}

	@Test
	fun `an unknown host key stops with its fingerprint, and once confirmed it connects`() {
		val e = assertFailsWith<HostKeyError> { remote.connect(host) }
		assertEquals("ssh", e.kind)
		assertFalse(e.changed)
		assertEquals(machine.fingerprint, e.fingerprint)
		assertTrue(e.fingerprint.matches(Regex("^SHA256:[A-Za-z0-9+/]{43}$")), e.fingerprint)
		assertContains(e.message!!, e.fingerprint)
		assertTrue(machine.commands.isEmpty(), "nothing runs on a machine that was not confirmed")
		known.confirm(e.host, e.port, e.fingerprint)
		open.add(remote.connect(host))
		assertEquals(1, machine.commands.size)
	}

	@Test
	fun `a changed host key is refused until the stored one is forgotten`() {
		connected().stop()
		machine.hostKey = Machine.newHostKey()
		val e = assertFailsWith<HostKeyError> { remote.connect(host) }
		assertTrue(e.changed)
		assertEquals(machine.fingerprint, e.fingerprint)
		assertContains(e.message!!, "changed")
		assertEquals(1, machine.commands.size)
		// Confirming the new one while the old one is stored changes nothing: it is forgotten first.
		known.forget("127.0.0.1", machine.port)
		assertFalse(assertFailsWith<HostKeyError> { remote.connect(host) }.changed)
		known.confirm("127.0.0.1", machine.port, machine.fingerprint)
		open.add(remote.connect(host))
		assertEquals(2, machine.commands.size)
	}

	@Test
	fun `a key the machine does not take, a machine nobody answers at, and a host that is no host`() {
		val stranger = Remote(DeviceKey(MemoryVault()), known, answerMs = 1_000)
		known.confirm("127.0.0.1", machine.port, machine.fingerprint)
		assertFailsWith<RemoteError> { stranger.connect(host) }.let {
			assertEquals("ssh", it.kind)
			assertContains(it.message!!, "authorized_keys")
		}
		val nobody = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { it.localPort }
		assertFailsWith<RemoteError> { remote.connect("me@127.0.0.1:$nobody") }.let {
			assertEquals("ssh", it.kind)
			assertContains(it.message!!, "Could not connect to me@127.0.0.1:$nobody over SSH")
		}
		assertEquals("ssh", assertFailsWith<RemoteError> { remote.connect("-oProxyCommand=x") }.kind)
		assertContains(assertFailsWith<RemoteError> { remote.connect("127.0.0.1:${machine.port}") }.message!!, "user@")
	}
}
