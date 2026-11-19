import assert from "node:assert/strict";
import { test } from "node:test";
import { isName } from "../src/addresses.ts";
import { relay } from "../src/relay.ts";
import { limiter, names, pairs, request } from "./support.ts";

// The relay refuses before it upgrades: no WebSocket is made and nothing is connected.
async function refused(host: string, table: Record<string, string[]> = {}) {
	const calls: unknown[] = [];
	const { clients, upgrade } = pairs();
	const handle = relay({
		connect: (address) => {
			calls.push(address);
			throw new Error("connect() must not be called");
		},
		resolve: names(table),
		upgrade,
		timeoutMs: 1000,
	});
	const response = await handle(request(host), { LIMITER: limiter() });
	return { status: response.status, upgraded: clients.length > 0, connected: calls.length > 0 };
}

const NOT_REACHED = { status: 403, upgraded: false, connected: false };

test("private addresses are refused", async () => {
	for (const host of ["10.0.0.5", "172.16.3.4", "172.31.255.255", "192.168.1.10", "100.64.0.1", "[fd12:3456::1]", "fc00::1"]) {
		assert.deepEqual(await refused(host), NOT_REACHED, host);
	}
});

test("loopback addresses are refused, also behind a name or written another way", async () => {
	for (const host of ["127.0.0.1", "127.1.2.3", "::1", "[::1]", "0.0.0.0", "::", "::ffff:127.0.0.1", "[::ffff:7f00:1]", "0:0:0:0:0:0:0:1", "localhost"]) {
		assert.deepEqual(await refused(host, { localhost: ["127.0.0.1"] }), NOT_REACHED, host);
	}
});

test("link-local addresses are refused, the cloud metadata address among them", async () => {
	for (const host of ["169.254.169.254", "169.254.0.1", "fe80::1", "[fe80::abcd%25eth0]"]) {
		assert.deepEqual(await refused(host), NOT_REACHED, host);
	}
});

test("Cloudflare's own addresses are refused", async () => {
	for (const host of ["104.16.0.1", "172.67.1.1", "162.158.0.1", "2606:4700::1111", "1.1.1.1"]) {
		assert.deepEqual(await refused(host), NOT_REACHED, host);
	}
});

test("a name with a refused address among its addresses is refused", async () => {
	assert.deepEqual(await refused("mixed.example.org", { "mixed.example.org": ["198.51.100.7", "10.0.0.1"] }), NOT_REACHED);
});

test("multicast, broadcast and reserved addresses are refused", async () => {
	for (const host of ["224.0.0.1", "255.255.255.255", "240.0.0.1", "ff02::1"]) {
		assert.deepEqual(await refused(host), NOT_REACHED, host);
	}
});

test("a public address is let through, written as it is or behind a name", async () => {
	const cases: [string, Record<string, string[]>][] = [
		["198.51.100.7", {}],
		["2001:db8::7", {}],
		["[2001:db8::7]", {}],
		["ssh.example.org", { "ssh.example.org": ["198.51.100.7"] }],
	];
	for (const [host, table] of cases) {
		const { clients, upgrade } = pairs();
		const handle = relay({
			connect: () => {
				throw new Error("not reached in this test");
			},
			resolve: names(table),
			upgrade,
			timeoutMs: 1000,
		});
		await handle(request(host), { LIMITER: limiter() });
		assert.equal(clients.length, 1, host);
		clients[0].end.close(1000);
	}
});

// Any ?host= reaches isName, so a pattern that backtracks would let one request use up the Worker's CPU.
test("a long host that is not a name is refused at once", { timeout: 2000 }, () => {
	for (const text of ["a".repeat(60) + "!", "a".repeat(252) + "!", "a-".repeat(100) + "!", "a.".repeat(120) + "!"]) {
		const start = performance.now();
		assert.equal(isName(text), false, text);
		assert.ok(performance.now() - start < 50, text);
	}
});

test("names are labels of letters, digits and inner hyphens, with one trailing dot allowed", () => {
	for (const text of ["example.org", "ssh.example.org", "example.org.", "a-b.example", "x1", "a".repeat(63) + ".org"]) {
		assert.equal(isName(text), true, text);
	}
	for (const text of ["", ".", "1.2.3.4", "-a.org", "a-.org", "a..org", ".a.org", "a".repeat(64) + ".org", "a_b.org", "a".repeat(254)]) {
		assert.equal(isName(text), false, text);
	}
});
