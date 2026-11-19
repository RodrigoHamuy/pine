package pine.mobile.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Pictures, video and sound straight from the daemon, as desktop/test/daemon.test.ts proves
// `mediaFromDaemon` for the Mac: only the listed paths, only what is drawn or played.
class MediaTest {
	private val rig = Rig()

	init {
		rig.daemon.routes["/media/tool/pic"] = { x ->
			x.responseHeaders.add("content-type", "image/png")
			x.sendResponseHeaders(200, StandInDaemon.PNG.size.toLong())
			x.responseBody.write(StandInDaemon.PNG)
		}
		rig.daemon.routes["/media/tool/clip"] = { x ->
			// Sent in chunks, without a length: none is claimed.
			x.responseHeaders.add("content-type", "video/mp4")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("MP4".toByteArray())
		}
		rig.daemon.routes["/media/tool/page"] = { x ->
			x.responseHeaders.add("content-type", "text/html")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("<script>".toByteArray())
		}
		rig.daemon.routes["/media/tool/drawing"] = { x ->
			x.responseHeaders.add("content-type", "image/svg+xml")
			x.sendResponseHeaders(200, 0)
			x.responseBody.write("<svg/>".toByteArray())
		}
		rig.daemon.routes["/media/tool/gone"] = { x -> x.sendResponseHeaders(404, -1) }
	}

	@AfterTest
	fun end() = rig.close()

	private fun MediaAnswer.text() = body.use { it.readBytes().toString(Charsets.UTF_8) }

	@Test
	fun `only the listed paths, and only what is drawn or played`() {
		assertTrue(MEDIA.any { it.matches("/media/tool/pic") })
		val s = rig.connected()
		val ok = mediaFromDaemon(s, "GET", "/media/tool/pic", "?v=1")
		assertEquals(200, ok.status)
		assertEquals(StandInDaemon.PNG.toList(), ok.body.use { it.readBytes() }.toList())
		assertEquals("image/png", ok.headers["content-type"])
		assertEquals("no-store", ok.headers["cache-control"])
		assertEquals("nosniff", ok.headers["x-content-type-options"])
		assertEquals("${StandInDaemon.PNG.size}", ok.headers["content-length"])
		val seen = rig.daemon.seen.single()
		assertEquals("/media/tool/pic?v=1", seen.url)
		assertEquals("GET", seen.method)
		assertEquals("Bearer secret-token", seen.header("authorization"))
		assertNull(seen.header("origin"))

		val clip = mediaFromDaemon(s, "GET", "/media/tool/clip", "")
		assertEquals(200, clip.status)
		assertEquals("MP4", clip.text())
		assertNull(clip.headers["content-length"])

		assertEquals(415, mediaFromDaemon(s, "GET", "/media/tool/page", "").status)
		assertEquals(415, mediaFromDaemon(s, "GET", "/media/tool/drawing", "").status)
		assertEquals(404, mediaFromDaemon(s, "GET", "/media/tool/gone", "").status)
	}

	@Test
	fun `what is not one of the daemon's media never leaves the phone`() {
		val s = rig.connected()
		for ((method, path, search) in listOf(
			Triple("POST", "/media/tool/pic", ""),
			Triple("GET", "/agents", ""),
			Triple("GET", "/media/tool/a/b", ""),
			Triple("GET", "/tasks/x/images/1", ""),
			Triple("GET", "/media/tool/pic HTTP/1.1\r\nX-A: b", ""),
			Triple("GET", "/agents/main/image", "?path=a b"),
		)) {
			val r = mediaFromDaemon(s, method, path, search)
			assertEquals(404, r.status, "$method $path$search")
			assertEquals("not found", r.text())
		}
		assertEquals(404, mediaFromDaemon(null, "GET", "/media/tool/pic", "").status)
		assertTrue(rig.daemon.seen.isEmpty())
		// The other listed paths pass.
		for (path in listOf("/tasks/3/images/0", "/agents/main/image", "/agents/main/browser/frame")) assertTrue(MEDIA.any { it.matches(path) }, path)
	}
}
