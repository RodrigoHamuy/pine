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
import os from "node:os";
import path from "node:path";
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
		const there = await page.evaluate(() => ({ text: (document.querySelector(".column, .set-in, .events-list, .gate") as HTMLElement | null)?.innerText?.slice(-1500), toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent), dialog: (document.querySelector(".dialog") as HTMLElement | null)?.innerText?.slice(0, 600) }));
		throw new Error(`"${selector}" did not appear. On screen: ${JSON.stringify(there, null, 1)}${pageErrors.length ? `\nErrors in the page:\n${pageErrors.join("\n")}` : ""}`);
	}
}

/** What a menu item does: the menus are the system's, and keys typed into the page do not reach them. */
const menu = (command: string) => app.evaluate(({ BrowserWindow }: any, c: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);

const api = (method: string, url: string, body?: unknown) => page.evaluate(([m, u, b]: [string, string, unknown]) => (window as any).pine.call(m, u, b), [method, url, body]);

before(async () => {
	if (!fs.existsSync(path.join(root, "dist", "index.html")) || !fs.existsSync(path.join(root, "dist-electron", "main.js"))) execFileSync(process.execPath, [path.join(root, "scripts", "build.mjs")], { stdio: "inherit" });
	mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// A port of its own (0: the system picks one), so that a pine the developer has running is left alone.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent: it administers pine", delegates: ["scout"], approve: ["bash"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "main", "workspace", "notes.md"), "# Notes\n\nfirst line\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({ description: "Looks things up on the web" }));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");
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

	// PINE_DESKTOP_THEME=dark|light: the pictures in that appearance, whatever the system is set to.
	if (process.env.PINE_DESKTOP_THEME) write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ theme: process.env.PINE_DESKTOP_THEME }));

	app = await electron.launch({
		// (The driver shows every page in light unless it is told otherwise, whatever the app says.)
		colorScheme: process.env.PINE_DESKTOP_THEME === "dark" ? "dark" : "light",
		args: [root],
		env: { ...process.env, PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_VOICE: voice },
	});
	page = await app.firstWindow();
	page.on("pageerror", (e: Error) => pageErrors.push(String(e.stack ?? e.message).slice(0, 600)));
	page.on("console", (m: any) => m.type() === "error" && pageErrors.push(m.text().slice(0, 600)));
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	for (const dir of [home, folder]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test("starts a daemon of its own and shows the main agent", async () => {
	await sees(".welcome h1");
	assert.equal(await page.textContent(".welcome h1"), "main");
	assert.match(await page.textContent(".side-status"), /started here/);
	const agents = await page.$$eval(".side-agent .who > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim()));
	assert.deepEqual(agents, ["main", "scout"]);
	// The daemon it started is the one of this home, on a port of its own.
	assert.ok(fs.existsSync(path.join(home, "data", "http-token")));
	await shot("01-welcome");
});

test("a message is answered, with the turn's work folded into a line", async () => {
	const steps = [{ tools: [{ name: "read", args: { path: "notes.md" } }], text: "Let me look at the notes first." }, { text: "The notes say **first line**.\n\n```ts\nconst a = 1;\n```\n\n<details><summary>Full file</summary>\n\nfirst line\n\n</details>\n\n[the docs](https://example.com/docs)" }];
	await page.fill(".composer textarea", mockMsg(steps, "What do the notes say? "));
	await page.keyboard.press("Enter");
	await sees(".md strong");
	assert.match(await page.textContent(".md"), /first line/);
	// The work of the turn (what it said on the way, and the tool call) is one line, which a click opens.
	await page.waitForFunction(() => /1 tool call · read/.test(document.querySelector(".work-head")?.textContent ?? ""));
	assert.equal(await page.$(".work .part .tool"), null);
	await page.click(".work-head");
	await sees(".work .part .tool");
	assert.equal(await page.textContent(".work .part .tool"), "read");
	// A link says where it leads, and is not an address the page itself would follow.
	assert.equal(await page.textContent(".md-link"), "the docs");
	assert.match(await page.textContent(".md-link + .md-target"), /example\.com\/docs/);
	assert.equal(await page.getAttribute(".md-link", "href"), null);
	// A folded part is there and closed.
	assert.equal(await page.$eval(".md details", (d: HTMLDetailsElement) => d.open), false);
	assert.ok(await page.$(".md-code .hljs-keyword"));
	await shot("02-answer");
});

test("what an answer points at on the web is not fetched by itself", async () => {
	await page.fill(".composer textarea", mockMsg([{ text: 'Look: ![a cat](https://example.com/cat.png)\n\n<img src="https://example.com/dog.png">\n\n<script>window.hacked = 1</script><a href="javascript:window.hacked=2">x</a>' }], "pictures "));
	await page.keyboard.press("Enter");
	await sees(".md-remote");
	assert.equal(await page.$$eval(".md img", (els: Element[]) => els.length), 0);
	assert.equal(await page.$$eval(".md-remote", (els: Element[]) => els.length), 2);
	assert.equal(await page.evaluate(() => (window as any).hacked), undefined);
	assert.equal(await page.$$eval(".md script, .md a[href]", (els: Element[]) => els.length), 0);
});

test("an approval is asked in a dialog and answered from it, and so is a question", async () => {
	// The owner listed bash under "approve": it asks in every mode.
	await page.fill(".composer textarea", mockMsg([{ tools: [{ name: "bash", args: { command: "echo hello" } }] }, { tools: [{ name: "question", args: { question: "Which database?", choices: ["the old one", "the new one"] } }] }, { text: "done" }], "run it "));
	await page.keyboard.press("Enter");
	await sees(".dialog-warn");
	assert.match(await page.textContent(".dialog-warn"), /Approval needed[\s\S]*echo hello/);
	await shot("03-approval");
	await page.click(".dialog-warn .btn-primary");
	await sees(".it-approval.allowed");
	// Then the agent asks something: the answers it offers, the recommended one first.
	await sees(".dialog-accent");
	assert.match(await page.textContent(".dialog-accent"), /Which database\?[\s\S]*the old one[\s\S]*the new one/);
	await shot("03-question");
	await page.keyboard.press("2");
	await sees(".it-approval.allowed >> text=Answered");
	await page.waitForSelector(".dialog", { state: "detached" });
	await sees(".md >> text=done");
});

test("a folder is opened for a conversation: changes, and a file edited and saved", async () => {
	// As the system does it when a folder is dropped on the app's icon.
	await app.evaluate(({ BrowserWindow }: any, dir: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", `folder:${dir}`), folder);
	// With several agents the app asks whose folder it is; the one in front is offered first.
	await sees(".pick-title >> text=Which agent works in");
	await page.keyboard.press("Enter");
	await sees(".tab.on .name >> text=pine-desktop-folder");
	await page.click(".conv-head .btn[title*='workspace']");
	// The panel begins with the agent: who it is and what it runs on.
	await sees(".agent-view .agent-name >> text=main");
	assert.match(await page.textContent(".agent-view"), /it administers pine[\s\S]*mock\/m[\s\S]*hands work to scout/);
	// However narrow the panel is, the names of its views stay whole on one line.
	assert.ok((await page.$eval(".code .segmented button >> text=Last turn", (b: Element) => b.getBoundingClientRect().height)) <= 26);
	await page.click(".code .segmented button >> text=Changes");
	await sees(".code .frow");
	assert.match(await page.textContent(".code .frow"), /index\.ts/);
	await page.click(".code .frow");
	await sees(".diff .add");
	assert.match(await page.textContent(".diff .add"), /answer = 42/);
	await shot("04-changes");
	// The editor: change the file and save it through the daemon.
	await page.click(".code-sub .btn >> text=Edit");
	await sees(".editor .cm-content");
	await page.click(".editor .cm-content");
	await page.keyboard.press("Meta+A");
	await page.keyboard.type("export const answer = 43;\n");
	await page.keyboard.press("Meta+S");
	for (let i = 0; i < 50 && !fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8").includes("43"); i++) await new Promise((r) => setTimeout(r, 100));
	assert.equal(fs.readFileSync(path.join(folder, "src", "index.ts"), "utf8"), "export const answer = 43;\n");
	await shot("05-editor");
});

test("settings: a setting is changed, an agent made, a schedule added, a provider signed in to, a skill and a source added", async () => {
	await menu("settings");
	await sees(".set-in h1 >> text=General");
	// The settings are a tab like any other, beside the conversations.
	assert.equal(await page.textContent(".tab.on .name"), "Settings");
	assert.ok((await page.$$eval(".tab", (els: Element[]) => els.length)) >= 3);
	await sees(".item .mono >> text=limits.maxDownloadMb");
	await shot("06-settings-general");
	// A setting of pine's: checked by the daemon, written into pine.json, in force at once.
	const limit = page.locator(".item", { has: page.locator(".mono", { hasText: /^limits\.maxDownloadMb$/ }) }).locator(".ctl input");
	await limit.fill("123");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /limits\.maxDownloadMb is now 123/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// One that cannot be is refused, and the file stays as it is.
	await limit.fill("0");
	await limit.press("Enter");
	await page.waitForFunction(() => [...document.querySelectorAll(".toast.bad")].some((t) => /whole number from 1/.test(t.textContent ?? "")));
	assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pine.json"), "utf8")).limits.maxDownloadMb, 123);
	// Agents: make one.
	await page.click(".set-nav .side-row >> text=Agents");
	await page.click(".btn-primary >> text=New agent");
	await page.fill(".dialog input.mono", "books");
	await page.fill(".dialog .field:nth-of-type(2) input", "Keeps the books");
	await page.click(".dialog .btn-primary >> text=Create agent");
	await sees(".set-in h1 >> text=books");
	assert.ok(fs.existsSync(path.join(home, "agents", "books", "agent.json")));
	// It is in the side bar at once, with the others.
	assert.deepEqual(await page.$$eval(".side-agent .who > :first-child", (els: Element[]) => els.map((e) => e.textContent?.trim())), ["main", "scout", "books"]);
	await shot("07-settings-agent");
	// Events: a schedule.
	await page.click(".set-nav .side-row >> text=Events");
	await page.click(".segmented button >> text=Schedules");
	await page.fill("input[placeholder='morning']", "morning");
	await page.fill(".form .field:nth-of-type(4) input", "0 7 * * *");
	await page.fill(".form textarea", "Say good morning.");
	await page.click(".btn-primary >> text=Add schedule");
	await sees(".item .name >> text=morning");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"morning"/);
	await shot("08-settings-schedules");
	// Models: sign in to a provider with a key. It is typed into a field of its own and not shown.
	await page.click(".set-nav .side-row >> text=Models");
	await page.click(".set-in h2 .btn >> text=/Show all/");
	const row = page.locator(".item", { has: page.locator(".tag.mono", { hasText: /^opencode$/ }) }).first();
	await row.locator(".btn >> text=API key").click();
	await sees(".dialog input[type=password]");
	await page.fill(".dialog input[type=password]", "sk-test-not-a-real-key-0123456789");
	await page.click(".dialog .btn-primary >> text=Continue");
	await sees(".dialog .notice.plain");
	assert.doesNotMatch(await page.textContent(".dialog"), /sk-test-not-a-real-key/);
	await shot("09-settings-sign-in");
	await page.click(".dialog-foot .btn >> text=Done");
	assert.match(fs.readFileSync(path.join(home, "auth.json"), "utf8"), /opencode/);
	// MCP servers: a remote one is added, pine says whether it connects, and "Sign in" runs pi's own
	// sign-in for it (which for a server that wants none says so; a browser opens only where one is needed).
	const remote = await httpMcp({});
	try {
		await page.click(".set-nav .side-row >> text=MCP servers");
		await page.fill("input[placeholder='home_link']", "notes");
		await page.fill("input[placeholder='https://mcp.example.com/mcp']", remote.url);
		await page.click(".btn-primary >> text=Add server");
		const server = page.locator(".item", { has: page.locator(".name", { hasText: /^notes/ }) });
		await server.waitFor({ timeout: 15_000 });
		await page.waitForFunction(() => /connected, 1 tool/.test(document.querySelector(".set-in .group")?.textContent ?? ""), undefined, { timeout: 30_000 });
		await server.locator(".btn >> text=Sign in").click();
		await sees("pre.log >> text=/signed in to MCP server .notes./i", 40_000);
		await shot("09-settings-mcp-sign-in");
		assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
		// And taken out again: the file is as it was.
		await server.locator(".btn >> text=Remove").click();
		await server.locator(".btn >> text=Remove it?").click();
		await server.waitFor({ state: "detached", timeout: 15_000 });
		assert.doesNotMatch(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"notes"/);
	} finally {
		await remote.close();
	}
	// Skills: one is written down for all agents.
	await page.click(".set-nav .side-row >> text=Skills");
	await page.click(".btn-primary >> text=New skill");
	await page.fill("input[placeholder='invoices']", "invoices");
	await page.fill(".form textarea", "File an invoice. Use when a bill arrives.");
	await page.click(".editor .cm-content");
	await page.keyboard.type("1. Read the bill.");
	await page.click(".btn-primary >> text=Save skill");
	await sees(".item .name >> text=invoices");
	assert.match(fs.readFileSync(path.join(home, "skills", "invoices", "SKILL.md"), "utf8"), /Read the bill/);
	// Events: a folder to watch, set up from the type's own options.
	await page.click(".set-nav .side-row >> text=Events");
	await page.click(".btn-primary >> text=New source");
	await page.fill(".dialog input[placeholder='scans']", "scans");
	await page.selectOption(".dialog select >> nth=1", "folder");
	const watched = path.join(folder, "scans");
	fs.mkdirSync(watched, { recursive: true });
	await page.locator(".dialog .field", { has: page.locator(".field-label", { hasText: /^dir/ }) }).locator("input").fill(watched);
	await shot("09-settings-new-source");
	await page.click(".dialog .btn-primary >> text=Continue");
	await sees(".dialog >> text=will:");
	await page.click(".dialog .btn-primary >> text=Add source");
	await sees(".item .name >> text=scans");
	assert.match(fs.readFileSync(path.join(home, "pine.json"), "utf8"), /"scans"/);
	await shot("09-settings-sources");
	for (const [nav, title] of [["Models", "Models"], ["MCP servers", "MCP servers"], ["Skills", "Skills"], ["Instructions", "Instructions"], ["App", "App"]]) {
		await page.click(`.set-nav .side-row >> text=${nav}`);
		await sees(`.set-in h1 >> text=${title}`);
		await page.waitForTimeout(400);
		await shot(`09-settings-${nav.toLowerCase().replace(/\s+/g, "-")}`);
	}
	await menu("settings");
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
	if (!(await page.$(".code"))) await page.click(".conv-head .btn[title*='workspace']");
	await page.click(".code .segmented button >> text=Agent");
	await sees(".agent-view .agent-line .name >> text=invoices");
	await sees(".agent-view .agent-line .name >> text=morning");
	assert.match(await page.textContent(".agent-view"), /Nothing wakes it by itself\. 1 event source could/);
	await shot("14-agent-view");
	// On an agent's line, its initial stands beside its name, not half-way down to its description.
	const line = await page.$eval(".side-agent", (el: Element) => ({ avatar: el.querySelector(".avatar")!.getBoundingClientRect(), name: el.querySelector(".who > :first-child")!.getBoundingClientRect() }));
	assert.ok(Math.abs(line.avatar.y + line.avatar.height / 2 - (line.name.y + line.name.height / 2)) <= 2, JSON.stringify(line));
	// The side bar is as wide as it is dragged.
	const before = await page.$eval(".sidebar", (el: Element) => el.getBoundingClientRect().width);
	const edge = await page.$eval(".splitter.side", (el: Element) => el.getBoundingClientRect());
	await page.mouse.move(edge.x + edge.width / 2, 300);
	await page.mouse.down();
	await page.mouse.move(edge.x + edge.width / 2 + 80, 300, { steps: 4 });
	await page.mouse.up();
	assert.equal(await page.$eval(".sidebar", (el: Element) => el.getBoundingClientRect().width), before + 80);
	// A group folds away on a click on its agent, and comes back.
	const group = page.locator(".side-group", { has: page.locator(".who > :first-child", { hasText: /^scout$/ }) });
	assert.equal(await group.locator(".side-conv").count(), 1);
	await group.locator(".side-agent .who").click();
	assert.equal(await group.locator(".side-conv").count(), 0);
	await group.locator(".side-agent .who").click();
	assert.equal(await group.locator(".side-conv").count(), 1);
	// The plus on an agent's own line starts a conversation with that agent.
	await group.locator(".side-agent .btn[title='New conversation with scout']").click();
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
	await sees(".pick-input");
	// By words that are only in an answer of the agent's, never in a name:
	await page.keyboard.type("echo[where");
	await sees(".pick-group >> text=Said in conversations");
	assert.match(await page.textContent(".pick-list"), /scout · where is the okapi invoice[\s\S]*ECHO\[where is the okapi invoice\]/);
	await shot("15-search");
	// By words that are also its name, it is listed once, and still opens at the words.
	await page.fill(".pick-input", "okapi invoice");
	await page.waitForFunction(() => document.querySelectorAll(".pick-item").length > 0 && [...document.querySelectorAll(".pick-item .label")].filter((e) => /where is the okapi invoice/.test(e.textContent ?? "")).length === 1);
	await page.click(".pick-item:has-text('scout · where is the okapi invoice')");
	await sees(".tab.on .name >> text=where is the okapi invoice");
	await sees(".find >> text=/\\d+ of \\d+/");
	assert.equal(await page.inputValue(".find input"), "okapi invoice");
	await page.keyboard.press("Escape");
	await page.click(".tab.on .close");
	// Asked from where no agent is in front (the event log), a new conversation asks with whom.
	await menu("events");
	await sees(".tab.on .name >> text=Events");
	await menu("new");
	await sees(".pick-title >> text=New conversation with");
	assert.deepEqual(await page.$$eval(".pick-item .label", (els: Element[]) => els.map((e) => e.textContent)), ["main", "scout", "books", "test"]);
	await page.keyboard.press("Escape");
	await page.click(".tab.on .close");
});

test("the palette finds things by name, and the event log follows", async () => {
	// The pointer rests where the list will open: the first line is still the one that enter takes.
	await page.mouse.move(640, 320);
	await menu("palette");
	await sees(".pick-input");
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
	await page.click(".work-head >> nth=-1");
	await sees(".work .part .open-link");
	await page.click(".work .part .open-link >> nth=0");
	await sees(".tab.on .name >> text=#");
	await sees(".md >> text=hi from the child");
	assert.match(await page.textContent(".column"), /sub-agent of main/);
	await shot("12-task");
	await page.click(".tab.on .close");
});

test("the last message is taken back, and its text is in the input again", async () => {
	await page.click(".tab >> nth=0");
	const before = await page.$$eval(".it-user", (els: Element[]) => els.length);
	await menu("undo");
	await sees(".it-note.accent >> text=Taken back");
	assert.equal(await page.$$eval(".it-user", (els: Element[]) => els.length), before - 1);
	assert.match(await page.inputValue(".composer textarea"), /^ask a helper /);
	await page.fill(".composer textarea", "");
});

test("dictating puts what is heard into the input and sends nothing", async () => {
	const sent = await page.$$eval(".it-user", (els: Element[]) => els.length);
	await page.fill(".composer textarea", "Typed first:");
	await menu("voice");
	await sees(".banner >> text=listening");
	await page.waitForFunction(() => (document.querySelector(".composer textarea") as HTMLTextAreaElement).value === "Typed first: about the scans", undefined, { timeout: 8000 }).catch(async () => {
		throw new Error(`what was heard is not in the input, which holds: ${JSON.stringify(await page.inputValue(".composer textarea"))}; ${await page.evaluate(() => [...document.querySelectorAll(".banner, .toast")].map((e) => e.textContent).join(" | "))}`);
	});
	// Enter says "that was all": the rest arrives, and the message is still only text in the input.
	await page.focus(".composer textarea");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => (document.querySelector(".composer textarea") as HTMLTextAreaElement).value === "Typed first: about the scans please");
	await page.waitForSelector(".banner >> text=listening", { state: "detached" });
	assert.equal(await page.$$eval(".it-user", (els: Element[]) => els.length), sent);
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
