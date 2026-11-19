package pine.mobile.core

import org.json.JSONObject
import org.junit.jupiter.api.TestFactory
import kotlin.test.assertEquals

// Where the page may go, what opens outside it, and which of its requests are the daemon's media,
// as desktop/electron/main.ts decides for the desktop page. The cases are mobile/cases/links.json.
class LinksTest {
	@TestFactory
	fun `only web addresses open outside, the page stays on its origin, and media are the paths under the media base`() = replay("links") { case ->
		val url = case.getString("url")
		val expect = plain(android(case.opt("expect")))
		when (val rule = case.getString("rule")) {
			"outside" -> assertEquals(expect, outside(url), url)
			"stays" -> assertEquals(expect, stays(url), url)
			"media" -> assertEquals((expect as JSONObject?)?.let { it.getString("path") to it.getString("search") }, mediaRequest(url), url)
			else -> error("links.json: no rule \"$rule\"")
		}
	}
}
