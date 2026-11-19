package pine.mobile.core

import org.json.JSONObject
import java.util.Collections
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A shelf in memory, as the app's SharedPreferences are. */
class MemoryShelf : Shelf {
	val entries = mutableMapOf<String, String>()
	override fun get(name: String) = entries[name]
	override fun set(name: String, value: String?) {
		if (value == null) entries.remove(name) else entries[name] = value
	}
}

/** What the page is told, as it is told it. */
class SeenPage : Page {
	val states = Collections.synchronizedList(mutableListOf<JSONObject>())
	val batches = Collections.synchronizedList(mutableListOf<List<Any>>())
	val ups = Collections.synchronizedList(mutableListOf<Boolean>())
	override fun service(state: JSONObject) {
		states.add(state)
	}
	override fun events(batch: List<Any>) {
		batches.add(batch)
	}
	override fun connection(up: Boolean) {
		ups.add(up)
	}
	val last: JSONObject? get() = synchronized(states) { states.lastOrNull() }
	fun status() = last?.optString("status")
}

// The native plugin's part that has no Android in it: the machines, the one in use, its connection
// and what the page is told about it, as desktop/electron/main.ts does for the desktop page.
class PinesTest {
	private val rig = Rig()
	private val shelf = MemoryShelf()
	private val page = SeenPage()
	private val pines = Pines(rig.remote, rig.known, shelf, page, retryMs = 20)

	@AfterTest
	fun end() {
		pines.close()
		rig.close()
	}

	@Test
	fun `machines are added as ssh would take them, with a user, at most twenty, and kept`() {
		assertEquals(listOf("me@server"), pines.addHost(" me@server "))
		assertEquals(listOf("me@server", "me@other:2222"), pines.addHost("me@other:2222"))
		assertEquals(listOf("me@server", "me@other:2222"), pines.addHost("me@server"), "once")
		assertFailsWith<RemoteError> { pines.addHost("-oProxyCommand=evil") }
		assertFailsWith<RemoteError> { pines.addHost("server") }
		(3..20).forEach { pines.addHost("me@host$it") }
		assertFailsWith<RemoteError> { pines.addHost("me@one-too-many") }
		assertEquals(20, Pines(rig.remote, rig.known, shelf, SeenPage()).hosts.size, "kept on the shelf")
	}

	@Test
	fun `with no machine the page is told to add one, and a machine not yet known asks the owner for its host key`() {
		pines.ready()
		assertEquals("error", page.status())
		assertTrue(page.last!!.optString("message").contains("Add the machine"))
		assertTrue(!page.last!!.has("host"))
		rig.known.forget("127.0.0.1", rig.machine.port)
		pines.addHost(rig.host)
		pines.use(rig.host)
		assertEquals("starting", page.states.first { it.optString("status") == "starting" }.optString("status"))
		eventually("the host key put to the owner") { page.status() == "error" && page.last!!.has("fingerprint") }
		val asked = page.last!!
		assertEquals(rig.host, asked.optString("host"))
		assertEquals(rig.machine.fingerprint, asked.optString("fingerprint"))
		assertEquals(false, asked.optBoolean("changed"))
		assertTrue(asked.optString("message").contains(rig.machine.fingerprint))
		assertEquals(0, rig.machine.commands.size, "nothing runs on a machine whose key is not trusted")
		assertFailsWith<RemoteError> { pines.trust(rig.host, "SHA256:" + "A".repeat(43)) }
		pines.trust(rig.host, rig.machine.fingerprint)
		eventually("connected") { page.status() == "ready" }
		assertEquals("me@127.0.0.1:${rig.machine.port}", page.last!!.optString("host"))
		assertEquals("on 127.0.0.1", page.last!!.optString("mode"))
		assertEquals(rig.machine.fingerprint, rig.known.fingerprintOf("127.0.0.1", rig.machine.port))
		assertEquals(rig.host, Pines(rig.remote, rig.known, shelf, SeenPage()).use, "kept as the one in use")
	}

	@Test
	fun `calls and media go to the pine in use with its token, and nothing before it is reached`() {
		assertEquals(503, pines.call("GET", "/agents", null).status)
		pines.addHost(rig.host)
		pines.use(rig.host)
		eventually("connected") { page.status() == "ready" }
		val r = pines.call("POST", "/agents", JSONObject().put("a", 1))
		assertEquals(200, r.status)
		val seen = rig.daemon.seen.last()
		assertEquals("Bearer secret-token", seen.header("authorization"))
		assertNull(seen.header("origin"))
		assertEquals(404, pines.media("GET", "/agents", "").status, "only what the media list names")
	}

	@Test
	fun `a changed host key is refused, cannot be trusted, and the machine can then be forgotten with its key`() {
		pines.addHost(rig.host)
		pines.use(rig.host)
		eventually("connected") { page.status() == "ready" }
		assertFailsWith<RemoteError> { pines.forgetHost(rig.host) }
		// The machine is another one now: the held session no longer answers, and a new one meets another key.
		rig.daemon.routes["/health"] = { x -> x.sendResponseHeaders(503, -1) }
		rig.machine.hostKey = Machine.newHostKey()
		pines.retry()
		eventually("refused") { page.status() == "error" }
		assertEquals(true, page.last!!.optBoolean("changed"))
		assertFailsWith<RemoteError> { pines.trust(rig.host, rig.machine.fingerprint) }
		pines.forgetKey(rig.host)
		assertEquals(emptyList(), pines.forgetHost(rig.host))
		assertNull(rig.known.fingerprintOf("127.0.0.1", rig.machine.port))
		assertNull(pines.use)
		assertTrue(!page.last!!.has("host"))
	}

	@Test
	fun `only the machine in use speaks to the page, and a check after a pause connects again when it no longer answers`() {
		rig.daemon.routes["/events/stream"] = { x ->
			x.responseHeaders.add("content-type", "text/event-stream")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("data: {\"topic\":\"a/b\"}\n\n".toByteArray())
			x.responseBody.flush()
			Thread.sleep(3_000)
		}
		rig.daemon.routes["/health"] = { x -> x.sendResponseHeaders(200, -1) }
		pines.addHost(rig.host)
		pines.use(rig.host)
		eventually("an event") { page.batches.isNotEmpty() }
		eventually("up") { pines.connected }
		pines.check()
		assertEquals(1, rig.machine.commands.size, "a pine that answers is kept")
		rig.daemon.routes["/health"] = { x -> x.sendResponseHeaders(503, -1) }
		pines.check()
		assertEquals("ready", page.status())
		assertEquals(2, rig.machine.commands.size, "connected again")
	}
}
