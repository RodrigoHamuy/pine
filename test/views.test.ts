// The views of the Pine app's panel (src/views.ts): scripts of the owner's in <home>/views, chosen with
// `ui.view`. The daemon lists them and hands one over with its types taken away; it runs none of them.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listViews, seedViews, viewCode, viewInForce } from "../src/views.ts";
import { type Harness, harness } from "./support/harness.ts";

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-views-")));

test("a home gets pine's views once, the module views import and a tsconfig for the owner's editor; after that the folder is the owner's", () => {
	const home = tmp();
	try {
		seedViews(home);
		const dir = path.join(home, "views");
		assert.ok(fs.existsSync(path.join(dir, "office.ts")));
		assert.equal(fs.readFileSync(path.join(dir, ".pine", "view.ts"), "utf8"), fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "view-kit.ts"), "utf8"));
		assert.match(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"), /"pine\/view": \["\.\/\.pine\/view\.ts"\]/);
		// The owner takes the office out: it stays out. The kit is brought back up to date all the same.
		fs.rmSync(path.join(dir, "office.ts"));
		fs.writeFileSync(path.join(dir, ".pine", "view.ts"), "old");
		seedViews(home);
		assert.ok(!fs.existsSync(path.join(dir, "office.ts")));
		assert.notEqual(fs.readFileSync(path.join(dir, ".pine", "view.ts"), "utf8"), "old");
		assert.deepEqual(listViews(home), [], "the kit and the tsconfig are no views");
		assert.equal(viewInForce(undefined, listViews(home)), undefined, "no view: the app shows no button");
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("a view is handed over as JavaScript, its types taken away; one that cannot be read says why", () => {
	const home = tmp();
	try {
		const dir = path.join(home, "views");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "plain.ts"), 'import { defineView, type ViewHost } from "pine/view";\nexport default defineView((host: ViewHost): void => { host.root.textContent = "hi"; });\n');
		fs.writeFileSync(path.join(dir, "old.js"), 'export default { pineView: 1, start() {} };\n');
		fs.writeFileSync(path.join(dir, "enum.ts"), "enum E { A }\nexport default E;\n");
		fs.writeFileSync(path.join(dir, "Bad Name.ts"), "");
		fs.writeFileSync(path.join(dir, "notes.md"), "");
		const list = listViews(home);
		assert.deepEqual(list.map((v) => [v.id, "problem" in v]), [["Bad Name", true], ["enum", false], ["old", false], ["plain", false]]);
		const plain = viewCode(home, "plain");
		assert.ok("code" in plain);
		assert.ok(!/ViewHost|: void/.test(plain.code), "no types left");
		assert.match(plain.code, /from "pine\/view"/, "the import is left for the frame to point at the kit");
		assert.match(JSON.stringify(viewCode(home, "enum")), /cannot be read.*no enum/);
		assert.match(JSON.stringify(viewCode(home, "../pine")), /there is no view/);
		assert.equal(viewInForce(undefined, list), "enum", "the first view there is, when none is named");
		assert.equal(viewInForce("plain", list), "plain");
		assert.equal(viewInForce("off", list), undefined);
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("the owner's UI lists the views and sets ui.view, or off; a view that is not there is refused", async () => {
	const h: Harness = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const call = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	const first = (await call("GET", "/views")).body;
	assert.equal(first.view, "office");
	assert.equal(first.chosen, null);
	const code = (await call("GET", "/views/office")).body;
	assert.match(code.code, /defineView/);
	assert.equal((await call("POST", "/settings", { key: "ui.view", value: "nowhere" })).status >= 400, true);
	assert.equal((await call("POST", "/settings", { key: "ui.view", value: "off" })).status, 200);
	assert.equal((await call("GET", "/views")).body.view, null);
	assert.equal((await call("POST", "/settings", { key: "ui.view", value: "office" })).status, 200);
	assert.equal((await call("GET", "/views")).body.view, "office");
	// Without the token, nothing: a view's code is the owner's.
	assert.equal((await fetch(`${base}/views/office`)).status, 401);
});
