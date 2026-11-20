// What the page draws of machines, read from the states and preferences the bridges hand it
// (desktop/src/machines.ts): a paired Mac by its name, never its id; a pairing under way on the
// first screen; how a pairing ended; and where the home-screen suggestion is offered.
import assert from "node:assert/strict";
import { test } from "node:test";
import { firstScreen, homeScreenKeeps, machineName, pairingEnded } from "../../desktop/src/machines.ts";

const MAC = "mac:q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x-_";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

test("a paired Mac is named by the name kept for it, or 'your Mac'; never by its id; a user@host machine by its host unless renamed", () => {
	assert.equal(machineName(MAC, { [MAC]: "Studio Mac" }), "Studio Mac");
	assert.equal(machineName(MAC, {}), "your Mac");
	assert.equal(machineName(MAC), "your Mac");
	assert.equal(machineName("me@box.example", {}), "me@box.example");
	assert.equal(machineName("me@box.example", { "me@box.example": "Box" }), "Box");
});

test("the first screen during a pairing: what to do before the Mac answered, then the four digits and 'Confirm on your Mac'", () => {
	const before = firstScreen({ status: "starting", pairing: { name: "Chrome on Android" } });
	assert.equal(before?.title, "Pairing with your Mac");
	assert.equal(before?.code, undefined);
	const asked = firstScreen({ status: "starting", pairing: { code: "4821", name: "Chrome on Android" } });
	assert.equal(asked?.title, "Confirm on your Mac");
	assert.equal(asked?.code, "4821");
	assert.match(asked?.about ?? "", /Chrome on Android/);
	assert.match(asked?.about ?? "", /4821/);
	assert.match(asked?.about ?? "", /Allow/);
	// No pairing: the first screen is drawn as before.
	assert.equal(firstScreen({ status: "starting" }), undefined);
	assert.equal(firstScreen({ status: "starting", host: MAC }), undefined);
});

test("how a pairing ended, from the state before and the one after: paired when a machine is reached next, failed on an error with no machine", () => {
	const asking = { status: "starting", pairing: { code: "4821", name: "Chrome on Android" } } as const;
	assert.equal(pairingEnded(asking, { status: "starting", host: MAC }), "paired");
	assert.equal(pairingEnded(asking, { status: "error", kind: "ssh", message: "Your Mac refused this browser." }), "failed");
	assert.equal(pairingEnded({ status: "starting", pairing: {} }, { status: "error", kind: "ssh", message: "expired" }), "failed");
	// Still pairing, or no pairing at all: nothing ended.
	assert.equal(pairingEnded({ status: "starting", pairing: {} }, asking), undefined);
	assert.equal(pairingEnded({ status: "starting", host: MAC }, { status: "error", kind: "ssh", host: MAC, message: "x" }), undefined);
	assert.equal(pairingEnded({ status: "starting" }, { status: "error", kind: "ssh", message: "x" }), undefined);
});

test("the home-screen suggestion is offered only where an installed web app keeps the browser's data: Android, not iOS or iPadOS, not a computer", () => {
	assert.equal(homeScreenKeeps(ANDROID), true);
	assert.equal(homeScreenKeeps(IPHONE), false);
	assert.equal(homeScreenKeeps(IPAD, 5), false);
	assert.equal(homeScreenKeeps(DESKTOP), false);
	assert.equal(homeScreenKeeps(""), false);
});
