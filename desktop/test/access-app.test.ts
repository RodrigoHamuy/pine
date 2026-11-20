// Browser access through the real app: the page's calls, made from the page itself, to the main
// process, which runs browser access on its stand-in (PINE_DESKTOP_ACCESS_STAND_IN: no network,
// a phone of the stand-in's own that pairs over an in-memory stream). The login item and the
// notifications are noted instead of reaching the system, and the keychain is Chromium's mock one.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { startMock } from "../../baseline/tests/mock.mjs";
import { launchApp } from "./support/app.ts";

const SERVICE = "https://pine.example.invalid";

let app: any;
let page: any;
let mock: any;
let home: string;
let data: string;

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** A call of the page's bridge, made in the page. */
const bridge = (name: string, ...args: unknown[]) => page.evaluate(([n, a]: [string, unknown[]]) => (window as any).pine[n](...a), [name, args]);

/** What the page was told of browser access, last first. */
const told = () => page.evaluate(() => (window as any).__access as any[]);
const noted = () => app.evaluate(() => (globalThis as any).noted);

async function until(what: string, ok: () => Promise<boolean>, ms = 15_000) {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error(`timed out: ${what}. Told: ${JSON.stringify((await told())?.at(-1))}`);
		await new Promise((r) => setTimeout(r, 50));
	}
}

before(async () => {
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-access-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({}));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "The main agent.\n\nYou are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	data = path.join(home, "desktop-data");
	// The official service's address is not known yet: the owner's own is named.
	write(path.join(data, "prefs.json"), JSON.stringify({ updates: false, access: { service: SERVICE } }));

	app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: data, PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "", PINE_DESKTOP_ACCESS_STAND_IN: "200" });
	page = await app.firstWindow();
	await app.evaluate(({ app, Notification }: any) => {
		const noted = ((globalThis as any).noted = { login: [] as unknown[], notified: [] as unknown[] });
		app.setLoginItemSettings = (settings: unknown) => void noted.login.push(settings);
		Notification.prototype.show = function (this: any) {
			noted.notified.push({ title: this.title, body: this.body });
		};
	});
	await page.waitForFunction(() => Boolean((window as any).pine?.access));
	await page.evaluate(() => {
		(window as any).__access = [];
		(window as any).pine.onAccess((s: unknown) => (window as any).__access.push(s));
	});
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("browser access in the app: off at first, nothing written; on, it waits; a device pairs with one notification; removed, it is gone; off again", async () => {
	const first = await bridge("access");
	assert.equal(first.enabled, false);
	assert.equal(first.status, "off");
	assert.equal(first.service, SERVICE);
	assert.deepEqual(first.devices, []);
	assert.equal(first.problem, undefined, `no problem: ${JSON.stringify(first.problem)}`);
	assert.ok(!fs.existsSync(path.join(data, "access.bin")), "no host key before it is turned on");
	await assert.rejects(bridge("openPairing"), /Turn browser access on first/);

	const on = await bridge("setAccess", { enabled: true, openAtLogin: true });
	assert.equal(on.enabled, true);
	assert.equal(on.openAtLogin, true);
	assert.deepEqual((await noted()).login, [{ openAtLogin: true }]);
	assert.ok(fs.existsSync(path.join(data, "access.bin")), "the host key is kept in the app's data folder");
	assert.ok(!fs.readFileSync(path.join(data, "access.bin")).includes("OPENSSH"), "encrypted");
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, "prefs.json"), "utf8")).access, { enabled: true, service: SERVICE, openAtLogin: true });
	assert.ok(!fs.existsSync(path.join(home, "access.bin")) && !fs.readdirSync(home).some((f) => f.startsWith("access")), "nothing in pine's home");
	await until("the page is told it waits", async () => (await told()).some((s) => s.status === "waiting"));

	const opened = await bridge("openPairing");
	assert.ok(opened.link.startsWith(`${SERVICE}/#pair=`), opened.link);
	assert.equal((await bridge("access")).pairing.link, opened.link);
	await until("the owner is asked", async () => (await told()).at(-1)?.request !== undefined);
	const { request } = (await told()).at(-1);
	assert.equal(request.name, "Stand-in phone");
	assert.match(request.code, /^\d{4}$/);
	await bridge("answerPairing", true);
	await until("the device is connected", async () => (await told()).at(-1)?.devices[0]?.connected !== undefined);
	const now = (await told()).at(-1);
	assert.equal(now.devices[0].name, "Stand-in phone");
	assert.deepEqual(now.devices[0].connected, { path: "lan" });
	assert.equal(now.request, undefined);
	assert.deepEqual((await noted()).notified, [{ title: "Browser access", body: "Stand-in phone can now access Pine." }]);

	assert.equal(await bridge("removeDevice", now.devices[0].id), true);
	assert.deepEqual((await bridge("access")).devices, []);
	await assert.rejects(bridge("removeDevice", "../../etc"), /not a device/);

	const off = await bridge("setAccess", { enabled: false, openAtLogin: false });
	assert.equal(off.status, "off");
	assert.deepEqual((await noted()).login, [{ openAtLogin: true }, { openAtLogin: false }]);
	assert.equal((await noted()).notified.length, 1, "one notification, for the one device added");
});

test("browser access in the app: an address that is not http(s) is refused and not kept", async () => {
	await assert.rejects(bridge("setAccess", { service: "file:///etc/passwd" }), /https:\/\//);
	assert.equal((await bridge("access")).service, SERVICE);
});
