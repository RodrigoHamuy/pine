// The overview (examples/home/views/overview.ts), pine's third view, without a window: the three columns of boxes and
// what each box says in words, the lines that join two boxes while something happens between them, what the pointer
// over a box shows, where the camera goes, and the whole board drawn on a canvas that only counts. The view is loaded as the frame loads it:
// "pine/view" is pine's src/view-kit.ts.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import type { ViewAgent, ViewState, ViewWork } from "../../src/view-kit.ts";

registerHooks({
	resolve: (spec, ctx, next) => (spec === "pine/view" ? { url: pathToFileURL(path.resolve(import.meta.dirname, "../../src/view-kit.ts")).href, shortCircuit: true } : next(spec, ctx)),
});
const view = await import("../../examples/home/views/overview.ts");
const { Recent, layoutOf, sentenceOf, causeOf, linksOf, wiringOf, hitAt, tipOf, routesOf, focusOf, allOf, held, toBoard, wholeOf, PIN, draw } = view;

const T0 = 1_800_000_000_000;
const conv = (id: number, more: object = {}) => ({ id, main: false, worktree: false, busy: false, outside: false, ...more });
const agent = (id: string, more: Partial<ViewAgent> = {}): ViewAgent => ({ id, main: false, color: "#22a06b", mode: "safe", mcp: [], skills: [], sources: [], schedules: [], conversations: [conv(1, { main: true })], ...more });
const work = (id: number, a: string, more: Partial<ViewWork> = {}): ViewWork => ({ id, agent: a, copy: false, depth: 0, from: { k: "you" }, doing: "thinking", waitingOn: [], started: T0, tools: 0, asking: false, held: false, outside: false, branch: false, worktree: false, ...more });

const AGENTS: ViewAgent[] = [
	agent("main", { main: true, mcp: ["web", "browser"], skills: ["pine"], sources: ["telegram"], schedules: ["morning"], conversations: [conv(1, { main: true }), conv(2, { branchOf: 1, worktree: true }), conv(3, { goal: "active" })] }),
	agent("books", { mcp: ["web"], skills: ["invoices", "taxes", "ledger"], sources: ["inbox"], schedules: ["daily-report", "month-end"], conversations: [conv(4, { main: true })] }),
	agent("scout", { mode: "auto", mcp: ["web", "browser", "maps", "media"], skills: ["research"], sources: ["feed"] }),
	agent("coder", { mode: "bypass", skills: ["review", "release", "tests", "docs", "refactor", "deploy", "lint"] }),
];
const state = (works: ViewWork[], at = T0, more: Partial<ViewState> = {}): ViewState => ({
	at,
	agents: AGENTS,
	work: works,
	inputs: [
		{ id: "you", kind: "you", name: "you", count: 3, agents: [], failing: false },
		{ id: "clock", kind: "clock", name: "clock", count: 2, agents: [], failing: false },
		{ id: "source:inbox", kind: "source", name: "inbox", type: "mail", count: 12, last: at - 4000, agents: ["books"], failing: false },
		{ id: "source:telegram", kind: "source", name: "telegram", type: "telegram", count: 40, agents: ["main"], failing: false },
		{ id: "source:feed", kind: "source", name: "feed", type: "feed", count: 2, agents: ["scout"], failing: true },
		{ id: "outside:hook", kind: "outside", name: "hook", count: 1, agents: [], failing: false },
	],
	schedules: [
		{ name: "daily-report", agent: "books", when: "0 9 * * *", next: at + 3 * 3600_000 },
		{ name: "month-end", agent: "books", when: "0 8 1 * *", next: at + 9 * 86_400_000 },
		{ name: "morning", agent: "main", when: "every 30m", next: at + 40_000 },
	],
	dark: true,
	focused: true,
	...more,
});
// A piece of work of main's, from the owner, that hands a task to scout, which starts two copies; and books, woken by its inbox.
const STORY = (now: number) => [
	work(1, "main", { started: now - 60_000, doing: "waiting", waitingOn: [2], conversation: 1 }),
	work(2, "scout", { started: now - 50_000, parent: 1, depth: 1, from: { k: "agent", id: "main" }, doing: "tool", tool: "mcp__web__web_search", mcp: "web", mode: "safe", held: true }),
	work(3, "scout", { started: now - 30_000, parent: 2, depth: 2, copy: true, from: { k: "copy", id: "scout" }, doing: "tool", tool: "grep" }),
	work(4, "scout", { started: now - 28_000, parent: 2, depth: 2, copy: true, from: { k: "copy", id: "scout" } }),
	work(5, "books", { started: now - 20_000, from: { k: "source", name: "inbox" }, doing: "tool", tool: "read", skill: "invoices", outside: true, steps: { done: 2, total: 5 } }),
	work(6, "coder", { started: now - 100_000, finished: now - 70_000, doing: "failed", from: { k: "clock", name: "nightly" } }),
];

test("what an agent is doing is said the way a person would say it, and why it does it in a few words", () => {
	const s = state(STORY(T0));
	assert.equal(sentenceOf(s.work[0], s), "Waiting for scout");
	assert.equal(sentenceOf(s.work[1], s), "Using web: search");
	assert.equal(sentenceOf(s.work[2], s), "Searching files");
	assert.equal(sentenceOf(s.work[4], s), "Reading skill: invoices");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "bash" }), s), "Running a command");
	assert.equal(sentenceOf(work(9, "main", { doing: "writing" }), s), "Writing an answer", "not: writes its answer");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "bash", asking: true }), s), "Needs your answer", "a question comes before anything else");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "something_new" }), s), "Using something new", "a tool the view has no words for is called by its name");
	assert.equal(sentenceOf(work(9, "scout", { doing: "waiting", waitingOn: [3, 4] }), s), "Waiting for 2 sub-agents", "a sub-agent, never a copy");
	assert.deepEqual(s.work.map((w) => causeOf(w)), ["for you", "delegated by main", "", "", "triggered by inbox", "triggered by nightly"]);
});

test("three columns: triggers, agents, tools; everything in them says in words what it is", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, new Set(), T0);
	assert.deepEqual(l.cols.map((c) => c.title), ["Triggers", "Agents", "Tools"]);
	assert.ok(l.cols[0].x === 0 && l.cols[0].x + l.cols[0].w < l.cols[1].x && l.cols[1].x + l.cols[1].w < l.cols[2].x && l.cols[2].x + l.cols[2].w === l.w, "side by side, from one edge of the board to the other");
	assert.ok(l.cols[1].w >= 200 && l.w <= 600, `the agents have ${l.cols[1].w} of ${l.w}: at the panel's 560 the board is nearly full size`);
	assert.ok(l.boxes.every((b: any) => b.y >= 0 && b.y + b.h <= l.h), "everything is on the board");
	const of = (col: number) => l.boxes.filter((b: any) => b.col === col).map((b: any) => b.id);
	assert.deepEqual(of(0), ["you", "source:feed", "source:inbox", "source:telegram", "sched:morning", "sched:daily-report", "sched:month-end", "outside:hook"], "you, then the event sources, then the schedules, the one that is due first on top");
	assert.deepEqual(of(1), ["agent:main", "agent:books", "agent:scout", "agent:coder"], "those that work on top in pine's own order, the idle one below them");
	// Only scout works: it stands on top. When its work ends it keeps its place while its answer goes back, then joins the idle ones in pine's order.
	const agentsOf = (works: ViewWork[], now: number) => layoutOf(state(works, now), new Set(), now).boxes.filter((b: any) => b.col === 1).map((b: any) => b.agent.id);
	assert.deepEqual(agentsOf([work(1, "scout", { started: T0 - 5000 })], T0), ["scout", "main", "books", "coder"]);
	const done = [work(1, "scout", { started: T0 - 5000, doing: "done", finished: T0 })];
	assert.deepEqual(agentsOf(done, T0 + 2000), ["scout", "main", "books", "coder"]);
	assert.deepEqual(agentsOf(done, T0 + 6000), ["main", "books", "scout", "coder"]);
	assert.deepEqual(agentsOf([], T0), ["main", "books", "scout", "coder"]);
	assert.deepEqual(of(2).slice(0, 4), ["mcp:web", "mcp:browser", "mcp:maps", "mcp:media"], "what most agents have comes first");
	assert.deepEqual(l.heads.map((h: any) => h.text), ["Events", "Schedules", "Webhooks", "MCP servers", "Skills"]);
	const box = (id: string) => l.byId.get(id)!;
	assert.equal(box("source:inbox").sub, "triggers books");
	assert.deepEqual([box("source:feed").sub, box("source:feed").bad], ["down", true]);
	assert.deepEqual([box("sched:morning").sub, box("sched:morning").right], ["triggers main", "in 40 s"]);
	assert.equal(box("you").sub, undefined);
	// An agent: what it is doing, why, how far, and its sub-agents each on a line of their own.
	assert.deepEqual(box("agent:main").lines, [{ text: "Waiting for scout", tone: "now" }, { text: "for you", tone: "dim" }]);
	assert.deepEqual(box("agent:scout").lines!.map((x: any) => [x.text, x.tone]), [["Using web: search", "now"], ["delegated by main", "dim"], ["Sub-agent: searching files", "sub"], ["Sub-agent: thinking", "sub"]]);
	assert.deepEqual(box("agent:books").lines!.map((x: any) => x.text), ["Reading skill: invoices", "triggered by inbox", "step 2 of 5"]);
	assert.deepEqual(box("agent:coder").lines, [{ text: "Idle", tone: "dim" }], "its work failed a while ago: it is idle");
	// A sub-agent that starts sub-agents of its own: they stand in under it, each with what it is doing.
	const deep = [...STORY(T0), work(7, "scout", { started: T0 - 9000, parent: 3, depth: 3, copy: true, from: { k: "copy", id: "scout" }, doing: "tool", tool: "bash" })];
	Object.assign(deep[2], { doing: "waiting", waitingOn: [7], tool: undefined });
	const nested = layoutOf(state(deep), new Set(), T0).byId.get("agent:scout")!.lines!.slice(2);
	assert.deepEqual(nested.map((x: any) => [x.text, x.indent]), [["Sub-agent: waiting for 1 sub-agent", 1], ["Sub-agent: running a command", 2], ["Sub-agent: thinking", 1]]);
	assert.equal(box("agent:coder").right, "bypass");
	// No two boxes of a column overlap, and none has a name that is not said.
	for (const a of l.boxes) for (const b of l.boxes) if (a !== b && a.col === b.col) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id}`);
	assert.ok(l.boxes.every((b: any) => b.title.length > 0));
});

test("a question for you is said at your box and at the agent's; an agent that is clicked shows its conversations", () => {
	const works = STORY(T0);
	Object.assign(works[4], { asking: true });
	const s = state(works);
	const l = layoutOf(s, new Set(["main"]), T0);
	assert.deepEqual([l.byId.get("you")!.sub, l.byId.get("you")!.bad], ["1 question for you", true]);
	assert.deepEqual(l.byId.get("agent:books")!.lines![0], { text: "Needs your answer", tone: "ask" });
	assert.deepEqual(l.byId.get("agent:main")!.lines!.slice(2).map((x: any) => [x.text, Boolean(x.indent)]), [["Main conversation", false], ["Branch of main · in a worktree", true], ["Conversation 3 · goal active", false]], "in words that are not their names; a branch stands in from what it was branched from");
	assert.ok(l.byId.get("agent:main")!.h > layoutOf(s, new Set(), T0).byId.get("agent:main")!.h);
});

test("a line joins two boxes only while something happens between them", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, new Set(), T0);
	const lines = linksOf(s, l).map((k: any) => `${k.from} > ${k.to}${k.side ? " (beside)" : ""}`);
	assert.deepEqual(lines.sort(), ["agent:books > skill:invoices", "agent:main > agent:scout (beside)", "agent:scout > mcp:web", "source:inbox > agent:books", "you > agent:main"], "what woke whom, who handed a task to whom, who uses what. Nothing for the agent that rests");
	assert.ok(linksOf(s, l).every((k: any) => k.live));
	// Each is in the color of the agent it happens to; a task handed on in the color of who gave it.
	const colors = Object.fromEntries(AGENTS.map((a) => [a.id, a.color]));
	assert.equal(linksOf(s, l).find((k: any) => k.to === "agent:books")!.color, colors.books);
	// A question goes from the agent to you, in red, and stands for the line that once woke it.
	const works = STORY(T0);
	Object.assign(works[0], { asking: true, doing: "tool", tool: "send" });
	const asked = linksOf(state(works), l).filter((k: any) => k.from === "you" || k.to === "you").map((k: any) => [k.from, k.to, k.color]);
	assert.deepEqual(asked, [["agent:main", "you", "#ff5d73"]]);
	// When a delegated task ends, its answer goes back: for a few seconds a line from the one that did it to the one that
	// asked, at the right of the agents where the task went out at their left. Red if it failed. Then it is gone.
	const over = STORY(T0);
	Object.assign(over[1], { doing: "done", finished: T0 - 1000, tool: undefined, mcp: undefined });
	over.splice(2, 2);
	const back = (now: number, doing = "done") => {
		Object.assign(over[1], { doing });
		return linksOf(state(over), l, now).filter((k: any) => k.back);
	};
	assert.deepEqual(back(T0).map((k: any) => [k.from, k.to, k.color, k.side]), [["agent:scout", "agent:main", colors.scout, true]]);
	assert.equal(back(T0, "failed")[0].color, "#ff5d73");
	assert.deepEqual(back(T0 + 5000), [], "a few seconds later it is gone");
	const answer = routesOf(back(T0), l)[0]!;
	const [mainBox, scoutBox, webBox] = ["agent:main", "agent:scout", "mcp:web"].map((id) => l.byId.get(id)!);
	assert.deepEqual([answer[0][0], answer[answer.length - 1][0]], [scoutBox.x + scoutBox.w + PIN, mainBox.x + mainBox.w + PIN], "it leaves and arrives at the pins on the right side of the agents");
	assert.ok(answer.every(([x]: [number, number]) => x >= mainBox.x + mainBox.w && x < webBox.x), "and runs in the gap right of them all the way");
	// What you asked for comes back to you the same way.
	const yours = [work(1, "main", { doing: "done", started: T0 - 9000, finished: T0 - 500 })];
	assert.deepEqual(linksOf(state(yours), l, T0).map((k: any) => [k.from, k.to]), [["agent:main", "you"]]);
	assert.deepEqual(linksOf(state(yours), l, T0 + 9000), []);
	// Nothing happens: no line at all.
	assert.deepEqual(linksOf(state([]), layoutOf(state([]), new Set(), T0)), []);
});

test("the pointer over a box shows all it is wired to, and the line on top says what it is", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, new Set(), T0);
	const ends = (id: string) => wiringOf(id, s, l).map((k: any) => (k.from === id ? k.to : k.from)).sort();
	assert.deepEqual(ends("agent:books"), ["mcp:web", "sched:daily-report", "sched:month-end", "skill:invoices", "skill:ledger", "skill:taxes", "source:inbox"]);
	assert.deepEqual(ends("mcp:web"), ["agent:books", "agent:main", "agent:scout"], "over a thing: everybody who has it");
	assert.deepEqual(ends("source:inbox"), ["agent:books"]);
	assert.deepEqual(ends("you"), [], "you talk to every agent: that is no wiring");
	assert.deepEqual(wiringOf(undefined, s, l), []);
	assert.ok(wiringOf("agent:books", s, l).every((k: any) => !k.live));
	assert.deepEqual(tipOf(l.byId.get("agent:main"), s, T0), ["main (main agent)", "safe mode", "3 conversations, 1 branch", "morning in 40 s", "click to expand, double-click to open"]);
	assert.deepEqual(tipOf(l.byId.get("source:feed"), s, T0), ["feed: event source (feed)", "down", "triggers scout", "2 events"]);
	assert.deepEqual(tipOf(l.byId.get("sched:morning"), s, T0), ["morning: schedule", "triggers main", "every 30m", "next in 40 s"]);
	assert.deepEqual(tipOf(l.byId.get("mcp:web"), s, T0), ["web: MCP server", "available to main, books, scout", "in use by scout"]);
	assert.deepEqual(tipOf(l.byId.get("skill:invoices"), s, T0), ["invoices: skill", "available to books", "in use by books"]);
	assert.deepEqual(tipOf(undefined, s, T0), []);
	// Where the pointer has to be for it.
	const b = l.byId.get("agent:scout")!;
	assert.equal(hitAt(l, { x: b.x + 20, y: b.y + 10 })?.id, "agent:scout");
	assert.equal(hitAt(l, { x: b.x - 6, y: b.y + 10 }), undefined, "between the columns is nothing");
	assert.equal(hitAt(l, { x: b.x + 20, y: 10 }), undefined, "nor where a column says what it is");
});

test("every line runs from pin to pin in a lane of its own, as a trace does: straight, with its turns cut at 45 degrees", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, new Set(), T0);
	const live = linksOf(s, l);
	const ways = routesOf(live, l);
	const way = (from: string, to: string) => ways[live.findIndex((k: any) => k.from === from && k.to === to)]!;
	const [inbox, books, invoices, main, scout] = ["source:inbox", "agent:books", "skill:invoices", "agent:main", "agent:scout"].map((id) => l.byId.get(id)!);
	const woke = way("source:inbox", "agent:books");
	assert.deepEqual([woke[0][0], woke[woke.length - 1][0]], [inbox.x + inbox.w + PIN, books.x - PIN], "from the pin at the right of what triggered it to a pin at the agent's left");
	const uses = way("agent:books", "skill:invoices");
	assert.deepEqual([uses[0][0], uses[uses.length - 1][0]], [books.x + books.w + PIN, invoices.x - PIN]);
	// A line runs straight across, then straight down or up in its lane, then straight across: on a slant only where it turns,
	// and there at 45 degrees.
	for (const pts of ways) {
		for (const [i, p] of pts!.slice(1).entries()) {
			const [dx, dy] = [Math.abs(p[0] - pts![i][0]), Math.abs(p[1] - pts![i][1])];
			assert.ok(dx < 0.01 || dy < 0.01 || Math.abs(dx - dy) < 0.01, `straight or at 45 degrees: ${dx}, ${dy}`);
		}
		const slanted = pts!.slice(1).reduce((n: number, p: [number, number], i: number) => n + (Math.abs(p[0] - pts![i][0]) > 0.5 && Math.abs(p[1] - pts![i][1]) > 0.5 ? Math.hypot(p[0] - pts![i][0], p[1] - pts![i][1]) : 0), 0);
		assert.ok(slanted < 24, `only its two turns are on a slant: ${slanted}`);
	}
	// No two lines between the same two columns share a lane: where each runs up or down is its own.
	const laneOf = (pts: Array<[number, number]>) => {
		const tall = pts.slice(1).map((p, i) => ({ x: p[0], len: Math.abs(p[1] - pts[i][1]), flat: Math.abs(p[0] - pts[i][0]) < 0.5 })).filter((v) => v.flat).sort((a, b) => b.len - a.len)[0];
		return tall?.x;
	};
	const lanes = ways.map((pts: any) => laneOf(pts)).filter((x: any) => x !== undefined);
	assert.equal(new Set(lanes).size, lanes.length, `lanes: ${lanes.join(", ")}`);
	// A task delegated from agent to agent runs beside the agents, never across one.
	const handed = way("agent:main", "agent:scout");
	assert.ok(handed.every(([x]: [number, number]) => x <= main.x && x > inbox.x + inbox.w), "in the gap left of the agents all the way");
	assert.deepEqual([handed[0][0], handed[handed.length - 1][0]], [main.x - PIN, scout.x - PIN]);
	// Two lines at one side of a box leave it a little apart.
	const two = [...STORY(T0), work(8, "coder", { started: T0 - 1000, doing: "thinking" })];
	const l2 = layoutOf(state(two), new Set(), T0);
	const live2 = linksOf(state(two), l2);
	const fromYou = routesOf(live2, l2).filter((_: any, i: number) => live2[i].from === "you").map((pts: any) => pts[0][1]);
	assert.equal(fromYou.length, 2);
	assert.notEqual(fromYou[0], fromYou[1]);
	assert.deepEqual(routesOf([{ from: "agent:main", to: "nowhere", color: "#000000", live: true }], l), [undefined]);
});

test("a camera looks at the board: it follows what happens, shows all of it, and stays where the owner put it", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, new Set(["main", "books", "scout", "coder"]), T0);
	const whole = wholeOf(l);
	const shows = (cam: any, view: { w: number; h: number }) => {
		const [a, b] = [toBoard({ x: 0, y: 32 }, cam, view), toBoard({ x: view.w, y: view.h }, cam, view)];
		return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
	};
	const has = (seen: any, b: any) => b.x >= seen.x - 0.01 && b.y >= seen.y - 0.01 && b.x + b.w <= seen.x + seen.w + 0.01 && b.y + b.h <= seen.y + seen.h + 0.01;
	// Nothing happens: the board as wide as the panel, from its top, like a page.
	const panel = { w: 560, h: 420 };
	const rest = focusOf(l, [], panel);
	assert.ok(rest.z > 0.85 && rest.z <= 1, `at the panel's own width the board is nearly full size: ${rest.z}`);
	assert.ok(Math.abs(shows(rest, panel).y - whole.y) < 0.01 && shows(rest, panel).x >= whole.x - 4 && shows(rest, panel).w <= whole.w + 8, "from the board's top, and no wider than the board with its edge");
	assert.ok(has(shows(rest, panel), l.byId.get("you")) && has(shows(rest, panel), l.byId.get("mcp:web")), "all three columns");
	assert.ok(l.h > shows(rest, panel).h, "this board is taller than the panel");
	// Something happens low on the board: the camera goes there, as wide as before.
	const low = l.boxes.filter((b: any) => b.col === 2).at(-1)!;
	const there = focusOf(l, [low.id], panel);
	assert.ok(has(shows(there, panel), low) && !has(shows(rest, panel), low));
	assert.equal(there.z, rest.z);
	// Two things far apart that do not fit: it goes further out until both do.
	const both = focusOf(l, ["you", low.id], panel);
	assert.ok(both.z < rest.z && has(shows(both, panel), low) && has(shows(both, panel), l.byId.get("you")));
	assert.deepEqual(focusOf(l, ["nothing"], panel), rest, "a box that is gone is not followed");
	// The whole board, in a panel of any shape; and a board smaller than the panel hangs from its top.
	for (const view of [{ w: 320, h: 300 }, { w: 560, h: 420 }, { w: 1500, h: 400 }, { w: 900, h: 2400 }]) {
		const all = allOf(l, view);
		assert.ok(has(shows(all, view), { x: 0, y: 0, w: l.w, h: l.h }), `${view.w}x${view.h}: ${JSON.stringify(all)}`);
		assert.ok(all.z < 1.41, "never closer than is good for reading");
	}
	assert.ok(Math.abs(shows(allOf(l, { w: 900, h: 2400 }), { w: 900, h: 2400 }).y - whole.y) < 0.01);
	// A point of the panel is a point of the board, wherever the camera is.
	const cam = { x: 200, y: 300, z: 2 };
	assert.deepEqual(toBoard({ x: 280, y: 32 + (420 - 32) / 2 }, cam, panel), { x: 200, y: 300 }, "the middle of the panel under the line on top is where the camera is");
	assert.deepEqual(toBoard({ x: 300, y: 32 + (420 - 32) / 2 + 10 }, cam, panel), { x: 210, y: 305 });
	// Dragged or zoomed by hand it stays where some of the board is to be seen, neither a speck nor a blur.
	assert.deepEqual(held({ x: -5000, y: 9000, z: 40 }, l), { x: whole.x, y: whole.y + whole.h, z: 3 });
	assert.equal(held({ x: 100, y: 100, z: 0.01 }, l).z, 0.25);
	assert.deepEqual(held(cam, l), cam);
});

test("what just happened shows for a moment: a box lights up, an agent's box says a few words", () => {
	const recent = new Recent();
	for (const h of [{ k: "event", input: "source:inbox" }, { k: "scheduled", name: "morning", agent: "main" }, { k: "tool", work: 2, agent: "scout", tool: "mcp__web__web_search", mcp: "web" }, { k: "skill", work: 5, agent: "books", skill: "invoices" }, { k: "sent", work: 5, agent: "books", tool: "send" }, { k: "branched", agent: "main", conversation: 2, from: 1, worktree: true }] as any[]) recent.hear(h, T0);
	recent.hear({ k: "answered", work: 2, from: "scout", to: "coder" }, T0);
	assert.deepEqual([recent.notes.get("scout")!.text, recent.notes.get("coder")!.text], ["Answered coder", "Answer from scout"], "both ends say that an answer went back");
	assert.deepEqual([...recent.hot.keys()], ["source:inbox", "sched:morning", "mcp:web", "skill:invoices"]);
	const s = state(STORY(T0));
	const texts = (now: number) => layoutOf(s, new Set(), now, recent).byId.get("agent:books")!.lines!.map((x: any) => x.text);
	assert.equal(texts(T0 + 500).at(-1), "Sent a message");
	assert.ok(!texts(T0 + 6000).includes("Sent a message"), "and is gone again");
	assert.equal(layoutOf(s, new Set(), T0 + 500, recent).byId.get("agent:main")!.lines!.at(-1)!.text, "New branch in a worktree");
});

// A canvas that draws nothing and takes every call: enough to run all of the drawing and see that none of it throws.
function fakeCtx(): any {
	return new Proxy({ measureText: (t: string) => ({ width: t.length * 6 }) } as any, { get: (t, k: string) => (k in t ? t[k] : (t[k] = () => undefined)), set: (t, k: string, v) => ((t[k] = v), true) });
}

test("the whole board draws in every state: narrow and wide, dark and light, from near and far, with the pointer over each kind of box", () => {
	const g = fakeCtx();
	const recent = new Recent();
	let frames = 0;
	for (let step = 0; step < 30; step++) {
		const now = T0 + step * 1500;
		const works = STORY(T0).map((w) => ({ ...w }));
		if (step > 8) Object.assign(works[4], { asking: true });
		if (step > 16) Object.assign(works[1], { doing: "done", finished: T0 + 30_000, tool: undefined, mcp: undefined }), Object.assign(works[2], { doing: "cancelled", finished: T0 + 30_000 }), Object.assign(works[3], { doing: "done", finished: T0 + 30_000 });
		if (step > 24) works.length = 0;
		const s = state(works, now, { dark: step % 2 === 0 });
		if (step === 5) for (const h of [{ k: "event", input: "source:inbox" }, { k: "said", work: 1, agent: "main" }, { k: "goal", agent: "main", status: "met" }, { k: "outside", agent: "books" }, { k: "decided", work: 5, agent: "books", allowed: false }, { k: "ended", work: 6, agent: "coder", failed: true }] as any[]) recent.hear(h, now);
		for (const size of [{ w: 320, h: 300 }, { w: 560, h: 700 }, { w: 1500, h: 400 }]) {
			for (const open of [new Set<string>(), new Set(["main", "scout", "nobody"])]) {
				const l = layoutOf(s, open, now, recent);
				const cam = [focusOf(l, ["agent:scout"], size), allOf(l, size), { x: 300, y: 200, z: 3 }, { x: -10, y: 900, z: 0.25 }][step % 4];
				for (const hover of [undefined, "agent:scout", "you", "source:inbox", "sched:morning", "mcp:web", "skill:invoices", "outside:hook"]) {
					draw(g, s, l, now, { hover, selected: step % 3 ? "agent:books" : undefined, recent, cam, view: size });
					frames++;
				}
			}
		}
	}
	assert.equal(frames, 30 * 3 * 2 * 8);
	assert.equal(view.default.pineView, 1, "the file's default export is the view");
});
