// The machine of the mobile app's smoke run (mobile/scripts/smoke.mjs): an SSH server on this
// computer's loopback, which the emulator reaches at 10.0.2.2, and behind it the real
// `pine service` on a home of the run's own. Nothing of the computer's own sshd or settings is
// touched. Not a test: run by the smoke script with the test classpath (`./gradlew smokeClasspath`).
//
//   java -cp <classpath> pine.mobile.core.SmokeMachineKt <authorized keys file> <pine home> <node> <pine.js>
//
// It prints `port <n>` and `fingerprint <SHA256:...>` on stdout, then serves until stdin ends.
package pine.mobile.core

import org.apache.sshd.common.config.keys.AuthorizedKeyEntry
import org.apache.sshd.common.config.keys.KeyUtils
import org.apache.sshd.common.keyprovider.KeyPairProvider
import org.apache.sshd.server.SshServer
import org.apache.sshd.server.auth.pubkey.PublickeyAuthenticator
import org.apache.sshd.server.forward.AcceptAllForwardingFilter
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import kotlin.concurrent.thread

fun main(args: Array<String>) {
	val (keys, home, node, pine) = args
	val hostKey = Machine.newHostKey()
	val sshd = SshServer.setUpDefaultServer().apply {
		host = "127.0.0.1"
		port = 0
		keyPairProvider = KeyPairProvider.wrap(hostKey)
		// The phone's key, as the run read it from the app's page and wrote it there.
		publickeyAuthenticator = PublickeyAuthenticator { _, key, _ ->
			File(keys).takeIf { it.exists() }?.readLines()?.filter { it.isNotBlank() }?.any { line ->
				runCatching { KeyUtils.compareKeys(key, AuthorizedKeyEntry.parseAuthorizedKeyEntry(line).resolvePublicKey(null, null)) }.getOrDefault(false)
			} ?: false
		}
		forwardingFilter = AcceptAllForwardingFilter.INSTANCE
		setCommandFactory { _, command ->
			val behaviour = if (command == Machine.expectedCommand) Behaviour { input, out, err -> service(input, out, err, node, pine, home) }
			else Behaviour { _, _, err -> err.write("not the command of src/remote.ts: $command\n".toByteArray()); 2 }
			Exec(behaviour)
		}
		start()
	}
	println("port ${sshd.port}")
	println("fingerprint ${fingerprint(hostKey.public)}")
	System.out.flush()
	while (System.`in`.read() >= 0) Unit
	sshd.stop(true)
}

/** `pine service && exec cat >/dev/null`, with the real pine: its line goes back, and stdin is its leash. */
private fun service(input: InputStream, out: OutputStream, err: OutputStream, node: String, pine: String, home: String): Int {
	val child = ProcessBuilder(node, pine, "service", "--home", home).apply { environment()["PINE_SKIP_DOWNLOADS"] = "1" }.start()
	// Each piece is sent as it comes: the service line comes first, and the daemon then runs on.
	thread(isDaemon = true) {
		runCatching {
			val buf = ByteArray(4096)
			while (true) {
				val n = child.inputStream.read(buf)
				if (n < 0) break
				out.write(buf, 0, n)
				out.flush()
			}
		}
	}
	thread(isDaemon = true) { runCatching { child.errorStream.copyTo(err) } }
	// The session's stdin goes to the service, which stops a daemon it started when it ends.
	thread(isDaemon = true) {
		runCatching { input.copyTo(child.outputStream) }
		runCatching { child.outputStream.close() }
	}
	val code = child.waitFor()
	if (code != 0) return code
	// A service that attached has exited: the session lasts until stdin ends, as `cat` holds it.
	while (runCatching { input.read() }.getOrDefault(-1) >= 0) Unit
	return 0
}
