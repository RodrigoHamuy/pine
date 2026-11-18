// The palette the app's colours are generated from, as the owner sets it in Settings > App > Colours:
// the real app on a home of its own, started twice on the same data. What is checked is the colour
// the window draws (a computed colour), never a class or a file's text, except that Reset leaves no
// palette in the app's preferences.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { builder } from "material-theme-builder";
import { _electron as electron } from "playwright-core";
import { startMock } from "../../baseline/tests/mock.mjs";
import { DEFAULT_PALETTE, type Palette } from "../src/theme.ts";

const root = path.resolve(import.meta.dirname, "..");
let app: any;
let page: any;
let mock: any;
let home: string;
const prefsFile = () => path.join(home, "desktop-data", "prefs.json");

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** The M3 scheme of a palette, as material-theme-builder generates it: what the window should draw. */
const schemeOf = (palette: Palette) => builder(palette.source, palette).toJson().schemes;
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
/** The colour a CSS colour value resolves to in the page, read from an element of the test's own. */
const resolved = (value: string): Promise<string> =>
	page.evaluate((v: string) => {
		const probe = document.body.appendChild(document.createElement("div"));
		probe.style.backgroundColor = v;
		const colour = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return colour;
	}, value);
/** Waits until the page's primary is the one of that palette, and says what it is instead when it does not come. */
async function primaryIs(palette: Palette, look: "light" | "dark" = "light"): Promise<void> {
	const want = rgb(schemeOf(palette)[look].primary);
	for (let i = 0; i < 100; i++) {
		if ((await resolved("var(--primary)")) === want) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(await resolved("var(--primary)"), want, `${look}: the primary of ${palette.source}`);
}
/** Waits until the page's outline (made from the neutral variant) is the one of that palette. */
async function outlineIs(palette: Palette): Promise<void> {
	const want = rgb(schemeOf(palette).light.outline);
	for (let i = 0; i < 100; i++) {
		if ((await resolved("var(--md-sys-color-outline)")) === want) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	assert.equal(await resolved("var(--md-sys-color-outline)"), want, `the outline of the neutral variant ${palette.neutralVariant}`);
}

async function start(): Promise<void> {
	app = await electron.launch({ colorScheme: "light", args: [root], env: { ...process.env, PINE_DESKTOP_BACKGROUND: "1", PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" } });
	page = await app.firstWindow();
	await page.setViewportSize?.({ width: 1280, height: 820 }).catch(() => {});
	await page.waitForSelector("[data-slot=empty] h1", { timeout: 30_000 });
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 3000 }).catch(() => undefined);
	if (dialog) await dialog.click();
}

async function colours(): Promise<void> {
	await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", "settings"));
	await page.locator("[role=navigation]").getByRole("button", { name: "App", exact: true }).click();
	await page.waitForSelector("[data-setting=colours]");
}

const SOURCE = "#ff0000";

before(async () => {
	if (!fs.existsSync(path.join(root, "dist", "index.html")) || !fs.existsSync(path.join(root, "dist-electron", "main.js"))) throw new Error("the app is not built: node scripts/build.mjs in desktop/");
	mock = await startMock({});
	home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-desktop-palette-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
	// A palette written by hand, with one good field and the others wrong each in its own way.
	write(prefsFile(), JSON.stringify({ updates: false, palette: { source: SOURCE, neutral: "blue", neutralVariant: "grey", colorMatch: "yes", scheme: "rainbow", contrast: 3, customColors: [{ name: "warn", hex: "#zzzzzz" }, { name: "evil", hex: "#000000" }] } }));
	await start();
});

after(async () => {
	await app?.close().catch(() => {});
	await mock?.close?.().catch(() => {});
	if (home) fs.rmSync(home, { recursive: true, force: true });
});

test("a malformed stored palette opens the app with the default for each field that is wrong", async () => {
	// The good field is kept, every wrong one is pine's default: the scheme is the one of the default palette with that source.
	await primaryIs({ ...DEFAULT_PALETTE, source: SOURCE });
	assert.equal(await resolved("var(--surface)"), rgb(schemeOf({ ...DEFAULT_PALETTE, source: SOURCE }).light.surfaceContainerLowest));
	// The outline is made from the neutral variant: the default one, since "grey" is not a colour.
	await outlineIs({ ...DEFAULT_PALETTE, source: SOURCE });
	// A custom colour of another name is not in the page; warn is there, and is the default one (checked against Reset below).
	assert.equal(await resolved("var(--md-sys-color-evil)"), "rgba(0, 0, 0, 0)");
	assert.notEqual(await resolved("var(--md-sys-color-warn)"), "rgba(0, 0, 0, 0)");
});

test("the source colour set in Settings redraws the window, is kept after a restart, and Reset brings the default back", async () => {
	await colours();
	const warn = await resolved("var(--md-sys-color-warn)");
	await page.getByRole("button", { name: "Reset colours" }).click();
	await primaryIs(DEFAULT_PALETTE);
	assert.equal(await resolved("var(--md-sys-color-warn)"), warn, "the malformed warn was the default one");
	assert.equal("palette" in JSON.parse(fs.readFileSync(prefsFile(), "utf8")), false, "Reset stores no palette");

	// A new source colour: the whole window follows at once, in light and in dark.
	const mine = { ...DEFAULT_PALETTE, source: "#3366cc", neutralVariant: "#806040" };
	await page.fill("input[type=color][name=source]", mine.source);
	await primaryIs(mine);
	// The neutral variant tints the outlines and muted text, and is kept like the rest.
	await page.fill("input[type=color][name=neutralVariant]", mine.neutralVariant);
	await outlineIs(mine);
	await page.emulateMedia({ colorScheme: "dark" });
	await primaryIs(mine, "dark");
	await page.emulateMedia({ colorScheme: "light" });

	// The same data, a new app: the palette is the owner's.
	await app.close();
	await start();
	await primaryIs(mine);
	await outlineIs(mine);

	// Reset: pine's palette, and nothing kept.
	await colours();
	assert.equal(await page.inputValue("input[type=color][name=source]"), mine.source);
	await page.getByRole("button", { name: "Reset colours" }).click();
	await primaryIs(DEFAULT_PALETTE);
	assert.equal(await page.inputValue("input[type=color][name=source]"), DEFAULT_PALETTE.source);
	assert.equal("palette" in JSON.parse(fs.readFileSync(prefsFile(), "utf8")), false);
});

test("the window's own background is the stored palette's surface where the system draws none", async (t) => {
	if (process.platform === "darwin") return t.skip("on a Mac the window is transparent behind its vibrancy");
	const mine = { ...DEFAULT_PALETTE, source: "#3366cc", neutral: "#202830" };
	await page.fill("input[type=color][name=neutral]", mine.neutral);
	await app.close();
	write(prefsFile(), JSON.stringify({ ...JSON.parse(fs.readFileSync(prefsFile(), "utf8")), palette: mine }));
	await start();
	const background = await app.evaluate(({ BrowserWindow }: any) => BrowserWindow.getAllWindows()[0].getBackgroundColor());
	assert.equal(background.toLowerCase(), schemeOf(mine).light.surface.toLowerCase());
});
