// The app from end to end: the real Electron app on a pine home of its own, with the scripted
// model server of pine's test suite behind it. It starts the daemon itself (`pine service`),
// which is half of what is tested here.
//
//   npm test                         in desktop/
//   PINE_DESKTOP_SHOTS=<folder>      also saves a picture of each screen there
//   PINE_DESKTOP_THEME=dark|light    in that appearance
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { _electron as electron } from "playwright-core";
import { mockMsg, startMock } from "../../baseline/tests/mock.mjs";
import { httpMcp } from "../../test/support/http-mcp.ts";

const root = path.resolve(import.meta.dirname, "..");
const shots = process.env.PINE_DESKTOP_SHOTS;

let app: any;
let page: any;
let mock: any;
let home: string;
let folder: string;
/** Where the browser of the web tools would lie (Playwright's own variable for it): a folder of the test's, empty at the start. */
let browsers: string;
/** A stand-in for GitHub, which the app asks for pine's last release: what it answers, and how often it was asked. */
let github: http.Server;
const releases = { status: 200, tag: "v9.9.9", asked: 0 };
/** What went wrong in the page itself, said with a failure. */
const pageErrors: string[] = [];

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

async function shot(name: string): Promise<void> {
	if (!shots) return;
	fs.mkdirSync(shots, { recursive: true });
	await page.screenshot({ path: path.join(shots, `${name}.png`) });
}

/** Wait for something on screen; when it does not come, say what is there instead. */
async function sees(selector: string, timeout = 20_000): Promise<void> {
	try {
		await page.waitForSelector(selector, { timeout });
	} catch {
		await shot(`failed-${selector.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`);
		const there = await page.evaluate(() => ({ text: (document.querySelector(".column, .set-in, .events-list, .gate") as HTMLElement | null)?.innerText?.slice(-1500), toasts: [...document.querySelectorAll("[data-slot=toast]")].map((t) => t.textContent), dialog: (document.querySelector("[data-slot=dialog-content]") as HTMLElement | null)?.innerText?.slice(0, 600) }));
		throw new Error(`"${selector}" did not appear. On screen: ${JSON.stringify(there, null, 1)}${pageErrors.length ? `\nErrors in the page:\n${pageErrors.join("\n")}` : ""}`);
	}
}

/** What a menu item does: the menus are the system's, and keys typed into the page do not reach them. */
const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);

const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);

before(async () => {
	if (!fs.existsSync(path.join(root, "dist", "index.html")) || !fs.existsSync(path.join(root, "dist-electron", "main.js"))) execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs")], { stdio: "inherit" });
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g, promptTokens: (body: any, raw: string) => contextAt(body) ?? Math.ceil(raw.length / 4) });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// A port of its own (0: the system picks one), so that a pine the developer has running is left alone.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent: it administers pine", delegates: ["scout"], approve: ["bash"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "main", "workspace", "notes.md"), "# Notes\n\nfirst line\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({ description: "Looks things up on the web" }));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");
	browsers = path.join(home, "browsers");
	fs.mkdirSync(browsers, { recursive: true });
	// A folder of the owner's, with a git history, to open for a conversation.
	folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-folder-")));
	write(path.join(folder, "README.md"), "# Okapi\n\nA small project.\n");
	write(path.join(folder, "src", "index.ts"), "export const answer = 41;\n");
	const git = (...args: string[]) => execFileSync("git", ["-C", folder, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { stdio: "ignore" });
	git("init", "-q");
	git("add", ".");
	git("commit", "-q", "-m", "first");
	write(path.join(folder, "src", "index.ts"), "export const answer = 42;\n");

	// A stand-in for the voice helper: it "hears" two words, and a third when it is told that was all.
	const voice = path.join(home, "voice-stand-in.mjs");
	write(voice, `#!/usr/bin/env node
const say = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
say({ type: "ready" });
setTimeout(() => say({ type: "partial", text: "about the scans" }), 50);
process.stdin.on("end", () => say({ type: "final", text: "about the scans please" }));
process.stdin.resume();
`);
	fs.chmodSync(voice, 0o755);

	github = http.createServer((_req, res) => {
		releases.asked++;
		const version = releases.tag.slice(1);
		res.writeHead(releases.status, { "content-type": "application/json" }).end(JSON.stringify({ tag_name: releases.tag, html_url: "https://example.invalid/elsewhere", assets: ["arm64", "x64"].map((arch) => ({ name: `Pine-${version}-${arch}.dmg` })) }));
	});
	await new Promise<void>((r) => github.listen(0, "127.0.0.1", r));

	// PINE_DESKTOP_THEME=dark|light: the pictures in that appearance, whatever the system is set to.
	if (process.env.PINE_DESKTOP_THEME) write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ theme: process.env.PINE_DESKTOP_THEME }));

	app = await electron.launch({
		// (The driver shows every page in light unless it is told otherwise, whatever the app says.)
		colorScheme: process.env.PINE_DESKTOP_THEME === "dark" ? "dark" : "light",
		args: [root],
		env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_VOICE: voice, PINE_DESKTOP_RELEASES: `http://127.0.0.1:${(github.address() as any).port}/repos/pmndre/pine/releases/latest` },
	});
	page = await app.firstWindow();
	page.on("pageerror", (e: Error) => pageErrors.push(String(e.stack ?? e.message).slice(0, 600)));
	page.on("console", (m: any) => m.type() === "error" && pageErrors.push(m.text().slice(0, 600)));
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	github?.close();
	for (const dir of [home, folder]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/** The context window of the mock model (models.json above). */
const WINDOW = 128000;

/** A message that says "the context at N%" is read by the mock as filling that much of the window. */
function contextAt(body: any): number | undefined {
	const last = [...(body.messages ?? [])].reverse().find((m: any) => m.role === "user");
	const text = typeof last?.content === "string" ? last.content : (last?.content ?? []).map((p: any) => p.text ?? "").join("");
	const n = /the context at (\d+)%/.exec(text)?.[1];
	return n ? Math.round((WINDOW * Number(n)) / 100) : undefined;
}

/** The edge between the side bar and the rest of the window, and the one before the panel beside a conversation. */
const SIDE_EDGE = "[data-slot=resizable-panel]:has(.sidebar) + [data-slot=resizable-handle]";
const CODE_EDGE = "[data-slot=resizable-handle]:has(+ [data-slot=resizable-panel] > * > .code)";

test("starts a daemon of its own and shows the main agent", async () => {
	await sees(".welcome h1");
	assert.equal(await page.textContent(".welcome h1"), "main");
	// This home has no browser for the web tools in the build its pine drives (the folder for it
	// is empty): that is asked once, at the start, and "Not now" is remembered.
	await sees("[data-slot=dialog-title] >> text=The browser for the web tools is not on this Mac");
	await shot("00-browser");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	assert.match(await page.textContent(".side-status"), /started here/);
	const agents = await page.$$eval(".side-agent .who > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim()));
	assert.deepEqual(agents, ["main", "scout"]);
	// The daemon it started is the one of this home, on a port of its own.
	assert.ok(fs.existsSync(path.join(home, "data", "http-token")));
	// The line around the tab in front is drawn outside the tab, and the row of tabs scrolls: what
	// lies outside the row is cut off. So the row has to leave the line its pixel on every side.
	const room = await page.evaluate(() => {
		const row = document.querySelector(".tabs")!.getBoundingClientRect();
		const tab = document.querySelector(".tab.on")!.getBoundingClientRect();
		return { top: tab.top - row.top, bottom: row.bottom - tab.bottom, left: tab.left - row.left };
	});
	assert.ok(room.top >= 1 && room.bottom >= 1 && room.left >= 1, `the row cuts off the line around the tab in front: ${JSON.stringify(room)}`);
	// At the foot of the side bar the dot of the status stands under the icons of the rows above
	// it, and what is written beside it under their names.
	const foot = await page.evaluate(() => {
		const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
		const middle = (r: DOMRect) => r.left + r.width / 2;
		return { icon: middle(box(".side-foot .side-row .lucide")), dot: middle(box(".side-status .dot")), name: box(".side-foot .side-row .grow").left, status: box(".side-status .cut").left };
	});
	assert.equal(foot.dot, foot.icon, `the dot of the status is not under the icons above it: ${JSON.stringify(foot)}`);
	assert.equal(foot.status, foot.name, `the status is not written under the names above it: ${JSON.stringify(foot)}`);
	await shot("01-welcome");
});

test("a newer app is said at the start and when asked, with a link to its page on GitHub and nothing fetched", async () => {
	const mine = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
	const link = "https://github.com/pmndre/pine/releases/tag/v9.9.9";
	// The start asked once, and the side bar says what it found.
	await sees(".side-update >> text=Pine 9.9.9 is available");
	assert.equal(releases.asked, 1);
	await shot("01-update");
	// What would open in the owner's browser is noted instead.
	await app.evaluate(({ shell }: any) => {
		(globalThis as any).opened = [];
		shell.openExternal = async (url: string) => void (globalThis as any).opened.push(url);
	});
	const opened = () => app.evaluate(() => (globalThis as any).opened);
	await page.click(".side-update");
	// "Check for Updates…" in the menu asks again and says where the new app is.
	const inMenu = await app.evaluate(({ Menu }: any) => {
		const found = Menu.getApplicationMenu().items.flatMap((m: any) => m.submenu?.items ?? []).filter((i: any) => i.label === "Check for Updates…");
		found[0]?.click();
		return found.length;
	});
	assert.equal(inMenu, 1);
	await sees("[data-slot=dialog-title] >> text=Pine 9.9.9 is available");
	assert.equal(releases.asked, 2);
	const body = await page.textContent("[data-slot=dialog-content]");
	assert.ok(body.includes(`This is Pine ${mine}.`) && body.includes(link), body);
	await shot("01-update-asked");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Open the release page" }).click();
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	// The link is GitHub's page of that release, not the address the answer named.
	assert.deepEqual(await opened(), [link, link]);
	// Nobody answers: that is said, and what was found before stays.
	releases.status = 503;
	await menu("updates");
	await sees("[data-slot=toast] >> text=Could not ask GitHub for the latest version");
	await sees(".side-update");
	// This app is the last release: said once, and the side bar's line is gone.
	Object.assign(releases, { status: 200, tag: `v${mine}` });
	await menu("updates");
	await sees(`[data-slot=toast] >> text=Pine ${mine} is the latest version.`);
	await page.waitForSelector(".side-update", { state: "detached" });
	// Settings > App has the same, and the switch for the question at the start.
	await menu("settings");
	await page.click(".set-nav .side-row >> text=App");
	await sees(".item.updates .tag.good >> text=the latest version");
	releases.tag = "v9.9.9";
	await page.locator(".item.updates").getByRole("button", { name: "Check now" }).click();
	await sees(".item.updates .tag.warn >> text=9.9.9 is available");
	await page.locator("[data-slot=dialog-footer]").getByRole("button", { name: "Not now" }).click();
	await page.locator(".item.updates").getByRole("button", { name: "Release page" }).click();
	assert.deepEqual(await opened(), [link, link, link]);
	const prefs = () => JSON.parse(fs.readFileSync(path.join(home, "desktop-data", "prefs.json"), "utf8"));
	await page.click(".item:has-text('Look for a newer version at the start') [data-slot=switch]");
	for (let i = 0; i < 50 && prefs().updates !== false; i++) await new Promise((r) => setTimeout(r, 40));
	assert.equal(prefs().updates, false);
	// It is a switch to assistive technology too, and Space turns it back on.
	await sees(".item:has-text('Look for a newer version at the start') [role=switch][aria-checked=false]");
	await page.keyboard.press("Space");
	await sees(".item:has-text('Look for a newer version at the start') [role=switch][aria-checked=true]");
	// (The settings open where they were left: back to their first page for the tests that follow.)
	await page.click(".set-nav .side-row >> text=General");
	await menu("settings");
	await sees(".side-update >> text=Pine 9.9.9 is available");
});

test("the agent's browser is shown in the panel as a picture, and what is done in it goes back through the daemon", async () => {
	// A stand-in for the door of the browser of main's own conversation: it says where it is in pine's data,
	// as the real one does, hands out one picture and notes what it is asked.
	const picture = Buffer.from(await app.evaluate(({ nativeImage }: any) => nativeImage.createFromBitmap(Buffer.alloc(400 * 300 * 4, 180), { width: 400, height: 300 }).toJPEG(70).toString("base64")), "base64");
	const word = "cd".repeat(32);
	const asked: Array<{ at: string; body: any }> = [];
	const where = { open: true, tabs: [{ title: "<img src=x onerror=window.hacked=3>Okapi shop", url: "https://shop.example/" }, { title: "Second", url: "https://shop.example/two" }], current: 0, window: false };
	const door = http.createServer(async (req, res) => {
		if (req.headers.authorization !== `Bearer ${word}`) return void res.writeHead(401).end();
		let text = "";
		for await (const chunk of req) text += chunk;
		if (req.url === "/frame") return void res.writeHead(200, { "content-type": "image/jpeg" }).end(picture);
		if (req.method === "POST") asked.push({ at: req.url!, body: JSON.parse(text || "{}") });
		res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(req.url === "/open" ? { ...where, error: "the browser was refused that address" } : where));
	});
	await new Promise<void>((r) => door.listen(0, "127.0.0.1", r));
	const file = path.join(home, "data", "browser-view", `${encodeURIComponent("main:main")}.json`);
	write(file, JSON.stringify({ port: (door.address() as any).port, token: word, pid: 1 }));
	const ops = () => asked.filter((a) => a.at === "/input").flatMap((a) => a.body.ops as any[]);
	const waitFor = async (what: string, test: () => boolean) => {
		for (let i = 0; i < 100 && !test(); i++) await new Promise((r) => setTimeout(r, 50));
		assert.ok(test(), `${what}. Asked: ${JSON.stringify(asked)}`);
	};
	await page.click(".tab >> nth=0");
	const had = Boolean(await page.$(".code"));
	try {
		await menu("code-browser");
		// The page is a picture, drawn when it is whole; its address is text in the line above it.
		await sees(".browser-page canvas:not(.blank)");
		assert.equal(await page.inputValue(".browser-address"), "https://shop.example/");
		assert.deepEqual(await page.$eval(".browser-page canvas", (c: HTMLCanvasElement) => [c.width, c.height]), [400, 300]);
		// The app said that it shows the browser itself, so the agent's browser opens no window.
		await waitFor("the door was told that the app shows the browser", () => asked.some((a) => a.at === "/input" && a.body.ops.some((o: any) => o.do === "size")));
		const size = ops().find((o) => o.do === "size");
		const room = await page.$eval(".browser-page", (el: Element) => ({ w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
		assert.deepEqual([size.w, size.h], [room.w, room.h], "the page is laid out for the room the panel has");
		// A page's title is text wherever it stands: nothing of it becomes part of this window.
		assert.match(await page.textContent(".browser-tab.on"), /<img src=x onerror=window\.hacked=3>Okapi shop/);
		assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
		await shot("05-browser");

		// A click in the picture is a click at that place in the page, whatever size the picture is drawn at.
		const box = await page.$eval(".browser-page canvas", (c: HTMLCanvasElement) => ({ x: c.getBoundingClientRect().left, y: c.getBoundingClientRect().top, k: c.width / c.getBoundingClientRect().width }));
		await page.mouse.click(box.x + 100, box.y + 60);
		await waitFor("the click arrived", () => ops().some((o) => o.do === "click"));
		const click = ops().find((o) => o.do === "click");
		assert.ok(Math.abs(click.x - 100 * box.k) <= 1 && Math.abs(click.y - 60 * box.k) <= 1 && click.button === "left", JSON.stringify(click));
		// Letters typed in a row go as one text, a key by its name, and what is pasted as text too.
		await page.keyboard.type("okapi");
		await page.keyboard.press("Enter");
		await page.keyboard.press("Meta+KeyA");
		await waitFor("what was typed arrived", () => ops().some((o) => o.do === "key" && o.key === "Meta+KeyA"));
		assert.equal(ops().filter((o) => o.do === "text").map((o) => o.text).join(""), "okapi");
		assert.ok(ops().filter((o) => o.do === "text").length < 5, "letters are not sent one by one");
		assert.deepEqual(ops().filter((o) => o.do === "key").map((o) => o.key), ["Enter", "Meta+KeyA"]);
		// The wheel adds up, a tab is chosen by a click, back is a button.
		await page.mouse.wheel(0, 120);
		await page.mouse.wheel(0, 120);
		await page.click(".browser-tab >> nth=1");
		// A tab of the owner's own, and one closed.
		await page.click(".browser-tabs button[aria-label='A new tab']");
		await page.click(".browser-tab >> nth=1 >> .browser-tab-close", { force: true });
		await waitFor("a new tab and a closed one arrived", () => ops().some((o) => o.do === "newtab") && ops().some((o) => o.do === "closetab" && o.index === 1));
		await page.click(".browser-bar button[aria-label='Back']");
		await waitFor("wheel, tab and back arrived", () => ["wheel", "tab", "back"].every((d) => ops().some((o) => o.do === d)));
		// (How far a turn of the wheel goes is the system's to say; that it went down, and all of it, is what counts.)
		assert.ok(ops().filter((o) => o.do === "wheel").reduce((sum, o) => sum + o.dy, 0) >= 240, JSON.stringify(ops().filter((o) => o.do === "wheel")));
		assert.equal(ops().find((o) => o.do === "tab").index, 1);
		// An address typed above the picture is opened by the daemon's hand, and a no is said.
		await page.fill(".browser-address", "localhost:5173");
		await page.press(".browser-address", "Enter");
		await waitFor("the address arrived", () => asked.some((a) => a.at === "/open"));
		assert.deepEqual(asked.find((a) => a.at === "/open")!.body, { url: "localhost:5173" });
		await sees("[data-slot=toast] >> text=the browser was refused that address");
		// The picture came through the app's own road for pictures, and the page asked the web for nothing.
		assert.equal(await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /^https?:/.test(r.name)).length), 0);

		// No page is open: what the agent opened here before is listed, as text, and a click opens it again.
		Object.assign(where, { open: false, tabs: [] });
		const db = new DatabaseSync(path.join(home, "data", "pine.db"));
		db.exec("PRAGMA busy_timeout = 5000");
		db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("visited:main:main", JSON.stringify(["https://shop.example/<img src=x onerror=window.hacked=4>", "http://127.0.0.1:4173/"]));
		db.close();
		await sees(".browser-visited .open-link >> nth=1");
		assert.deepEqual(await page.$$eval(".browser-visited .open-link", (els: Element[]) => els.map((e) => e.textContent)), ["shop.example/<img src=x onerror=window.hacked=4>", "127.0.0.1:4173"]);
		assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
		await shot("05-browser-empty");
		await page.click(".browser-visited .open-link >> nth=1");
		await waitFor("the address the agent had opened arrived", () => asked.some((a) => a.at === "/open" && a.body.url === "http://127.0.0.1:4173/"));

		// Without a browser the view says so and draws nothing.
		fs.rmSync(file);
		await sees(".browser [data-slot=empty] >> text=No page is open");
	} finally {
		// (The panel as it was, for the tests that follow.)
		await menu("code-agent");
		if (!had) await menu("code");
		fs.rmSync(file, { force: true });
		door.close();
	}
});

test("a message is answered, with the turn's work folded into a line", async () => {
	const steps = [{ tools: [{ name: "read", args: { path: "notes.md" } }], text: "Let me look at the notes first." }, { text: "The notes say **first line**.\n\n```ts\nconst a = 1;\n```\n\n<details><summary>Full file</summary>\n\nfirst line\n\n</details>\n\n[the docs](https://example.com/docs)" }];
	await page.fill(".composer textarea", mockMsg(steps, "What do the notes say? "));
	await page.keyboard.press("Enter");
	await sees('.md [data-streamdown="strong"]');
	assert.match(await page.textContent(".md"), /first line/);
	// The work of the turn (what it said on the way, and the tool call) is one line, which a click opens.
	await page.waitForFunction(() => /1 tool call · read/.test(document.querySelector("[data-item=work] > [data-slot=trace-collapsible-trigger]")?.textContent ?? ""));
	assert.equal(await page.$("[data-item=work] [data-tool]"), null);
	await page.click("[data-item=work] > [data-slot=trace-collapsible-trigger]");
	await sees("[data-item=work] [data-tool]");
	assert.equal(await page.textContent("[data-item=work] [data-tool]"), "read");
	// A link says where it leads, and is not an address the page itself would follow.
	assert.equal(await page.textContent(".md [data-href]"), "the docs");
	assert.equal(await page.getAttribute(".md [data-href]", "data-href"), "https://example.com/docs");
	assert.match(await page.textContent(".md [data-href] + [data-target]"), /example\.com\/docs/);
	assert.equal(await page.$$eval(".md a[href]", (els: Element[]) => els.length), 0);
	// A folded part is there and closed.
	assert.equal(await page.getAttribute(".md [data-details] [data-slot=collapsible-trigger]", "aria-expanded"), "false");
	// Code is coloured on the page, with its language and a copy button, and nothing to download.
	await page.waitForFunction(() => document.querySelectorAll('.md [data-streamdown="code-block"] span[style]').length > 0);
	assert.match(await page.textContent('.md [data-streamdown="code-block-header"]'), /ts/);
	assert.ok(await page.$('.md [data-streamdown="code-block"] button[title="Copy Code"], .md [data-streamdown="code-block"] button[aria-label="Copy Code"]'));
	assert.equal(await page.$$eval('.md [data-streamdown="code-block"] button[title*="ownload"], .md [data-streamdown="code-block"] button[aria-label*="ownload"]', (els: Element[]) => els.length), 0);
	await shot("02-answer");
});

/** Where focus is: the field's role, and the option it marks active, as a screen reader hears them. */
const activeOption = () =>
	page.evaluate(() => {
		const field = document.activeElement as HTMLElement;
		const id = field.getAttribute("aria-activedescendant");
		const option = id ? document.getElementById(id) : null;
		return { inDialog: Boolean(field.closest("[role=dialog]")), role: field.getAttribute("role"), option: option?.getAttribute("role"), selected: option?.getAttribute("aria-selected"), text: option?.textContent ?? "", list: Boolean(option?.closest("[role=listbox]")) };
	});

/** Tab stays inside the dialog: past its last stop, the dialog's focus guard hands focus back to its first (in the next frame). */
const stillInside = () => page.waitForFunction(() => Boolean(document.activeElement?.closest("[role=dialog]")) && !document.activeElement?.hasAttribute("data-base-ui-focus-guard"), undefined, { timeout: 2000 });

/** The text a dialog is announced by: what its aria-labelledby points at. */
const announced = (selector: string) =>
	page.$eval(selector, (d: Element) => (d.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim());

test("a model is chosen from its picker with the keyboard alone, and focus goes back to the chip", async () => {
	const chip = ".composer button[aria-label^='Model:']";
	const focused = () => page.evaluate((s: string) => document.activeElement === document.querySelector(s), chip);
	await page.focus(chip);
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=listbox] [role=option]");
	await sees("[data-slot=dialog-content] [role=combobox][aria-activedescendant]");
	// It is announced by its title.
	assert.match(await announced("[data-slot=dialog-content]"), /^Model for main/);
	// Its models are options in a list, the one in use marked active, and Tab stays inside.
	let at = await activeOption();
	assert.deepEqual([at.inDialog, at.role, at.option, at.selected, at.list], [true, "combobox", "option", "true", true], JSON.stringify(at));
	assert.match(at.text, /mock\/m/);
	await page.keyboard.press("Tab");
	await stillInside();
	// Escape closes it, and focus is back on the chip.
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	assert.equal(await focused(), true);
	// Arrows move, Enter chooses.
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content] [role=listbox] [role=option]");
	const count = await page.$$eval("[data-slot=dialog-content] [role=option]", (els: Element[]) => els.length);
	await page.keyboard.press("ArrowDown");
	if (count > 1) assert.doesNotMatch((await activeOption()).text, /^mock\/m/);
	await page.keyboard.press("ArrowUp");
	at = await activeOption();
	assert.match(at.text, /mock\/m/);
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	assert.equal(await focused(), true);
	assert.match((await page.getAttribute(chip, "aria-label")) ?? "", /mock\/m/);
});

test("the reasoning is chosen from the composer's menu with the keyboard, and the agent keeps it", async () => {
	const trigger = ".composer button[aria-label^='Reasoning:']";
	const before = (await page.getAttribute(trigger, "aria-label")) ?? "";
	const wanted = before.startsWith("Reasoning: high,") ? "low" : "high";
	await page.focus(trigger);
	await page.keyboard.press("Enter");
	await sees("[role=menu] [role=menuitemradio][aria-checked=true]");
	// The first letter goes to the level, Enter chooses it.
	await page.keyboard.press(wanted[0]);
	await page.waitForFunction((v: string) => document.activeElement?.getAttribute("role") === "menuitemradio" && document.activeElement.textContent?.startsWith(v), wanted);
	await page.keyboard.press("Enter");
	await page.waitForSelector("[role=menu]", { state: "detached" });
	await page.waitForFunction((v: string) => document.querySelector(".composer button[aria-label^='Reasoning:']")?.getAttribute("aria-label")?.startsWith(`Reasoning: ${v},`), wanted);
	await sees(`text=now reasons at "${wanted}"`);
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), trigger), true);
});

test("an empty composer is drawn at full strength, and its send button says there is nothing to send", async () => {
	await page.fill(".composer textarea", "");
	const send = page.locator(".composer [data-slot=input-group]").getByRole("button", { name: "Send", exact: true });
	assert.equal(await send.getAttribute("aria-disabled"), "true");
	assert.equal(await page.$eval(".composer [data-slot=input-group]", (el: Element) => getComputedStyle(el).opacity), "1");
	// A click on it sends nothing (forced: to the driver, as to a screen reader, it is disabled).
	const asked = mock.state.requests.length;
	await send.click({ force: true });
	await new Promise((r) => setTimeout(r, 200));
	assert.equal(mock.state.requests.length, asked);
	await page.fill(".composer textarea", "something");
	assert.notEqual(await send.getAttribute("aria-disabled"), "true");
	await page.fill(".composer textarea", "");
});

test("the context meter turns to a warning past two thirds, and to danger past 85%", async () => {
	const meter = ".conv-head [data-slot=hover-card-trigger]";
	for (const [percent, tone] of [[70, "warn"], [86, "bad"]] as const) {
		await page.fill(".composer textarea", mockMsg([{ text: `full to ${percent}` }], `the context at ${percent}% `));
		await page.keyboard.press("Enter");
		await sees(`${meter}[data-tone=${tone}] >> text=${percent}%`);
	}
	// A conversation that has room again is drawn as before.
	await page.fill(".composer textarea", mockMsg([{ text: "room again" }], "small "));
	await page.keyboard.press("Enter");
	await sees(`${meter}:not([data-tone])`);
});

test("what an answer points at on the web is not fetched by itself, and what it writes as HTML is cleaned", async () => {
	// A picture the page tried to load from an address the policy refuses would be said here.
	await page.evaluate(() => {
		(window as any).refused = [];
		document.addEventListener("securitypolicyviolation", (e) => (window as any).refused.push(e.blockedURI));
	});
	const dot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
	const text = [
		"Look: ![a cat](https://example.com/cat.png)",
		'<img src="https://example.com/dog.png">',
		`A dot: ![dot](data:image/png;base64,${dot})`,
		"In the workspace: ![the plan](plan.png)",
		'<script>window.hacked = 1</script><a href="javascript:window.hacked=2">x</a> and [y](javascript:window.hacked=3)',
		'<div style="color: red" class="evil" id="evil" data-x="1" aria-label="evil" onclick="window.hacked=4">styled</div>',
		'<style>body { display: none }</style><form action="https://example.com"><input name="q"><button>go</button></form>',
		'<iframe src="https://example.com"></iframe><svg><circle r="5"></circle></svg><video src="https://example.com/v.mp4"></video><object data="x"></object>',
		"| a | b |\n|---|---|\n| 1 | 2 |",
		"Read [the docs](https://example.com/docs).",
	].join("\n\n");
	await page.fill(".composer textarea", mockMsg([{ text }], "pictures "));
	await page.keyboard.press("Enter");
	await sees(".md [data-remote]");
	const md = page.locator(".md", { hasText: "A dot" }).last();
	// A picture on the web is a line to click, with its address, and the page asks for nothing.
	assert.equal(await md.locator("[data-remote]").count(), 2);
	assert.match(await md.locator("[data-remote]").first().textContent(), /Load picture · https:\/\/example\.com\/cat\.png/);
	assert.equal(await md.locator('img[src^="http"]').count(), 0);
	// A small picture in the text itself is shown, and one in the workspace comes from the daemon.
	assert.equal(await md.locator('img[src^="data:image/png"]').count(), 1);
	assert.match((await md.locator('img[alt="the plan"]').getAttribute("src")) ?? "", /^pine-media:\/\/daemon\/.*plan\.png/);
	// Nothing to download a picture with.
	assert.equal(await md.locator('button[title*="ownload"], button[aria-label*="ownload"]').count(), 0);
	// What could act or restyle is gone, and the words stay. The one svg allowed is pine's own arrow beside a link.
	assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
	assert.equal(await md.locator("script, style, form, input, button:not([data-remote]), iframe, svg:not([data-target] > svg), video, object, a[href]").count(), 0);
	assert.equal(await md.locator('[class~="evil"], #evil, [data-x], [aria-label="evil"], [onclick]').count(), 0);
	assert.equal(await md.getByText("styled", { exact: true }).evaluate((el: HTMLElement) => el.getAttribute("style")), null);
	assert.doesNotMatch(await md.textContent(), /display: none/);
	// A link on the web is no address the page could follow: it says where it leads, beside it.
	const link = md.locator("[data-href]");
	assert.equal(await link.getAttribute("data-href"), "https://example.com/docs");
	assert.match(await md.locator("[data-href] + [data-target]").textContent(), /example\.com\/docs/);
	// A table is kept in a box of its own that scrolls sideways.
	assert.equal(await md.locator("table").evaluate((t: HTMLElement) => getComputedStyle(t.parentElement!).overflowX), "auto");
	assert.deepEqual(await page.evaluate(() => (window as any).refused), []);
	await shot("02b-pictures");
});

test("a folded part that was opened stays open while the answer goes on", async () => {
	const text = "<details><summary>More</summary>\n\nhidden part\n\n</details>\n\n" + "and the answer goes on. ".repeat(40);
	await page.fill(".composer textarea", mockMsg([{ text, chunkDelayMs: 40 }], "fold "));
	await page.keyboard.press("Enter");
	await sees(".md-live [data-details] [data-slot=collapsible-trigger]");
	await page.click(".md-live [data-details] [data-slot=collapsible-trigger]");
	await page.waitForSelector('.md [data-details] [aria-expanded="true"]');
	await page.waitForFunction(() => !document.querySelector(".md-live"), undefined, { timeout: 20_000 });
	assert.equal(await page.locator(".md", { hasText: "hidden part" }).last().locator("[data-details] [data-slot=collapsible-trigger]").getAttribute("aria-expanded"), "true");
});

test("a picture opens over the page, and Escape closes it back onto the picture", async () => {
	const picture = await app.evaluate(({ nativeImage }: any) => nativeImage.createFromBitmap(Buffer.alloc(40 * 30 * 4, 180), { width: 40, height: 30 }).toPNG().toString("base64"));
	fs.writeFileSync(path.join(home, "agents", "main", "workspace", "okapi.png"), Buffer.from(picture, "base64"));
	await page.fill(".composer textarea", mockMsg([{ tools: [{ name: "read", args: { path: "okapi.png" } }] }, { text: "an okapi" }], "picture "));
	await page.keyboard.press("Enter");
	const img = ".it-media img";
	await sees(img);
	await page.click(img);
	await sees("[data-slot=dialog-content][role=dialog] img");
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("[data-slot=dialog-content]"));
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), img), true);
	// A press beside the picture closes it too.
	await page.click(img);
	await sees("[data-slot=dialog-content][role=dialog] img");
	await page.mouse.click(5, 5);
	await page.waitForFunction(() => !document.querySelector("[data-slot=dialog-content]"));
	// From the keyboard: Enter on the focused picture opens it, and Escape gives focus back to it.
	await page.focus(img);
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content][role=dialog] img");
	await page.keyboard.press("Escape");
	await page.waitForFunction(() => !document.querySelector("[data-slot=dialog-content]"));
	assert.equal(await page.evaluate((s: string) => document.activeElement === document.querySelector(s), img), true);
});

test("an approval is asked in a dialog and answered from it, and so is a question", async () => {
	// The owner listed bash under "approve": it asks in every mode.
	await page.fill(".composer textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo hello" } }] }, { tools: [{ name: "question", args: { question: "Which database?", choices: ["the old one", "the new one"] } }] }, { text: "done" }], "run it "));
	await page.keyboard.press("Enter");
	await sees("[data-slot=dialog-content][data-tone=warn]");
	assert.match(await page.textContent("[data-slot=dialog-content][data-tone=warn]"), /Approval needed[\s\S]*echo hello/);
	await shot("03-approval");
	// What is at work is stock Spinner, announced as working: here the line of the turn's work and the
	// line under the conversation, which came one after the other.
	const working = await page.locator("[data-slot=spinner][role=status][aria-label=Working]").count();
	assert.ok(working >= 2, `${working} spinners at work`);
	assert.equal(await page.$$eval(".spinner", (els: Element[]) => els.length), 0);
	await page.locator("[data-slot=dialog-content][data-tone=warn]").getByRole("button", { name: /^Allow/ }).click();
	await sees('[data-item="approval"][data-state="allowed"]');
	// Then the agent asks something: the answers it offers, the recommended one first.
	await sees("[data-slot=dialog-content][data-tone=accent]");
	assert.match(await page.textContent("[data-slot=dialog-content][data-tone=accent]"), /Which database\?[\s\S]*the old one[\s\S]*the new one/);
	await shot("03-question");
	await page.keyboard.press("2");
	await sees('[data-item="approval"][data-state="allowed"] >> text=Answered');
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees(".md >> text=done");
});

test("what is asked is answered from the conversation too: an approval by its buttons, a question by one of its answers", async () => {
	await page.fill(".composer textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo again" } }] }, { tools: [{ name: "question", args: { question: "Which colour?", choices: ["green", "blue"] } }] }, { text: "answered from the line" }], "ask in line "));
	await page.keyboard.press("Enter");
	// The dialog is put off ("Later"); the request stays in the conversation, with what it is and why.
	await sees("[data-slot=dialog-content][data-tone=warn]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	const asked = '[data-item="approval"][data-state="open"] [data-slot="item"]';
	await sees(`${asked} >> text=Approval needed`);
	assert.match(await page.textContent(asked), /echo again/);
	await shot("03-confirmation");
	await page.click(`${asked} button:has-text("Allow once")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=Allowed');
	// The question offers its answers as suggestions; one click answers.
	await sees("[data-slot=dialog-content][data-tone=accent]");
	await page.keyboard.press("Escape");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees(`${asked} >> text=Which colour?`);
	await page.click(`${asked} button:has-text("blue")`);
	await sees('[data-item="approval"][data-state="allowed"] >> text=Answered');
	await sees(".md >> text=answered from the line");
});

test("a folder is opened for a conversation: changes, and a file edited and saved", async () => {
	// As the system does it when a folder is dropped on the app's icon.
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	// With several agents the app asks whose folder it is; the one in front is offered first.
	await sees("[data-slot=dialog-title] >> text=Which agent works in");
	await page.keyboard.press("Enter");
	await sees(".tab.on .name >> text=pine-desktop-folder");
	await page.click(".conv-head button[aria-label*='workspace']");
	// The panel begins with the agent: who it is and what it runs on.
	await sees(".agent-view .agent-name >> text=main");
	assert.match(await page.textContent(".agent-view"), /it administers pine[\s\S]*mock\/m[\s\S]*hands work to scout/);
	// The panel is as wide as it is dragged, by the edge before it, and the keyboard moves that edge too.
	const was = await page.$eval(".code", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(CODE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 - 60, 300, { steps: 4 });
	await page.mouse.up();
	assert.equal(await page.$eval(".code", (el: Element) => el.getBoundingClientRect().width), was + 60);
	await page.focus(`${CODE_EDGE}[role='separator']`);
	await page.keyboard.press("ArrowLeft");
	await page.waitForFunction((w) => document.querySelector(".code")!.getBoundingClientRect().width > w, was + 60);
	// Loaded again, it is as wide as it was left (to the pixel).
	const wide = Math.round(await page.$eval(".code", (el: Element) => el.getBoundingClientRect().width));
	await page.reload();
	await sees(".tab.on .name >> text=pine-desktop-folder");
	if (!(await page.$(".code"))) await page.click(".conv-head button[aria-label*='workspace']");
	await sees(".code");
	assert.equal(Math.round(await page.$eval(".code", (el: Element) => el.getBoundingClientRect().width)), wide);
	// However narrow the panel is, the names of its views stay whole on one line.
	// (On one line: no taller than the control's own height, 32 pixels.)
	assert.ok((await page.$eval(".code [data-slot=tabs-trigger] >> text=Last turn", (b: Element) => b.getBoundingClientRect().height)) <= 32);
	await page.locator(".code").getByRole("tab", { name: "Changes" }).click();
	// Its views are a tab list: the arrow keys move the choice, as in any segmented control.
	await page.keyboard.press("ArrowLeft");
	await sees(".code [role=tab][aria-selected=true] >> text=Files");
	await page.keyboard.press("ArrowRight");
	await sees(".code [role=tab][aria-selected=true] >> text=Changes");
	await sees(".code .frow");
	assert.match(await page.textContent(".code .frow"), /index\.ts/);
	await page.click(".code .frow");
	await sees(".diff .add");
	assert.match(await page.textContent(".diff .add"), /answer = 42/);
	await shot("04-changes");
	// The editor: change the file and save it through the daemon.
	await page.locator(".code-sub").getByRole("button", { name: "Edit" }).click();
	await sees(".editor .cm-content");
	await page.click(".editor .cm-content");
	await page.keyboard.press("Meta+A");
	await page.keyboard.type("export const answer = 43;\n");
	await page.keyboard.press("Meta+S");
	for (let i = 0; i < 50 && !fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8").includes("43"); i++) await new Promise((r) => setTimeout(r, 100));
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n");
	await shot("05-editor");
	// Leaving what was typed and not saved is asked in the app: staying keeps it, leaving drops it.
	await page.keyboard.type("// draft");
	await page.click(".code-sub button[aria-label='Back to the files']");
	await sees("[role=alertdialog] >> text=without saving");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Cancel" }).click();
	await page.waitForFunction(() => !document.querySelector("[role=alertdialog]"));
	assert.ok(await page.$(".editor .cm-content"));
	await page.click(".code-sub button[aria-label='Back to the files']");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Leave" }).click();
	await page.waitForFunction(() => !document.querySelector(".editor"));
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n");
});

const focused = () =>
	page.evaluate(() => {
		const el = document.activeElement as HTMLElement;
		return { role: el.getAttribute("role"), expanded: el.getAttribute("aria-expanded"), text: (el.querySelector("[data-slot=tree-label]") ?? el).textContent ?? "" };
	});

test("a file is opened from the panel's tree, its changes and its search with the keyboard alone", async () => {
	if (!(await page.$(".code"))) await page.click(".conv-head button[aria-label*='workspace']");
	// The test before left a file open in the editor.
	if (await page.$(".editor")) await page.click(".code-sub button[aria-label='Back to the files']");
	await page.locator(".code").getByRole("tab", { name: "Files" }).click();
	await sees(".code [role=tree] [role=treeitem]");
	// From the find field, Tab reaches the tree after the refresh button: one stop.
	await page.focus(".code-sub input");
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	assert.equal((await focused()).role, "treeitem");
	// Typing finds the folder, the right arrow opens it and goes in, Enter opens the file.
	await page.keyboard.type("src");
	assert.deepEqual([(await focused()).text.trim(), (await focused()).expanded], ["src", "false"]);
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "true");
	await sees(".code [role=treeitem] >> text=index.ts");
	await page.keyboard.press("ArrowRight");
	assert.match((await focused()).text, /index\.ts/);
	await page.keyboard.press("ArrowLeft");
	assert.deepEqual([(await focused()).text.trim(), (await focused()).expanded], ["src", "true"]);
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("Enter");
	await sees(".editor .cm-content");
	assert.match(await page.textContent(".editor .cm-content"), /answer = 43/);
	await page.click(".code-sub button[aria-label='Back to the files']");
	// The file search's results are a list: Tab reaches it, Enter opens one.
	await page.fill(".code-sub input", "index");
	await sees(".code [role=listbox] [role=option] >> text=src/index.ts");
	await page.focus(".code-sub input");
	await page.keyboard.press("Tab");
	await page.keyboard.press("Tab");
	assert.equal((await focused()).role, "option");
	await page.keyboard.press("Enter");
	await sees(".editor .cm-content");
	await page.click(".code-sub button[aria-label='Back to the files']");
	await page.fill(".code-sub input", "");
	// So are the changes: Tab from the refresh button, Enter opens the diff.
	await page.locator(".code").getByRole("tab", { name: "Changes" }).click();
	await sees(".code [role=listbox] [role=option]");
	await page.focus(".code-sub button[aria-label='Read again']");
	await page.keyboard.press("Tab");
	assert.equal((await focused()).role, "option");
	await page.keyboard.press("Enter");
	await sees(".diff");
	await page.click(".code-sub button[aria-label='Back to the list']");
	await page.locator(".code").getByRole("tab", { name: "Files" }).click();
});

/** The composer's field, and the suggestion it marks active, as a screen reader hears them. */
const composerState = () =>
	page.evaluate(() => {
		const field = document.querySelector(".composer textarea") as HTMLTextAreaElement;
		const id = field.getAttribute("aria-activedescendant");
		const option = id ? document.getElementById(id) : null;
		return { focused: document.activeElement === field, value: field.value, controls: Boolean(field.getAttribute("aria-controls")), option: option?.getAttribute("role"), text: option?.textContent ?? "" };
	});
const suggestion = "[role=listbox] [role=option][data-slot=combobox-item]";

test("a command is picked from the composer's suggestions with the arrows and Enter, and the input keeps focus", async () => {
	const area = ".composer textarea";
	await page.fill(area, "");
	await page.focus(area);
	await page.keyboard.type("/");
	await sees(suggestion);
	const names = await page.$$eval(`${suggestion} [data-part=label]`, (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(names.length > 2, JSON.stringify(names));
	// Arrows move the highlight, announced on the field, and focus stays in it.
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	let at = await composerState();
	assert.deepEqual([at.focused, at.controls, at.option], [true, true, "option"], JSON.stringify(at));
	assert.equal(at.text.split(" ")[0], names[1].split(" ")[0]);
	await page.keyboard.press("Enter");
	await page.waitForSelector(suggestion, { state: "detached" });
	at = await composerState();
	assert.equal(at.value, `${names[1].split(" ")[0]} `);
	assert.equal(at.focused, true);
	// Escape dismisses the list and keeps the text.
	await page.fill(area, "");
	await page.keyboard.type("/");
	await sees(suggestion);
	await page.keyboard.press("Escape");
	await page.waitForSelector(suggestion, { state: "detached" });
	assert.equal((await composerState()).value, "/");
	// A command typed out whole is run by Enter, not picked again.
	await page.fill(area, "");
	await page.keyboard.type("/copy");
	await sees(suggestion);
	await page.keyboard.press("Enter");
	await page.waitForSelector(suggestion, { state: "detached" });
	assert.equal((await composerState()).value, "");
});

test("a file of the conversation's folder is mentioned with @, picked from the suggestions", async () => {
	const area = ".composer textarea";
	await page.fill(area, "");
	await page.focus(area);
	await page.keyboard.type("look at @indx");
	await sees(`${suggestion} >> text=src/index.ts`);
	// Escape closes the list and keeps the text; typing on brings it back, and a click picks.
	await page.keyboard.press("Escape");
	await page.waitForSelector(suggestion, { state: "detached" });
	assert.equal((await composerState()).value, "look at @indx");
	await page.keyboard.type(".");
	await sees(`${suggestion} >> text=src/index.ts`);
	await page.locator("[role=listbox]").getByRole("option", { name: "src/index.ts" }).click();
	await page.waitForSelector(suggestion, { state: "detached" });
	let at = await composerState();
	assert.deepEqual([at.value, at.focused], ["look at @src/index.ts ", true], JSON.stringify(at));
	// Tab picks the highlighted one too.
	await page.keyboard.type("and @indx");
	await sees(`${suggestion} >> text=src/index.ts`);
	await page.keyboard.press("Tab");
	await page.waitForSelector(suggestion, { state: "detached" });
	at = await composerState();
	assert.deepEqual([at.value, at.focused], ["look at @src/index.ts and @src/index.ts ", true], JSON.stringify(at));
	await page.fill(area, "");
});

test("settings: a setting is changed, an agent made, a schedule added, a provider signed in to, a skill and a source added", async () => {
	await menu("settings");
	await sees(".set-in h1 >> text=General");
	// The settings are a tab like any other, beside the conversations.
	assert.equal(await page.textContent(".tab.on .name"), "Settings");
	assert.ok((await page.$$eval(".tab", (els: Element[]) => els.length)) >= 3);
	await sees(".item .mono >> text=limits.maxDownloadMb");
	// A setting is called by a few words; its key stands beside them. What only tunes pine is not on the page.
	assert.match(await page.locator(".item", { has: page.locator(".mono", { hasText: /^limits\.maxDownloadMb$/ }) }).locator(".name").textContent(), /^Largest download/);
	assert.doesNotMatch(await page.textContent(".set-page"), /warmSlots|slotPages|catalogue|maxDelegationDepth/);
	await shot("06-settings-general");
	// A setting of pine's: checked by the daemon, written into pine.json, in force at once.
	const limit = page.locator(".item", { has: page.locator(".mono", { hasText: /^limits\.maxDownloadMb$/ }) }).locator(".ctl input");
	await limit.fill("123");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast]")].some((t) => /limits\.maxDownloadMb is now 123/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// One that cannot be is refused, and the file stays as it is.
	await limit.fill("0");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll("[data-slot=toast][data-type=error]")].some((t) => /whole number from 1/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// A setting chosen from a list is chosen with the keyboard alone: Escape closes the list and gives
	// focus back to it, Enter opens it, the arrows move, Enter chooses.
	const reasoning = page.locator(".item", { has: page.locator(".mono", { hasText: /^defaults\.thinking$/ }) }).locator("[role=combobox]");
	const list = "[data-slot=select-content][data-open]";
	await reasoning.focus();
	await page.keyboard.press("Enter");
	await sees(`${list} [role=option][data-highlighted]`);
	await page.keyboard.press("Escape");
	await page.waitForSelector(list, { state: "detached" });
	assert.equal(await reasoning.evaluate((el: Element) => el === document.activeElement), true);
	await page.keyboard.press("Enter");
	await sees(`${list} [role=option][data-highlighted]`);
	const before = await page.textContent(`${list} [role=option][data-highlighted]`);
	await page.keyboard.press(before?.trim() === "off" ? "ArrowDown" : "Home");
	const chosen = (await page.textContent(`${list} [role=option][data-highlighted]`))?.trim();
	assert.notEqual(chosen, before?.trim());
	await page.keyboard.press("Enter");
	await page.waitForFunction((v) => [...document.querySelectorAll("[data-slot=toast]")].some((t) => t.textContent?.includes(`defaults.thinking is now ${v}`)), chosen);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.thinking, chosen);
	assert.equal(await reasoning.evaluate((el: Element) => el === document.activeElement), true);
	// Agents: make one.
	await page.click(".set-nav .side-row >> text=Agents");
	await page.locator(".set-in").getByRole("button", { name: "New agent" }).click();
	await page.fill("[data-slot=dialog-content] input.mono", "books");
	await page.fill("[data-slot=dialog-content] [data-slot=field]:nth-of-type(2) input", "Keeps the books");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Create agent" }).click();
	await sees(".set-in h1 >> text=books");
	assert.ok(fs.existsSync(path.join(home, "agents", "books", "agent.json")));
	// It is in the side bar at once, with the others.
	assert.deepEqual(await page.$$eval(".side-agent .who > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim())), ["main", "scout", "books"]);
	await shot("07-settings-agent");
	// Events: a schedule.
	await page.click(".set-nav .side-row >> text=Events");
	await page.locator(".set-in").getByRole("tab", { name: "Schedules" }).click();
	await page.fill("input[placeholder='morning']", "morning");
	await page.fill(".form [data-slot=field]:nth-of-type(4) input", "0 7 * * *");
	await page.fill(".form textarea", "Say good morning.");
	await page.locator(".set-in").getByRole("button", { name: "Add schedule" }).click();
	await sees(".item .name >> text=morning");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"morning"/);
	await shot("08-settings-schedules");
	// Models: sign in to a provider with a key. It is typed into a field of its own and not shown.
	await page.click(".set-nav .side-row >> text=Models");
	await page.locator(".set-in h2").getByRole("button", { name: /Show all/ }).click();
	const row = page.locator(".item", { has: page.locator(".tag.mono", { hasText: /^opencode$/ }) }).first();
	await row.getByRole("button", { name: "API key" }).click();
	await sees("[data-slot=dialog-content] input[type=password]");
	await page.fill("[data-slot=dialog-content] input[type=password]", "sk-test-not-a-real-key-0123456789");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Continue" }).click();
	await sees("[data-slot=dialog-content] .notice.plain");
	assert.doesNotMatch(await page.textContent("[data-slot=dialog-content]"), /sk-test-not-a-real-key/);
	await shot("09-settings-sign-in");
	assert.match(fs.readFileSync(path.join(home, "auth.json"), "utf8"), /opencode/);
	// A sign-in changes no agent's model, so the dialog offers the new ones for all agents.
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Choose the model your agents run on" }).click();
	await sees("[data-slot=dialog-title] >> text=Model for every agent that has none of its own");
	const offered = await page.$$eval("[data-slot=command-item] .label", (els: Element[]) => els.map((e) => e.textContent ?? ""));
	assert.ok(offered.length > 0 && offered.every((m) => m.startsWith("opencode/")), JSON.stringify(offered.slice(0, 5)));
	await page.click("[data-slot=command-item] >> nth=0");
	await sees(`[data-slot=toast] >> text=Your agents now run on ${offered[0]}`);
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.model, offered[0]);
	await sees(`.item.fallback-model .name >> text=${offered[0]}`);
	// Signed out again, that model cannot answer: the page says so for each agent it leaves without
	// one, and so does the welcome of such an agent's conversation, with the way to this page.
	const signedIn = page.locator(".item", { has: page.locator(".tag.mono", { hasText: /^opencode$/ }) }).first();
	await signedIn.getByRole("button", { name: "Sign out" }).click();
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=/^Sign out of /");
	await page.locator("[role=alertdialog]").getByRole("button", { name: "Sign out" }).click();
	await sees(".set-group .notice >> text=/main cannot answer: .* needs a sign-in to opencode/");
	await page.click(".tab:has-text('pine-desktop-folder')");
	await sees(".welcome .notice >> text=/needs a sign-in to opencode/");
	await shot("09-no-model");
	await page.locator(".welcome .notice").getByRole("button", { name: "Models" }).click();
	await sees(".set-in h1 >> text=Models");
	// "Change" offers every model that can be used now.
	await page.locator(".item.fallback-model").getByRole("button", { name: "Change" }).click();
	await sees("[data-slot=dialog-title] >> text=Model for every agent that has none of its own");
	await page.getByRole("option", { name: "mock/m" }).click();
	await sees("[data-slot=toast] >> text=Your agents now run on mock/m");
	await page.waitForSelector(".set-group .notice", { state: "detached" });
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).defaults.model, "mock/m");
	// MCP servers: a remote one is added, pine says whether it connects, and "Sign in" runs pi's own
	// sign-in for it (which for a server that wants none says so; a browser opens only where one is needed).
	const remote = await httpMcp({});
	try {
		await page.click(".set-nav .side-row >> text=MCP servers");
		await page.fill("input[placeholder='home_link']", "notes");
		await page.fill("input[placeholder='https://mcp.example.com/mcp']", remote.url);
		await page.locator(".set-in").getByRole("button", { name: "Add server" }).click();
		const server = page.locator(".item", { has: page.locator(".name", { hasText: /^notes/ }) });
		await server.waitFor({ timeout: 15_000 });
		await page.waitForFunction(() => /connected, 1 tool/.test(document.querySelector(".set-in .set-group")?.textContent ?? ""), undefined, { timeout: 30_000 });
		await server.getByRole("button", { name: "Sign in" }).click();
		await sees("pre.log >> text=/signed in to MCP server .notes./i", 40_000);
		await shot("09-settings-mcp-sign-in");
		assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
		// And taken out again: the file is as it was.
		await server.getByRole("button", { name: "Remove" }).click();
		await sees("[role=alertdialog] >> text=Remove the MCP server notes?");
		// Asked in an alert dialog, announced by its question; Escape closes it onto the button, and nothing is removed.
		assert.equal(await announced("[role=alertdialog]"), "Remove the MCP server notes?");
		await page.locator("[role=alertdialog]").evaluate((el: Element) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
		await shot("09-settings-confirm");
		await page.keyboard.press("Escape");
		await page.waitForSelector("[role=alertdialog]", { state: "detached" });
		assert.equal(await server.locator("[data-slot=alert-dialog-trigger] >> text=Remove").evaluate((b: Element) => b === document.activeElement), true);
		assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
		await server.getByRole("button", { name: "Remove" }).click();
		await sees("[role=alertdialog] >> text=Remove the MCP server notes?");
		await page.locator("[role=alertdialog]").getByRole("button", { name: "Remove" }).click();
		await server.waitFor({ state: "detached", timeout: 15_000 });
		assert.doesNotMatch(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
	} finally {
		await remote.close();
	}
	// Skills: one is written down for all agents.
	await page.click(".set-nav .side-row >> text=Skills");
	await page.locator(".set-in").getByRole("button", { name: "New skill" }).click();
	await page.fill("input[placeholder='invoices']", "invoices");
	await page.fill(".form textarea", "File an invoice. Use when a bill arrives.");
	await page.click(".editor .cm-content");
	await page.keyboard.type("1. Read the bill.");
	await page.locator(".set-in").getByRole("button", { name: "Save skill" }).click();
	await sees(".item .name >> text=invoices");
	assert.match(fs.readFileSync(path.join(home, "skills", "invoices", "SKILL.md"), "utf8"), /Read the bill/);
	// Events: a folder to watch, set up from the type's own options.
	await page.click(".set-nav .side-row >> text=Events");
	await page.locator(".set-in").getByRole("button", { name: "New source" }).click();
	await page.fill("[data-slot=dialog-content] input[placeholder='scans']", "scans");
	await page.locator("[data-slot=dialog-content]").getByRole("combobox", { name: "Type", exact: true }).click();
	await page.getByRole("option", { name: /^folder:/ }).click();
	// Chosen with a click, the list closes and stays closed.
	await page.waitForSelector("[data-slot=select-content][data-open]", { state: "detached" });
	const watched = path.join(folder, "scans");
	fs.mkdirSync(watched, { recursive: true });
	await page.locator("[data-slot=dialog-content] [data-slot=field]", { has: page.locator("[data-slot=field-label]", { hasText: /^dir/ }) }).locator("input").fill(watched);
	await shot("09-settings-new-source");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Continue" }).click();
	await sees("[data-slot=dialog-content] >> text=will:");
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Add source" }).click();
	await sees(".item .name >> text=scans");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"scans"/);
	await shot("09-settings-sources");
	for (const [nav, title] of [["Models", "Models"], ["MCP servers", "MCP servers"], ["Skills", "Skills"], ["Instructions", "Instructions"], ["App", "App"]]) {
		await page.click(`.set-nav .side-row >> text=${nav}`);
		await sees(`.set-in h1 >> text=${title}`);
		await page.waitForTimeout(400);
		await shot(`09-settings-${nav.toLowerCase().replace(/\s+/g, "-")}`);
	}
	// App: the browser of the web tools is still not there, and can be fetched from here. (The
	// test fetches nothing: PINE_SKIP_DOWNLOADS. What the command printed is shown.)
	await sees(".item.browser .tag.warn >> text=not on this Mac");
	await page.locator(".item.browser").getByRole("button", { name: "Fetch it" }).click();
	await sees(".item.browser pre.log >> text=Not fetched: PINE_SKIP_DOWNLOADS is set.");
	// Fetched some other way (a terminal): the page says so when it is opened again.
	const { browserPlaces } = await import("../../src/browser-build.ts");
	const places = (await browserPlaces()) ?? [];
	for (const place of places) write(path.join(browsers, path.basename(place), "INSTALLATION_COMPLETE"), "");
	await page.click(".set-nav .side-row >> text=Models");
	await page.click(".set-nav .side-row >> text=App");
	await sees(".item.browser .tag.good >> text=on this Mac");
	await menu("settings");
});

test("the appearance setting puts the page in dark or light, and System follows the system", async () => {
	// The driver forces light on every page; here the app's own setting has to decide, as it does
	// for the owner (Electron's native theme drives the page's prefers-color-scheme).
	await page.emulateMedia({ colorScheme: null });
	const dark = () => page.evaluate(() => document.documentElement.classList.contains("dark"));
	const appearance = (label: string) => page.click(`.item:has(.name:text-is("Appearance")) [data-slot=toggle-group-item]:text-is("${label}")`);
	const waitDark = (want: boolean) => page.waitForFunction((w) => document.documentElement.classList.contains("dark") === w, want);
	try {
		await menu("settings");
		await page.locator(".set-nav").getByRole("button", { name: "App", exact: true }).click();
		await appearance("Dark");
		await waitDark(true);
		// What the stylesheet draws follows the class: the tab in front is poimandres' background, then the light one.
		const tab = () => page.evaluate(() => getComputedStyle(document.querySelector(".tab.on")!).backgroundColor);
		assert.equal(await tab(), "rgb(27, 30, 40)");
		await appearance("Light");
		await waitDark(false);
		assert.equal(await dark(), false);
		assert.equal(await tab(), "rgb(253, 253, 252)");
		// System: whatever the system says, the class says the same.
		await appearance("System");
		await page.emulateMedia({ colorScheme: "dark" });
		await waitDark(true);
		await page.emulateMedia({ colorScheme: "light" });
		await waitDark(false);
		await menu("settings");
	} finally {
		await page.emulateMedia({ colorScheme: process.env.PINE_DESKTOP_THEME === "dark" ? "dark" : "light" });
	}
});

test("the side bar is the agents: one made elsewhere appears, a group folds away, and what is new says for whom", async () => {
	// An agent that another hand makes (the main agent, a `pine agent add`): asked of the daemon directly, not through the app.
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const made = await fetch(`http://127.0.0.1:${port}/agents`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "test", description: "Made outside the app", instructions: "You are test." }) });
	assert.equal(made.status, 200);
	await sees(".side-agent .who >> text=test", 20_000);
	assert.match((await page.locator(".side-agent", { has: page.locator(".who > :first-child", { hasText: /^test$/ }) }).textContent()) ?? "", /Made outside the app/);
	// Beside a conversation, the panel's Agent view says what the agent has been given: here what was set up for all agents above.
	await page.click(".tab >> nth=0");
	if (!(await page.$(".code"))) await page.click(".conv-head button[aria-label*='workspace']");
	await page.locator(".code").getByRole("tab", { name: "Agent" }).click();
	await sees(".agent-view .agent-line .name >> text=invoices");
	await sees(".agent-view .agent-line .name >> text=morning");
	assert.match(await page.textContent(".agent-view"), /Nothing wakes it by itself\. 1 event source could/);
	await shot("14-agent-view");
	// On an agent's line, its initial stands beside its name, not half-way down to its description.
	const line = await page.$eval(".side-agent", (el: Element) => ({ avatar: el.querySelector(".avatar")!.getBoundingClientRect(), name: el.querySelector(".who > :first-child")!.getBoundingClientRect() }));
	assert.ok(Math.abs(line.avatar.y + line.avatar.height / 2 - (line.name.y + line.name.height / 2)) <= 2, JSON.stringify(line));
	// A conversation's name begins where its agent's name begins, whatever leads its row.
	const under = await page.$$eval(".side-group", (groups: Element[]) => groups.map((g) => ({ agent: g.querySelector(".side-agent .who > :first-child")!.getBoundingClientRect().left, names: [...g.querySelectorAll(".side-conv .cut")].map((c) => c.getBoundingClientRect().left) })));
	assert.ok(under.some((g: any) => g.names.length));
	for (const g of under) for (const left of g.names) assert.equal(left, g.agent, `a conversation's name is not under its agent's: ${JSON.stringify(under)}`);
	// What the agent is for stands on that line too, after the name and on the line its letters stand on.
	const one = await page.$eval(".side-agent", (el: Element) => {
		const stands = (node: Element) => {
			const range = document.createRange();
			range.selectNodeContents(node);
			const box = range.getBoundingClientRect();
			const pen = document.createElement("canvas").getContext("2d")!;
			pen.font = getComputedStyle(node).font;
			return { left: box.left, right: box.right, baseline: box.top + pen.measureText("x").fontBoundingBoxAscent };
		};
		return { name: stands(el.querySelector(".who > :first-child")!), what: stands(el.querySelector(".what > span")!), row: el.getBoundingClientRect().height };
	});
	assert.ok(one.what.left > one.name.right && Math.abs(one.what.baseline - one.name.baseline) <= 0.75, `an agent's name and what it is for are not on one line: ${JSON.stringify(one)}`);
	assert.equal(one.row, 30, "an agent's line is as high as a conversation's");
	// The side bar is as wide as it is dragged.
	const before = await page.$eval(".sidebar", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(SIDE_EDGE, (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 80, 300, { steps: 4 });
	await page.mouse.up();
	assert.equal(await page.$eval(".sidebar", (el: Element) => el.getBoundingClientRect().width), before + 80);
	// The edge is a separator the keyboard moves too: focused, an arrow key makes the side bar wider.
	await page.focus(`${SIDE_EDGE}[role='separator']`);
	assert.ok(await page.getAttribute(SIDE_EDGE, "aria-valuenow"), "the edge says how far it is");
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction((was) => document.querySelector(".sidebar")!.getBoundingClientRect().width > was, before + 80);
	// Hidden, the side bar is still hidden when the page is loaded again, and shown it is as wide as it was
	// (to the pixel: the edges place panels by fractions of the window, a few hundredths of a pixel apart).
	const wide = Math.round(await page.$eval(".sidebar", (el: Element) => el.getBoundingClientRect().width));
	await menu("sidebar");
	await page.waitForSelector(".sidebar", { state: "detached" });
	await page.reload();
	await sees(".tab.on");
	assert.equal(await page.locator(".sidebar").count(), 0);
	await menu("sidebar");
	await sees(".sidebar");
	assert.equal(Math.round(await page.$eval(".sidebar", (el: Element) => el.getBoundingClientRect().width)), wide);
	await page.reload();
	await sees(".sidebar .side-agent");
	// A group folds away on a click on its agent, and comes back.
	const group = page.locator(".side-group", { has: page.locator(".who > :first-child", { hasText: /^scout$/ }) });
	assert.equal(await group.locator(".side-conv").count(), 1);
	await group.locator(".side-agent .who").click();
	assert.equal(await group.locator(".side-conv").count(), 0);
	await group.locator(".side-agent .who").click();
	assert.equal(await group.locator(".side-conv").count(), 1);
	// The plus on an agent's own line starts a conversation with that agent.
	await group.locator(".side-agent button[aria-label='New conversation with scout']").click();
	await sees(".tab.on .name >> text=scout");
	assert.equal(await page.textContent(".welcome h1"), "scout");
	assert.match(await page.textContent(".welcome"), /Looks things up on the web/);
	await shot("14-agents");
	// A conversation that was only started is called by how it began, in the side bar and on its tab.
	assert.match(await page.textContent(".tab.on .name"), /new conversation/);
	await page.fill(".composer textarea", "where is the okapi invoice");
	await page.keyboard.press("Enter");
	await sees(".md >> text=ECHO[where is the okapi invoice]");
	await sees(".tab.on .name >> text=where is the okapi invoice", 15_000);
	assert.equal(await group.locator(".side-conv >> text=where is the okapi invoice").count(), 1);
	await page.click(".tab.on .close");
	// Search finds a conversation by what was said in it, and opens it with the words marked.
	await menu("palette");
	await sees("[data-slot=command-input]");
	// By words that are only in an answer of the agent's, never in a name:
	await page.keyboard.type("echo[where");
	await sees("[cmdk-group-heading] >> text=Said in conversations");
	assert.match(await page.textContent("[data-slot=command-list]"), /scout · where is the okapi invoice[\s\S]*ECHO\[where is the okapi invoice\]/);
	await shot("15-search");
	// By words that are also its name, it is listed once, and still opens at the words.
	await page.fill("[data-slot=command-input]", "okapi invoice");
	await page.waitForFunction(() => document.querySelectorAll("[data-slot=command-item]").length > 0 && [...document.querySelectorAll("[data-slot=command-item] .label")].filter((e) => /where is the okapi invoice/.test(e.textContent ?? "")).length === 1);
	await page.click("[data-slot=command-item]:has-text('scout · where is the okapi invoice')");
	await sees(".tab.on .name >> text=where is the okapi invoice");
	await sees(".find >> text=/\\d+ of \\d+/");
	assert.equal(await page.inputValue(".find input"), "okapi invoice");
	await page.keyboard.press("Escape");
	await page.click(".tab.on .close");
	// Asked from where no agent is in front (the event log), a new conversation asks with whom.
	await menu("events");
	await sees(".tab.on .name >> text=Events");
	await menu("new");
	await sees("[data-slot=dialog-title] >> text=New conversation with");
	assert.deepEqual(await page.$$eval("[data-slot=command-item] .label", (els: Element[]) => els.map((e) => e.textContent)), ["main", "scout", "books", "test"]);
	await page.keyboard.press("Escape");
	await page.click(".tab.on .close");
});

test("a conversation is opened from the side bar with the keyboard alone, and a group folds from it", async () => {
	const group = page.locator(".side-group", { has: page.locator(".who > :first-child", { hasText: /^scout$/ }) });
	const fold = group.locator("[data-slot=collapsible-trigger]");
	await fold.focus();
	assert.equal(await fold.getAttribute("aria-expanded"), "true");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "false");
	assert.equal(await group.locator(".side-conv").count(), 0);
	await page.keyboard.press("Space");
	await page.waitForFunction(() => document.activeElement?.getAttribute("aria-expanded") === "true");
	assert.ok((await group.locator(".side-conv").count()) > 0);
	// Its conversations are one stop after the agent's plus: Tab goes in, the arrows move, Enter opens.
	await page.keyboard.press("Tab");
	assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "New conversation with scout");
	await page.keyboard.press("Tab");
	const at = () => page.evaluate(() => ({ role: document.activeElement?.getAttribute("role"), text: document.activeElement?.textContent ?? "" }));
	assert.equal((await at()).role, "option");
	for (let i = 0; i < 6 && !/where is the okapi invoice/.test((await at()).text); i++) await page.keyboard.press("ArrowDown");
	assert.match((await at()).text, /where is the okapi invoice/);
	await page.keyboard.press("Enter");
	await sees(".tab.on .name >> text=where is the okapi invoice");
	await page.click(".tab.on .close");
});

test("a right click on an agent offers to remove it, and never the main agent", async () => {
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(home, "data", "pine.log"), "utf8"))![1];
	const token = fs.readFileSync(path.join(home, "data", "http-token"), "utf8").trim();
	const made = await fetch(`http://127.0.0.1:${port}/agents`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ id: "spare", description: "Not needed for long", instructions: "You are spare." }) });
	assert.equal(made.status, 200);
	await sees(".side-agent .who >> text=spare", 20_000);
	// The menu is the system's, which the driver cannot click in: what it would show is noted, and the test says what is picked.
	await app.evaluate(({ ipcMain }: any) => {
		const g = globalThis as any;
		g.menus = [];
		ipcMain.removeHandler("pine:context-menu");
		ipcMain.handle("pine:context-menu", (_e: unknown, items: Array<{ id: string; label: string; separator?: boolean }>) => {
			g.menus.push(items.filter((i) => !i.separator).map((i) => i.label));
			return g.pick;
		});
	});
	const shown = async (agent: string, pick?: string): Promise<string[]> => {
		const before = await app.evaluate((_e: unknown, p: string | undefined) => (((globalThis as any).pick = p), (globalThis as any).menus.length), pick);
		await page.locator(".side-agent", { has: page.locator(".who > :first-child", { hasText: new RegExp(`^${agent}$`) }) }).click({ button: "right" });
		for (let i = 0; i < 100; i++) {
			const menus = await app.evaluate(() => (globalThis as any).menus);
			if (menus.length > before) return menus.at(-1);
			await new Promise((r) => setTimeout(r, 30));
		}
		throw new Error(`no menu for ${agent}`);
	};
	// Folding is a click on the line and no menu item; the main agent has nothing to remove it with.
	assert.deepEqual(await shown("main"), ["New conversation with main", "Open a folder with main…", "Agent settings…"]);
	assert.deepEqual(await shown("spare", "remove"), ["New conversation with spare", "Open a folder with spare…", "Agent settings…", "Remove spare…"]);
	// It asks first, and how: nothing is removed by the menu alone.
	// It is an alert dialog: it does not go away with a stray click beside it.
	await sees("[role=alertdialog] [data-slot=alert-dialog-title] >> text=Remove the agent spare?");
	await page.mouse.click(5, 5);
	await sees("[role=alertdialog]");
	assert.ok(fs.existsSync(path.join(home, "agents", "spare", "agent.json")));
	await page.click("[data-slot=command-item]:has-text('Remove it with everything it has')");
	await sees("[data-slot=toast] >> text=Removed the agent spare.");
	await page.waitForFunction(() => ![...document.querySelectorAll(".side-agent .who > :first-child")].some((e) => e.textContent?.trim() === "spare"));
	assert.equal(fs.existsSync(path.join(home, "agents", "spare")), false);
	// Asked for the main agent all the same (the palette, another road), the app says no and asks the daemon for nothing.
	await page.evaluate(() => (window as any).pine.call("POST", "/agents/main/erase", { agent: "main", keepFiles: false })).then((r: any) => assert.equal(r.ok, false));
	assert.ok(fs.existsSync(path.join(home, "agents", "main", "agent.json")));
});

test("a conversation is opened from the palette with the keyboard alone", async () => {
	await menu("palette");
	await sees("[data-slot=dialog-content] [role=listbox]");
	assert.equal((await activeOption()).role, "combobox");
	assert.equal(await announced("[data-slot=dialog-content]"), "Search everything");
	await page.keyboard.press("Tab");
	await stillInside();
	await page.keyboard.press("Shift+Tab");
	await stillInside();
	assert.equal((await activeOption()).role, "combobox");
	await page.keyboard.type("where is the okapi");
	// Its results keep their group headers.
	await sees("[cmdk-group-heading] >> text=Conversations");
	await sees("[role=option] >> text=scout · where is the okapi invoice");
	await page.keyboard.press("ArrowDown");
	await page.keyboard.press("ArrowUp");
	const at = await activeOption();
	assert.deepEqual([at.option, at.selected, at.list], ["option", "true", true], JSON.stringify(at));
	assert.match(at.text, /scout · where is the okapi invoice/);
	await page.keyboard.press("Enter");
	await page.waitForSelector("[data-slot=dialog-content]", { state: "detached" });
	await sees(".tab.on .name >> text=where is the okapi invoice");
	await page.keyboard.press("Escape");
	await page.click(".tab.on .close");
});

test("the palette finds things by name, and the event log follows", async () => {
	// The pointer rests where the list will open: the first line is still the one that enter takes.
	await page.mouse.move(640, 320);
	await menu("palette");
	await sees("[data-slot=command-input]");
	await page.keyboard.type("event log");
	await shot("10-palette");
	await page.keyboard.press("Enter");
	await sees(".events-list .ev");
	assert.ok((await page.$$eval(".events-list .ev", (els: Element[]) => els.length)) > 3);
	await shot("11-events");
});

test("a sub-agent's work opens in a tab of its own", async () => {
	await page.click(".tab >> nth=0");
	mock.state.scripts.child = [{ text: "hi from the child" }];
	await page.fill(".composer textarea", mockMsg([{ tools: [{ name: "subagent", args: { tasks: ["@@REF:child@@ say hi"] } }] }, { text: "the sub-agent answered" }], "ask a helper "));
	await page.keyboard.press("Enter");
	await sees(".md >> text=the sub-agent answered");
	await page.click("[data-item=work] > [data-slot=trace-collapsible-trigger] >> nth=-1");
	await sees("[data-part=child] .open-link");
	await page.click("[data-part=child] .open-link >> nth=0");
	await sees(".tab.on .name >> text=#");
	await sees(".md >> text=hi from the child");
	assert.match(await page.textContent(".column"), /sub-agent of main/);
	await shot("12-task");
	await page.click(".tab.on .close");
});

test("the last message is taken back, and its text is in the input again", async () => {
	await page.click(".tab >> nth=0");
	const before = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await menu("undo");
	await sees(".it-note.accent >> text=Taken back");
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), before - 1);
	assert.match(await page.inputValue(".composer textarea"), /^ask a helper /);
	await page.fill(".composer textarea", "");
});

test("a message is branched from: a new conversation with what was said up to it, under the original in the side bar", async () => {
	await page.click(".tab >> nth=0");
	await menu("new");
	await sees(".tab.on .name >> text=new conversation");
	for (const word of ["BRANCH-ONE", "BRANCH-TWO"]) {
		await page.fill(".composer textarea", mockMsg([{ text: `answer to ${word}` }], `${word} `));
		await page.keyboard.press("Enter");
		await sees(`.md >> text=answer to ${word}`);
	}
	const from = await page.textContent(".tab.on .name");
	// The button stands beside a message of the owner's while the pointer is on it.
	await page.hover(".it-user:has-text('BRANCH-ONE')");
	await page.click(".it-user:has-text('BRANCH-ONE') .branch-from button");
	await sees(".toast >> text=from that message");
	await sees(".tab.on .name >> text=· branch");
	assert.ok((await page.textContent(".tab.on .name")).startsWith(`${from!.trim()} · branch`));
	await sees(".md >> text=answer to BRANCH-ONE");
	assert.doesNotMatch(await page.textContent(".column"), /BRANCH-TWO/);
	// In the side bar it is under the conversation it was made from, one step in.
	await page.waitForFunction(() => [...document.querySelectorAll(".side-conv")].some((r) => /a branch of/.test(r.getAttribute("title") ?? "")));
	const rows = await page.$$eval(".side-conv", (els: Element[]) => els.map((e) => ({ title: e.getAttribute("title") ?? "", indent: (e as HTMLElement).style.paddingLeft })));
	const at = rows.findIndex((r) => /a branch of/.test(r.title));
	assert.equal(rows[at].indent, "45px");
	assert.match(rows[at].title, new RegExp(`a branch of ${rows[at - 1].title.split(" · ")[1]}`), JSON.stringify(rows));
	await shot("15-branch");
	// What is said in the branch stays there.
	await page.fill(".composer textarea", mockMsg([{ text: "only in the branch" }], "BRANCH-THREE "));
	await page.keyboard.press("Enter");
	await sees(".md >> text=only in the branch");
	await page.click(".tab.on .close");
	await page.click(".tab.on .close");
	await page.click(".tab >> nth=0");
	await sees(".composer textarea");
});

test("a conversation moves into a worktree of its folder: the chip names the branch, and its work is merged from the panel", async () => {
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	await sees(".pick-title >> text=Which agent works in");
	await page.keyboard.press("Enter");
	await sees(".tab.on .name >> text=pine-desktop-folder");
	await menu("worktree");
	await sees(".pick-title >> text=Work in a worktree?");
	await page.keyboard.press("Enter");
	await sees(".conv-head .chip.worktree >> text=pine/");
	const branch = (await page.textContent(".conv-head .chip.worktree"))!.trim();
	const tree = path.join(folder, ".pine", "worktrees", branch.slice(5));
	assert.ok(fs.existsSync(path.join(tree, "README.md")), "a checkout of its own");
	await sees(".column >> text=now works in the worktree");
	// The side bar says where it works, once something was said in it.
	await page.fill(".composer textarea", mockMsg([{ text: "working apart" }], "APART "));
	await page.keyboard.press("Enter");
	await sees(".md >> text=working apart");
	await page.waitForFunction((b: string) => [...document.querySelectorAll(".side-conv")].some((r) => (r.getAttribute("title") ?? "").includes(`in the worktree ${b}`)), branch);

	// Its work, committed there as an agent would, is merged from the panel into what the folder has checked out.
	fs.writeFileSync(path.join(tree, "WORKTREE.md"), "made apart\n");
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "add", "WORKTREE.md"], { stdio: "ignore" });
	execFileSync("git", ["-C", tree, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "apart"], { stdio: "ignore" });
	await menu("code-changes");
	await page.click(".code .segmented button >> text=Files");
	await page.click(".code .segmented button >> text=Changes");
	await sees(".code-sub >> text=1 ahead of");
	await shot("16-worktree");
	await page.click(".code-sub .btn >> text=Merge…");
	await sees(".pick-title >> text=1 commit ahead of");
	await page.keyboard.press("Enter");
	await sees(".toast >> text=merged into");
	assert.equal(fs.readFileSync(path.join(folder, "WORKTREE.md"), "utf8"), "made apart\n");
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n", "what was not committed in the folder stayed");

	// Discarded once merged: the folder's chip is back.
	await menu("worktree");
	await sees(".pick-title >> text=ahead of");
	await page.keyboard.press("Enter");
	await sees(".conv-head .chip:not(.worktree) >> text=pine-desktop-folder");
	assert.ok(!fs.existsSync(tree));
	await page.click(".tab.on .close");
});

test("dictating puts what is heard into the input and sends nothing", async () => {
	const sent = await page.$$eval("[data-item=user]", (els: Element[]) => els.length);
	await page.fill(".composer textarea", "Typed first:");
	await menu("voice");
	await sees(".banner >> text=listening");
	await page.waitForFunction(() => (document.querySelector(".composer textarea") as HTMLTextAreaElement).value === "Typed first: about the scans", undefined, { timeout: 8000 }).catch(async () => {
		throw new Error(`what was heard is not in the input, which holds: ${JSON.stringify(await page.inputValue(".composer textarea"))}; ${await page.evaluate(() => [...document.querySelectorAll(".banner, [data-slot=toast]")].map((e) => e.textContent).join(" | "))}`);
	});
	// Enter says "that was all": the rest arrives, and the message is still only text in the input.
	await page.focus(".composer textarea");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => (document.querySelector(".composer textarea") as HTMLTextAreaElement).value === "Typed first: about the scans please");
	await page.waitForSelector(".banner >> text=listening", { state: "detached" });
	assert.equal(await page.$$eval("[data-item=user]", (els: Element[]) => els.length), sent);
	await page.fill(".composer textarea", "");
});

test("find marks what is looked for", async () => {
	await menu("find");
	await sees(".find input");
	await page.keyboard.type("first line");
	await sees(".find >> text=/\\d+ of \\d+/");
	assert.ok(await page.evaluate(() => ((CSS as any).highlights.get("pine-find")?.size ?? 0) > 0));
	await shot("13-find");
	await page.keyboard.press("Escape");
	await page.waitForSelector(".find", { state: "detached" });
});

test("many tabs keep their width and scroll instead of stepping on each other", async () => {
	await page.click(".tab >> nth=0");
	const had = await page.locator(".tab").count();
	for (let i = 0; i < 20; i++) {
		await menu("new");
		await page.waitForFunction((n) => document.querySelectorAll(".tab").length === n, had + i + 1);
	}
	const measure = () =>
		page.evaluate(() => {
			const strip = document.querySelector(".tabs [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
			const tabs = [...document.querySelectorAll(".tab")].map((el) => {
				const r = el.getBoundingClientRect();
				// What a tab draws reaches as far as its widest child: a child that does not fit spills over the next tab.
				const right = Math.max(r.right, ...[...el.children].map((c) => c.getBoundingClientRect().right));
				return { left: r.left, right, width: r.width, on: el.classList.contains("on") };
			});
			const plus = document.querySelector("header button[aria-label^='New conversation']")!.getBoundingClientRect();
			return { strip: { left: strip.left, right: strip.right }, tabs, plus: { left: plus.left, right: plus.right }, width: window.innerWidth };
		});
	const m = await measure();
	const gaps = m.tabs.slice(1).map((t: any, i: number) => t.left - m.tabs[i].right);
	assert.ok(Math.min(...gaps) >= 0, `tabs overlap: the smallest gap between two tabs is ${Math.min(...gaps)}px`);
	assert.ok(Math.min(...m.tabs.map((t: any) => t.width)) >= 96, "every tab keeps room for its avatar, a few letters and its close button");
	const on = m.tabs.find((t: any) => t.on);
	assert.ok(on.left >= m.strip.left - 0.5 && on.right <= m.strip.right + 0.5, `the tab in front is in view: ${JSON.stringify({ on, strip: m.strip })}`);
	assert.ok(m.plus.left >= m.strip.right && m.plus.right <= m.width, "the plus stays in view after the tabs");
	// Going back to the first tab scrolls it into view.
	await page.click(".tab >> nth=0");
	await menu("prev-tab");
	await page.waitForFunction(() => {
		const strip = document.querySelector(".tabs [data-slot=scroll-area-viewport]")!.getBoundingClientRect();
		const r = document.querySelector(".tab.on")!.getBoundingClientRect();
		return r.left >= strip.left - 0.5 && r.right <= strip.right + 0.5;
	});
	await shot("many-tabs");
	while ((await page.locator(".tab").count()) > had) await page.click(".tab >> nth=-1 >> .close");
});

test("quitting stops the daemon it started", async () => {
	const log = path.join(home, "data", "pine.log");
	assert.ok(fs.existsSync(log));
	await app.close();
	app = undefined;
	// The daemon wrote its last line and is gone: its control port no longer answers.
	const said = fs.readFileSync(log, "utf8");
	assert.match(said, /pine is up/);
	const port = /http listening on 127\.0\.0\.1:(\d+)/.exec(said)?.[1];
	assert.ok(port);
	let up = true;
	for (let i = 0; i < 100 && up; i++) {
		up = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) }).then((r) => r.ok, () => false);
		if (up) await new Promise((r) => setTimeout(r, 150));
	}
	assert.equal(up, false);
});
