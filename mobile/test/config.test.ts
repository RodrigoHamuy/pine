// Capacitor's configuration: the page comes from the app itself and goes nowhere else.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { APP_ORIGIN } from "../src/plugin.ts";

const config = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "../capacitor.config.json"), "utf8"));

test("no remote content: the page is the built one, served by the app", () => {
	assert.equal(config.server.url, undefined);
	assert.equal(config.webDir, "dist");
	assert.equal(config.android?.allowMixedContent, false);
});

test("no navigation away from the page", () => {
	assert.deepEqual(config.server.allowNavigation, []);
});

test("the page's origin is the one its media base and policy name", () => {
	assert.equal(`${config.server.androidScheme}://${config.server.hostname}`, APP_ORIGIN);
});
