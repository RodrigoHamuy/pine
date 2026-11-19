// The mobile build of the desktop page, beside the desktop's own: the same styles, the policy the
// app's main process would send, and each build without the other's stand-in for Electron.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";
import { pageCsp } from "../../desktop/electron/daemon.ts";

const mobile = path.resolve(import.meta.dirname, "..");
const desktop = path.resolve(mobile, "../desktop");
let out: string;

/** The built page's files, by path, and their text. */
function read(dir: string) {
	const files = fs.readdirSync(dir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(js|html|css)$/.test(f));
	return new Map(files.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
}

/** The class names a style sheet has rules for (`.flex`, `.md\:px-4`...). */
function classes(css: string) {
	return new Set([...css.matchAll(/\.(-?[A-Za-z_\\](?:\\.|[\w-])*)/g)].map((m) => m[1]));
}

let mobileBuild: Map<string, string>;
let desktopBuild: Map<string, string>;

before(async () => {
	out = fs.mkdtempSync(path.join(os.tmpdir(), "pine-mobile-build-"));
	await build({ configFile: path.join(mobile, "vite.config.ts"), root: mobile, logLevel: "silent", build: { outDir: path.join(out, "mobile"), emptyOutDir: true } });
	await build({ configFile: path.join(desktop, "vite.config.ts"), root: desktop, logLevel: "silent", build: { outDir: path.join(out, "desktop"), emptyOutDir: true } });
	mobileBuild = read(path.join(out, "mobile"));
	desktopBuild = read(path.join(out, "desktop"));
});

after(() => fs.rmSync(out, { recursive: true, force: true }));

test("the mobile page has every style the desktop page has", () => {
	const css = (files: Map<string, string>) => [...files].filter(([f]) => f.endsWith(".css")).map(([, t]) => t).join("\n");
	const theirs = classes(css(desktopBuild));
	const ours = classes(css(mobileBuild));
	assert.ok(theirs.size > 500, `the desktop's style sheet has its utilities (${theirs.size})`);
	const missing = [...theirs].filter((c) => !ours.has(c));
	assert.deepEqual(missing, []);
});

test("the mobile page carries the desktop's content security policy, with the origin its media come from", () => {
	const html = mobileBuild.get("index.html")!;
	const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/g)];
	assert.equal(metas.length, 1);
	assert.equal(metas[0][1], pageCsp({ media: ["https://localhost"] }));
	// Before any script of the page, so that it holds for all of them.
	assert.ok(html.indexOf("Content-Security-Policy") < html.indexOf("<script"));
});

test("the mobile page installs its bridge and has nothing of the preview's stand-in", () => {
	const all = [...mobileBuild.values()].join("\n");
	assert.match(all, /_pine_media/, "the mobile bridge is in");
	for (const [f, text] of mobileBuild) assert.doesNotMatch(text, /__pine/, f);
});

test("the desktop page has nothing of the mobile bridge", () => {
	for (const [f, text] of desktopBuild) {
		assert.doesNotMatch(text, /_pine_media/, f);
		assert.doesNotMatch(text, /registerPlugin|Capacitor/, f);
	}
});
