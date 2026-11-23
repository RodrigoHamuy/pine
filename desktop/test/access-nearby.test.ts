// Being found on the local network (electron/access/nearby.ts): what the announcement says, that the
// library is made only while something is announced, and which `pine:` addresses the app takes.
// A stand-in for the library: no multicast leaves the test.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnnouncer, isPairAddress, type Mdns, NEARBY_PORT, NEARBY_TYPE, txtOf } from "../electron/access/nearby.ts";

const ID = "A".repeat(43);
const SERVICE = "https://pine.example.workers.dev";
const NONCE = "n".repeat(22);

function fakeLibrary() {
	const made: Array<{ published: any[]; destroyed: boolean }> = [];
	const make = (): Mdns => {
		const one = { published: [] as any[], destroyed: false };
		made.push(one);
		return { publish: (config) => void one.published.push(config), destroy: () => void (one.destroyed = true) };
	};
	return { made, make };
}

test("nearby: the record says the version, the machine id and the service, under _pine._tcp, and no name of the computer's", () => {
	const lib = fakeLibrary();
	const announcer = createAnnouncer(lib.make);
	announcer.announce({ id: ID, service: SERVICE, nonce: NONCE });
	assert.equal(lib.made.length, 1);
	const [config] = lib.made[0].published;
	assert.equal(config.type, NEARBY_TYPE);
	assert.equal(config.protocol, "tcp");
	assert.equal(config.port, NEARBY_PORT);
	assert.equal(config.name, "Pine AAAAAAAA");
	assert.deepEqual(config.txt, { v: "1", id: ID, service: SERVICE, nonce: NONCE });
	assert.deepEqual(txtOf({ id: ID, service: SERVICE, nonce: NONCE }), config.txt);
});

test("nearby: nothing is made before an announcement, and a stop destroys the library (its socket and its records)", () => {
	const lib = fakeLibrary();
	const announcer = createAnnouncer(lib.make);
	announcer.announce(undefined);
	assert.equal(lib.made.length, 0);
	announcer.announce({ id: ID, service: SERVICE, nonce: NONCE });
	announcer.announce(undefined);
	assert.equal(lib.made[0].destroyed, true);
	announcer.announce({ id: ID, service: "https://other.example", nonce: NONCE });
	assert.equal(lib.made.length, 2);
	announcer.stop();
	assert.equal(lib.made[1].destroyed, true);
});

test("nearby: only pine://pair opens a pairing; the mobile app's links and anything else under pine: do not", () => {
	for (const ok of ["pine://pair", "pine://pair/", "PINE://pair", " pine://pair "]) assert.equal(isPairAddress(ok), true, ok);
	for (const no of ["pine://pair?service=https%3A%2F%2Fx&id=a&code=b", "pine://pair#x", "pine://pairs", "pine://other", "https://pine/pair", "pine:pair", ""]) assert.equal(isPairAddress(no), false, no);
});
