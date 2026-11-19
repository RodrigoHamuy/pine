// The mobile bridge on a fake of the native plugin: what the page asks for reaches the plugin as
// the contract says (src/plugin.ts), and what the plugin answers or tells reaches the page.
import assert from "node:assert/strict";
import test from "node:test";
import { mobileBridge } from "../src/mobile-bridge.ts";
import type { PinePlugin, StoredPrefs } from "../src/plugin.ts";

type Call = [method: string, options?: unknown];

/** A plugin that records each call and answers with what the test gave it. */
function fakePlugin(answers: Partial<Record<keyof PinePlugin, (options?: any) => unknown>> = {}, stored: StoredPrefs = { hosts: [] }) {
	const calls: Call[] = [];
	const listeners = new Map<string, Set<(data: any) => void>>();
	const plugin = new Proxy({} as PinePlugin, {
		get: (_t, name: string) => {
			if (name === "then") return undefined;
			if (name === "addListener")
				return async (event: string, fn: (data: any) => void) => {
					calls.push(["addListener", event]);
					const set = listeners.get(event) ?? new Set();
					listeners.set(event, set.add(fn));
					return { remove: async () => void set.delete(fn) };
				};
			return async (options?: unknown) => {
				calls.push(options === undefined ? [name] : [name, options]);
				if (answers[name as keyof PinePlugin]) return answers[name as keyof PinePlugin]!(options);
				if (name === "loadPrefs") return structuredClone(stored);
				if (name === "state") return { state: { status: "starting" }, connected: false, version: "0.0.0" };
				return undefined;
			};
		},
	});
	const emit = (event: string, data: unknown) => listeners.get(event)?.forEach((fn) => fn(data));
	return { plugin, calls, emit, listeners };
}

const ready = { status: "ready", mode: "attached", started: false, home: "box:~/.pine", version: "0.40.0", from: "ssh", host: "me@box", label: "box" } as const;

test("state: the plugin's connection and stored machines, with no local machine and the phone's platform", async () => {
	const { plugin } = fakePlugin({ state: () => ({ state: ready, connected: true, version: "1.2.3" }) }, { hosts: ["me@box"], use: "me@box", prefs: { theme: "dark" } });
	const s = await mobileBridge(plugin).state();
	assert.equal(s.local, false);
	assert.equal(s.platform, "android");
	assert.deepEqual(s.state, ready);
	assert.equal(s.connected, true);
	assert.equal(s.home, "box:~/.pine");
	assert.equal(s.updates, false);
	assert.deepEqual(s.versions, { app: "1.2.3", electron: "none" });
	assert.deepEqual(s.prefs, { keepRunning: false, hosts: ["me@box"], use: "me@box", theme: "dark", notify: false, updates: false, codeFollowsPalette: true });
});

test("mediaBase: the address on the app's origin that the plugin answers", () => {
	assert.equal(mobileBridge(fakePlugin().plugin).mediaBase, "https://localhost/_pine_media");
});

test("call: forwarded as one object, and the plugin's answer handed back as it is", async () => {
	const answer = { ok: true, status: 200, data: { mime: "image/png", base64: "iVBO" } };
	const { plugin, calls } = fakePlugin({ call: () => answer });
	assert.deepEqual(await mobileBridge(plugin).call("POST", "/agents/main/message", { text: "hi" }), answer);
	assert.deepEqual(calls, [["call", { method: "POST", url: "/agents/main/message", body: { text: "hi" } }]]);
});

test("ready and retry: forwarded", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin);
	b.ready();
	await b.retry();
	assert.deepEqual(calls, [["ready"], ["retry"]]);
});

test("machines: use, add and forget go to the plugin, and the prefs come back with its list", async () => {
	const { plugin, calls } = fakePlugin({ addHost: ({ host }) => ({ hosts: ["me@box", host] }), forgetHost: () => ({ hosts: ["pi"] }) }, { hosts: ["me@box"], prefs: { theme: "light" } });
	const b = mobileBridge(plugin);
	await b.state();
	const added = await b.addHost("pi");
	assert.deepEqual(added.hosts, ["me@box", "pi"]);
	assert.equal(added.theme, "light");
	await b.use("pi");
	const forgotten = await b.forgetHost("me@box");
	assert.deepEqual(forgotten, { keepRunning: false, hosts: ["pi"], use: "pi", theme: "light", notify: false, updates: false, codeFollowsPalette: true });
	assert.deepEqual(
		calls.filter(([m]) => m !== "state" && m !== "loadPrefs"),
		[
			["addHost", { host: "pi" }],
			["use", { host: "pi" }],
			["forgetHost", { host: "me@box" }],
		],
	);
});

test("use: the phone has no pine of its own, so a call without a machine is refused and reaches nothing", async () => {
	const { plugin, calls } = fakePlugin();
	await assert.rejects(mobileBridge(plugin).use(undefined), /no pine of its own/);
	assert.deepEqual(calls, []);
});

test("a refusal of the plugin reaches the page with its words", async () => {
	const { plugin } = fakePlugin({
		addHost: () => {
			throw new Error("Not a host for ssh: -oProxyCommand=x.");
		},
	});
	await assert.rejects(mobileBridge(plugin).addHost("-oProxyCommand=x"), /Not a host for ssh/);
});

test("open: http(s) addresses go to the phone's browser, nothing else reaches the plugin", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin);
	await b.open("https://example.com/a");
	await b.open("HTTP://example.com/b");
	await b.open("file:///etc/passwd");
	await b.open("javascript:alert(1)");
	await b.open("intent://x#Intent;end");
	assert.deepEqual(calls, [
		["openExternal", { url: "https://example.com/a" }],
		["openExternal", { url: "HTTP://example.com/b" }],
	]);
});

test("listeners: what the plugin tells reaches each page listener in the desktop's shape, until it unsubscribes", async () => {
	const { plugin, emit } = fakePlugin();
	const b = mobileBridge(plugin);
	const got: unknown[] = [];
	const offs = [
		b.onService((s: unknown) => got.push(["service", s])),
		b.onEvents((e: unknown) => got.push(["events", e])),
		b.onConnection((c: unknown) => got.push(["connection", c])),
		b.onFocus((f: unknown) => got.push(["focus", f])),
		b.onMenu((m: unknown) => got.push(["menu", m])),
	];
	const second: unknown[] = [];
	const offSecond = b.onEvents((e: unknown) => second.push(e));
	await new Promise((r) => setImmediate(r));
	const batch = [{ id: 1, topic: "agent/main/answer", data: {} }];
	emit("service", { state: ready });
	emit("events", { events: batch });
	emit("connection", { connected: false });
	emit("focus", { focused: true });
	emit("menu", { command: "close" });
	assert.deepEqual(got, [
		["service", ready],
		["events", batch],
		["connection", false],
		["focus", true],
		["menu", "close"],
	]);
	assert.deepEqual(second, [batch]);
	for (const off of offs) off();
	emit("service", { state: ready });
	emit("events", { events: batch });
	emit("connection", { connected: true });
	emit("focus", { focused: false });
	emit("menu", { command: "back" });
	assert.equal(got.length, 5);
	assert.deepEqual(second, [batch, batch], "another listener of the same kind still hears");
	offSecond();
});

test("listeners: the plugin is listened to once per kind, however many page listeners there are", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin);
	b.onEvents(() => {})();
	b.onEvents(() => {});
	b.onEvents(() => {});
	await new Promise((r) => setImmediate(r));
	assert.equal(calls.filter(([m, e]) => m === "addListener" && e === "events").length, 1);
});

test("ready: a plugin that cannot start tells the page as a failed connection", async () => {
	const { plugin } = fakePlugin({
		ready: () => {
			throw new Error("The keystore is locked.");
		},
	});
	const b = mobileBridge(plugin);
	const states: unknown[] = [];
	b.onService((s: unknown) => states.push(s));
	b.ready();
	await new Promise((r) => setImmediate(r));
	assert.deepEqual(states, [{ status: "error", kind: "failed", message: "The keystore is locked." }]);
});

test("what only the desktop app has refuses or does nothing, as the preview's stand-in, and never reaches the plugin", async () => {
	const { plugin, calls } = fakePlugin();
	const b = mobileBridge(plugin);
	assert.equal(await b.update(true), undefined);
	await assert.rejects(b.restart(), /machine/);
	assert.equal(await b.init(), 1);
	assert.equal(await b.browserInstall(), 1);
	assert.deepEqual(await b.command("install"), { state: "unavailable", text: "" });
	await assert.rejects(b.voiceStart("en"), /Mac/);
	assert.equal(await b.voiceStop(), undefined);
	await assert.rejects(b.termOpen("t", undefined, 80, 24), /desktop app/);
	assert.equal(await b.termWrite("t", "ls"), undefined);
	assert.deepEqual(await b.termRun("t", "ls"), { reports: false });
	assert.equal(await b.termResize("t", 80, 24), undefined);
	assert.equal(await b.termClose("t"), undefined);
	assert.equal(await b.pickFolder("Choose"), undefined);
	assert.equal(b.pathOf({} as File), "");
	assert.equal(await b.reveal("/x"), undefined);
	assert.equal(await b.notify("t", "b"), undefined);
	assert.equal(await b.badge(3), undefined);
	assert.equal(await b.contextMenu([{ id: "a", label: "A" }]), undefined);
	for (const off of [b.onInitLine, b.onVoice, b.onTermData, b.onTermExit, b.onTermRun].map((on) => on(() => {}))) off();
	assert.deepEqual(calls, []);
});

test("prefs: each value checked as the desktop's main process checks it, then stored whole", async () => {
	const { plugin, calls } = fakePlugin({}, { hosts: ["me@box"], use: "me@box" });
	const b = mobileBridge(plugin);
	await b.state();
	const after = await b.prefs({ theme: "dark", notify: true, codeFollowsPalette: false, palette: { source: "#FF0000", scheme: "nope", contrast: 7 } });
	assert.equal(after.theme, "dark");
	assert.equal(after.notify, true);
	assert.equal(after.codeFollowsPalette, false);
	assert.equal(after.palette.source, "#ff0000", "the palette is made safe by cleanPalette");
	assert.equal(after.palette.scheme, "tonalSpot");
	assert.equal(after.palette.contrast, 0);
	assert.deepEqual(after.hosts, ["me@box"]);
	assert.equal(after.use, "me@box");
	const saved = calls.find(([m]) => m === "savePrefs")?.[1] as { prefs: Record<string, unknown> };
	assert.deepEqual(Object.keys(saved.prefs).sort(), ["codeFollowsPalette", "keepRunning", "notify", "palette", "theme", "updates"], "machines are the plugin's own, not saved with the page's prefs");

	const refused = await b.prefs({ theme: "neon", notify: "yes", updates: 1, keepRunning: null, codeFollowsPalette: "no", home: "/etc", hosts: ["evil"], use: "evil", extra: 1 });
	assert.deepEqual(refused, after, "nothing that is not a value the desktop accepts changes, and no machine is set this way");

	const reset = await b.prefs({ palette: undefined });
	assert.equal(reset.palette, undefined, "a reset palette is pine's default: none stored");
});

test("saveText: the text goes to the share sheet under its name", async () => {
	const { plugin, calls } = fakePlugin();
	assert.equal(await mobileBridge(plugin).saveText("conversation.md", "# hi"), "conversation.md");
	assert.deepEqual(calls, [["share", { title: "conversation.md", text: "# hi" }]]);
});
