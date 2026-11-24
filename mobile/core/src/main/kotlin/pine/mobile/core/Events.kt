// The daemon's live events: `followEvents` of desktop/electron/daemon.ts. The stream is read
// through a channel of the SSH session held for it, and handed on in small batches: a model that
// writes fast sends a hundred events a second, and each as a message of its own would keep the
// page busy.
package pine.mobile.core

import org.json.JSONTokener
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** What the reader of the event stream tells its caller. */
interface EventHandlers {
	/** A few events at a time, each a JSON value. */
	fun batch(events: List<Any>)

	/** The stream was opened (true) or was lost (false). */
	fun connection(up: Boolean)

	/** After each loss, with how many in a row: true stops the reading (the caller does something else about it). */
	fun lost(times: Int): Boolean = false
}

/** A reading of the event stream, until it is stopped. */
interface Following : AutoCloseable {
	fun stop()
	override fun close() = stop()
}

/**
 * The daemon's live events, read until stopped and handed on in batches of what came within
 * `batchMs`. A lost stream is opened again `retryMs` later.
 */
fun followEvents(daemon: Daemon, on: EventHandlers, retryMs: Long = 1_000, batchMs: Long = 24): Following {
	val lock = Object()
	var stopped = false
	var conn: Duplex? = null
	var batch = mutableListOf<Any>()
	var timer: ScheduledFuture<*>? = null
	// Losses in a row: an opened stream starts the count again.
	var down = 0
	val clock = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "pine-events-batch").apply { isDaemon = true } }

	fun flush() {
		val events = synchronized(lock) {
			timer = null
			val events = batch
			batch = mutableListOf()
			if (stopped) return
			events
		}
		if (events.isNotEmpty()) on.batch(events)
	}

	fun add(event: Any) = synchronized(lock) {
		if (stopped) return
		batch.add(event)
		if (timer == null) timer = clock.schedule(::flush, batchMs, TimeUnit.MILLISECONDS)
	}

	fun read(input: InputStream) {
		val head = readHead(input)
		if (head.status !in 200..299) throw java.io.IOException("HTTP ${head.status}")
		val body = bodyStream(head, input)
		synchronized(lock) { if (stopped) return }
		down = 0
		on.connection(true)
		while (true) {
			val block = frame(body) ?: return
			if (!block.startsWith("data: ")) continue
			try {
				val tokener = JSONTokener(block.substring(6))
				val value = tokener.nextValue()
				if (tokener.more()) continue
				add(value)
			} catch (e: Exception) {
				// A malformed frame is skipped; the stream goes on.
			}
		}
	}

	thread(isDaemon = true, name = "pine-events") {
		while (true) {
			try {
				val c = daemon.open()
				val go = synchronized(lock) {
					if (!stopped) conn = c
					!stopped
				}
				if (!go) {
					c.close()
					return@thread
				}
				c.use {
					send(daemon, c, "GET", "/events/stream?topic=%23")
					read(c.input)
				}
			} catch (e: Exception) {
				// fall through to the retry
			}
			synchronized(lock) { if (stopped) return@thread }
			on.connection(false)
			down++
			if (on.lost(down)) break
			Thread.sleep(retryMs)
		}
		clock.shutdown()
	}

	return object : Following {
		override fun stop() {
			val c = synchronized(lock) {
				stopped = true
				timer?.cancel(false)
				conn
			}
			runCatching { c?.close() }
			clock.shutdown()
		}
	}
}

/** The next block of the stream, up to an empty line, as text; null at its end. */
private fun frame(input: InputStream): String? {
	val out = ByteArrayOutputStream()
	var last = -1
	while (true) {
		val b = input.read()
		if (b < 0) return null
		if (b == '\n'.code && last == '\n'.code) return out.toString(Charsets.UTF_8).removeSuffix("\n")
		out.write(b)
		last = b
	}
}
