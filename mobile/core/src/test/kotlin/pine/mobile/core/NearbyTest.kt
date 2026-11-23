package pine.mobile.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

// What the phone keeps of a computer that announces itself on the network (Nearby.kt), and the list
// of those found. The same cases as the iOS core's NearbyTests.swift.
class NearbyTest {
	private val id = "EKN2VkO6uLv7SOTEAyIGDru_1I_cTOGadqwTlLFm-qs"

	private fun record(v: String? = "1", id: String? = this.id, service: String? = OFFICIAL_SERVICE, noService: Boolean = false): Map<String, String?> =
		buildMap {
			v?.let { put("v", it) }
			id?.let { put("id", it) }
			if (!noService) put("service", service)
		}

	@Test
	fun `a record of version 1 names a machine id and an https service`() {
		assertEquals(NearbyComputer(id, OFFICIAL_SERVICE), nearbyComputer(record()))
		assertEquals(NearbyComputer(id, "https://pine-pr-57.drcmda.workers.dev"), nearbyComputer(record(service = "https://pine-pr-57.drcmda.workers.dev")))
		assertEquals(NearbyComputer(id, "https://pine.example.com:8443"), nearbyComputer(record(service = "https://pine.example.com:8443")))
		assertEquals(NearbyComputer(id, OFFICIAL_SERVICE), nearbyComputer(record(service = "$OFFICIAL_SERVICE:443")), "without :443")
		assertEquals(NearbyComputer(id, "https://pine.example.com"), nearbyComputer(record(service = "HTTPS://PINE.Example.com")), "in lower case")
		assertEquals(NearbyComputer(id, OFFICIAL_SERVICE), nearbyComputer(mapOf("V" to "1", "ID" to id, "Service" to OFFICIAL_SERVICE)), "keys in any case")
	}

	@Test
	fun `a record without a service names the official one`() {
		assertEquals(NearbyComputer(id, OFFICIAL_SERVICE), nearbyComputer(record(noService = true)))
	}

	@Test
	fun `a record of another version, without a good machine id, or with a service that is not an https origin, is ignored`() {
		assertNull(nearbyComputer(record(v = "2")))
		assertNull(nearbyComputer(record(v = null)))
		assertNull(nearbyComputer(record(id = null)))
		assertNull(nearbyComputer(record(id = id.drop(1))))
		assertNull(nearbyComputer(record(id = id.dropLast(1) + "+")))
		for (service in listOf("http://pine.example.com", "", "https://pine.example.com/", "https://pine.example.com/x", "https://me@pine.example.com", "javascript:alert(1)", null)) {
			assertNull(nearbyComputer(record(service = service)), "service $service")
		}
	}

	@Test
	fun `the list holds each computer once, follows what is lost, and says when it changed`() {
		val found = NearbyFound()
		assertEquals("""{"computers":[]}""", found.event().toString())
		assertTrue(found.found("Pine", NearbyComputer(id, OFFICIAL_SERVICE)))
		assertFalse(found.found("Pine", NearbyComputer(id, OFFICIAL_SERVICE)), "the same again changes nothing")
		assertFalse(found.found("Pine (2)", NearbyComputer(id, OFFICIAL_SERVICE)), "the same machine under another name is listed once")
		val other = "A".repeat(43)
		assertTrue(found.found("Pine (3)", NearbyComputer(other, "https://pine.example.com")))
		assertEquals(listOf(NearbyComputer(id, OFFICIAL_SERVICE), NearbyComputer(other, "https://pine.example.com")), found.list())
		assertFalse(found.lost("Pine"), "still there under its other name")
		assertTrue(found.lost("Pine (2)"))
		assertTrue(found.found("Pine (3)", null), "a record it no longer reads takes it out")
		assertEquals(emptyList(), found.list())
		assertFalse(found.lost("never seen"))
	}
}
