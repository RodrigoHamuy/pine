// What a view is told (view-state.ts), without a window: the shape of pine, and none of its text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { happeningsOf, knownTarget, viewStateOf } from "../src/view-state.ts";
import { World } from "../src/view-world.ts";

let id = 1;
const ev = (topic: string, payload: any, more: { source?: string; trust?: string } = {}) => ({ id: id++, ts: Date.now(), topic, source: more.source ?? `agent:${payload.agent}`, payload, trust: more.trust ?? "owner" });
const SECRET = "CANARY-7731";

function busyWorld() {
	const w = new World();
	w.setPlaces([
		{ id: "main", main: true, mode: "safe", description: `the owner's own words ${SECRET}` },
		{ id: "books", main: false, mode: "bypass", description: "" },
	]);
	const batch = [
		ev("source/inbox/mail", { text: `a mail about ${SECRET}` }, { source: "source:inbox", trust: "untrusted" }),
		ev("agent/main/started", { task: 1, agent: "main", session: `notes-${SECRET}`, root: 1, depth: 0, kind: "prompt", prompt: `Please look at ${SECRET}` }),
		ev("agent/main/tool", { task: 1, agent: "main", session: `notes-${SECRET}`, root: 1, depth: 0, phase: "start", tool: "delegate", subject: `books: ${SECRET}` }),
		ev("agent/books/started", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, kind: "delegate", prompt: `[task from agent main]\nCount ${SECRET}` }),
		ev("agent/books/tool", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, phase: "start", tool: "read", subject: `/Users/owner/${SECRET}/notes.md` }),
		ev("agent/books/tool", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, phase: "start", tool: "read", subject: `/Users/owner/.pine/skills/invoices/SKILL.md` }),
		ev("approval/requested", { id: "q1", agent: "books", task: 2, root: 1, tool: "bash", summary: `bash: cat ${SECRET}` }, { source: "approvals" }),
		ev("agent/books/delta", { task: 2, agent: "books", session: "_t2", root: 1, parent: 1, depth: 1, text: `the answer is ${SECRET}` }),
	];
	w.take(batch);
	w.setRooms([{ agent: "books", session: "_t2", busy: true, outside: `a page about ${SECRET}`, mode: "safe", trust: "owner" }]);
	return { w, batch };
}

test("a view is told who works on what, how and from where, and not one word of what anybody said", () => {
	const { w, batch } = busyWorld();
	const holdings = new Map([["books", { servers: ["web"], skills: ["invoices"], sources: ["inbox"], schedules: [] }]]);
	const state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	const happened = happeningsOf(batch, w, holdings);
	const all = JSON.stringify({ state, happened });
	assert.ok(!all.includes(SECRET), `nothing private reaches a view: ${all.slice(all.indexOf(SECRET) - 80, all.indexOf(SECRET) + 20)}`);
	assert.ok(!all.includes("/Users/owner"), "no path");
	assert.ok(!all.includes("notes-"), "no conversation's name");

	const books = state.work.find((x) => x.agent === "books")!;
	assert.deepEqual(books.from, { k: "agent", id: "main" });
	assert.equal(books.asking, true);
	assert.equal(books.held, true, "books works in bypass by itself and is held to main's safe mode");
	assert.equal(books.outside, true);
	assert.deepEqual(state.agents.find((a) => a.id === "books")!.mcp, ["web"]);
	assert.ok(happened.some((h) => h.k === "handed" && h.from === "main" && h.to === "books"));
	assert.ok(happened.some((h) => h.k === "skill" && h.skill === "invoices"), "a skill the agent has is named");
	assert.ok(happened.some((h) => h.k === "asked" && h.work === 2));
	assert.ok(happened.some((h) => h.k === "event" && h.input === "source:inbox"));
});

test("what a view asks the panel to show or open is checked against what the panel knows", () => {
	const { w } = busyWorld();
	assert.deepEqual(knownTarget(w, { agent: "books" }), { agent: "books" });
	assert.deepEqual(knownTarget(w, { work: 2 }), { work: 2 });
	assert.equal(knownTarget(w, { agent: "nobody" }), undefined);
	assert.equal(knownTarget(w, { work: "2" }), undefined);
	assert.equal(knownTarget(w, "main"), undefined);
});
