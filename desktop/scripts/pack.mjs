// Makes the app that is handed out: release/mac-*/Pine.app (and with --dmg a disk image).
//   node scripts/pack.mjs            the app, for this Mac's kind of processor
//   node scripts/pack.mjs --dmg      also a disk image (Pine-<version>-<arch>.dmg)
//   node scripts/pack.mjs --arch x64 for the other kind of processor (arm64, x64)
//   node scripts/pack.mjs --no-pine  without a pine inside: the app then uses the `pine` of the owner's shell
//   node scripts/pack.mjs --out <folder>   into another folder than release/ (for a build beside one that is in use)
//
// The app carries everything pine needs, so that it works on a Mac where nothing was installed:
//   Resources/pine   the package `npm run build` makes in the checkout (the sources compiled, as
//                    they go to npm) with what it depends on, and its helpers built for both
//                    kinds of Mac (scripts/helpers.mjs of the checkout)
//   Resources/node   the Node pine runs on, as nodejs.org hands it out: the version this script
//                    runs on. pine never runs on the app's Electron: its children are started
//                    with the program it runs on, which has to be a Node
//   Resources/bin    `pine` for a terminal (scripts/pine.sh), which the app links into the PATH
//
// Signing. Without anything set, the app is signed for this Mac only ("ad hoc"). To hand it out:
//   CSC_NAME                               a Developer ID Application identity in the keychain, or
//   CSC_LINK, CSC_KEY_PASSWORD             the same as a .p12 file (a path or base64) and its password
//   APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER    an App Store Connect key: the app is notarised
// Either way it is signed with the hardened runtime, so that what is tried here is what is shipped.
// PINE_VERSION gives the app and the pine inside it their version (a release sets it).
import { build as packApp } from "electron-builder";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const stage = path.join(root, ".stage", "pine");
const flags = new Set(process.argv.slice(2));
const outAt = process.argv.indexOf("--out");
const out = path.resolve(root, outAt > 0 && process.argv[outAt + 1] ? process.argv[outAt + 1] : "release");
const archAt = process.argv.indexOf("--arch");
const arch = archAt > 0 ? process.argv[archAt + 1] : process.arch;
if (arch !== "arm64" && arch !== "x64") {
	console.error(`--arch is arm64 or x64, not "${arch}"`);
	process.exit(2);
}
const carries = !flags.has("--no-pine");

// An app that runs from the folder this would clear is somebody's open window: it is not deleted under them.
try {
	const running = execFileSync("/usr/bin/pgrep", ["-fl", `${out}/`], { encoding: "utf8" }).split("\n").filter((l) => l.includes(".app/Contents/MacOS/"));
	if (running.length) {
		console.error(`An app from ${out} is running (process ${running[0].split(" ")[0]}). Quit it first, or pack into another folder: node scripts/pack.mjs --out release-next`);
		process.exit(1);
	}
} catch (e) {
	// pgrep ends with 1 when nothing matches: nothing runs from there.
	if (e.status !== 1) throw e;
}
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run(process.execPath, [path.join(root, "scripts", "build.mjs")], root);
if (!fs.existsSync(path.join(root, "assets", "icon.icns"))) run(path.join(root, "node_modules", ".bin", "electron"), [path.join(root, "scripts", "icon.mjs")], root);

/**
 * The Node the app carries, as nodejs.org hands it out for a Mac of this kind: fetched once, kept
 * in .stage, and only used when it is the file their list of checksums names.
 */
async function carriedNode() {
	const name = `node-${process.version}-darwin-${arch}`;
	const dir = path.join(root, ".stage", "node", name);
	if (fs.existsSync(path.join(dir, "bin", "node"))) return dir;
	const from = `https://nodejs.org/dist/${process.version}`;
	const get = async (file) => {
		const res = await fetch(`${from}/${file}`);
		if (!res.ok) throw new Error(`${from}/${file} answered ${res.status}`);
		return Buffer.from(await res.arrayBuffer());
	};
	console.log(`fetching ${name} for the app ...`);
	const wanted = new RegExp(`^([0-9a-f]{64})\\s+${name.replaceAll(".", "\\.")}\\.tar\\.gz$`, "m").exec((await get("SHASUMS256.txt")).toString("utf8"))?.[1];
	if (!wanted) throw new Error(`nodejs.org lists no ${name}.tar.gz: is ${process.version} a released version?`);
	const archive = await get(`${name}.tar.gz`);
	const got = createHash("sha256").update(archive).digest("hex");
	if (got !== wanted) throw new Error(`${name}.tar.gz is not the file nodejs.org lists (sha256 ${got}, listed ${wanted})`);
	const tmp = `${dir}.tmp`;
	fs.rmSync(tmp, { recursive: true, force: true });
	fs.mkdirSync(tmp, { recursive: true });
	fs.writeFileSync(path.join(tmp, "node.tar.gz"), archive);
	// The program and its licence, which has to travel with it. npm and the rest stay out: pine uses none of it.
	run("/usr/bin/tar", ["-xzf", "node.tar.gz", "--strip-components", "1", `${name}/bin/node`, `${name}/LICENSE`], tmp);
	fs.rmSync(path.join(tmp, "node.tar.gz"));
	fs.renameSync(tmp, dir);
	return dir;
}

const pineVersion = process.env.PINE_VERSION ?? JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
let node;
if (carries) {
	run(process.execPath, [path.join(repo, "scripts", "build.mjs")], repo);
	fs.rmSync(stage, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(stage), { recursive: true });
	fs.cpSync(path.join(repo, "build"), stage, { recursive: true });
	// What pine is built on, as an install of the package would fetch it.
	run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], stage);
	if (process.platform === "darwin") {
		// Its helpers, built: a Mac without Apple's developer tools could not build them itself.
		run(process.execPath, [path.join(repo, "scripts", "helpers.mjs"), stage], repo);
		node = await carriedNode();
	}
}

// What the signed programs may do under the hardened runtime. Electron and Node make machine code
// as they run; the voice helper listens. Signed for this Mac only, the parts have no team in
// common, and the system would not let one load the other without the last entry.
const identity = process.env.CSC_NAME ?? (process.env.CSC_LINK ? undefined : "-");
const adhoc = identity === "-";
const entitlements = path.join(root, ".stage", "entitlements.plist");
fs.mkdirSync(path.dirname(entitlements), { recursive: true });
fs.writeFileSync(
	entitlements,
	`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
${["com.apple.security.cs.allow-jit", "com.apple.security.cs.allow-unsigned-executable-memory", "com.apple.security.device.audio-input", ...(adhoc ? ["com.apple.security.cs.disable-library-validation"] : [])].map((key) => `<key>${key}</key><true/>`).join("\n")}
</dict></plist>
`,
);

// Notarising, with an App Store Connect key, is done here and not by the packer. Apple checks the
// app, and then its answer (the "ticket") is attached to the app, which asks another server of
// Apple's. That server drops a connection now and then, and the packer gives up at the first one:
// a release then had no app although Apple had long said yes. Here that step is tried again.
const key = { file: process.env.APPLE_API_KEY, id: process.env.APPLE_API_KEY_ID, issuer: process.env.APPLE_API_ISSUER };
const notariseHere = !adhoc && process.platform === "darwin" && Boolean(key.file && key.id && key.issuer);
const STAPLE_TRIES = 10;

async function notarise(app) {
	const zip = `${app}.zip`;
	run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, zip]);
	let answer;
	try {
		console.log(`sending ${path.basename(app)} to Apple to be notarised, and waiting for the answer ...`);
		const said = execFileSync("/usr/bin/xcrun", ["notarytool", "submit", zip, "--key", key.file, "--key-id", key.id, "--issuer", key.issuer, "--wait", "--output-format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 16 * 1024 * 1024 });
		answer = JSON.parse(said);
	} finally {
		fs.rmSync(zip, { force: true });
	}
	if (answer.status !== "Accepted") throw new Error(`Apple did not notarise the app: its answer is "${answer.status}". What it found: xcrun notarytool log ${answer.id} --key <file> --key-id <id> --issuer <issuer>`);
	console.log(`Apple notarised it (${answer.id})`);
	for (let i = 1; ; i++) {
		try {
			run("/usr/bin/xcrun", ["stapler", "staple", app]);
			return;
		} catch (e) {
			if (i >= STAPLE_TRIES) throw new Error(`Apple notarised the app, but its ticket could not be attached in ${STAPLE_TRIES} tries (xcrun stapler staple). Run this again later: the app need not be sent to Apple anew for that.`);
			const wait = Math.min(15 * i, 60);
			console.log(`the ticket could not be attached (try ${i} of ${STAPLE_TRIES}); again in ${wait} seconds`);
			await new Promise((r) => setTimeout(r, wait * 1000));
		}
	}
}

// What an earlier run left is taken away first: the packer does not always manage to itself.
// (Tried a few times: the Finder and the system's index write into a folder that is being looked at.)
fs.rmSync(out, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });

const targets = flags.has("--dmg") ? ["dmg", "dir"] : ["dir"];
await packApp({
	projectDir: root,
	publish: "never",
	config: {
		appId: "dev.pine.desktop",
		productName: "Pine",
		copyright: "pine contributors",
		directories: { output: path.relative(root, out), buildResources: "assets" },
		// The app has the version of the pine it carries: they are made and handed out together.
		extraMetadata: { version: pineVersion },
		// Everything the app runs is in the two built folders: the page and the main process are bundles.
		files: ["dist/**", "dist-electron/**", "package.json"],
		// pine goes in whole, with what it depends on, before the app is signed. (Listed as a resource,
		// the packer would leave its node_modules out.) With it the Node it runs on and `pine` for a terminal.
		afterPack: (context) => {
			if (!carries) return;
			const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
			fs.cpSync(stage, path.join(resources, "pine"), { recursive: true, verbatimSymlinks: true });
			if (!node) return;
			fs.cpSync(node, path.join(resources, "node"), { recursive: true });
			fs.mkdirSync(path.join(resources, "bin"), { recursive: true });
			fs.copyFileSync(path.join(root, "scripts", "pine.sh"), path.join(resources, "bin", "pine"));
			fs.chmodSync(path.join(resources, "bin", "pine"), 0o755);
		},
		// After the app is signed and before a disk image is made of it: the image then holds the app with its ticket.
		afterSign: async (context) => {
			if (!notariseHere || context.electronPlatformName !== "darwin") return;
			await notarise(path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
		},
		asar: true,
		npmRebuild: false,
		mac: {
			category: "public.app-category.developer-tools",
			icon: "assets/icon.icns",
			target: targets.map((target) => ({ target, arch: [arch] })),
			artifactName: "Pine-${version}-${arch}.${ext}",
			darkModeSupport: true,
			// Signed for this Mac only ("ad hoc") unless a Developer ID is set up: enough to run what was built here.
			identity,
			hardenedRuntime: true,
			entitlements,
			entitlementsInherit: entitlements,
			// Notarised when a signature Apple knows and an App Store Connect key are both there: by
			// `notarise` above. With another kind of sign-in (APPLE_ID, a keychain profile) by the packer.
			notarize: !adhoc && !notariseHere,
			extendInfo: {
				// Dictating a message: the helper that listens asks under its own name, and the app says why too.
				NSMicrophoneUsageDescription: "Pine listens while you dictate a message.",
				NSSpeechRecognitionUsageDescription: "Pine turns what you say into text for the message you are writing. The words are recognised on this Mac.",
				CFBundleDocumentTypes: [{ CFBundleTypeName: "Folder", CFBundleTypeRole: "Viewer", LSHandlerRank: "Alternate", LSItemContentTypes: ["public.folder"] }],
			},
		},
		dmg: { title: `Pine ${pineVersion}` },
		linux: { target: ["AppImage"], icon: "assets/icon.png", category: "Development" },
		win: { target: ["nsis"], icon: "assets/icon.png" },
	},
});
const app = path.join(out, arch === "arm64" ? "mac-arm64" : "mac", "Pine.app");
if (process.platform === "darwin") {
	// Every part has to carry a signature the whole agrees with, or the system will not start it elsewhere.
	run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], root);
	const notarised = !adhoc && (process.env.APPLE_API_KEY || process.env.APPLE_ID || process.env.APPLE_KEYCHAIN_PROFILE);
	console.log(adhoc ? "signed for this Mac only: to hand the app out, sign it with a Developer ID (CSC_NAME or CSC_LINK) and have it notarised" : notarised ? "signed and notarised" : "signed with a Developer ID but not notarised: another Mac will not open it. Set APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER");
}
console.log(`the app is ${app}`);
