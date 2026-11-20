// The iOS app of a release as an unsigned IPA, the file a person sideloads with AltStore or
// Sideloadly, which sign it with their own Apple ID when they install it. Nothing here signs: the
// signed build for TestFlight is scripts/upload.ts's.
//   node scripts/ipa.ts [version]      (npm run ipa -- 0.38.0, or a preview: 0.38.0-next.4)
// Builds the page for iOS and syncs it (npm run sync:ios), archives the app for devices with code
// signing off, its version X.Y.Z and its build number the one a signed build of the same version
// gets (iosVersion in scripts/version-code.ts: versionCode * 1000 + N, 999 for a release), and
// writes ios/App/output/Pine-<version>.ipa. Then checks what it wrote: the app inside is not signed
// at all, its binary is arm64, its versions are the ones asked for. Without a version it is 0.0.0,
// build 1. Needs Xcode with the iOS SDK; the Release workflow
// runs it on a runner with Xcode 27.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { iosVersion } from "./version-code.ts";

const version = process.argv[2] ?? "0.0.0";
const { short, build: code } = version === "0.0.0" ? { short: version, build: 1 } : iosVersion(version);
const mobile = path.resolve(import.meta.dirname, "..");
const build = path.join(mobile, "ios", "App", "build");
const archive = path.join(build, "App.xcarchive");
const output = path.join(mobile, "ios", "App", "output");
const ipa = path.join(output, `Pine-${version}.ipa`);

function run(cmd: string, args: string[], cwd = mobile) {
	const r = spawnSync(cmd, args, { cwd, stdio: "inherit" });
	if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed (exit ${r.status ?? r.signal}).`);
}
const read = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

try {
	run("npm", ["run", "sync:ios"]);
	fs.rmSync(build, { recursive: true, force: true });
	run("xcodebuild", [
		"-project", "ios/App/App.xcodeproj",
		"-scheme", "App",
		"-configuration", "Release",
		"-destination", "generic/platform=iOS",
		"-archivePath", archive,
		"-derivedDataPath", path.join(build, "DerivedData"),
		// The versions of the packages are the ones committed (swift-collections is held at a version
		// that compiles on Xcode 27), never a newer one resolved on the day of the release.
		"-onlyUsePackageVersionsFromResolvedFile",
		"archive",
		"CODE_SIGNING_ALLOWED=NO",
		"CODE_SIGNING_REQUIRED=NO",
		"CODE_SIGN_IDENTITY=",
		`MARKETING_VERSION=${short}`,
		`CURRENT_PROJECT_VERSION=${code}`,
	]);

	// An IPA is a zip of Payload/<name>.app.
	const app = path.join(archive, "Products", "Applications", "App.app");
	const stage = path.join(build, "ipa");
	fs.mkdirSync(path.join(stage, "Payload"), { recursive: true });
	run("ditto", [app, path.join(stage, "Payload", "App.app")]);
	fs.mkdirSync(output, { recursive: true });
	fs.rmSync(ipa, { force: true });
	run("zip", ["-qry", ipa, "Payload"], stage);

	// What a sideloading tool gets: checked on the app as it lies in the IPA.
	const unpacked = path.join(build, "check");
	run("ditto", ["-x", "-k", ipa, unpacked]);
	const inside = path.join(unpacked, "Payload", "App.app");
	const signature = spawnSync("codesign", ["-dv", inside], { encoding: "utf8" });
	if (signature.status === 0 || !/not signed at all/.test(signature.stderr)) {
		throw new Error(`the app in the IPA is signed, and must not be:\n${signature.stderr}`);
	}
	const archs = read("lipo", ["-archs", path.join(inside, "App")]);
	if (archs !== "arm64") throw new Error(`the app's binary is "${archs}", not arm64 alone.`);
	const plist = path.join(inside, "Info.plist");
	const shown = read("plutil", ["-extract", "CFBundleShortVersionString", "raw", plist]);
	const number = read("plutil", ["-extract", "CFBundleVersion", "raw", plist]);
	if (shown !== short || number !== String(code)) {
		throw new Error(`the app says version ${shown} (${number}), not ${short} (${code}).`);
	}
	console.log(`wrote ${ipa}: ${fs.statSync(ipa).size} bytes, not signed, arm64, version ${short} (${code})`);
} catch (e) {
	console.error((e as Error).message);
	process.exit(1);
}
