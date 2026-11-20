// The way to a paired computer: a WebRTC data channel, through the computer's meeting service, as
// the web client opens it (web/src/peer.ts). The phone joins the meeting under the computer's
// machine id, makes the offer and one channel labelled `ssh`, and the two exchange the offer, the
// answer and their candidates as the service's signal messages; once the channel is open the
// meeting is left. The channel is then SSH's byte stream (Remote.kt), end to end, checked against
// the machine id's host key. libdatachannel through tel.schich's binding, the library the Pine
// app's access host runs on.
package pine.mobile.core

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import tel.schich.libdatachannel.DataChannel
import tel.schich.libdatachannel.DataChannelCallback
import tel.schich.libdatachannel.PeerConnection
import tel.schich.libdatachannel.PeerConnectionConfiguration
import tel.schich.libdatachannel.PeerState
import tel.schich.libdatachannel.SessionDescriptionType
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.URI
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.concurrent.thread

/** The channel the phone makes and the paired computer takes. */
const val LABEL = "ssh"

/** Writes are cut to this: the size every data channel carries without trouble. */
const val PIECE = 16 * 1024

/** A writer waits while more than this waits in the channel, and goes on once it fell to `LOW`. */
const val HIGH = 1024 * 1024
const val LOW = 256 * 1024

/**
 * Why the way to a paired computer could not be opened: the meeting service could not be reached
 * ("unreachable"), no computer waits under its id ("absent"), no connection was made in time or the
 * meeting ended first ("no-path"), or the service is over its limits ("limits"). The words are
 * `PairedWords.peer`'s.
 */
class PeerClosed(val reason: String) : Exception(reason)

/** "your computer": a paired computer that gave no name. */
const val YOUR_COMPUTER = "your computer"

/**
 * What the owner is told about a paired computer, in the web client's words (`peerTrouble`,
 * `notKnown` and the paired host-key sentence of web/src/host.ts) with "this phone" for "this
 * browser", word for word as the iOS core says them (PairedWords in PeerRemote.swift). `label` is
 * the name the computer gave when it was paired, or "your computer".
 */
class PairedWords(val label: String) {
	private val atStart = if (label == YOUR_COMPUTER) "Your computer" else label

	/** The way to the computer could not be opened. */
	fun peer(reason: String): String = when (reason) {
		"absent" -> "$atStart does not answer: it is off, asleep, or Pine is closed. This phone keeps trying, and connects when $label is back."
		"no-path" -> "$atStart is there, but no direct connection could be made from this network. Try another network (another Wi-Fi, or your phone's data); this phone keeps trying meanwhile."
		"limits" -> "The meeting service is over its limits for now. Try again later; this phone keeps trying meanwhile."
		else -> "Could not connect to $label. The meeting service could not be reached. Check the network, then try again."
	}

	/** The computer presented a host key that is not its machine id. */
	fun changed(was: String, seen: String) = "The host key of $label changed: it was $was, it is now $seen. Someone may stand between this phone and $label. Forget it here, then open Pine on $label and add this device again."

	/** The computer did not take the phone's key: it was removed there. */
	val notKnown: String get() = "This phone is no longer known to $label. Open Pine on $label and add this device again."

	/** The channel closed before SSH let the phone in. */
	val cut: String get() = "Could not connect to $label. The connection to the computer closed before SSH let this phone in."

	/** The channel went while `pine service` was asked. */
	val lost: String get() = "The connection to $label was lost while pine there was asked to start."
}

/** The servers that help a connection, as the service's configuration names them (`GET /meet/config`); anything that is not a STUN or TURN address is left out. */
fun iceOf(config: JSONObject?): List<URI> {
	val ice = config?.optJSONArray("ice") ?: return emptyList()
	val url = Regex("^(stun|stuns|turn|turns):\\S+$")
	return (0 until ice.length()).flatMap { i ->
		val urls = ice.optJSONObject(i)?.opt("urls")
		val list = when (urls) {
			is String -> listOf(urls)
			is JSONArray -> (0 until urls.length()).map { urls.opt(it) as? String ?: "" }
			else -> emptyList()
		}
		if (list.isEmpty() || !list.all { url.matches(it) }) emptyList() else list.mapNotNull { runCatching { URI(it) }.getOrNull() }
	}
}

/** The meeting's close codes (web/relay/src/meet.ts `CLOSE`) that say why a meeting ended. */
private fun whyClosed(code: Int): PeerClosed = PeerClosed(
	when (code) {
		4404 -> "absent"
		4429 -> "limits"
		// 4408 (the session ran out of time), or the computer or the service ended it: no way this time.
		else -> "no-path"
	},
)

/**
 * Where a meeting service answers: an https origin, and nothing else, the loopback included. Null
 * for anything else: the phone connects to nothing else. (The tests reach the access host's helper,
 * which answers on http on the loopback, through `route` of `Remote`, which only a test hands in.)
 */
fun meetingService(service: String): String? = httpsOrigin(service)?.first?.takeIf { it == service }

/**
 * The data channel, open, as SSH's byte stream: what arrives is read from `input` in order, bytes
 * that came before anybody read included, and the channel's end is its end (-1), so that SSH does
 * not hang on a channel that closed. `output` cuts writes into pieces of `PIECE` and waits while
 * more than `HIGH` is buffered. Closing either closes the channel and the connection.
 *
 * The library calls back on threads of its own, where a throw is lost without a word, and where its
 * own calls must not be made (closing there can wait on itself): the callbacks only copy bytes and
 * set flags, and the connection is closed on a thread of its own.
 */
class ChannelStream internal constructor(private val pc: PeerConnection, private val dc: DataChannel) : AutoCloseable {
	private val lock = Object()
	private val arrived = LinkedBlockingQueue<ByteArray>()
	@Volatile
	private var ended = false
	private var closing = false

	init {
		dc.bufferedAmountLowThreshold(LOW)
		dc.onMessage.register(DataChannelCallback.Message.handleBinary { _, buffer ->
			arrived.add(ByteArray(buffer.remaining()).also { buffer.get(it) })
		})
		dc.onBufferedAmountLow.register { synchronized(lock) { lock.notifyAll() } }
		dc.onClosed.register { end() }
		dc.onError.register { _, _ -> end() }
		pc.onStateChange.register { _, state -> if (state == PeerState.RTC_FAILED || state == PeerState.RTC_CLOSED) end() }
	}

	/** Whether the channel still stands. */
	val isOpen: Boolean get() = !ended

	/** The channel ended (from either side): readers get its end, writers an error. */
	private fun end() {
		if (ended) return
		ended = true
		arrived.add(END)
		synchronized(lock) { lock.notifyAll() }
	}

	val input: InputStream = object : InputStream() {
		private var piece: ByteArray = ByteArray(0)
		private var at = 0

		override fun read(): Int {
			val one = ByteArray(1)
			return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xff
		}

		override fun read(b: ByteArray, off: Int, len: Int): Int {
			if (len == 0) return 0
			while (at >= piece.size) {
				val next = arrived.take()
				if (next === END) {
					// Every reader after this one hears the end too.
					arrived.add(END)
					return -1
				}
				piece = next
				at = 0
			}
			val n = minOf(len, piece.size - at)
			System.arraycopy(piece, at, b, off, n)
			at += n
			return n
		}

		override fun close() = this@ChannelStream.close()
	}

	val output: OutputStream = object : OutputStream() {
		override fun write(b: Int) = write(byteArrayOf(b.toByte()), 0, 1)

		// One write at a time, so that the pieces of two writes never interleave while one waits for room.
		override fun write(b: ByteArray, off: Int, len: Int) = synchronized(this) {
			var at = off
			while (at < off + len) {
				synchronized(lock) {
					while (!ended && this@ChannelStream.buffered() > HIGH) lock.wait(50)
				}
				if (ended) throw IOException("The connection to the computer is closed.")
				val n = minOf(PIECE, off + len - at)
				// The binding sends only a direct buffer: it hands the native side its address.
				val piece = ByteBuffer.allocateDirect(n).put(b, at, n).flip()
				try {
					dc.sendMessage(piece)
				} catch (e: Exception) {
					end()
					throw IOException("The connection to the computer is closed.", e)
				}
				at += n
			}
		}

		override fun close() = this@ChannelStream.close()
	}

	/** How many bytes wait in the channel to be sent. */
	fun buffered(): Int = if (ended) 0 else runCatching { dc.bufferedAmount() }.getOrDefault(0)

	override fun close() {
		end()
		synchronized(lock) {
			if (closing) return
			closing = true
		}
		thread(isDaemon = true, name = "pine-peer-close") {
			runCatching { dc.close() }
			runCatching { pc.close() }
		}
	}

	private companion object {
		/** The end of the stream, in the queue of what arrived. */
		val END = ByteArray(0)
	}
}

/**
 * Opens the way to the paired computer `id` through the meeting service at `base` (an origin
 * `Remote` checked to be https, then routed): its
 * configuration (the ICE servers), the join socket, the offer and the `ssh` channel, the computer's
 * answer and candidates (kept until its answer is set). Throws `PeerClosed` when there is no way to
 * it, and when no channel opened within `openMs`. `native` loads the library: it differs on
 * Android and on the JVM.
 */
internal fun openPeer(base: String, id: String, http: OkHttpClient, native: () -> Unit, openMs: Long = 20_000): ChannelStream {
	native()
	val config = runCatching {
		http.newCall(Request.Builder().url("$base/meet/config").build()).execute().use { r -> if (r.isSuccessful) JSONObject(r.body.string()) else null }
	}.getOrNull()
	val ice = iceOf(config)
	val result = CompletableFuture<ChannelStream>()
	val lock = Object()
	var pc: PeerConnection? = null
	var stream: ChannelStream? = null
	var answered = false
	val pending = mutableListOf<Pair<String, String>>()

	val join = base.replaceFirst(Regex("^http"), "ws") + "/meet/join?id=$id"
	lateinit var socket: WebSocket
	val signal = { d: JSONObject -> socket.send(JSONObject().put("t", "signal").put("d", d).toString()) }
	val fail = { e: Exception -> if (result.completeExceptionally(e)) socket.cancel() }

	socket = http.newWebSocket(Request.Builder().url(join).build(), object : WebSocketListener() {
		override fun onMessage(webSocket: WebSocket, text: String) {
			val message = runCatching { JSONObject(text) }.getOrNull() ?: return
			try {
				if (message.optString("t") == "ready") {
					synchronized(lock) {
						if (pc != null || result.isDone) return
						val peer = PeerConnection.createPeer(PeerConnectionConfiguration.DEFAULT.withIceServers(ice))
						pc = peer
						peer.onLocalDescription.register { _, sdp, type -> signal(JSONObject().put("sdp", JSONObject().put("type", type.name.lowercase()).put("sdp", sdp))) }
						peer.onLocalCandidate.register { _, candidate, mid -> signal(JSONObject().put("ice", JSONObject().put("candidate", candidate.removePrefix("a=")).put("sdpMid", mid).put("sdpMLineIndex", 0))) }
						peer.onStateChange.register { _, state -> if (state == PeerState.RTC_FAILED) fail(PeerClosed("no-path")) }
						// Made before the channel opens, so that the bytes the computer sends at once (SSH's banner) are kept.
						val dc = peer.createDataChannel(LABEL)
						val made = ChannelStream(peer, dc)
						stream = made
						dc.onOpen.register {
							if (result.complete(made)) webSocket.close(1000, "The channel is open.")
						}
					}
					return
				}
				if (message.optString("t") != "signal") return
				val d = message.optJSONObject("d") ?: return
				synchronized(lock) {
					val peer = pc ?: return
					val sdp = d.optJSONObject("sdp")
					val ice = d.optJSONObject("ice")
					if (sdp != null && sdp.optString("type") == "answer" && sdp.opt("sdp") is String) {
						peer.setRemoteDescription(sdp.getString("sdp"), SessionDescriptionType.ANSWER)
						answered = true
						pending.forEach { (c, mid) -> peer.addRemoteCandidate(c, mid) }
						pending.clear()
					} else if (ice != null && ice.optString("candidate").isNotEmpty()) {
						val candidate = ice.getString("candidate") to (ice.opt("sdpMid") as? String ?: "0")
						if (answered) peer.addRemoteCandidate(candidate.first, candidate.second) else pending.add(candidate)
					}
				}
			} catch (e: Exception) {
				// A message that does not fit this connection changes nothing: the time limit ends the attempt.
			}
		}

		override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
			webSocket.close(1000, null)
			fail(whyClosed(code))
		}

		override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
			// A socket that never reached the meeting: the service could not be reached, or refused it outright.
			fail(if (synchronized(lock) { pc == null }) PeerClosed("unreachable") else PeerClosed("no-path"))
		}
	})

	try {
		return result.get(openMs, TimeUnit.MILLISECONDS)
	} catch (e: Exception) {
		fail(PeerClosed("no-path"))
		synchronized(lock) {
			stream?.close() ?: pc?.let { peer -> thread(isDaemon = true, name = "pine-peer-close") { runCatching { peer.close() } } }
		}
		throw when (e) {
			is ExecutionException -> e.cause as? Exception ?: PeerClosed("no-path")
			is TimeoutException -> PeerClosed("no-path")
			else -> PeerClosed("no-path")
		}
	}
}
