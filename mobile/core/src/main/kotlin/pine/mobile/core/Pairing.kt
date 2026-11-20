// Pairing the phone with a computer by its link, as the web client pairs a browser (web/src/pairing.ts
// `askToPair`, web/src/host.ts `pairWith`) and the Pine app's access host takes it
// (desktop/electron/access/pairing.ts): the data channel of Peer.kt, an SSH session as user
// `pair.<code>` with the phone's key, offered only once the computer showed the host key the link's
// machine id stands for, and one command that names the phone. The computer answers the four digits
// it shows the owner, then the owner's answer. Only a yes keeps anything, and that is Pines' to keep.
//
// The surface, the same in the Swift core (Pairing.swift):
//   - `Remote.pair(link, name, on)` starts a pairing from a link (`pairLink`) as the phone called
//     `name` (`deviceName`) and returns a `Pairing`;
//   - `Pairing.cancel()` ends it: its session and data channel are closed, nothing more is told;
//   - `Pairing.result(ms)` waits for its end (null when it was cancelled);
//   - `on` is told `PairingState.Pairing(code)` once the computer shows the four digits, then exactly
//     one of `Allowed(name)`, `Refused`, `Expired` or `Failed(message)`.
// `Pines.pair(link, name)` and `Pines.cancelPairing()` are the same for the page, in its states
// (`{status: "starting", pairing: {name, code?}}`), and keep the computer on a yes.
package pine.mobile.core

import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import net.schmizz.sshj.userauth.UserAuthException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.security.PublicKey
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** The user name of a pairing session, before its code (desktop/electron/access/pairing.ts `PAIR_USER`). */
const val PAIR_USER = "pair."

/** The command of the pairing request: this word, a space, and base64url of `{"name": ...}` (`PAIR_COMMAND`). */
const val PAIR_COMMAND = "pine-pair"

/** How long a pairing waits for the owner's answer at most: the computer ends it after two minutes itself. */
const val PAIR_WAIT_MS = 5 * 60_000L

/** What a pairing reports, in order: `Pairing` once the four digits are known, then one end. */
sealed interface PairingState {
	/** The computer shows the owner these four digits beside the phone's name. */
	data class Pairing(val code: String) : PairingState

	/** The owner allowed the phone; `name` is the computer's, cleaned, or "your computer". */
	data class Allowed(val name: String) : PairingState

	/** The owner refused the phone. */
	data object Refused : PairingState

	/** No answer in time, a code that is wrong or was used, or a session that closed without an answer. */
	data object Expired : PairingState

	/** The computer could not be reached to pair with, or another one answered: `message` says what to do. */
	data class Failed(val message: String) : PairingState
}

/** The words of a pairing that did not go through: the web client's, "this browser" said "this phone", as the iOS core says them. */
object PairWords {
	const val REFUSED = "Your computer refused this phone: nothing was kept. To pair it after all, open Pine on your computer and add this device again."
	const val EXPIRED = "This pairing link has expired or was used already. Open Pine on your computer and add this device again."
	const val IMPOSTOR = "The computer that answered is not the one this pairing link names: nothing was trusted. Open Pine on your computer and add this device again."
	const val CUT = "Could not reach your computer to pair with it. The connection to the computer closed before SSH let this phone in."
	const val NOT_A_LINK = "That is not a pairing link this phone can read. Open Pine on your computer and add this device again."
	const val BUSY = "A pairing is under way already: finish or cancel it first."

	/** While pairing nothing is tried again: the link is for one use and two minutes. */
	fun trouble(reason: String): String = when (reason) {
		"absent" -> "Your computer does not answer: it is off, asleep, or Pine is closed. Open Pine on your computer and add this device again."
		"no-path" -> "Your computer is there, but no direct connection could be made from this network. Try another network (another Wi-Fi, or your phone's data), then add this device again at your computer."
		"limits" -> "The meeting service is over its limits for now. Try again later: add this device again at your computer."
		else -> "Could not reach your computer to pair with it. The meeting service could not be reached. Check the network, then add this device again at your computer."
	}

	/** What the page is told for an end that is not a yes; null for a yes. */
	fun of(end: PairingState): String? = when (end) {
		is PairingState.Pairing, is PairingState.Allowed -> null
		PairingState.Refused -> REFUSED
		PairingState.Expired -> EXPIRED
		is PairingState.Failed -> end.message
	}
}

/** The pairing request for a phone called `name`. */
internal fun pairCommand(name: String): String {
	val json = JSONObject().put("name", cleanName(name)).toString().toByteArray(Charsets.UTF_8)
	return "$PAIR_COMMAND ${Base64.getUrlEncoder().withoutPadding().encodeToString(json)}"
}

/** One pairing under way: `cancel()` ends it, `result()` waits for its end (null when it was cancelled). */
class Pairing internal constructor() {
	private val lock = Object()
	private var cancelled = false
	private val held = mutableListOf<AutoCloseable>()
	private val done = CompletableFuture<PairingState?>()

	/** Ends the pairing: its session and its data channel are closed, and nothing more is told. */
	fun cancel() {
		val closing = synchronized(lock) {
			cancelled = true
			held.toList().also { held.clear() }
		}
		closing.forEach { runCatching { it.close() } }
		done.complete(null)
	}

	/** The end it came to, within `ms`; null when it was cancelled (or has not ended by then). */
	fun result(ms: Long = PAIR_WAIT_MS + 30_000): PairingState? = runCatching { done.get(ms, TimeUnit.MILLISECONDS) }.getOrNull()

	internal val isCancelled: Boolean get() = synchronized(lock) { cancelled }

	/** Keeps what `cancel()` closes; false when it was cancelled meanwhile (it is closed at once then). */
	internal fun hold(thing: AutoCloseable): Boolean {
		synchronized(lock) {
			if (!cancelled) {
				held.add(thing)
				return true
			}
		}
		runCatching { thing.close() }
		return false
	}

	internal fun finish(end: PairingState) {
		val closing = synchronized(lock) { held.toList().also { held.clear() } }
		closing.forEach { runCatching { it.close() } }
		done.complete(if (isCancelled) null else end)
	}
}

/**
 * Starts a pairing on a thread of its own: `open` opens the data channel to the computer, `client`
 * makes the SSH client that runs over it. `on` hears nothing once the pairing was cancelled.
 */
internal fun startPairing(link: PairLink, name: String, on: (PairingState) -> Unit, key: DeviceKey, open: () -> ChannelStream, client: () -> SSHClient): Pairing {
	val pairing = Pairing()
	val tell = { state: PairingState -> if (!pairing.isCancelled) on(state) }
	thread(isDaemon = true, name = "pine-pairing") {
		val end = try {
			pairingEnd(link, name, pairing, key, open, client, tell)
		} catch (e: Exception) {
			if (pairing.isCancelled) PairingState.Expired else PairingState.Failed(PairWords.CUT)
		}
		tell(end)
		pairing.finish(end)
	}
	return pairing
}

private fun pairingEnd(link: PairLink, name: String, pairing: Pairing, key: DeviceKey, open: () -> ChannelStream, client: () -> SSHClient, tell: (PairingState) -> Unit): PairingState {
	val trusted = pairedFingerprint(link.id) ?: return PairingState.Failed(PairWords.IMPOSTOR)
	val stream = try {
		open()
	} catch (e: PeerClosed) {
		return PairingState.Failed(PairWords.trouble(e.reason))
	} catch (e: RemoteError) {
		return PairingState.Failed(e.message ?: PairWords.CUT)
	}
	if (!pairing.hold(stream)) return PairingState.Expired
	val ssh = client()
	if (!pairing.hold(AutoCloseable { ssh.disconnect() })) return PairingState.Expired
	var seen: String? = null
	ssh.addHostKeyVerifier(object : HostKeyVerifier {
		override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
			val presented = fingerprint(key)
			if (presented == trusted) return true
			seen = presented
			return false
		}
		override fun findExistingAlgorithms(hostname: String, port: Int): List<String> = emptyList()
	})
	try {
		ssh.connectVia(stream.input, stream.output)
	} catch (e: IOException) {
		return PairingState.Failed(if (seen != null) PairWords.IMPOSTOR else PairWords.CUT)
	}
	try {
		ssh.authPublickey(PAIR_USER + link.code, key.provider())
	} catch (e: UserAuthException) {
		// The computer takes no key under a code that is wrong, used or closed.
		return PairingState.Expired
	} catch (e: IOException) {
		return PairingState.Failed(PairWords.CUT)
	}
	val command = try {
		ssh.startSession().exec(pairCommand(name))
	} catch (e: IOException) {
		return PairingState.Expired
	}
	return answer(command.inputStream, tell)
}

/** The computer's lines: the four digits, then the owner's answer. A channel that ends without one is expired. */
private fun answer(input: java.io.InputStream, tell: (PairingState) -> Unit): PairingState {
	val line = ByteArrayOutputStream()
	try {
		while (true) {
			val b = input.read()
			if (b < 0) return PairingState.Expired
			if (b != '\n'.code) {
				if (line.size() > 64 * 1024) return PairingState.Expired
				line.write(b)
				continue
			}
			val said = runCatching { JSONObject(line.toString(Charsets.UTF_8)) }.getOrNull()
			line.reset()
			if (said == null) continue
			val code = said.opt("code") as? String
			val ok = said.opt("ok") as? Boolean
			if (code != null && Regex("^[0-9]{4}$").matches(code)) tell(PairingState.Pairing(code))
			else if (ok == false) return if (said.opt("reason") == "refused") PairingState.Refused else PairingState.Expired
			else if (ok == true) return PairingState.Allowed(cleanName(said.opt("name") as? String ?: "").ifEmpty { YOUR_COMPUTER })
		}
	} catch (e: IOException) {
		return PairingState.Expired
	}
}
