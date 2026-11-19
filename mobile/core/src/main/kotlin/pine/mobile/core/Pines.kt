// The native plugin without Android: the machines the owner added, the one in use, its connection
// and what the page is told about it. It is what desktop/electron/main.ts does for the desktop page
// (`startService`, `use`, `pine:hosts-add`, `pine:hosts-forget`, `follow`), with one thing more: a
// host key the phone does not know yet is put to the owner in the page, and trusted on their yes.
package pine.mobile.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/** Where the plugin keeps what is not secret (the app's SharedPreferences): text by name, none to remove. */
interface Shelf {
	fun get(name: String): String?
	fun set(name: String, value: String?)
}

/** What the page is told: the desktop's `pine:service`, `pine:events` and `pine:connection`. */
interface Page {
	fun service(state: JSONObject)
	fun events(batch: List<Any>)
	fun connection(up: Boolean)
}

/** How many machines the list holds at most, as on the desktop. */
const val MAX_HOSTS = 20

/**
 * The pines of the owner's machines, one shown at a time. Each machine used is held (`HeldRemote`)
 * until it is forgotten or the app ends, so that switching back is quick and an agent at work on one
 * goes on; only the one in use speaks to the page.
 */
class Pines(
	private val remote: Remote,
	private val known: KnownHosts,
	private val shelf: Shelf,
	private val page: Page,
	private val retryMs: Long = 1_000,
	private val batchMs: Long = 24,
) : AutoCloseable {
	private val lock = Object()
	private val held = mutableMapOf<String, HeldRemote>()
	/** Host keys seen and not known yet, by machine: what the owner's yes may trust. */
	private val unknown = mutableMapOf<String, HostKeyError>()
	private var state: JSONObject = JSONObject().put("status", "starting")
	/** Which connection is the latest asked for: an older one that ends late changes nothing. */
	private var round = 0
	private var shown: String? = null
	private var begun = false
	private var closed = false

	/** Whether each held machine's event stream is up, by machine: what the page is told when it is shown again. */
	private val streams = mutableMapOf<String, Boolean>()

	/** Whether the event stream of the machine in use is up. */
	@Volatile
	var connected = false
		private set

	/** The machines, as the owner added them. */
	val hosts: List<String>
		get() = shelf.get(HOSTS)?.let { text -> runCatching { JSONArray(text) }.getOrNull() }?.let { a -> (0 until a.length()).mapNotNull { a.opt(it) as? String } } ?: emptyList()

	/** The machine in use: one of the list, or none. */
	val use: String? get() = shelf.get(USE)?.takeIf { it in hosts }

	/** The page's own preferences, as the page gave them (JSON text): the plugin reads nothing in them. */
	var prefs: String?
		get() = shelf.get(PREFS)
		set(value) = shelf.set(PREFS, value)

	/** The state as the page was last told it. */
	fun state(): JSONObject = synchronized(lock) { JSONObject(state.toString()) }

	/** The page has started: it is told the state, and on the first time the machine in use is connected to. */
	fun ready() {
		val first = synchronized(lock) { !begun.also { begun = true } }
		if (first) start(use) else page.service(state())
	}

	/** Add a machine: host, user@host or user@host:port, with a user, since a phone has no user name of its own. */
	fun addHost(value: String): List<String> {
		val named = sshHost(value) ?: throw RemoteError("ssh", "Write the machine as you would after ssh: user@host, or user@host:port.")
		if (named.user == null) throw RemoteError("ssh", "Name the user too: user@${named.given}. A phone has no user name of its own to sign in with.")
		synchronized(lock) {
			val list = hosts
			if (named.given in list) return list
			if (list.size >= MAX_HOSTS) throw RemoteError("ssh", "There are $MAX_HOSTS machines in the list already: forget one first.")
			return (list + named.given).also { shelf.set(HOSTS, JSONArray(it).toString()) }
		}
	}

	/**
	 * Take a machine out of the list and let go of its connection (a pine it started there stops).
	 * The one in use is refused while it is reached or being reached; one that could not be reached
	 * may go (its host key changed, say), and then no machine is in use.
	 */
	fun forgetHost(host: String): List<String> {
		val stop: HeldRemote?
		val wasInUse: Boolean
		synchronized(lock) {
			wasInUse = host == use
			if (wasInUse && state.optString("status") != "error") throw RemoteError("ssh", "The app uses this machine now. Use another one first.")
			if (wasInUse) shelf.set(USE, null)
			shelf.set(HOSTS, JSONArray(hosts.filter { it != host }).toString())
			unknown.remove(host)
			streams.remove(host)
			stop = held.remove(host)
		}
		stop?.stop()
		if (wasInUse) start(null)
		return hosts
	}

	/** Use the pine of a machine of the list: it is kept as the one in use, and connected to. */
	fun use(host: String) {
		if (host !in hosts) throw RemoteError("ssh", "That machine is not in the list: add it first.")
		shelf.set(USE, host)
		start(host)
	}

	/** Connect again to the machine in use. */
	fun retry() = start(use)

	/**
	 * The owner's yes to the host key a connection stopped at: only the one the machine showed, never
	 * a key that changed. The machine in use is then connected to again.
	 */
	fun trust(host: String, fingerprint: String) {
		synchronized(lock) {
			val seen = unknown[host] ?: throw RemoteError("ssh", "No host key of $host waits for your yes: try again to connect.")
			if (seen.fingerprint != fingerprint) throw RemoteError("ssh", "That is not the key $host showed: try again to connect.")
			known.confirm(seen.host, seen.port, seen.fingerprint)
			unknown.remove(host)
		}
		if (host == use) start(host)
	}

	/** Forget the host key stored for a machine: the next connection shows its key again. */
	fun forgetKey(host: String) {
		val named = sshHost(host) ?: return
		known.forget(named.host, named.port)
		synchronized(lock) { unknown.remove(host) }
	}

	/** One call of the control API to the pine in use (503 before there is one). */
	fun call(method: String, url: String, body: Any?): CallResult = callDaemon(daemon(), method, url, body)

	/** A picture, video or sound of the pine in use, under `mediaFromDaemon`'s rules. */
	fun media(method: String, path: String, search: String): MediaAnswer = mediaFromDaemon(daemon(), method, path, search)

	private fun daemon(): RemoteService? = synchronized(lock) {
		if (state.optString("status") != "ready") null else held[shown]?.service
	}

	/**
	 * The app came back to the front: the pine in use is asked whether it still answers (Android may
	 * have cut the link meanwhile), and connected to again when it does not. A machine that could not
	 * be reached is tried again, except when its host key waits for the owner's yes. Returns when that is known.
	 */
	fun check() {
		val (host, mine, service) = synchronized(lock) {
			val host = shown ?: return
			val status = state.optString("status")
			val again = status == "error" && host == use && state.optString("kind") in listOf("ssh", "failed") && !state.has("fingerprint")
			if (status != "ready" && !again) return
			Triple(host, round, if (status == "ready") held[host]?.service else null)
		}
		if (service != null && service.isOpen && answers(service)) return
		val again = synchronized(lock) {
			if (mine != round) return
			++round
		}
		show(again, starting(host), host)
		connect(host, again)
	}

	private fun start(host: String?) {
		val mine = synchronized(lock) { ++round }
		if (host == null) return show(mine, nobody(), null)
		show(mine, starting(host), host)
		thread(isDaemon = true, name = "pine-connect") { connect(host, mine) }
	}

	private fun connect(host: String, mine: Int) {
		try {
			val h = synchronized(lock) {
				if (closed) return
				held.getOrPut(host) { HeldRemote(remote, host, follow(host), failed = { e -> lost(host, e) }, retryMs, batchMs) }
			}
			show(mine, ready(h.ensure()), host)
		} catch (e: Exception) {
			show(mine, failure(host, e), host)
		}
	}

	/**
	 * The page is told `next`, when it is still what the latest connection is about, and whether the
	 * shown machine's events flow when that changed: a held machine's stream may have been up all along.
	 */
	private fun show(mine: Int, next: JSONObject, host: String?) = synchronized(lock) {
		if (mine != round || closed) return
		val switched = shown != host
		val was = connected
		connected = next.optString("status") == "ready" && host != null && streams[host] == true
		shown = host
		state = next
		page.service(JSONObject(next.toString()))
		if (switched || connected != was) page.connection(connected)
	}

	/** A held machine's events reach the page only while it is the one shown. */
	private fun follow(host: String) = object : EventHandlers {
		override fun batch(events: List<Any>) {
			if (synchronized(lock) { shown == host }) page.events(events)
		}
		override fun connection(up: Boolean) {
			synchronized(lock) {
				if (closed || held[host] == null) return
				streams[host] = up
				if (shown != host) return
				connected = up
			}
			page.connection(up)
		}
	}

	/** A held machine whose session could not be made again after its stream was lost. */
	private fun lost(host: String, e: Exception) {
		val mine = synchronized(lock) { if (shown != host) return else round }
		show(mine, failure(host, e), host)
	}

	private fun failure(host: String, e: Exception): JSONObject {
		val out = JSONObject().put("status", "error").put("host", host)
		when (e) {
			is HostKeyError -> {
				if (!e.changed) synchronized(lock) { unknown[host] = e }
				out.put("kind", "ssh").put("fingerprint", e.fingerprint).put("changed", e.changed).put(
					"message",
					if (e.changed) "The host key of $host changed: it is now ${e.fingerprint}, not the one this phone confirmed. Not connecting, since another machine may stand in for it. If that machine was reinstalled, forget it in the list of machines, add it again and confirm its new key."
					else "This phone does not know $host yet. Its host key's fingerprint is ${e.fingerprint}. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), press Trust this key to connect.",
				)
			}
			is RemoteError -> out.put("kind", e.kind).put("message", e.message ?: "")
			else -> out.put("kind", "failed").put("message", e.message ?: e.javaClass.simpleName)
		}
		return out
	}

	private fun nobody(): JSONObject = JSONObject().put("status", "error").put("kind", "ssh").put(
		"message",
		if (hosts.isEmpty()) "Add the machine whose pine this phone is to use, as you would write it after ssh: user@host, or user@host:port. Put this phone's key into ~/.ssh/authorized_keys there first."
		else "Choose the machine whose pine this phone is to use.",
	)

	override fun close() {
		val all = synchronized(lock) {
			closed = true
			held.values.toList().also { held.clear() }
		}
		all.forEach { it.stop() }
	}

	private companion object {
		const val HOSTS = "hosts"
		const val USE = "use"
		const val PREFS = "prefs"

		fun starting(host: String) = JSONObject().put("status", "starting").put("host", host)

		fun ready(s: RemoteService) = JSONObject().put("status", "ready").put("mode", "on ${s.label}").put("started", s.started).put("home", "${s.label}:${s.home}").apply { s.version?.let { put("version", it) } }.put("from", "ssh ${s.host}").put("host", s.host).put("label", s.label)
	}
}
