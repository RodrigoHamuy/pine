// The configurations that are deployed, read as wrangler reads them:
// - the default one (today's deployment and every preview of .github/workflows/web-preview.yml):
//   the relay on, and no meeting service, since a Worker that holds a Durable Object can be
//   neither uploaded as a version with a new class nor given version addresses;
// - `official`, the project's service and the one environment with the meeting service: the
//   meeting service and the relay, on workers.dev. A deployment of one's own uses the same
//   environment under a name of its own.
// None of them has any logs.
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
const { official } = config.env;

test("the default configuration declares no Durable Object, so that the preview workflow can still upload versions with addresses", () => {
	assert.equal(config.durable_objects, undefined);
	assert.equal(config.migrations, undefined);
	assert.equal(config.preview_urls, true);
	assert.equal(config.workers_dev, false);
	assert.equal(config.name, "pine-relay");
});

test("official is the one environment: a deployment of one's own with the meeting service uses it under a name of its own", () => {
	assert.deepEqual(Object.keys(config.env), ["official"]);
});

test("the relay is on by default and in the official service", () => {
	assert.equal(config.vars.RELAY, "on");
	assert.equal(official.vars.RELAY, "on");
});

test("the official service has an address of its own on workers.dev", () => {
	assert.equal(official.name, "pine");
	assert.equal(official.workers_dev, true);
});

test("official declares the meeting's Durable Object backed by SQLite, as the free plan requires, and asks for no version addresses", () => {
	assert.deepEqual(official.durable_objects.bindings, [{ name: "MEET", class_name: "Meeting" }]);
	assert.ok(official.migrations.some((m: any) => m.new_sqlite_classes?.includes("Meeting")));
	assert.ok(!official.migrations.some((m: any) => m.new_classes?.includes("Meeting")), "a key-value class is not on the free plan");
	assert.equal(official.preview_urls, false);
	assert.ok(official.vars.ICE.every((s: any) => /^stun:/.test(s.urls)));
});

test("every configuration has the rate limit and the web client's files", () => {
	for (const [name, c] of [["default", config], ["official", official]]) {
		assert.ok(c.ratelimits.some((r: any) => r.name === "LIMITER"), name);
		assert.equal(c.assets.binding, "ASSETS", name);
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
