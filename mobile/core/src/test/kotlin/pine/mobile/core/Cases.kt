package pine.mobile.core

import org.json.JSONObject
import org.junit.jupiter.api.DynamicTest
import java.io.File

// The cases both cores replay (mobile/cases/README.md): one file per subject, each case a name, its
// input and what is expected. The iOS core replays the very same files.

/** Where the case files lie: Gradle says (build.gradle.kts). */
val CASES = File(System.getProperty("pine.cases") ?: error("run the tests through Gradle, which sets pine.cases"))

/** The cases of a subject, each as a test of its own named after the case. */
fun replay(subject: String, check: (JSONObject) -> Unit): List<DynamicTest> {
	val cases = JSONObject(File(CASES, "$subject.json").readText()).getJSONArray("cases")
	require(cases.length() > 0) { "$subject.json has no cases" }
	val names = mutableSetOf<String>()
	return (0 until cases.length()).map { i ->
		val case = cases.getJSONObject(i)
		val name = case.getString("name")
		require(names.add(name)) { "$subject.json: two cases are named \"$name\"" }
		DynamicTest.dynamicTest(name) { check(case) }
	}
}

/** What this platform expects: a value, or an object with exactly the keys "android" and "ios", one value for each. */
fun android(value: Any?): Any? =
	if (value is JSONObject && value.keySet() == setOf("android", "ios")) value.get("android") else value

/** A JSON value as Kotlin compares it: JSON's null as null. */
fun plain(value: Any?): Any? = if (value == JSONObject.NULL) null else value

/** A string field that may be null or absent. */
fun JSONObject.text(key: String): String? = plain(opt(key)) as String?

/** Text with a case's placeholders (`{given}`, `{label}`) filled in. */
fun String.filled(vararg pairs: Pair<String, String>): String = pairs.fold(this) { s, (k, v) -> s.replace("{$k}", v) }
