// The configurations that are deployed, read as wrangler reads them: the default one (an owner's
// own deployment, relay on) and `official` (the project's service, relay off), each with the
// meeting service declared the way the free plan requires, and neither with any logs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.join(import.meta.dirname, "..");
/** wrangler.jsonc without its comments, which here stand on lines of their own. */
const config = JSON.parse(
	readFileSync(path.join(root, "wrangler.jsonc"), "utf8")
		.split("\n")
		.filter((line) => !/^\s*\/\//.test(line))
		.join("\n"),
);
const official = config.env.official;

test("the default configuration keeps the relay on, and the official one turns it off", () => {
	assert.equal(config.vars.RELAY, "on");
	assert.equal(official.vars.RELAY, "off");
});

test("the official service has an address of its own on workers.dev", () => {
	assert.equal(official.workers_dev, true);
	assert.equal(config.workers_dev, false);
	assert.equal(typeof official.name, "string");
});

test("both configurations declare the meeting's Durable Object backed by SQLite, as the free plan requires", () => {
	for (const [name, c] of [["default", config], ["official", official]]) {
		assert.deepEqual(c.durable_objects.bindings, [{ name: "MEET", class_name: "Meeting" }], name);
		const migrations = c.migrations ?? config.migrations;
		assert.ok(migrations.some((m: any) => m.new_sqlite_classes?.includes("Meeting")), name);
		assert.ok(!migrations.some((m: any) => m.new_classes?.includes("Meeting")), `${name}: a key-value class is not on the free plan`);
		assert.ok(c.ratelimits.some((r: any) => r.name === "LIMITER"), name);
		assert.ok(c.vars.ICE.every((s: any) => /^stun:/.test(s.urls)), name);
	}
});

test("observability stays off in every configuration", () => {
	assert.equal(config.observability.enabled, false);
	for (const [name, c] of Object.entries<any>(config.env)) assert.equal(c.observability?.enabled, false, name);
});

test("nothing of a meeting is logged", () => {
	for (const file of ["meet.ts", "meet-object.ts", "site.ts", "worker.ts"]) {
		assert.doesNotMatch(readFileSync(path.join(root, "src", file), "utf8"), /\bconsole\./, file);
	}
});
