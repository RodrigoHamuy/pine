// The meeting service's logic, driven the way a Node server drives it (`inMemory`): a Mac proves
// its key and waits under its machine id, a browser that names the id is put through, and a few
// small messages cross under the limits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSE, inMemory, type Limits } from "../src/meet.ts";
import { macKey, ORIGIN, Sock } from "./meet-support.ts";

/** A Mac that has proved its key and waits. */
async function waitingMac(meetings: ReturnType<typeof inMemory>, key = macKey()) {
	const sock = new Sock();
	const conn = meetings.connect("host", key.id, ORIGIN, sock);
	const { nonce } = await sock.got("challenge");
	await conn.message(key.proof(nonce));
	await sock.got("waiting");
	return { sock, conn, key };
}

async function joined(meetings: ReturnType<typeof inMemory>, id: string) {
	const sock = new Sock();
	const conn = meetings.connect("join", id, ORIGIN, sock);
	return { sock, conn };
}

test("a Mac is sent a random challenge, and waits after a valid proof", async () => {
	const meetings = inMemory();
	const key = macKey();
	const a = new Sock();
	const b = new Sock();
	meetings.connect("host", key.id, ORIGIN, a);
	meetings.connect("host", key.id, ORIGIN, b);
	const first = await a.got("challenge");
	const second = await b.got("challenge");
	assert.match(first.nonce, /^[A-Za-z0-9_-]{43}$/);
	assert.notEqual(first.nonce, second.nonce);
	const mac = await waitingMac(meetings, key);
	assert.equal(mac.sock.closed, null);
});

test("a wrong signature is closed, and the Mac does not wait", async () => {
	const meetings = inMemory();
	const key = macKey();
	const other = macKey();
	const sock = new Sock();
	const conn = meetings.connect("host", key.id, ORIGIN, sock);
	const { nonce } = await sock.got("challenge");
	// Signed by another key, over the right text, but presented with this Mac's key.
	await conn.message(key.proof(nonce, ORIGIN, other.privateKey));
	assert.equal((await sock.closes()).code, CLOSE.proof);
	const browser = await joined(meetings, key.id);
	assert.equal((await browser.sock.closes()).code, CLOSE.absent);
});

test("a signature over another service's address or another challenge is closed", async () => {
	const meetings = inMemory();
	const key = macKey();
	for (const proof of [(nonce: string) => key.proof(nonce, "https://elsewhere.example"), () => key.proof("A".repeat(43))]) {
		const sock = new Sock();
		const conn = meetings.connect("host", key.id, ORIGIN, sock);
		const { nonce } = await sock.got("challenge");
		await conn.message(proof(nonce));
		assert.equal((await sock.closes()).code, CLOSE.proof);
	}
});

test("a key whose fingerprint is not the id is closed, even with a valid signature", async () => {
	const meetings = inMemory();
	const owner = macKey();
	const stranger = macKey();
	const sock = new Sock();
	const conn = meetings.connect("host", owner.id, ORIGIN, sock);
	const { nonce } = await sock.got("challenge");
	await conn.message(stranger.proof(nonce));
	assert.equal((await sock.closes()).code, CLOSE.proof);
	const browser = await joined(meetings, owner.id);
	assert.equal((await browser.sock.closes()).code, CLOSE.absent);
});

test("a Mac that sends anything before its proof is closed", async () => {
	const meetings = inMemory();
	const key = macKey();
	const sock = new Sock();
	const conn = meetings.connect("host", key.id, ORIGIN, sock);
	await sock.got("challenge");
	await conn.message(JSON.stringify({ t: "signal", s: "x", d: {} }));
	assert.equal((await sock.closes()).code, CLOSE.proof);
});

test("a Mac that does not prove its key in time is closed", async () => {
	const meetings = inMemory({ limits: { proofMs: 40 } });
	const key = macKey();
	const sock = new Sock();
	meetings.connect("host", key.id, ORIGIN, sock);
	assert.equal((await sock.closes()).code, CLOSE.proof);
});

test("a newer proven socket for an id replaces the older one", async () => {
	const meetings = inMemory();
	const key = macKey();
	const older = await waitingMac(meetings, key);
	const newer = await waitingMac(meetings, key);
	assert.equal((await older.sock.closes()).code, CLOSE.replaced);
	assert.equal(newer.sock.closed, null);
	const browser = await joined(meetings, key.id);
	await browser.sock.got("ready");
	assert.equal((await newer.sock.got("open")).t, "open");
	assert.equal(older.sock.sent.filter((m) => m.t === "open").length, 0);
});

test("a socket that has not proved its key replaces nobody", async () => {
	const meetings = inMemory();
	const key = macKey();
	const mac = await waitingMac(meetings, key);
	const pretender = new Sock();
	const conn = meetings.connect("host", key.id, ORIGIN, pretender);
	const { nonce } = await pretender.got("challenge");
	await conn.message(macKey().proof(nonce));
	await pretender.closes();
	assert.equal(mac.sock.closed, null);
});

test("a browser that names an id with no Mac waiting is told so and closed", async () => {
	const meetings = inMemory();
	const browser = await joined(meetings, macKey().id);
	assert.equal((await browser.sock.closes()).code, CLOSE.absent);
	assert.deepEqual(browser.sock.sent, []);
});

test("with a Mac waiting, signals pass both ways under a session the service chose", async () => {
	const meetings = inMemory();
	const mac = await waitingMac(meetings);
	const browser = await joined(meetings, mac.key.id);
	assert.deepEqual(await browser.sock.got("ready"), { t: "ready" });
	const { s } = await mac.sock.got("open");
	assert.match(s, /^[A-Za-z0-9_-]{22}$/);

	const offer = { sdp: { type: "offer", sdp: "v=0..." } };
	await browser.conn.message(JSON.stringify({ t: "signal", d: offer }));
	assert.deepEqual(mac.sock.last(), { t: "signal", s, d: offer });

	const answer = { sdp: { type: "answer", sdp: "v=0..." } };
	await mac.conn.message(JSON.stringify({ t: "signal", s, d: answer }));
	assert.deepEqual(browser.sock.last(), { t: "signal", d: answer });

	// A second browser gets a session of its own, and nothing of the first one's.
	const second = await joined(meetings, mac.key.id);
	await second.sock.got("ready");
	const opened = mac.sock.sent.filter((m) => m.t === "open").map((m) => m.s);
	assert.equal(opened.length, 2);
	assert.notEqual(opened[0], opened[1]);
	assert.equal(second.sock.sent.filter((m) => m.t === "signal").length, 0);
});

test("a browser that leaves is told to the Mac, and a Mac that ends a session closes the browser", async () => {
	const meetings = inMemory();
	const mac = await waitingMac(meetings);
	const leaving = await joined(meetings, mac.key.id);
	const { s } = await mac.sock.got("open");
	await leaving.conn.closed();
	assert.deepEqual(mac.sock.last(), { t: "close", s });

	const ended = await joined(meetings, mac.key.id);
	await ended.sock.got("ready");
	const second = mac.sock.sent.filter((m) => m.t === "open")[1].s;
	await mac.conn.message(JSON.stringify({ t: "close", s: second }));
	assert.equal((await ended.sock.closes()).code, 1000);
});

test("a Mac that leaves closes the browsers it was meeting", async () => {
	const meetings = inMemory();
	const mac = await waitingMac(meetings);
	const browser = await joined(meetings, mac.key.id);
	await browser.sock.got("ready");
	await mac.conn.closed();
	assert.equal((await browser.sock.closes()).code, CLOSE.absent);
	const late = await joined(meetings, mac.key.id);
	assert.equal((await late.sock.closes()).code, CLOSE.absent);
});

test("a browser's message that is not a signal is closed as a bad message", async () => {
	const meetings = inMemory();
	const mac = await waitingMac(meetings);
	for (const bad of ["not json", JSON.stringify({ t: "proof" }), JSON.stringify({ t: "signal" }), new Uint8Array([1, 2, 3])]) {
		const browser = await joined(meetings, mac.key.id);
		await browser.sock.got("ready");
		await browser.conn.message(bad);
		assert.equal((await browser.sock.closes()).code, CLOSE.bad, String(bad));
	}
});

async function session(limits: Partial<Limits>) {
	const meetings = inMemory({ limits });
	const mac = await waitingMac(meetings);
	const browser = await joined(meetings, mac.key.id);
	await browser.sock.got("ready");
	const { s } = await mac.sock.got("open");
	return { mac, browser, s };
}

test("a message over 16 KiB ends the session", async () => {
	const t = await session({});
	const big = JSON.stringify({ t: "signal", d: { sdp: { type: "offer", sdp: "x".repeat(16 * 1024) } } });
	await t.browser.conn.message(big);
	assert.equal((await t.browser.sock.closes()).code, CLOSE.limits);
	assert.deepEqual(t.mac.sock.last(), { t: "close", s: t.s });

	// From the Mac's side too.
	const u = await session({ maxBytes: 200 });
	await u.mac.conn.message(JSON.stringify({ t: "signal", s: u.s, d: { sdp: { type: "answer", sdp: "x".repeat(300) } } }));
	assert.equal((await u.browser.sock.closes()).code, CLOSE.limits);
	assert.equal(u.mac.sock.closed, null);
});

test("a message just under the limit passes", async () => {
	const t = await session({});
	const text = JSON.stringify({ t: "signal", d: { sdp: { type: "offer", sdp: "" } } });
	const fits = JSON.stringify({ t: "signal", d: { sdp: { type: "offer", sdp: "x".repeat(16 * 1024 - text.length) } } });
	assert.equal(Buffer.byteLength(fits), 16 * 1024);
	await t.browser.conn.message(fits);
	assert.equal(t.browser.sock.closed, null);
	assert.equal(t.mac.sock.last().t, "signal");
});

test("the 65th message of a session ends it, counted both ways", async () => {
	const t = await session({});
	const signal = (from: "mac" | "browser") =>
		from === "mac" ? t.mac.conn.message(JSON.stringify({ t: "signal", s: t.s, d: { ice: { candidate: "c", sdpMid: null, sdpMLineIndex: 0 } } })) : t.browser.conn.message(JSON.stringify({ t: "signal", d: { ice: { candidate: "c", sdpMid: "0", sdpMLineIndex: null } } }));
	for (let i = 0; i < 64; i++) await signal(i % 2 ? "mac" : "browser");
	assert.equal(t.browser.sock.closed, null);
	await signal("mac");
	assert.equal((await t.browser.sock.closes()).code, CLOSE.limits);
	assert.deepEqual(t.mac.sock.last(), { t: "close", s: t.s });
});

test("a session older than its time limit ends", async () => {
	const t = await session({ sessionMs: 50 });
	assert.equal((await t.browser.sock.closes()).code, CLOSE.timeout);
	assert.deepEqual(t.mac.sock.last(), { t: "close", s: t.s });
	// The Mac keeps waiting for the next browser.
	assert.equal(t.mac.sock.closed, null);
});

test("the limits are 16 KiB, 64 messages and 30 seconds by default", async () => {
	const { LIMITS } = await import("../src/meet.ts");
	assert.equal(LIMITS.maxBytes, 16384);
	assert.equal(LIMITS.maxMessages, 64);
	assert.equal(LIMITS.sessionMs, 30_000);
});

test("ids of different Macs meet apart", async () => {
	const meetings = inMemory();
	const one = await waitingMac(meetings);
	const two = await waitingMac(meetings);
	const browser = await joined(meetings, two.key.id);
	await browser.sock.got("ready");
	assert.equal(one.sock.sent.filter((m) => m.t === "open").length, 0);
	assert.equal(two.sock.sent.filter((m) => m.t === "open").length, 1);
});
