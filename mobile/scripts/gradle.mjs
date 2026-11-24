// Runs a Gradle project of mobile/ (android or core) with its wrapper, on this computer's Android SDK
// and a JDK: ANDROID_HOME and JAVA_HOME when they are set, else where Android Studio puts them on a Mac.
//   node scripts/gradle.mjs <android|core> <task...>
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const [project, ...tasks] = process.argv.slice(2);
if (project !== "android" && project !== "core") {
	console.error("usage: node scripts/gradle.mjs <android|core> <task...>");
	process.exit(2);
}
const env = {
	...process.env,
	ANDROID_HOME: process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk"),
	JAVA_HOME: process.env.JAVA_HOME ?? "/Applications/Android Studio.app/Contents/jbr/Contents/Home",
};
const dir = path.join(import.meta.dirname, "..", project);
const r = spawnSync(path.join(dir, "gradlew"), ["--console=plain", ...tasks], { cwd: dir, env, stdio: "inherit" });
process.exit(r.status ?? 1);
