// The app's page in an ordinary browser (`npm run dev:preview`): the preview's server on a
// throwaway pine, talked to over HTTP as a browser would. No window.
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { build } from "vite";

const root = path.resolve(import.meta.dirname, "..");

let child: ChildProcess;
/** Where the page is served, its origin, the daemon behind it and the throwaway home it runs on. */
let page: string;
let origin: string;
let daemon: string;
let home: string;
let said = "";

before(async () => {
	child = spawn(process.execPath, [path.join(root, "scripts", "preview.ts")], { cwd: root, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
	child.stderr!.on("data", (d: Buffer) => (said += d.toString("utf8")));
	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`the preview did not come up. It said:\n${said}`)), 60_000);
		child.stdout!.on("data", (d: Buffer) => {
			said += d.toString("utf8");
			const p = /preview\s+(http:\/\/\S+)/.exec(said)?.[1];
			const pine = /pine\s+(http:\/\/\S+) on a throwaway home in (\S+)/.exec(said);
			if (p && pine) {
				clearTimeout(timer);
				page = p;
				origin = new URL(p).origin;
				daemon = pine[1];
				home = pine[2];
				resolve();
			}
		});
		child.on("close", (code) => reject(new Error(`the preview ended (exit ${code}). It said:\n${said}`)));
	});
});

after(() => {
	if (child.exitCode === null) child.kill("SIGKILL");
});

const call = (body: unknown, headers: Record<string, string> = { origin, "content-type": "application/json" }) => fetch(new URL("/__pine/call", page), { method: "POST", headers, body: JSON.stringify(body) });

test("a call from the page's own origin, as JSON, reaches the daemon and comes back with its answer", async () => {
	const res = await call({ method: "GET", url: "/agents" });
	assert.equal(res.status, 200);
	const answer = await res.json();
	assert.equal(answer.ok, true);
	assert.deepEqual(answer.data.map((a: { id: string }) => a.id).sort(), ["main", "scout"]);
});

test("a call from another origin, or that is not JSON, is refused and not forwarded", async () => {
	assert.equal((await call({ method: "GET", url: "/agents" }, { origin: "http://evil.example", "content-type": "application/json" })).status, 403);
	assert.equal((await call({ method: "GET", url: "/agents" }, { origin, "content-type": "text/plain" })).status, 403);
	assert.equal((await call({ method: "GET", url: "/agents" }, { "content-type": "application/json" })).status, 403);
	assert.equal((await fetch(new URL("/__pine/call", page), { headers: { origin } })).status, 403);
});

test("the event stream and media are refused to another origin", async () => {
	assert.equal((await fetch(new URL("/__pine/events", page), { headers: { origin: "http://evil.example" } })).status, 403);
	assert.equal((await fetch(new URL("/__pine/media/media/tool/x", page), { headers: { origin: "http://evil.example" } })).status, 403);
	const stream = await fetch(new URL("/__pine/events", page), { headers: { origin } });
	assert.equal(stream.status, 200);
	assert.match(stream.headers.get("content-type") ?? "", /^text\/event-stream/);
	await stream.body?.cancel();
});

test("the page is served with the app's content security policy", async () => {
	const res = await fetch(page);
	assert.equal(res.status, 200);
	const csp = res.headers.get("content-security-policy") ?? "";
	assert.match(csp, /default-src 'none'/);
	assert.match(csp, /img-src 'self' data: blob:;/);
	assert.doesNotMatch(csp, /pine-media:/);
	assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
	await res.body?.cancel();
});

test("a media path the app does not serve is refused", async () => {
	const res = await fetch(new URL("/__pine/media/agents", page));
	assert.equal(res.status, 404);
	await res.body?.cancel();
});

test("nothing of the browser stand-in is in the built page", async () => {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), "pine-preview-build-"));
	try {
		await build({ root, logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
		const files = fs.readdirSync(out, { recursive: true, encoding: "utf8" }).filter((f) => /\.(js|html)$/.test(f));
		assert.ok(files.length > 0);
		for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(out, f), "utf8"), /__pine/, f);
	} finally {
		fs.rmSync(out, { recursive: true, force: true });
	}
});

test("stopping the preview removes the throwaway home and ends the daemon", async () => {
	assert.ok(fs.existsSync(path.join(home, "pine.json")));
	const ended = new Promise((r) => child.once("close", r));
	child.kill("SIGTERM");
	await ended;
	assert.equal(fs.existsSync(home), false);
	await assert.rejects(fetch(`${daemon}/health`, { signal: AbortSignal.timeout(2000) }));
});
