// Starts a packed app on a pine home of its own and looks whether it comes up with the pine it
// carries inside. For checking what `npm run pack` made.
//   node scripts/smoke.mjs [release/mac-arm64/Pine.app]
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";

const root = path.resolve(import.meta.dirname, "..");
const appDir = path.resolve(process.argv[2] ?? path.join(root, "release", `mac-${process.arch}`, "Pine.app"));
// Tried from a folder of its own: inside the checkout, a pine that lacks what it depends on would
// find it in the checkout's own node_modules and seem whole.
const away = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-smoke-app-")));
fs.cpSync(appDir, path.join(away, "Pine.app"), { recursive: true, verbatimSymlinks: true });
const binary = path.join(away, "Pine.app", "Contents", "MacOS", "Pine");
const write = (file, content) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, content));
const freePort = () => new Promise((resolve) => {
	const s = net.createServer();
	s.listen(0, "127.0.0.1", () => {
		const p = s.address().port;
		s.close(() => resolve(p));
	});
});

const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-smoke-")));
write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, defaults: { model: "mock/m", mode: "safe" } }));
write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");

const port = await freePort();
// PINE_CLI is taken out: the app is to find the pine it carries.
const env = { ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data") };
delete env.PINE_CLI;
const child = spawn(binary, [`--remote-debugging-port=${port}`], { env, stdio: "ignore" });
let failed;
try {
	let browser;
	for (let i = 0; i < 100 && !browser; i++) {
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
		if (!browser) await new Promise((r) => setTimeout(r, 200));
	}
	if (!browser) throw new Error("the app did not come up");
	let page;
	for (let i = 0; i < 100 && !page; i++) {
		page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://"));
		if (!page) await new Promise((r) => setTimeout(r, 200));
	}
	if (!page) throw new Error("the app has no window");
	await page.waitForSelector(".welcome h1", { timeout: 60_000 }).catch(async () => {
		throw new Error(`no conversation appeared. On screen: ${await page.evaluate(() => document.body.innerText.slice(0, 600))}`);
	});
	const status = await page.textContent(".side-status");
	await page.fill(".composer textarea", "hello from the packed app");
	await page.keyboard.press("Enter");
	await page.waitForSelector(".md >> text=ECHO[hello from the packed app]", { timeout: 30_000 });
	const from = (await page.evaluate(() => window.pine.state())).state.from;
	if (process.argv[3]) await page.screenshot({ path: process.argv[3] });
	const shown = await page.evaluate(() => document.visibilityState);
	console.log(`ok: ${status?.trim()}; pine found in: ${from}; a message was answered; the window is ${shown}`);
	if (shown !== "visible") throw new Error("the app's window never showed");
	// PINE_SMOKE_HOLD=<seconds>: stays open that long, for somebody to look at the window.
	if (Number(process.env.PINE_SMOKE_HOLD) > 0) await new Promise((r) => setTimeout(r, Number(process.env.PINE_SMOKE_HOLD) * 1000));
	if (from !== "the app") throw new Error(`the app used the pine of "${from}", not the one it carries`);
	await browser.close();
} catch (e) {
	failed = e;
} finally {
	child.kill("SIGTERM");
	await new Promise((r) => child.once("close", r));
	await mock.close?.();
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(away, { recursive: true, force: true });
}
if (failed) {
	console.error(`failed: ${failed.message}`);
	process.exit(1);
}
