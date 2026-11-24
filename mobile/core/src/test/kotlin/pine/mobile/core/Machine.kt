package pine.mobile.core

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import org.apache.sshd.common.config.keys.KeyUtils
import org.apache.sshd.common.keyprovider.KeyPairProvider
import org.apache.sshd.server.SshServer
import org.apache.sshd.server.auth.pubkey.PublickeyAuthenticator
import org.apache.sshd.server.command.Command
import org.apache.sshd.server.forward.AcceptAllForwardingFilter
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.Executors
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** What the other machine does with the command it is given: writes on stdout and stderr, reads stdin, and exits with a code. */
fun interface Behaviour {
	fun run(input: InputStream, out: OutputStream, err: OutputStream): Int
}

/**
 * The other machine: an SSH server in this process (Apache MINA sshd) that lets in one key. Its
 * exec handler accepts only the command src/remote.ts builds (any other is answered as sshd's
 * shell would not: exit 2), and does what `behaviour` says. `direct-tcpip` channels are let
 * through to wherever they ask, as an sshd does.
 */
class Machine(private val authorized: PublicKey, var behaviour: Behaviour) : AutoCloseable {
	val commands = ConcurrentLinkedQueue<String>()
	var hostKey: KeyPair = newHostKey()
		set(value) {
			field = value
			sshd.keyPairProvider = KeyPairProvider.wrap(value)
		}
	private val sshd: SshServer = SshServer.setUpDefaultServer().apply {
		host = "127.0.0.1"
		port = 0
		keyPairProvider = KeyPairProvider.wrap(hostKey)
		publickeyAuthenticator = PublickeyAuthenticator { _, key, _ -> KeyUtils.compareKeys(key, authorized) }
		forwardingFilter = AcceptAllForwardingFilter.INSTANCE
		setCommandFactory { _, command ->
			commands.add(command)
			Exec(if (command == expectedCommand) behaviour else Behaviour { _, _, err -> err.write("not the command of src/remote.ts: $command\n".toByteArray()); 2 })
		}
		start()
	}
	val port: Int get() = sshd.port
	val fingerprint: String get() = fingerprint(hostKey.public)

	override fun close() = sshd.stop(true)

	companion object {
		val expectedCommand: String = Machine::class.java.getResource("/pine/mobile/core/remote-command.txt")!!.readText()
		fun newHostKey(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
	}
}

internal class Exec(private val behaviour: Behaviour) : Command {
	private lateinit var input: InputStream
	private lateinit var out: OutputStream
	private lateinit var err: OutputStream
	private lateinit var exit: org.apache.sshd.server.ExitCallback
	override fun setInputStream(i: InputStream) { input = i }
	override fun setOutputStream(o: OutputStream) { out = o }
	override fun setErrorStream(e: OutputStream) { err = e }
	override fun setExitCallback(callback: org.apache.sshd.server.ExitCallback) { exit = callback }
	override fun start(channel: org.apache.sshd.server.channel.ChannelSession, env: org.apache.sshd.server.Environment) {
		thread(isDaemon = true) {
			val code = try {
				behaviour.run(input, out, err)
			} catch (e: Exception) {
				255
			}
			runCatching { out.flush(); err.flush() }
			exit.onExit(code)
		}
	}
	override fun destroy(channel: org.apache.sshd.server.channel.ChannelSession) {}
}

/** `pine service` that prints `line`, then holds until stdin ends, as `cat` does there. */
class Service(private val line: String) : Behaviour {
	val leashEnded = CountDownLatch(1)
	override fun run(input: InputStream, out: OutputStream, err: OutputStream): Int {
		out.write("$line\n".toByteArray())
		out.flush()
		while (input.read() >= 0) Unit
		leashEnded.countDown()
		return 0
	}
	fun ended(): Boolean = leashEnded.await(5, TimeUnit.SECONDS)
}

/** A request as the stand-in daemon received it. */
data class Seen(val method: String, val url: String, val headers: Map<String, List<String>>, val body: String) {
	fun header(name: String): String? = headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.firstOrNull()
}

/** The daemon on the other machine's loopback: notes each request, and answers by its path (or as a test's `routes` say). */
class StandInDaemon : AutoCloseable {
	val seen = ConcurrentLinkedQueue<Seen>()
	/** Answers of a test's own, by path. */
	val routes = ConcurrentHashMap<String, (HttpExchange) -> Unit>()
	private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
		// An event stream holds its request: the others are answered meanwhile.
		executor = Executors.newCachedThreadPool()
		createContext("/") { x ->
			val body = x.requestBody.readBytes().toString(Charsets.UTF_8)
			seen.add(Seen(x.requestMethod, x.requestURI.toString(), x.requestHeaders.toMap(), body))
			routes[x.requestURI.path]?.let { route ->
				try {
					route(x)
				} catch (e: Exception) {
					// The test ended the answer by closing it.
				} finally {
					x.close()
				}
				return@createContext
			}
			val (status, type, bytes, chunked) = when (x.requestURI.path) {
				"/picture" -> Answer(200, "image/png", PNG, false)
				"/streamed" -> Answer(200, "application/json; charset=utf-8", """{"streamed":true}""".toByteArray(), true)
				"/missing" -> Answer(404, "application/json", """{"error":"not found"}""".toByteArray(), false)
				"/broken" -> Answer(200, "application/json", "{nope".toByteArray(), false)
				else -> Answer(200, "application/json", """{"method":"${x.requestMethod}","url":"${x.requestURI}"}""".toByteArray(), false)
			}
			x.responseHeaders.add("content-type", type)
			x.sendResponseHeaders(status, if (chunked) 0 else bytes.size.toLong())
			x.responseBody.use { it.write(bytes) }
		}
		start()
	}
	val base: String get() = "http://127.0.0.1:${server.address.port}"

	override fun close() = server.stop(0)

	private data class Answer(val status: Int, val type: String, val bytes: ByteArray, val chunked: Boolean)

	companion object {
		val PNG = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3)
	}
}
