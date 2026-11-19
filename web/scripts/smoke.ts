// `npm run smoke` (after `npm run build`): the built web client in a headless Chrome for Testing,
// against a real sshd on this computer that runs the real `pine service` on a home of its own
// with the scripted model server. Run by hand; no workflow runs it. It needs /usr/sbin/sshd and
// Chrome for Testing (`npx playwright-core install chromium`). Nothing here touches ~/.ssh,
// ~/.pine or the system's sshd, and no window is shown.
//
// The owner's first visit, as named checks: the page cannot reach the bridge's storage or
// document; the browser's key is shown; a machine is added and used; its host key fingerprint is
// asked about and trusted; a message is sent and the answer comes back.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { startMock } from "../../baseline/tests/mock.mjs";
import { site } from "../relay/src/site.ts";
import { headless } from "../test/support/browser.ts";
import { startMachine } from "../test/support/machine.ts";

const web = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(web, "..");
const dist = path.join(web, "dist");
if (!existsSync(path.join(dist, "index.html")) || !existsSync(path.join(dist, "page", "index.html"))) throw new Error("the web client is not built: npm run build in web/");

const checks: string[] = [];
async function check(name: string, run: () => Promise<void>) {
	const started = Date.now();
	await run();
	checks.push(name);
	console.log(`ok   ${name} (${Date.now() - started} ms)`);
}

const cleanups: (() => Promise<unknown> | unknown)[] = [];
const write = (file: string, content: string, mode?: number) => {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
	if (mode) chmodSync(file, mode);
};

try {
	// A pine home of its own with the scripted model server, and `pine` on the PATH of the sessions sshd starts.
	const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	cleanups.push(() => mock.close?.());
	const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "pine-web-smoke-")));
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
	const home = path.join(dir, "home");
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	mkdirSync(path.join(home, "browsers"), { recursive: true });
	const bin = path.join(dir, "bin");
	write(path.join(bin, "pine"), `#!/bin/sh\nexec "${process.execPath}" "${path.join(repo, "src", "cli.ts")}" "$@"\n`, 0o755);
	// The login shell the remote command asks for the PATH: one that gives this PATH and reads no startup file of the owner's.
	write(path.join(bin, "login-shell"), `#!/bin/sh\nPATH="${bin}:/usr/bin:/bin"; export PATH\nfor a; do shift; [ "$a" = -l ] || set -- "$@" "$a"; done\nexec /bin/sh "$@"\n`, 0o755);
	const machine = await startMachine({ env: { PINE_HOME: home, SHELL: path.join(bin, "login-shell") } });
	cleanups.push(() => machine.stop());

	// The deployment: dist/ with the headers of the relay's site.ts, and at /ssh a stand-in for the
	// relay that pipes to this sshd (the real relay refuses a loopback address).
	const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm" };
	const assets = {
		fetch: async (request: Request) => {
			let file = path.join(dist, decodeURIComponent(new URL(request.url).pathname));
			if (!file.startsWith(dist)) return new Response("not found", { status: 404 });
			if (file.endsWith("/")) file = path.join(file, "index.html");
			if (!existsSync(file)) return new Response("not found", { status: 404 });
			return new Response(readFileSync(file), { headers: { "content-type": types[path.extname(file)] ?? "application/octet-stream" } });
		},
	};
	const handle = site(async () => new Response("the relay is a stand-in here", { status: 400 }));
	const relayed: string[] = [];
	const server = createServer(async (req: IncomingMessage, res) => {
		const response = await handle(new Request(`http://${req.headers.host}${req.url}`), { ASSETS: assets, LIMITER: { limit: async () => ({ success: true }) } });
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});
	const relay = new WebSocketServer({ noServer: true });
	server.on("upgrade", (req, socket, head) => {
		if (!req.url?.startsWith("/ssh?")) return socket.destroy();
		relayed.push(req.url);
		relay.handleUpgrade(req, socket, head, (ws) => {
			const tcp = connect(machine.sshPort, "127.0.0.1");
			tcp.on("data", (data) => ws.send(data));
			tcp.on("close", () => ws.close());
			tcp.on("error", () => ws.close());
			ws.on("message", (data) => tcp.write(data as Buffer));
			ws.on("close", () => tcp.destroy());
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	cleanups.push(() => new Promise((resolve) => (relay.close(), server.closeAllConnections(), server.close(resolve))));
	const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

	const browser = await headless();
	cleanups.push(() => browser.stop());
	const { page } = browser;
	const errors: string[] = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	await page.goto(`${origin}/`);
	const frame = page.frameLocator("iframe");
	const inside = async () => {
		for (;;) {
			const f = page.frames().find((x) => x !== page.mainFrame());
			if (f) return f;
			await new Promise((r) => setTimeout(r, 50));
		}
	};

	await check("the page runs in an iframe sandboxed with scripts only", async () => {
		assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
		await frame.locator("[data-slot=device-key]").waitFor({ timeout: 20_000 });
	});

	await check("the page cannot reach the bridge's IndexedDB, its document or its cookies", async () => {
		const f = await inside();
		const reached = await f.evaluate(async () => {
			const tries: Record<string, string> = {};
			const attempt = async (name: string, act: () => unknown) => {
				try {
					await act();
					tries[name] = "reached";
				} catch (e) {
					tries[name] = (e as Error).name;
				}
			};
			await attempt("indexedDB", () => new Promise((resolve, reject) => {
				const r = indexedDB.open("pine-web");
				r.onsuccess = resolve;
				r.onerror = () => reject(r.error);
			}));
			await attempt("parent document", () => window.parent.document.title);
			await attempt("cookies", () => document.cookie);
			return { tries, origin: window.origin };
		});
		assert.equal(reached.origin, "null");
		for (const [name, result] of Object.entries(reached.tries)) assert.notEqual(result, "reached", name);
	});

	const key = await frame.locator("[data-slot=device-key]").locator(".font-mono").innerText();
	await check("the browser's key is an Ed25519 key that sshd accepts once it is in authorized_keys", async () => {
		assert.match(key, /^ssh-ed25519 AAAA\S+ pine-web$/);
		machine.authorize(key);
	});

	const host = `${machine.user}@127.0.0.1:${machine.sshPort}`;
	await check("a machine is added and used, and its host key's fingerprint is asked about", async () => {
		await frame.getByPlaceholder("you@server").fill(host);
		await frame.getByRole("button", { name: "Add" }).click();
		await frame.locator(`[data-environment="${host}"]`).getByRole("button", { name: "Use" }).click();
		const shown = frame.locator(`[data-environment="${host}"] [data-slot=host-key-fingerprint]`).first();
		await shown.waitFor({ timeout: 20_000 });
		assert.equal(await shown.innerText(), machine.hostFingerprint);
		assert.ok(relayed.some((u) => u === `/ssh?host=127.0.0.1&port=${machine.sshPort}`), relayed.join(", "));
	});

	await check("trusting the key connects, and the conversation is there", async () => {
		await frame.locator(`[data-environment="${host}"] [data-slot=trust-host-key]`).first().click();
		await frame.locator("textarea").first().waitFor({ timeout: 60_000 });
		assert.match(machine.log(), /Accepted publickey for \S+ from 127\.0\.0\.1 port \d+ ssh2: ED25519/);
	});

	await check("a message is sent and the answer comes back", async () => {
		const box = frame.locator("textarea").first();
		await box.fill('Say it. <<MOCK {"steps":[{"text":"The answer came back over SSH."}]}>>');
		await box.press("Enter");
		// The answer alone in its paragraph: the message sent holds the same words inside its directive.
		await frame.getByText("The answer came back over SSH.", { exact: true }).first().waitFor({ timeout: 60_000 });
		assert.ok(mock.state.requests.length > 0, "the model was asked");
	});

	assert.deepEqual(errors.filter((e) => /Content Security Policy|Refused/.test(e)), [], "the page broke no policy");
	console.log(`\n${checks.length} checks passed`);
} finally {
	for (const clean of cleanups.reverse()) await Promise.resolve(clean()).catch(() => {});
}
process.exit(0);
