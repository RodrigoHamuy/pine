// Capacitor's configuration: the page comes from the app itself and goes nowhere else.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { ORIGINS } from "../src/plugin.ts";

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../capacitor.config.json"), "utf8"));

test("no remote content: the page is the built one, served by the app", () => {
	assert.equal(config.server.url, undefined);
	assert.equal(config.webDir, "dist");
	assert.equal(config.android?.allowMixedContent, false);
});

test("no navigation away from the page", () => {
	assert.deepEqual(config.server.allowNavigation, []);
});

test("the page's origin is the one its media base and policy name", () => {
	assert.equal(`${config.server.androidScheme}://${config.server.hostname}`, ORIGINS.android.app);
});

test("on iOS the page's origin is Capacitor's own scheme: WKWebView keeps https for itself", () => {
	assert.equal(`${config.server.iosScheme ?? "capacitor"}://${config.server.hostname}`, ORIGINS.ios.app);
});

test("the plugin intercepts the media base the bridge gives, on the origin it keeps the page to", () => {
	const links = fs.readFileSync(path.join(import.meta.dirname, "../core/src/main/kotlin/pine/mobile/core/Links.kt"), "utf8");
	const constant = (name: string) => links.match(new RegExp(`const val ${name} = "([^"]*)"`))?.[1];
	assert.equal(constant("APP_ORIGIN"), ORIGINS.android.app);
	assert.equal(`${constant("APP_ORIGIN")}${constant("MEDIA_PATH")}`, ORIGINS.android.media);
});

test("the iOS app: iOS 17 and later, and a sentence for the local network prompt", () => {
	const project = fs.readFileSync(path.join(import.meta.dirname, "../ios/App/App.xcodeproj/project.pbxproj"), "utf8");
	const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((m) => m[1]);
	assert.ok(targets.length > 0);
	assert.deepEqual(new Set(targets), new Set(["17.0"]));
	const plist = fs.readFileSync(path.join(import.meta.dirname, "../ios/App/App/Info.plist"), "utf8");
	assert.match(plist, /<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);
	assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = dev\.pmndre\.pine;/);
});

test("on iOS the web view takes the whole screen (the page keeps itself inside the safe area), does not scroll, and shows no link previews", () => {
	assert.equal(config.ios?.contentInset, "never");
	assert.equal(config.ios?.scrollEnabled, false);
	assert.equal(config.ios?.allowsLinkPreview, false);
});

// What App Store Connect reads when a build is uploaded.
const iosApp = path.join(import.meta.dirname, "../ios/App/App");
const infoPlist = () => fs.readFileSync(path.join(iosApp, "Info.plist"), "utf8");

test("for App Store Connect the iOS app says it uses no encryption beyond the exempt kind, so no build waits on export compliance", () => {
	assert.match(infoPlist(), /<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
});

test("the iOS app requires arm64, which every device of iOS 17 has, and not the 32-bit armv7 that App Store Connect refuses", () => {
	const capabilities = infoPlist().match(/<key>UIRequiredDeviceCapabilities<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1];
	assert.ok(capabilities !== undefined, "UIRequiredDeviceCapabilities is missing");
	assert.deepEqual([...capabilities.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]), ["arm64"]);
});

test("the iOS app's privacy manifest: no tracking, no data collected, and UserDefaults read only by the app itself (CA92.1)", () => {
	const manifest = fs.readFileSync(path.join(iosApp, "PrivacyInfo.xcprivacy"), "utf8");
	assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
	assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
	assert.match(manifest, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
	const apis = manifest.match(/<key>NSPrivacyAccessedAPITypes<\/key>\s*<array>([\s\S]*)<\/array>\s*<key>NSPrivacyCollectedDataTypes/)?.[1];
	assert.ok(apis !== undefined, "NSPrivacyAccessedAPITypes is missing");
	assert.match(
		apis,
		/<key>NSPrivacyAccessedAPIType<\/key>\s*<string>NSPrivacyAccessedAPICategoryUserDefaults<\/string>\s*<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>\s*<string>CA92\.1<\/string>\s*<\/array>/,
	);
});

test("the privacy manifest is a resource of the App target, so it lands in App.app", () => {
	const project = fs.readFileSync(path.join(import.meta.dirname, "../ios/App/App.xcodeproj/project.pbxproj"), "utf8");
	const file = project.match(/(\w{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference;[^}]*path = PrivacyInfo\.xcprivacy;/)?.[1];
	assert.ok(file, "no file reference for PrivacyInfo.xcprivacy");
	const build = project.match(new RegExp(`(\\w{24}) /\\* PrivacyInfo\\.xcprivacy in Resources \\*/ = \\{isa = PBXBuildFile; fileRef = ${file} `))?.[1];
	assert.ok(build, "no build file for PrivacyInfo.xcprivacy");
	// The App target's resources phase is the one that copies Assets.xcassets.
	const phases = [...project.matchAll(/isa = PBXResourcesBuildPhase;[\s\S]*?files = \(([\s\S]*?)\);/g)].map((m) => m[1]);
	const app = phases.find((files) => files.includes("Assets.xcassets in Resources"));
	assert.ok(app?.includes(`${build} /* PrivacyInfo.xcprivacy in Resources */`), "the App target does not copy PrivacyInfo.xcprivacy");
});
