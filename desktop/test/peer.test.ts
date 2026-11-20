// The peer connection of browser access (electron/access/peer.ts): two peers on this computer, with
// no STUN server, joined by hand the way the meeting service passes their messages. No window.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { test } from "node:test";
import { answer, offer, pathOf, type Peer, type Signal } from "../electron/access/peer.ts";

/** Two peers whose signals go to each other as JSON, as they would cross the meeting service. */
function pair(): { mac: Peer; browser: Peer } {
	let mac: Peer | undefined;
	let browser: Peer | undefined;
	const early: Signal[] = [];
	const cross = (d: Signal) => JSON.parse(JSON.stringify(d)) as Signal;
	browser = offer({ ice: [], send: (d) => (mac ? mac.signal(cross(d)) : early.push(cross(d))) });
	mac = answer({ ice: [], send: (d) => browser.signal(cross(d)) });
	for (const d of early.splice(0)) mac.signal(d);
	return { mac, browser };
}

/** Everything a stream gives until `n` bytes came, or what came when it ended first. */
function readBytes(s: Duplex, n: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const parts: Buffer[] = [];
		let got = 0;
		const done = () => (s.off("data", onData), s.off("end", onEnd), s.off("error", reject), resolve(Buffer.concat(parts)));
		const onData = (b: Buffer) => {
			parts.push(b);
			got += b.length;
			if (got >= n) done();
		};
		const onEnd = () => done();
		s.on("data", onData);
		s.once("end", onEnd);
		s.once("error", reject);
	});
}

const ended = (s: Duplex) => new Promise<void>((resolve) => (s.readableEnded || s.destroyed ? resolve() : (s.once("close", () => resolve()), s.once("end", () => resolve()))));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

test("two peers on this computer open the ssh channel and pass bytes both ways", async () => {
	const { mac, browser } = pair();
	try {
		const [a, b] = await Promise.all([mac.channel, browser.channel]);
		const back = readBytes(a, 5);
		b.write("hello");
		assert.equal((await back).toString(), "hello");
		const forth = readBytes(b, 5);
		a.write("world");
		assert.equal((await forth).toString(), "world");
	} finally {
		mac.close();
		browser.close();
	}
});

test("several megabytes cross both ways at once, whole and in order, in large writes", async () => {
	const { mac, browser } = pair();
	try {
		const [a, b] = await Promise.all([mac.channel, browser.channel]);
		const size = 6 * 1024 * 1024;
		const toMac = randomBytes(size);
		const toBrowser = randomBytes(size);
		const gotMac = readBytes(a, size);
		const gotBrowser = readBytes(b, size);
		// Writes far larger than a data channel message: the stream cuts them.
		for (let i = 0; i < size; i += 1024 * 1024) {
			b.write(toMac.subarray(i, i + 1024 * 1024));
			a.write(toBrowser.subarray(i, i + 1024 * 1024));
		}
		const [m, w] = await Promise.all([gotMac, gotBrowser]);
		assert.equal(m.length, size);
		assert.equal(w.length, size);
		assert.equal(sha(m), sha(toMac));
		assert.equal(sha(w), sha(toBrowser));
	} finally {
		mac.close();
		browser.close();
	}
});

test("a writer waits while the channel holds too much, and no message is above 16 KiB", async () => {
	const { mac, browser } = pair();
	try {
		const [a, b] = await Promise.all([mac.channel, browser.channel]);
		const sizes: number[] = [];
		b.on("data", (chunk: Buffer) => sizes.push(chunk.length));
		// One write of 16 MiB: what waits in the channel to be sent stays near the threshold the
		// whole time, instead of the whole write being handed to the channel at once.
		const big = randomBytes(16 * 1024 * 1024);
		let most = 0;
		let writing = true;
		const sample = () => {
			most = Math.max(most, mac.buffered());
			if (writing) setImmediate(sample);
		};
		sample();
		await new Promise<void>((resolve, reject) => a.write(big, (e) => (e ? reject(e) : resolve())));
		writing = false;
		while (sizes.reduce((x, y) => x + y, 0) < big.length) await new Promise((r) => setTimeout(r, 20));
		assert.ok(most > 0, "the channel was busy at some point");
		assert.ok(most <= 2 * 1024 * 1024, `at most ${most} bytes waited in the channel`);
		assert.ok(Math.max(...sizes) <= 16 * 1024, `largest message ${Math.max(...sizes)}`);
	} finally {
		mac.close();
		browser.close();
	}
});

test("closing the browser's side ends the Mac's stream, and the other way round", async () => {
	for (const closer of ["browser", "mac"] as const) {
		const { mac, browser } = pair();
		const [a, b] = await Promise.all([mac.channel, browser.channel]);
		a.resume();
		b.resume();
		const other = closer === "browser" ? a : b;
		(closer === "browser" ? browser : mac).close();
		await ended(other);
		assert.ok(other.readableEnded || other.destroyed);
		await Promise.all([mac.closed, browser.closed]);
	}
});

test("ending the stream closes the connection on both sides", async () => {
	const { mac, browser } = pair();
	const [a, b] = await Promise.all([mac.channel, browser.channel]);
	b.resume();
	a.resume();
	a.end();
	await ended(b);
	await Promise.all([mac.closed, browser.closed]);
});

test("the path a connection took can be read from the peer: on this computer, the same network", async () => {
	const { mac, browser } = pair();
	try {
		assert.equal(mac.path(), undefined);
		await Promise.all([mac.channel, browser.channel]);
		assert.equal(mac.path(), "lan");
		assert.equal(browser.path(), "lan");
	} finally {
		mac.close();
		browser.close();
	}
});

test("a path is named from the addresses of the pair the connection chose", () => {
	assert.equal(pathOf("192.168.1.20", "192.168.1.10"), "lan");
	assert.equal(pathOf("fe80::1", "fe80::2"), "lan");
	assert.equal(pathOf("fd12::5", "fd12::6"), "lan");
	assert.equal(pathOf("203.0.113.7", "192.168.1.10"), "ipv4");
	assert.equal(pathOf("2001:db8::7", "2001:db8:1::9"), "ipv6");
	assert.equal(pathOf("::ffff:198.51.100.1", "10.0.0.2"), "ipv4");
});

test("a process whose connections all closed ends by itself: nothing is left holding it", async () => {
	// In a process of its own, since this test run is ended by force (`--test-force-exit`).
	const script = `
		import { answer, offer } from ${JSON.stringify(new URL("../electron/access/peer.ts", import.meta.url).href)};
		async function once(label) {
			let mac;
			const early = [];
			const browser = offer({ ice: [], label, send: (d) => (mac ? mac.signal(d) : early.push(d)) });
			mac = answer({ ice: [], timeoutMs: 800, send: (d) => browser.signal(d) });
			for (const d of early) mac.signal(d);
			await mac.channel.catch(() => {});
			mac.close();
			browser.close();
			await Promise.all([mac.closed, browser.closed]);
		}
		await once("ssh");
		await once("other");
		console.log("closed");
	`;
	const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
	let out = "";
	child.stdout.on("data", (b) => (out += b));
	const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
	const [code, signal] = await once(child, "exit");
	clearTimeout(timer);
	assert.equal(out.trim(), "closed");
	assert.equal(signal, null, "the process had to be killed: something held it after every connection closed");
	assert.equal(code, 0);
});

test("a channel with another label is not the one handed back, and is closed", async () => {
	let mac: Peer | undefined;
	const early: Signal[] = [];
	const browser = offer({ ice: [], label: "other", send: (d) => (mac ? mac.signal(d) : early.push(d)) });
	mac = answer({ ice: [], timeoutMs: 1500, send: (d) => browser.signal(d) });
	for (const d of early.splice(0)) mac.signal(d);
	await assert.rejects(mac.channel, /no ssh channel/);
	browser.close();
	await Promise.all([mac.closed, browser.closed]);
});
