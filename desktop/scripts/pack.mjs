// Makes the app that is handed out: release/mac-*/Pine.app (and with --dmg a disk image).
//   node scripts/pack.mjs            the app, for this Mac's kind of processor
//   node scripts/pack.mjs --dmg      also a disk image
//   node scripts/pack.mjs --no-pine  without a pine inside: the app then uses the `pine` of the owner's shell
//
// The app carries a pine of its own, so that it works on a Mac where pine was never installed:
// the package `npm run build` makes in the checkout (the sources compiled, as they go to npm)
// with what it depends on. pine still runs on the Mac's own Node (24 or newer), never on the
// app's Electron: its children are started with the program it runs on, which has to be a Node.
import { build as packApp } from "electron-builder";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const stage = path.join(root, ".stage", "pine");
const flags = new Set(process.argv.slice(2));
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });

run(process.execPath, [path.join(root, "scripts", "build.mjs")], root);
if (!fs.existsSync(path.join(root, "assets", "icon.icns"))) run(path.join(root, "node_modules", ".bin", "electron"), [path.join(root, "scripts", "icon.mjs")], root);

if (!flags.has("--no-pine")) {
	run(process.execPath, [path.join(repo, "scripts", "build.mjs")], repo);
	fs.rmSync(stage, { recursive: true, force: true });
	fs.mkdirSync(path.dirname(stage), { recursive: true });
	fs.cpSync(path.join(repo, "build"), stage, { recursive: true });
	// What pine is built on, as an install of the package would fetch it.
	run("npm", ["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"], stage);
}

// What an earlier run left is taken away first: the packer does not always manage to itself.
fs.rmSync(path.join(root, "release"), { recursive: true, force: true });

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
await packApp({
	projectDir: root,
	publish: "never",
	config: {
		appId: "dev.pine.desktop",
		productName: "Pine",
		copyright: "pine contributors",
		directories: { output: "release", buildResources: "assets" },
		// Everything the app runs is in the two built folders: the page and the main process are bundles.
		files: ["dist/**", "dist-electron/**", "package.json"],
		// pine goes in whole, with what it depends on, before the app is signed. (Listed as a resource,
		// the packer would leave its node_modules out.)
		afterPack: (context) => {
			if (flags.has("--no-pine")) return;
			const resources = context.electronPlatformName === "darwin" ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources") : path.join(context.appOutDir, "resources");
			fs.cpSync(stage, path.join(resources, "pine"), { recursive: true, verbatimSymlinks: true });
		},
		asar: true,
		npmRebuild: false,
		mac: {
			category: "public.app-category.developer-tools",
			icon: "assets/icon.icns",
			target: flags.has("--dmg") ? ["dmg", "dir"] : ["dir"],
			darkModeSupport: true,
			// Signed for this Mac only ("ad hoc") unless a Developer ID is set up: enough to run what was built here.
			identity: process.env.CSC_NAME ?? "-",
			hardenedRuntime: false,
			extendInfo: {
				// Dictating a message: the helper that listens asks under its own name, and the app says why too.
				NSMicrophoneUsageDescription: "Pine listens while you dictate a message.",
				NSSpeechRecognitionUsageDescription: "Pine turns what you say into text for the message you are writing. The words are recognised on this Mac.",
				CFBundleDocumentTypes: [{ CFBundleTypeName: "Folder", CFBundleTypeRole: "Viewer", LSHandlerRank: "Alternate", LSItemContentTypes: ["public.folder"] }],
			},
		},
		dmg: { title: `Pine ${version}` },
		linux: { target: ["AppImage"], icon: "assets/icon.png", category: "Development" },
		win: { target: ["nsis"], icon: "assets/icon.png" },
	},
});
console.log(`the app is in ${path.join(root, "release")}`);
