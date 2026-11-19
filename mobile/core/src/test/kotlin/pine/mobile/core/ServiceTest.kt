package pine.mobile.core

import org.json.JSONObject
import org.junit.jupiter.api.TestFactory
import java.io.InputStream
import java.io.OutputStream
import kotlin.test.AfterTest
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

// What `pine service` on the other machine says, read over a real SSH session (Machine): its service
// line, and the words of a failure when it gives none. The cases are mobile/cases/service-lines.json
// and failures.json.
class ServiceTest {
	private val rig = Rig()

	@AfterTest
	fun end() = rig.close()

	private fun RemoteError.matches(expect: JSONObject) {
		assertEquals(expect.getString("kind"), kind)
		assertEquals(expect.getString("message").filled("given" to rig.host, "label" to "127.0.0.1"), message)
	}

	@TestFactory
	fun `the service line says where the daemon answers, or why it is not taken`() = replay("service-lines") { case ->
		rig.machine.behaviour = Service(case.getString("line"))
		val expect = android(case.get("expect")) as JSONObject
		if (expect.has("error")) {
			assertFailsWith<RemoteError> { rig.remote.connect(rig.host) }.matches(expect.getJSONObject("error"))
			return@replay
		}
		val want = expect.getJSONObject("service")
		val s = rig.connected()
		try {
			assertEquals(want.getString("token"), s.token)
			assertEquals(want.getString("home"), s.home)
			assertEquals(want.text("version"), s.version)
			assertEquals(want.getBoolean("started"), s.started)
			assertEquals(Loopback(want.getString("host"), want.getInt("port")), s.end)
		} finally {
			s.stop()
		}
	}

	@TestFactory
	fun `a command that gives no service line is said in words`() = replay("failures") { case ->
		val stderr = case.getString("stderr")
		val exit = plain(case.opt("exit")) as Int?
		rig.machine.behaviour = Behaviour { input: InputStream, _: OutputStream, err: OutputStream ->
			err.write(stderr.toByteArray())
			err.flush()
			if (exit == null) {
				while (input.read() >= 0) Unit
				0
			} else exit
		}
		assertFailsWith<RemoteError> { rig.remote.connect(rig.host) }.matches(android(case.get("expect")) as JSONObject)
	}
}
