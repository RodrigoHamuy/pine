plugins {
	kotlin("jvm") version "2.4.21"
}

group = "pine.mobile"

// Android runs Java 17 byte code; any newer JDK at hand (Android Studio's is 25) compiles it.
java {
	sourceCompatibility = JavaVersion.VERSION_17
	targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
	compilerOptions {
		jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
	}
}

dependencies {
	implementation("com.hierynomus:sshj:0.41.2")
	// sshj's own Ed25519 comes from it; the phone's key is made with it too.
	implementation("org.bouncycastle:bcprov-jdk18on:1.84")
	// Android has org.json built in; on the JVM it comes from Maven, with the same API.
	compileOnly("org.json:json:20250517")
	// WebRTC data channels for a paired computer: libdatachannel, the library the Pine app's access
	// host runs on, through tel.schich's binding. This is its Java part alone; the native library
	// comes from where the core runs: the Android app adds libdatachannel-java-android, the tests the
	// desktop builds below.
	implementation("tel.schich:libdatachannel-java:0.24.1.1")
	testImplementation("tel.schich:libdatachannel-java-arch-detect:0.24.1.1")
	testImplementation("org.json:json:20250517")

	testImplementation(kotlin("test"))
	testImplementation("org.junit.jupiter:junit-jupiter:6.1.3")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
	testImplementation("org.apache.sshd:sshd-core:2.20.0")
	testImplementation("org.slf4j:slf4j-nop:2.0.17")
}

// The classpath of the smoke run's machine (src/test/.../SmokeMachine.kt, run by mobile/scripts/smoke.mjs).
tasks.register("smokeClasspath") {
	dependsOn("testClasses")
	val classpath = sourceSets["test"].runtimeClasspath
	doLast { println(classpath.asPath) }
}

// The command run on the other machine is one file for both cores (mobile/cases/README.md): it is
// put where Remote.kt has always read it, beside its class.
tasks.processResources {
	from("../cases/remote-command.txt") { into("pine/mobile/core") }
}

tasks.test {
	useJUnitPlatform()
	// The cases both cores replay (mobile/cases): read where they lie, so a changed case is a changed test.
	systemProperty("pine.cases", file("../cases").absolutePath)
	inputs.dir("../cases")
	testLogging {
		events("failed")
		exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
	}
}
