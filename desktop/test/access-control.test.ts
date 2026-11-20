// Browser access as the app's main process holds it (electron/access/control.ts), without a
// window: its preferences, the file of the host key and the paired devices, the calls the page
// makes, and the stand-in for the access host that the app's tests use instead of the network.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { type AccessControl, type AccessPrefs, type AccessState, createAccessControl, type Host, OFFICIAL_SERVICE, readAccessPrefs } from "../electron/access/control.ts";
import type { Cipher } from "../electron/access/host.ts";
import { startStandIn } from "../electron/access/stand-in.ts";
import type { Device } from "../electron/access/store.ts";

const folders: string[] = [];
const controls: AccessControl[] = [];
after(async () => {
	await Promise.all(controls.map((c) => c.stop()));
	for (const f of folders) rmSync(f, { recursive: true, force: true });
});

/** A cipher that marks what it sealed, so that a test can tell a sealed file from a plain one. */
const cipher: Cipher = {
	seal: (text) => Buffer.concat([Buffer.from("sealed:"), Buffer.from(text).map((b) => b ^ 0x5a)]),
	open: (bytes) => {
		if (!bytes.subarray(0, 7).equals(Buffer.from("sealed:"))) throw new Error("not sealed");
		return Buffer.from(bytes.subarray(7).map((b) => b ^ 0x5a)).toString("utf8");
	},
};

const SERVICE = "https://pine.example.workers.dev";
const daemonLine = JSON.stringify({ base: "http://127.0.0.1:9", token: "t", mode: "attached", started: false, home: "/h" });

function make(more: { prefs?: Partial<AccessPrefs>; cipher?: Cipher | undefined; folder?: string; official?: string } = {}) {
	const folder = more.folder ?? mkdtempSync(path.join(tmpdir(), "pine-access-control-"));
	folders.push(folder);
	let prefs: AccessPrefs = { enabled: false, openAtLogin: false, ...more.prefs };
	const hosts: Host[] = [];
	const calls = { starts: 0, daemon: 0, login: [] as boolean[], paired: [] as Device[], changes: [] as AccessState[] };
	const control = createAccessControl({
		folder,
		cipher: () => ("cipher" in more ? more.cipher : cipher),
		prefs: { read: () => prefs, write: (p) => void (prefs = p) },
		official: more.official ?? SERVICE,
		daemon: async () => (calls.daemon++, daemonLine),
		loginItem: (open) => void calls.login.push(open),
		paired: (device) => void calls.paired.push(device),
		changed: (state) => void calls.changes.push(state),
		computerName: () => "The Mac",
		start: async (options) => {
			calls.starts++;
			const host = await startStandIn(options);
			hosts.push(host);
			return host;
		},
	});
	controls.push(control);
	return { control, folder, calls, hosts, prefs: () => prefs };
}

const until = async (what: string, ok: () => boolean | Promise<boolean>, ms = 5000) => {
	const end = Date.now() + ms;
	while (!(await ok())) {
		if (Date.now() > end) throw new Error(`timed out: ${what}`);
		await new Promise((r) => setTimeout(r, 20));
	}
};

test("access control: off by default, an app that starts makes no host key, starts no host and contacts no service", async () => {
	const { control, folder, calls } = make();
	await control.start();
	const state = await control.state();
	assert.equal(state.enabled, false);
	assert.equal(state.status, "off");
	assert.deepEqual(state.devices, []);
	assert.equal(calls.starts, 0, "no access host was started");
	assert.deepEqual(readdirSync(folder), [], "no file was written");
});

test("access control: preferences are read off by default, with the official address, and an address that is not http(s) is not kept", () => {
	assert.deepEqual(readAccessPrefs(undefined), { enabled: false, service: undefined, openAtLogin: false });
	assert.deepEqual(readAccessPrefs({ enabled: true, service: "https://mine.example/some/path", openAtLogin: true }), { enabled: true, service: "https://mine.example", openAtLogin: true });
	for (const service of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pw@mine.example", "not an address", 42]) assert.equal(readAccessPrefs({ service }).service, undefined, String(service));
	assert.equal(readAccessPrefs({ enabled: "yes" }).enabled, false);
	assert.equal(OFFICIAL_SERVICE, "", "the official address is not known yet");
});

test("access control: turned on, the host key is kept encrypted in a file of the app's data folder, and the host waits", async () => {
	const { control, folder, calls, prefs } = make();
	const state = await control.set({ enabled: true });
	assert.equal(state.enabled, true);
	assert.equal(prefs().enabled, true);
	assert.equal(calls.starts, 1);
	await until("the host waits", async () => (await control.state()).status === "waiting");
	assert.deepEqual(readdirSync(folder), ["access.bin"]);
	const bytes = readFileSync(path.join(folder, "access.bin"));
	assert.ok(bytes.subarray(0, 7).equals(Buffer.from("sealed:")), "the file is the cipher's");
	assert.ok(!bytes.includes("OPENSSH PRIVATE KEY"), "the host key is not in the clear");
	assert.ok(!(await control.state()).problem);
});

test("access control: where the keychain cannot be used, browser access cannot be turned on and says why", async () => {
	const { control, folder, calls } = make({ cipher: undefined });
	const state = await control.state();
	assert.equal(state.problem?.kind, "keychain");
	await assert.rejects(control.set({ enabled: true }), /keychain/);
	assert.equal(calls.starts, 0);
	assert.equal((await control.state()).enabled, false);
	assert.deepEqual(readdirSync(folder), []);
});

test("access control: without an address (the official one is not known yet) it says one is needed, and an address the owner gives is used", async () => {
	const { control, calls, prefs } = make({ official: OFFICIAL_SERVICE });
	const state = await control.state();
	assert.equal(state.service, "");
	assert.equal(state.problem?.kind, "address");
	await assert.rejects(control.set({ enabled: true }), /address/);
	assert.equal(calls.starts, 0);
	await assert.rejects(control.set({ service: "ftp://mine.example" }), /https:\/\//);
	const set = await control.set({ service: "https://mine.example/", enabled: true });
	assert.equal(set.service, "https://mine.example");
	assert.equal(prefs().service, "https://mine.example");
	assert.equal(set.problem, undefined);
	assert.equal(calls.starts, 1);
	// Back to the official one: none, so the host stops and the address is asked for again.
	const back = await control.set({ service: "" });
	assert.equal(back.status, "off");
	assert.equal(back.problem?.kind, "address");
});

test("access control: open at login sets and clears the app's login item", async () => {
	const { control, calls, prefs } = make();
	assert.equal((await control.set({ openAtLogin: true })).openAtLogin, true);
	assert.equal(prefs().openAtLogin, true);
	assert.equal((await control.set({ openAtLogin: false })).openAtLogin, false);
	assert.deepEqual(calls.login, [true, false]);
	await control.set({ enabled: true });
	assert.deepEqual(calls.login, [true, false], "turning browser access on does not touch it by itself");
});

test("access control: a pairing is opened, the owner is asked with the device's name and digits, and a yes adds the device with one notification", async () => {
	const { control, calls } = make();
	await control.set({ enabled: true });
	const opened = await control.openPairing();
	assert.match(opened.link, new RegExp(`^${SERVICE}/#pair=[A-Za-z0-9_-]{43}\\.[A-Za-z0-9_-]{22}$`));
	const before = await control.state();
	assert.equal(before.pairing?.link, opened.link);
	assert.equal(before.pairing?.expires, opened.expires);
	assert.ok(Date.parse(opened.expires) > Date.now());
	await until("the owner is asked", async () => (await control.state()).request !== undefined);
	const { request } = await control.state();
	assert.equal(request?.name, "Stand-in phone");
	assert.match(request!.code, /^\d{4}$/);
	await until("the page was told", () => calls.changes.some((s) => s.request?.code === request!.code));
	await control.answer(true);
	await until("the device is connected", async () => (await control.state()).devices[0]?.connected !== undefined);
	const after = await control.state();
	assert.equal(after.request, undefined);
	assert.equal(after.pairing, undefined, "the code was used");
	assert.equal(after.devices.length, 1);
	assert.equal(after.devices[0].name, "Stand-in phone");
	assert.deepEqual(after.devices[0].connected, { path: "lan" });
	assert.equal(calls.paired.length, 1);
	assert.equal(calls.paired[0].name, "Stand-in phone");
	await until("the paired phone was given this computer's daemon", () => calls.daemon >= 1);
	await assert.rejects(control.answer(true), /No device is waiting/);
});

test("access control: a no, or a pairing cancelled, adds nothing and notifies nobody", async () => {
	const { control, calls } = make();
	await control.set({ enabled: true });
	await control.openPairing();
	await until("the owner is asked", async () => (await control.state()).request !== undefined);
	await control.answer(false);
	await new Promise((r) => setTimeout(r, 200));
	assert.deepEqual((await control.state()).devices, []);
	await control.openPairing();
	await control.cancelPairing();
	assert.equal((await control.state()).pairing, undefined);
	await new Promise((r) => setTimeout(r, 500));
	const state = await control.state();
	assert.equal(state.request, undefined, "a cancelled pairing's link no longer works");
	assert.deepEqual(state.devices, []);
	assert.deepEqual(calls.paired, []);
});

async function paired() {
	const made = make();
	await made.control.set({ enabled: true });
	await made.control.openPairing();
	await until("the owner is asked", async () => (await made.control.state()).request !== undefined);
	await made.control.answer(true);
	await until("the device is connected", async () => (await made.control.state()).devices[0]?.connected !== undefined);
	return made;
}

test("access control: removing a device forgets it and cuts its live connection", async () => {
	const { control, hosts } = await paired();
	const [device] = (await control.state()).devices;
	assert.deepEqual(hosts[0].connected(), [{ id: device.id, path: "lan" }]);
	assert.equal(await control.remove(device.id), true);
	const state = await control.state();
	assert.deepEqual(state.devices, []);
	await until("its connection was cut", () => hosts[0].connected().length === 0 && hosts[0].peers() === 0);
	assert.equal(await control.remove(device.id), false);
});

test("access control: switched off, the devices are kept and shown, and are there again when switched on; no notification for a device seen again", async () => {
	const { control, folder, calls } = await paired();
	const off = await control.set({ enabled: false });
	assert.equal(off.status, "off");
	assert.equal(off.devices.length, 1);
	assert.equal(off.devices[0].connected, undefined, "its connection ended with the host");
	const on = await control.set({ enabled: true });
	assert.equal(on.devices.length, 1);
	assert.equal(calls.paired.length, 1);
	// Another control on the same folder (the app started again) reads the same file, and removes from it while off.
	await control.stop();
	const again = make({ folder, prefs: { enabled: false } });
	const [device] = (await again.control.state()).devices;
	assert.equal(device.name, "Stand-in phone");
	assert.equal(await again.control.remove(device.id), true);
	assert.deepEqual((await again.control.state()).devices, []);
});

test("access control: left on, the host starts with the app, and stops with it", async () => {
	const { control, calls } = make({ prefs: { enabled: true } });
	await control.start();
	assert.equal(calls.starts, 1);
	await until("the host waits", async () => (await control.state()).status === "waiting");
	await control.stop();
	assert.equal((await control.state()).status, "off");
});
