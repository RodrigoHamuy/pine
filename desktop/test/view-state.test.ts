// What a view is told (view-state.ts), without a window: the shape of pine, and none of its text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { happeningsOf, knownTarget, talkHappenings, viewStateOf } from "../src/view-state.ts";
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

test("a view is told of conversations, branches and worktrees as numbers, of schedules and when they run, of a skill in use, a to-do list and a goal", () => {
	const w = new World();
	w.setPlaces([
		{ id: "main", main: true, mode: "safe", description: "" },
		{ id: "books", main: false, mode: "safe", description: "" },
	]);
	const holdings = new Map([["books", { servers: [], skills: ["invoices"], sources: ["inbox"], schedules: ["daily"] }]]);
	const convs = (more: any[] = []) => [{ session: "main", last: 5 }, { session: `tax-${SECRET}`, last: 9, branch: { from: "main", at: 3 }, worktree: { branch: `pine/tax-${SECRET}`, base: "main", path: `/Users/owner/${SECRET}`, repo: "/Users/owner/shop" } }, { session: "main~u", last: 1 }, ...more];
	assert.deepEqual(w.setConversations("books", convs()), [], "the first look is no news");
	w.setSources([{ name: "inbox", type: "mail", events: 3, subscribers: ["books", `main:notes-${SECRET}`], error: `could not sign in as ${SECRET}` }]);
	w.setSchedules([
		{ name: "daily", scope: "books", when: 'at the times "0 9 * * 1-5" (minute hour day month weekday)', next: Date.now() + 60_000 },
		{ name: "sweep", scope: "global", when: `whenever ${SECRET} says so`, next: Date.now() + 5000 },
	]);
	const session = `tax-${SECRET}`;
	const batch = [
		ev("agent/books/started", { task: 7, agent: "books", session, root: 7, depth: 0, kind: "prompt", prompt: `Do the taxes ${SECRET}` }),
		ev("agent/books/goal", { agent: "books", session, objective: `all of ${SECRET} is filed`, status: "active", round: 2, task: 7, event: "round" }, { source: "pine" }),
		ev("agent/books/todos", { task: 7, root: 7, agent: "books", session, depth: 0, items: [{ text: `find ${SECRET}`, status: "done" }, { text: "sum", status: "in_progress" }, { text: "file", status: "pending" }] }),
		ev("agent/books/tool", { task: 7, agent: "books", session, root: 7, depth: 0, phase: "start", tool: "read", subject: "/Users/owner/.pine/agents/books/skills/invoices/SKILL.md" }),
		ev("agent/books/steered", { task: 7, agent: "books", session, by: 8, kind: "prompt", prompt: `and ${SECRET} too`, depth: 0 }),
		ev("schedule/daily", { name: "daily", task: `sum up ${SECRET}` }, { source: "timer" }),
	];
	w.take(batch);
	const state = viewStateOf(w, { colorOf: () => "#336699", holdings, dark: false });
	const happened = [...happeningsOf(batch, w, holdings), ...talkHappenings(w.setConversations("books", convs([{ session: `try-${SECRET}`, last: 12, branch: { from: session } }])))];
	const all = JSON.stringify({ state, happened });
	assert.ok(!all.includes(SECRET), `nothing private reaches a view: ${all.slice(all.indexOf(SECRET) - 80, all.indexOf(SECRET) + 20)}`);
	assert.ok(!all.includes("/Users/owner") && !all.includes("tax-") && !all.includes("pine/"), "no path, no conversation's name, no git branch's name");

	const books = state.agents.find((a) => a.id === "books")!;
	const [main, tax] = books.conversations;
	assert.deepEqual([books.conversations.length, main.main, tax.branchOf, tax.worktree, tax.goal], [2, true, main.id, true, "active"], "the conversation started from outside (~u) is none of the owner's");
	const work = state.work.find((x) => x.id === 7)!;
	assert.deepEqual([work.conversation, work.branch, work.worktree, work.skill, work.steps, work.round], [tax.id, true, true, "invoices", { done: 1, total: 3 }, 2]);
	assert.deepEqual(state.schedules.map((x) => [x.name, x.agent, x.when]), [["sweep", undefined, undefined], ["daily", "books", "0 9 * * 1-5"]], "the one that runs next first; a time that reads like free text is left out");
	assert.ok(state.schedules[1].last, "it fired while the panel was open");
	const inbox = state.inputs.find((i) => i.id === "source:inbox")!;
	assert.deepEqual([inbox.agents, inbox.failing], [["books", "main"], true]);
	assert.ok(happened.some((h) => h.k === "goal" && h.status === "active" && h.conversation === tax.id));
	assert.ok(happened.some((h) => h.k === "steps" && h.done === 1 && h.total === 3));
	assert.ok(happened.some((h) => h.k === "skill" && h.skill === "invoices"));
	assert.ok(happened.some((h) => h.k === "said" && h.work === 7));
	assert.ok(happened.some((h) => h.k === "scheduled" && h.name === "daily" && h.agent === "books"));
	assert.ok(happened.some((h) => h.k === "branched" && h.agent === "books" && h.from === tax.id && h.worktree === false), "a branch made while the panel is open is news");
	// A conversation that reads outside content after the first look is news too.
	assert.deepEqual(w.setRooms([{ agent: "books", session, busy: true, mode: "safe", trust: "owner" }]), []);
	assert.deepEqual(w.setRooms([{ agent: "books", session, busy: true, outside: `a page about ${SECRET}`, mode: "safe", trust: "owner" }]), [{ agent: "books", session }]);
});

test("what a view asks the panel to show or open is checked against what the panel knows", () => {
	const { w } = busyWorld();
	assert.deepEqual(knownTarget(w, { agent: "books" }), { agent: "books" });
	assert.deepEqual(knownTarget(w, { work: 2 }), { work: 2 });
	assert.equal(knownTarget(w, { agent: "nobody" }), undefined);
	assert.equal(knownTarget(w, { work: "2" }), undefined);
	assert.equal(knownTarget(w, "main"), undefined);
});
