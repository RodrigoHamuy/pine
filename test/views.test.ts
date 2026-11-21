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

test("a home gets pine's views once, the module views import, a tsconfig for the owner's editor and the guide to writing a view; after that the folder is the owner's", () => {
	const home = tmp();
	try {
		seedViews(home);
		const dir = path.join(home, "views");
		assert.ok(fs.existsSync(path.join(dir, "office.ts")));
		for (const name of ["workshop.ts", "overview.ts"]) assert.ok(fs.existsSync(path.join(dir, name)), `every view pine comes with: ${name}`);
		assert.equal(fs.readFileSync(path.join(dir, ".pine", "view.ts"), "utf8"), fs.readFileSync(path.resolve(import.meta.dirname, "..", "src", "view-kit.ts"), "utf8"));
		assert.match(fs.readFileSync(path.join(dir, "tsconfig.json"), "utf8"), /"pine\/view": \["\.\/\.pine\/view\.ts"\]/);
		// The guide for whoever writes a view, also a coding agent opened in the folder: it names what the module really has.
		const guide = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
		const kit = fs.readFileSync(path.join(dir, ".pine", "view.ts"), "utf8");
		for (const name of ["defineView", "running", "unsettled", "progress", "tasksOf", "tiling", "stages", "frame", "ease", "union", "inside", "along", "lengthOf", "hashOf", "seeded", "mix", "shade", "rgb"]) assert.ok(guide.includes("`" + name) && new RegExp(`export (function|const) ${name}\\b`).test(kit), `${name} is in the guide and in the module`);
		for (const field of ["agents", "work", "inputs", "schedules", "boards", "selected", "dark", "focused"]) assert.ok(guide.includes(`\`${field}\``) && new RegExp(`\\b${field}\\??:`).test(kit), `ViewState.${field}`);
		// It is the owner's while pine's guide is the same: a change is kept, and one that was taken out comes back.
		fs.writeFileSync(path.join(dir, "AGENTS.md"), "mine");
		seedViews(home);
		assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "mine");
		fs.rmSync(path.join(dir, "AGENTS.md"));
		seedViews(home);
		assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), guide);
		// What the guide describes changes (the module views import, here: as an older pine had it): it is written
		// anew. Untouched since pine wrote it, nothing of it is kept; changed by the owner, theirs is kept beside it.
		const stamp = path.join(dir, ".pine", "guide.json");
		const older = () => fs.writeFileSync(stamp, JSON.stringify({ ...JSON.parse(fs.readFileSync(stamp, "utf8")), for: "an-older-pine" }));
		older();
		seedViews(home);
		assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), guide);
		assert.ok(!fs.existsSync(path.join(dir, "AGENTS.before.md")), "an unchanged guide leaves nothing behind");
		fs.writeFileSync(path.join(dir, "AGENTS.md"), "mine, with notes");
		seedViews(home);
		assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), "mine, with notes", "the same pine: the owner's change stays");
		older();
		seedViews(home);
		assert.equal(fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8"), guide, "the API changed: the guide is pine's new one");
		assert.equal(fs.readFileSync(path.join(dir, "AGENTS.before.md"), "utf8"), "mine, with notes", "and the owner's is kept beside it");
		fs.rmSync(path.join(dir, "AGENTS.before.md"));
		// A file of the owner's own that was there before pine ever wrote a guide is left alone.
		const own = tmp();
		fs.mkdirSync(path.join(own, "views"));
		fs.writeFileSync(path.join(own, "views", "AGENTS.md"), "my own notes");
		seedViews(own);
		seedViews(own);
		assert.equal(fs.readFileSync(path.join(own, "views", "AGENTS.md"), "utf8"), "my own notes");
		fs.rmSync(own, { recursive: true, force: true });
		// The owner takes pine's views out: they stay out. The kit is brought back up to date all the same.
		for (const name of ["office.ts", "workshop.ts", "overview.ts"]) fs.rmSync(path.join(dir, name));
		fs.writeFileSync(path.join(dir, ".pine", "view.ts"), "old");
		seedViews(home);
		for (const name of ["office.ts", "workshop.ts", "overview.ts"]) assert.ok(!fs.existsSync(path.join(dir, name)), name);
		assert.notEqual(fs.readFileSync(path.join(dir, ".pine", "view.ts"), "utf8"), "old");
		assert.deepEqual(listViews(home), [], "the kit, the tsconfig and the guide are no views");
		assert.equal(viewInForce(undefined, listViews(home)), undefined, "no view: the app shows no button");
	} finally {
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test("a view pine comes with later reaches a home that is there already, once; the owner's files are left alone", () => {
	const home = tmp();
	try {
		// A home of an older pine: it was given the office, which its owner changed, and there was no list of what it was given.
		const dir = path.join(home, "views");
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, "office.ts"), "// mine now\n");
		seedViews(home);
		assert.equal(fs.readFileSync(path.join(dir, "office.ts"), "utf8"), "// mine now\n", "the office is the owner's");
		assert.equal(fs.readFileSync(path.join(dir, "workshop.ts"), "utf8"), fs.readFileSync(path.resolve(import.meta.dirname, "..", "examples", "home", "views", "workshop.ts"), "utf8"), "the view that is new to this home is there");
		assert.deepEqual(listViews(home).map((v) => v.id), ["office", "overview", "workshop"]);
		assert.equal(viewInForce(undefined, listViews(home)), "overview", "with no view chosen, pine's default is the one shown now");
		assert.equal(viewInForce("office", listViews(home)), "office", "and a view the owner chose stays the one shown");
		assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, ".pine", "seeded.json"), "utf8")), ["office.ts", "overview.ts", "workshop.ts"]);
		// Taken out, it stays out; changed, it stays as it is.
		fs.rmSync(path.join(dir, "workshop.ts"));
		seedViews(home);
		assert.ok(!fs.existsSync(path.join(dir, "workshop.ts")));
		// A home that never had the office and whose owner wrote a workshop of their own: nothing is written over.
		const own = tmp();
		fs.mkdirSync(path.join(own, "views"));
		fs.writeFileSync(path.join(own, "views", "workshop.ts"), "// my own workshop\n");
		seedViews(own);
		assert.equal(fs.readFileSync(path.join(own, "views", "workshop.ts"), "utf8"), "// my own workshop\n");
		assert.ok(!fs.existsSync(path.join(own, "views", "office.ts")), "an older home was given the office already: it is not brought back");
		fs.rmSync(own, { recursive: true, force: true });
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
		assert.equal(viewInForce(undefined, list), "enum", "the first view there is, when none is named and the folder has no overview");
		assert.equal(viewInForce(undefined, [...list, { id: "overview", file: path.join(dir, "overview.ts") }]), "overview", "pine's default, where it is there");
		assert.equal(viewInForce("gone", [...list, { id: "overview", file: path.join(dir, "overview.ts") }]), "overview", "a view that was chosen and is gone gives way to the default");
		assert.equal(viewInForce(undefined, [...list, { id: "overview", file: path.join(dir, "overview.ts"), problem: "too large for a view" }]), "enum", "a default that cannot be handed on is not shown");
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
	assert.equal(first.view, "overview", "none chosen: pine's default");
	assert.equal(first.chosen, null);
	assert.deepEqual(first.views.map((v: any) => v.id), ["office", "overview", "workshop"]);
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

test("the view kit lays a board's tasks out as tiles: a check under the work it checks, larger tiles where they fit, and what does not fit is counted", async () => {
	const { tiling, stages, progress, tasksOf, unsettled } = await import("../src/view-kit.ts");
	const t = (id: number, state: any, after: number[] = []) => ({ id, state, after });
	const board = (tasks: any[], more: object = {}): any => ({ id: 1, scope: "conversation", open: 0, taken: 0, done: 0, failed: 0, blocked: 0, notes: 0, workers: [], tasks, ...more });
	// Three pieces of work and a check of each: three columns, the check under its work.
	const checked = board([t(1, "done"), t(2, "taken"), t(3, "open"), t(4, "done", [1]), t(5, "waiting", [2]), t(6, "waiting", [3])], { open: 3, taken: 1, done: 2 });
	const g = tiling(checked, 108, 60, [[8, 2], [6, 2], [4, 1]], 3);
	assert.deepEqual([g.size, g.gap, g.more, g.height], [8, 2, 0, 18]);
	assert.deepEqual(g.tiles.map((k) => [k.task.id, k.x, k.y]), [[1, 0, 0], [2, 10, 0], [3, 20, 0], [4, 0, 10], [5, 10, 10], [6, 20, 10]]);
	assert.deepEqual(stages(checked).map((row) => row.map((k) => k.id)), [[1, 2, 3], [4, 5, 6]]);
	assert.equal(progress(checked), 2 / 6);
	assert.equal(unsettled(checked), 4);
	// A second check of the same work goes further down its column; a task after two others stands under the first.
	assert.deepEqual(tiling(board([t(1, "done"), t(2, "open", [1]), t(3, "open", [1]), t(4, "open"), t(5, "waiting", [4, 1])]), 100, 60, [[8, 2]]).tiles.map((k) => [k.task.id, k.x, k.y]), [[1, 0, 0], [2, 0, 10], [3, 0, 20], [4, 10, 0], [5, 10, 10]]);
	// Many tasks: the largest tile with which all fit; where a little smaller keeps them in one band, that one.
	const many = (n: number) => board(Array.from({ length: n }, (_, i) => t(i + 1, "open")));
	assert.equal(tiling(many(11), 108, 60, [[8, 2], [7, 2], [6, 2]]).size, 8);
	assert.deepEqual([tiling(many(12), 108, 60, [[8, 2], [7, 2], [6, 2]]).size, Math.max(...tiling(many(12), 108, 60, [[8, 2], [7, 2], [6, 2]]).tiles.map((k) => k.y))], [7, 0], "twelve stand in one row of slightly smaller tiles");
	assert.equal(tiling(many(12), 24, 13, [[2, 1], [1, 1]]).size, 2, "a tile half the size is not a little smaller: two bands of the larger");
	// More than fit even in the smallest: the rest is counted, and nothing lies outside the box.
	const over = tiling(many(500), 108, 60, [[8, 2], [4, 1]]);
	assert.equal(over.size, 4);
	assert.ok(over.more > 0 && over.tiles.length + over.more === 500);
	assert.ok(over.tiles.every((k) => k.x + over.size <= 108 && k.y + over.size <= 60));
	// A board without tasks, and a board as an older app tells it (no `tasks`), take no room.
	assert.deepEqual(tiling(board([]), 108, 60, [[8, 2]]), { size: 0, gap: 0, tiles: [], height: 0, more: 0 });
	const old = board([]);
	delete old.tasks;
	assert.deepEqual(tasksOf(old), []);
	assert.equal(tiling(old, 108, 60, [[8, 2]]).tiles.length, 0);
});
