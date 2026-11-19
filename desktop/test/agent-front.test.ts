// The window takes the colour of the agent in front, for the role families the owner ticked in
// Settings > App > Colours: the real app on a home of its own, started twice on the same data. What is
// checked is the colour a role resolves to in the window, never a class. The global values are read
// from the window itself, so that nothing here depends on how the owner's palette is drawn.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { builder } from "material-theme-builder";
import { _electron as electron } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";
import { DEFAULT_PALETTE } from "../src/theme.ts";

const root = path.resolve(import.meta.dirname, "..");
let app: any;
let page: any;
let mock: any;
let home: string;
const prefsFile = () => path.join(home, "desktop-data", "prefs.json");
const BOOKS = "#d9534f";

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const { source: _mint, ...owners } = DEFAULT_PALETTE;
/** The agent's scheme with the owner's neutrals: what the primary, secondary and tertiary come from. */
const booksScheme = () => builder(BOOKS, owners).toJson().schemes;
/** The agent's scheme with its own neutral (surfaces ticked): the owner's neutral left out. */
const { neutral: _night, ...withoutNeutral } = owners;
const booksSurfaces = () => builder(BOOKS, withoutNeutral).toJson().schemes;

/** The colour a role resolves to in the window. */
const role = (name: string): Promise<string> =>
	page.evaluate((v: string) => {
		const probe = document.body.appendChild(document.createElement("div"));
		probe.style.backgroundColor = `var(--md-sys-color-${v})`;
		const colour = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return colour;
	}, name);
/** Waits until a role is that colour, and says what it is instead when it does not come. */
async function roleIs(name: string, want: string, why: string): Promise<void> {
	for (let i = 0; i < 100; i++) {
		if ((await role(name)) === want) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(await role(name), want, why);
}

const menu = (name: string) => app.evaluate(({ BrowserWindow }: any, n: string) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", n), name);
const tab = (agent: string) => page.locator(`[data-slot=tab][title^="${agent} ·"]`).first();

async function start(): Promise<void> {
	app = await electron.launch({ colorScheme: "light", args: [root], env: { ...process.env, PINE_DESKTOP_BACKGROUND: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" } });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 });
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 3000 }).catch(() => undefined);
	if (dialog) await dialog.click();
}

/** books' conversation in front, opened from its page in Settings the first time. */
async function booksInFront(): Promise<void> {
	if (await tab("books").count()) return void (await tab("books").click());
	// The same menu item opens the settings and puts them away.
	if (!(await page.$("[data-slot=settings-page]"))) await menu("settings");
	await page.click("[role=navigation] [data-sidebar=menu-button] >> text=Agents");
	await page.locator("[data-slot=settings-page] [data-slot=item]", { hasText: "Keeps the books" }).click();
	await page.locator("[data-slot=settings-page]").getByRole("button", { name: "Open" }).click();
	await page.waitForSelector("[data-slot=empty] [data-slot=avatar][data-agent=books]");
}
async function colours(): Promise<void> {
	await menu("settings");
	await page.locator("[role=navigation]").getByRole("button", { name: "App", exact: true }).click();
	await page.waitForSelector("[data-setting=agent-families]");
}
const family = (name: string) => page.locator(`[data-setting=agent-families] [data-family=${name}] [role=checkbox]`);
/** Ticks or unticks a family in Settings, and waits until the box says so. */
async function tick(name: string, on: boolean): Promise<void> {
	const box = family(name);
	if ((await box.getAttribute("aria-checked")) !== String(on)) await box.click();
	await page.waitForFunction(([n, v]: [string, string]) => document.querySelector(`[data-setting=agent-families] [data-family=${n}] [role=checkbox]`)?.getAttribute("aria-checked") === v, [name, String(on)]);
}

/** The window's own values, with no agent's colour in front: read once main's conversation is in front. */
const global = { light: {} as Record<string, string>, dark: {} as Record<string, string> };
const ROLES = ["primary", "on-primary", "secondary", "tertiary", "surface", "surface-container-low", "on-surface", "outline"];

before(async () => {
	if (!fs.existsSync(path.join(root, "dist", "index.html")) || !fs.existsSync(path.join(root, "dist-electron", "main.js"))) throw new Error("the app is not built: node scripts/build.mjs in desktop/");
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-agent-front-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "books", "agent.json"), JSON.stringify({ description: "Keeps the books", color: BOOKS }));
	write(path.join(home, "agents", "books", "workspace", "AGENTS.md"), "You keep the books.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	// A damaged value: the default (primary only) is what the window follows.
	write(prefsFile(), JSON.stringify({ updates: false, agentFamilies: "rainbow" }));
	await start();
	for (const look of ["dark", "light"] as const) {
		await page.emulateMedia({ colorScheme: look });
		await page.waitForFunction((d: boolean) => document.documentElement.classList.contains("dark") === d, look === "dark");
		for (const r of ROLES) global[look][r] = await role(r);
	}
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("a coloured agent in front gives the window its primary, in light and dark, and leaves the surfaces global (a damaged preference is the default)", async () => {
	assert.notEqual(rgb(booksScheme().light.primary), global.light.primary, "books' primary differs from the window's");
	await booksInFront();
	await roleIs("primary", rgb(booksScheme().light.primary), "light: books' primary");
	await roleIs("on-primary", rgb(booksScheme().light.onPrimary), "light: books' on-primary");
	for (const r of ["secondary", "tertiary", "surface", "surface-container-low", "on-surface", "outline"]) assert.equal(await role(r), global.light[r], `light: ${r} stays the window's`);
	await page.emulateMedia({ colorScheme: "dark" });
	await roleIs("primary", rgb(booksScheme().dark.primary), "dark: books' primary");
	assert.equal(await role("surface"), global.dark.surface, "dark: the surface stays the window's");
	await page.emulateMedia({ colorScheme: "light" });
	await roleIs("primary", rgb(booksScheme().light.primary), "light again: books' primary");
});

test("another tab, Settings, or an agent without a colour gives the global palette back at once", async () => {
	await booksInFront();
	await roleIs("primary", rgb(booksScheme().light.primary), "books in front");
	await tab("main").click();
	await roleIs("primary", global.light.primary, "main has no colour");
	await booksInFront();
	await roleIs("primary", rgb(booksScheme().light.primary), "books in front again");
	await menu("settings");
	await roleIs("primary", global.light.primary, "Settings in front");
	await menu("settings");
});

test("ticking surfaces gives the window the agent's own surfaces; unticking every family changes nothing", async () => {
	await colours();
	await tick("surfaces", true);
	await booksInFront();
	await roleIs("surface", rgb(booksSurfaces().light.surface), "light: books' surface, from its own neutral");
	await roleIs("surface-container-low", rgb(booksSurfaces().light.surfaceContainerLow), "light: books' shell");
	await roleIs("primary", rgb(booksScheme().light.primary), "the primary is still followed");
	assert.equal(await role("outline"), global.light.outline, "outlines not ticked: the window's");
	await page.emulateMedia({ colorScheme: "dark" });
	await roleIs("surface", rgb(booksSurfaces().dark.surface), "dark: books' surface");
	await page.emulateMedia({ colorScheme: "light" });

	await colours();
	await tick("primary", false);
	await tick("surfaces", false);
	await booksInFront();
	for (const r of ROLES) await roleIs(r, global.light[r], `nothing ticked: ${r} is the window's`);
	assert.deepEqual(JSON.parse(fs.readFileSync(prefsFile(), "utf8")).agentFamilies, []);
});

test("the families are kept after a restart, and Reset colours brings back primary only", async () => {
	await colours();
	await tick("tertiary", true);
	await app.close();
	await start();
	await booksInFront();
	await roleIs("tertiary", rgb(booksScheme().light.tertiary), "after a restart: books' tertiary");
	await roleIs("primary", global.light.primary, "after a restart: primary still unticked");

	await colours();
	await page.getByRole("button", { name: "Reset colours" }).click();
	await page.waitForFunction(() => document.querySelector("[data-setting=agent-families] [data-family=primary] [role=checkbox]")?.getAttribute("aria-checked") === "true");
	assert.equal(await family("tertiary").getAttribute("aria-checked"), "false");
	await booksInFront();
	await roleIs("primary", rgb(booksScheme().light.primary), "reset: primary followed");
	await roleIs("tertiary", global.light.tertiary, "reset: tertiary the window's");
});
