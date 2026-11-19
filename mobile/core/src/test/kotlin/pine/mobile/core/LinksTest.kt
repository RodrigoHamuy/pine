package pine.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// Where the page may go, what opens outside it, and which of its requests are the daemon's media,
// as desktop/electron/main.ts decides for the desktop page.
class LinksTest {
	@Test
	fun `only addresses of the web open outside the app`() {
		assertTrue(outside("https://example.com/a?b"))
		assertTrue(outside("HTTP://example.com"))
		listOf("intent://x#Intent;end", "file:///sdcard/a", "javascript:alert(1)", "tel:123", "content://x/y", "https://", "not a url", "market://details?id=x").forEach { assertFalse(outside(it), it) }
	}

	@Test
	fun `the page stays on the app's own origin`() {
		assertTrue(stays("https://localhost/"))
		assertTrue(stays("https://localhost/index.html#x"))
		listOf("https://localhost.evil.com/", "http://localhost/", "https://localhost:8443/", "https://user@localhost/", "https://example.com/").forEach { assertFalse(stays(it), it) }
	}

	@Test
	fun `media requests are the paths under the app's media base, with their query`() {
		assertEquals("/media/tool/abc" to "", mediaRequest("https://localhost/_pine_media/media/tool/abc"))
		assertEquals("/agents/a/image" to "?path=x.png", mediaRequest("https://localhost/_pine_media/agents/a/image?path=x.png"))
		assertNull(mediaRequest("https://localhost/assets/index.js"))
		assertNull(mediaRequest("https://localhost/_pine_mediaX/a"))
		assertNull(mediaRequest("https://example.com/_pine_media/media/tool/abc"))
	}
}
