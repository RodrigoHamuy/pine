package pine.mobile.core

import java.net.ServerSocket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertSame
import kotlin.test.assertTrue

// A machine's pine held across the app's life, as desktop/electron/main.ts holds one: checked with
// /health before it is used again, and connected anew when the event stream is lost five times in a row.
class HeldTest {
	private val rig = Rig()
	private val hold = CountDownLatch(1)
	private val ups = Collections.synchronizedList(mutableListOf<Boolean>())
	private val failures = Collections.synchronizedList(mutableListOf<Exception>())
	private val on = object : EventHandlers {
		override fun batch(events: List<Any>) {}
		override fun connection(up: Boolean) {
			ups.add(up)
		}
	}

	private fun held() = rig.held(HeldRemote(rig.remote, rig.host, on, failed = { failures.add(it) }, retryMs = 20))

	private fun streams() {
		rig.daemon.routes["/events/stream"] = { x ->
			x.responseHeaders.add("content-type", "text/event-stream")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write(": connected\n\n".toByteArray())
			x.responseBody.flush()
			hold.await(5, TimeUnit.SECONDS)
		}
	}

	private fun health(status: Int) {
		rig.daemon.routes["/health"] = { x ->
			x.responseHeaders.add("content-type", "application/json")
			x.sendResponseHeaders(status, 2)
			x.responseBody.write("{}".toByteArray())
		}
	}

	@AfterTest
	fun end() {
		hold.countDown()
		rig.close()
	}

	@Test
	fun `whether a daemon still answers is asked of health, without the token, and in a bounded time`() {
		val s = rig.connected()
		health(200)
		assertTrue(answers(s))
		val seen = rig.daemon.seen.last()
		assertEquals("/health", seen.url)
		assertNull(seen.header("authorization"))
		health(503)
		assertFalse(answers(s))
		rig.daemon.routes["/health"] = { hold.await(5, TimeUnit.SECONDS) }
		val t = System.currentTimeMillis()
		assertFalse(answers(s, timeoutMs = 200))
		assertTrue(System.currentTimeMillis() - t < 1_500)
		val nobody = ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1")).use { it.localPort }
		rig.machine.behaviour = Service("""{"base":"http://127.0.0.1:$nobody","token":"t"}""")
		assertFalse(answers(rig.connected()))
	}

	@Test
	fun `a held session is used again while it answers, and made again when it does not`() {
		streams()
		health(200)
		val h = held()
		val first = h.ensure()
		eventually("the stream open") { ups.contains(true) }
		assertSame(first, h.ensure())
		assertEquals(1, rig.machine.commands.size)
		health(503)
		val second = h.ensure()
		assertTrue(second !== first)
		assertEquals(2, rig.machine.commands.size)
		assertTrue(rig.service.ended(), "the session that no longer answered was let go of")
		assertSame(second, h.service)
	}

	@Test
	fun `five losses in a row make a new SSH session`() {
		// Which session each attempt came in on.
		val sessions = Collections.synchronizedList(mutableListOf<Int>())
		rig.daemon.routes["/events/stream"] = { x ->
			sessions.add(rig.machine.commands.size)
			x.sendResponseHeaders(500, -1)
		}
		val h = held()
		val first = h.ensure()
		eventually("a second session") { rig.machine.commands.size >= 2 }
		streams()
		eventually("the stream open on it") { ups.lastOrNull() == true }
		assertEquals(5, sessions.count { it == 1 }, "the first session was tried five times")
		assertEquals(listOf(false, false, false, false, false), ups.take(5))
		assertTrue(h.service !== first)
		assertFalse(first.isOpen)
		assertTrue(failures.isEmpty())
	}

	@Test
	fun `a new session that cannot be made is said`() {
		rig.daemon.routes["/events/stream"] = { x -> x.sendResponseHeaders(500, -1) }
		val h = held()
		h.ensure()
		rig.known.forget("127.0.0.1", rig.machine.port)
		eventually("the failure said") { failures.isNotEmpty() }
		assertIs<HostKeyError>(failures.first())
		assertNull(h.service)
	}
}
