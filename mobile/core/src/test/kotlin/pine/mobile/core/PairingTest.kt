package pine.mobile.core

import org.json.JSONObject
import java.util.Collections
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Pairing from a link against the Pine app's real access host (AccessHost), as the web client pairs
// a browser with it (web/test/peer.test.ts). The words are the iOS core's (PairingTests.swift).
class PairingTest {
	private val vault = MemoryVault()
	private val key = DeviceKey(vault)
	private val daemon = StandInDaemon()
	private val computer = AccessHost("""{"base":"${daemon.base}","token":"secret-token","mode":"safe","started":true,"home":"/Users/me/.pine","version":"0.40.0"}""")
	private val remote = Remote(key, KnownHosts(vault), answerMs = 5_000, webrtc = LibDataChannelRtc, route = { if (it == SERVICE) computer.service else it })
	private val told = Collections.synchronizedList(mutableListOf<PairingState>())
	private val open = mutableListOf<AutoCloseable>()

	/** A pairing opened at the computer, its link read as the phone reads it, under the https name the test routes to the helper. */
	private fun link(): PairLink = pairLink(computer.command("open").getString("link").replace(computer.service, SERVICE))!!

	@AfterTest
	fun end() {
		open.forEach { runCatching { it.close() } }
		computer.close()
		daemon.close()
	}

	@Test
	fun `it pairs, shows the computer's four digits, is allowed and reaches the daemon without a second link`() {
		val link = link()
		computer.command("allow")
		val pairing = remote.pair(link, "Pine on Pixel 9") { told.add(it) }
		val asked = computer.event("asked")
		assertEquals("Pine on Pixel 9", asked.getString("name"))
		assertEquals(PairingState.Allowed("Test Mac"), pairing.result(20_000))
		assertEquals(listOf(PairingState.Pairing(asked.getString("code")), PairingState.Allowed("Test Mac")), told.toList())
		val device = computer.command("devices").getJSONArray("devices").getJSONObject(0)
		assertEquals("Pine on Pixel 9", device.getString("name"))
		assertEquals(key.publicKey.split(' ')[1], device.getString("key"))

		val s = remote.connect(PAIRED + link.id, PairedComputer(link.id, link.service, "Test Mac")).also { s -> open.add(AutoCloseable { s.stop() }) }
		assertTrue(s.call("POST", "/agents/main/message", JSONObject().put("text", "hello")).ok)
		assertEquals("Bearer secret-token", daemon.seen.single().header("authorization"))
	}

	private fun nothingKept(at: AccessHost = computer) = assertEquals(0, at.command("devices").getJSONArray("devices").length(), "no device stored")

	@Test
	fun `refused, it ends as refused and nothing is stored`() {
		val link = link()
		computer.command("refuse")
		val pairing = remote.pair(link, "Pine on Pixel 9") { told.add(it) }
		val code = computer.event("asked").getString("code")
		assertEquals(PairingState.Refused, pairing.result(20_000))
		assertEquals(listOf(PairingState.Pairing(code), PairingState.Refused), told.toList())
		assertEquals(PairWords.REFUSED, PairWords.of(PairingState.Refused))
		nothingKept()
	}

	@Test
	fun `with no answer in time, it ends as expired and nothing is stored`() {
		val slow = AccessHost("""{"base":"${daemon.base}","token":"t"}""", "--answer-ms", "300").also { open.add(it) }
		val routed = Remote(key, KnownHosts(vault), webrtc = LibDataChannelRtc, route = { slow.service })
		val link = pairLink(slow.command("open").getString("link").replace(slow.service, SERVICE))!!
		val pairing = routed.pair(link, "Pine on Pixel 9") { told.add(it) }
		slow.event("asked")
		assertEquals(PairingState.Expired, pairing.result(20_000))
		assertEquals(PairingState.Expired, told.last())
		nothingKept(slow)
	}

	@Test
	fun `a wrong code is reported as expired and stores nothing`() {
		val link = link().let { it.copy(code = (if (it.code[0] == 'A') "B" else "A") + it.code.drop(1)) }
		computer.command("allow")
		assertEquals(PairingState.Expired, remote.pair(link, "Pine on Pixel 9") { told.add(it) }.result(20_000))
		assertEquals(listOf<PairingState>(PairingState.Expired), told.toList())
		nothingKept()
	}

	@Test
	fun `a computer whose host key is not the link's machine id is refused before the phone's key is offered`() {
		val link = link()
		computer.command("meeting swap")
		computer.command("allow")
		assertEquals(PairingState.Failed(PairWords.IMPOSTOR), remote.pair(link, "Pine on Pixel 9") { told.add(it) }.result(20_000))
		nothingKept()
	}

	/**
	 * The pairing entry itself, with an `open` that hands back the first `cut` channels already closed,
	 * as a computer that let go of a channel slow to reach it would: the helper has no command that
	 * cuts only the first channel. Returns the end and how many channels were opened.
	 */
	private fun pairedThroughCut(cut: Int): Pair<PairingState?, Int> {
		val link = link()
		computer.command("allow")
		val http = okhttp3.OkHttpClient()
		var opened = 0
		val open = {
			val stream = openPeer(computer.service, link.id, http, LibDataChannelRtc, 20_000)
			if (++opened <= cut) stream.close()
			stream
		}
		val pairing = startPairing(link, "Pine on Pixel 9", { told.add(it) }, key, open, client = { net.schmizz.sshj.SSHClient(net.schmizz.sshj.DefaultConfig()) })
		return pairing.result(30_000) to opened
	}

	@Test
	fun `a channel that closed before the code was offered is tried once more, and the pairing goes through`() {
		val (end, opened) = pairedThroughCut(1)
		assertEquals(PairingState.Allowed("Test Mac"), end)
		assertEquals(2, opened, "one retry")
		assertEquals(1, computer.command("devices").getJSONArray("devices").length())
	}

	@Test
	fun `two channels that closed before the code was offered end the pairing, with no third try`() {
		val (end, opened) = pairedThroughCut(2)
		assertEquals(PairingState.Failed(PairWords.CUT), end)
		assertEquals(2, opened, "never a second retry")
		nothingKept()
	}

	@Test
	fun `an open pairing can be cancelled, tells nothing more and leaves no connection behind`() {
		val link = link()
		val pairing = remote.pair(link, "Pine on Pixel 9") { told.add(it) }
		val code = computer.event("asked").getString("code")
		within(5_000, "the four digits told") { told.isNotEmpty() }
		pairing.cancel()
		assertNull(pairing.result(1_000))
		assertTrue(computer.event("left").getString("id").startsWith("pairing:"), "the pairing session ended at the computer")
		computer.command("allow")
		Thread.sleep(300)
		assertEquals(listOf<PairingState>(PairingState.Pairing(code)), told.toList(), "nothing told after the cancel")
		nothingKept()
	}
}
