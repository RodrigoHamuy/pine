package dev.pmndre.pine

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import pine.mobile.core.DeviceKey
import pine.mobile.core.KnownHosts
import pine.mobile.core.PairedComputer
import pine.mobile.core.PairingState
import pine.mobile.core.Remote
import pine.mobile.core.Vault
import pine.mobile.core.pairLink
import java.security.KeyStore
import java.security.SecureRandom
import java.security.Security
import java.security.cert.CertificateFactory
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/**
 * The app's WebRTC library (LibWebRtc.kt) under the core, on the emulator, against the Pine app's
 * real access host (mobile/test/support/access-host.ts) on this computer: the core's tests prove
 * everything above the library on libdatachannel, this proves libwebrtc below it. Run by
 * `npm run smoke` in mobile/ (`-- --transport-only` for this alone), which starts the helper, puts
 * a TLS front of its own before its meeting service (a link names https only), opens a pairing,
 * answers yes, and hands this test the link and the front's authority as instrumentation arguments
 * (`link`, `ca`). Without them it has nothing to reach and says so.
 */
@RunWith(AndroidJUnit4::class)
class LibWebRtcTest {
	private val args = InstrumentationRegistry.getArguments()
	private val context = InstrumentationRegistry.getInstrumentation().targetContext

	init {
		// As PinePlugin.load: the full BouncyCastle in place of Android's cut-down one, for SSH.
		Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
		Security.addProvider(BouncyCastleProvider())
	}

	/** The phone's key and the hosts it knows, in memory: this test's own, never the app's. */
	private class MemoryVault : Vault {
		private val kept = mutableMapOf<String, ByteArray>()
		override fun read(name: String): ByteArray? = kept[name]
		override fun write(name: String, value: ByteArray) {
			kept[name] = value
		}
		override fun remove(name: String) {
			kept.remove(name)
		}
	}

	/** The certificates of the run's TLS front, and nothing else. */
	private fun trust(pem: ByteArray): X509TrustManager {
		val store = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
			load(null, null)
			setCertificateEntry("smoke", CertificateFactory.getInstance("X.509").generateCertificate(pem.inputStream()))
		}
		val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply { init(store) }
		return factory.trustManagers.filterIsInstance<X509TrustManager>().single()
	}

	@Test
	fun pairsThenMovesMegabytesEachWayWholeAndInOrder() {
		val given = args.getString("link") ?: throw AssertionError("No pairing link: run this through `npm run smoke -- --transport-only` in mobile/.")
		val link = pairLink(given) ?: throw AssertionError("Not a pairing link: $given")
		val ca = Base64.decode(args.getString("ca") ?: throw AssertionError("No authority for the TLS front."), Base64.DEFAULT)
		// The run's TLS front answers this emulator first: a failure here is the run's setup, not the library.
		val trusted = trust(ca)
		val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trusted), null) }
		val probe = OkHttpClient.Builder().sslSocketFactory(tls.socketFactory, trusted).build()
		val config = runCatching { probe.newCall(Request.Builder().url("${link.service}/meet/config").build()).execute().use { it.code } }
		assertEquals("the meeting service answers at ${link.service}: ${config.exceptionOrNull()}", 200, config.getOrNull())
		val vault = MemoryVault()
		val remote = Remote(DeviceKey(vault), KnownHosts(vault), LibWebRtc(context), answerMs = 20_000, trust = trust(ca))

		// Pairing: a first channel, SSH over it as pair.<code>, the computer's yes (the run answered it already).
		val heard = mutableListOf<PairingState>()
		val end = remote.pair(link, "Pine on an emulator") { synchronized(heard) { heard.add(it) } }.result(90_000)
		assertTrue("the computer allowed the phone: $end (heard ${synchronized(heard) { heard.toList() }})", end is PairingState.Allowed)
		val name = (end as PairingState.Allowed).name

		// A second channel, the session as the paired phone, `pine service`, then the daemon's calls.
		val service = remote.connect("paired:${link.id}", PairedComputer(link.id, link.service, name))
		try {
			assertTrue("reached over the data channel", service.paired)
			val health = service.call("GET", "/health", null)
			assertTrue("the daemon answers: $health", health.ok)

			// Several megabytes up, echoed back whole by the computer in one burst of more than 1 MiB,
			// under sshj's own window: whole and in order both ways, or the text is not the same.
			val random = SecureRandom()
			for (size in listOf(2, 4, 6)) {
				val up = Base64.encodeToString(ByteArray(size * 1024 * 1024).also { random.nextBytes(it) }, Base64.NO_WRAP)
				val answer = service.call("POST", "/echo/$size", JSONObject().put("data", up))
				assertTrue("the echo of $size MiB came back: ${answer.status}", answer.ok)
				val echoed = (answer.data as JSONObject).getJSONObject("echoed")
				assertEquals("/echo/$size", echoed.getString("url"))
				assertEquals("$size MiB up and back, whole and in order", up, JSONObject(echoed.getString("body")).getString("data"))
			}
		} finally {
			service.stop()
		}
	}
}
