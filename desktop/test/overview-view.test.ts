// The overview (examples/home/views/overview.ts), pine's third view, without a window: the three columns of boxes and
// what each box says in words, the lines that join two boxes while something happens between them, what the pointer
// over a box shows, and the whole page drawn on a canvas that only counts. The view is loaded as the frame loads it:
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
const { Recent, layoutOf, sentenceOf, causeOf, linksOf, wiringOf, hitAt, tipOf, pathOf, offsetOf, draw } = view;

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

test("what an agent does is said as a sentence, and why it does it in a few words", () => {
	const s = state(STORY(T0));
	assert.equal(sentenceOf(s.work[0], s), "waits for scout");
	assert.equal(sentenceOf(s.work[1], s), "uses web: search");
	assert.equal(sentenceOf(s.work[2], s), "searches files");
	assert.equal(sentenceOf(s.work[4], s), "reads its skill invoices");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "bash" }), s), "runs a command");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "bash", asking: true }), s), "asks you", "asking comes before anything else");
	assert.equal(sentenceOf(work(9, "main", { doing: "tool", tool: "something_new" }), s), "uses something new", "a tool the view has no words for is called by its name");
	assert.equal(sentenceOf(work(9, "scout", { doing: "waiting", waitingOn: [3, 4] }), s), "waits for its 2 copies");
	assert.deepEqual(s.work.map((w) => causeOf(w)), ["for you", "for main", "", "", "woken by inbox", "on schedule nightly"]);
});

test("three columns: what wakes agents, the agents, what they use; every box says in words what it is", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, { w: 560, h: 700 }, new Set(), T0);
	assert.deepEqual(l.cols.map((c) => c.title), ["what wakes them", "agents", "what they use"]);
	assert.ok(l.cols[0].x + l.cols[0].w < l.cols[1].x && l.cols[1].x + l.cols[1].w < l.cols[2].x && l.cols[2].x + l.cols[2].w <= 560, "side by side, inside the panel");
	assert.ok(l.cols[1].w >= 200, `the agents have ${l.cols[1].w} of 560`);
	const of = (col: number) => l.boxes.filter((b: any) => b.col === col).map((b: any) => b.id);
	assert.deepEqual(of(0), ["you", "source:feed", "source:inbox", "source:telegram", "sched:morning", "sched:daily-report", "sched:month-end", "outside:hook"], "you, then the event sources, then the schedules, the one that is due first on top");
	assert.deepEqual(of(1), ["agent:main", "agent:books", "agent:scout", "agent:coder"], "the agents in pine's own order");
	assert.deepEqual(of(2).slice(0, 4), ["mcp:web", "mcp:browser", "mcp:maps", "mcp:media"], "what most agents have comes first");
	assert.deepEqual(l.heads.map((h: any) => h.text), ["events", "schedules", "other ways in", "MCP servers", "skills"]);
	const box = (id: string) => l.byId.get(id)!;
	assert.equal(box("source:inbox").sub, "wakes books");
	assert.deepEqual([box("source:feed").sub, box("source:feed").bad], ["not running", true]);
	assert.deepEqual([box("sched:morning").sub, box("sched:morning").right], ["wakes main", "in 40 s"]);
	assert.equal(box("you").sub, undefined);
	// An agent's box: what it does, why, and its copies each on a line of their own.
	assert.deepEqual(box("agent:main").lines, [{ text: "waits for scout", tone: "now" }, { text: "for you", tone: "dim" }]);
	assert.deepEqual(box("agent:scout").lines!.map((x: any) => x.text), ["uses web: search", "for main", "a copy searches files", "a copy thinks"]);
	assert.deepEqual(box("agent:books").lines!.map((x: any) => x.text), ["reads its skill invoices", "woken by inbox · step 2 of 5"]);
	assert.deepEqual(box("agent:coder").lines, [{ text: "resting", tone: "dim" }], "its work failed a while ago: it rests");
	assert.equal(box("agent:coder").right, "bypass");
	// No two boxes of a column overlap, and none has a name that is not said.
	for (const a of l.boxes) for (const b of l.boxes) if (a !== b && a.col === b.col) assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} and ${b.id}`);
	assert.ok(l.boxes.every((b: any) => b.title.length > 0));
});

test("a question for you is said at your box and at the agent's; an agent that is clicked shows its conversations", () => {
	const works = STORY(T0);
	Object.assign(works[4], { asking: true });
	const s = state(works);
	const l = layoutOf(s, { w: 560, h: 700 }, new Set(["main"]), T0);
	assert.deepEqual([l.byId.get("you")!.sub, l.byId.get("you")!.bad], ["1 question for you", true]);
	assert.deepEqual(l.byId.get("agent:books")!.lines![0], { text: "asks you", tone: "ask" });
	assert.deepEqual(l.byId.get("agent:main")!.lines!.slice(2).map((x: any) => [x.text, Boolean(x.indent)]), [["its main conversation", false], ["a branch of the main one, in a worktree", true], ["conversation 3, goal active", false]], "in words that are not their names; a branch stands in from what it was branched from");
	assert.ok(l.byId.get("agent:main")!.h > layoutOf(s, { w: 560, h: 700 }, new Set(), T0).byId.get("agent:main")!.h);
});

test("a line joins two boxes only while something happens between them", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, { w: 560, h: 700 }, new Set(), T0);
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
	// Nothing happens: no line at all.
	assert.deepEqual(linksOf(state([]), layoutOf(state([]), { w: 560, h: 700 }, new Set(), T0)), []);
});

test("the pointer over a box shows all it is wired to, and the line on top says what it is", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, { w: 560, h: 700 }, new Set(), T0);
	const ends = (id: string) => wiringOf(id, s, l).map((k: any) => (k.from === id ? k.to : k.from)).sort();
	assert.deepEqual(ends("agent:books"), ["mcp:web", "sched:daily-report", "sched:month-end", "skill:invoices", "skill:ledger", "skill:taxes", "source:inbox"]);
	assert.deepEqual(ends("mcp:web"), ["agent:books", "agent:main", "agent:scout"], "over a thing: everybody who has it");
	assert.deepEqual(ends("source:inbox"), ["agent:books"]);
	assert.deepEqual(ends("you"), [], "you talk to every agent: that is no wiring");
	assert.deepEqual(wiringOf(undefined, s, l), []);
	assert.ok(wiringOf("agent:books", s, l).every((k: any) => !k.live));
	assert.deepEqual(tipOf(l.byId.get("agent:main"), s, T0), ["main, the main agent, works in safe mode", "3 conversations, 1 of them a branch", "morning in 40 s", "click for its conversations, double click to open it"]);
	assert.deepEqual(tipOf(l.byId.get("source:feed"), s, T0), ["feed: an event source (feed)", "not running", "wakes scout", "2 events so far"]);
	assert.deepEqual(tipOf(l.byId.get("sched:morning"), s, T0), ["morning: a schedule", "wakes main", "set to every 30m", "next in 40 s"]);
	assert.deepEqual(tipOf(l.byId.get("mcp:web"), s, T0), ["web: an MCP server", "main, books, scout have it", "scout uses it right now"]);
	assert.deepEqual(tipOf(l.byId.get("skill:invoices"), s, T0), ["invoices: a skill", "books has it", "books uses it right now"]);
	assert.deepEqual(tipOf(undefined, s, T0), []);
	// Where the pointer has to be for it.
	const b = l.byId.get("agent:scout")!;
	assert.equal(hitAt(l, { x: b.x + 20, y: l.top + b.y + 10 }, 0)?.id, "agent:scout");
	assert.equal(hitAt(l, { x: b.x - 6, y: l.top + b.y + 10 }, 0), undefined, "between the columns is nothing");
	assert.equal(hitAt(l, { x: b.x + 20, y: 10 }, 0), undefined);
});

test("a line leaves a box at its side and arrives at the other's; a tall page scrolls so that every column ends together", () => {
	const s = state(STORY(T0));
	const l = layoutOf(s, { w: 560, h: 700 }, new Set(), T0);
	const [inbox, books, invoices] = ["source:inbox", "agent:books", "skill:invoices"].map((id) => l.byId.get(id)!);
	const woke = pathOf({ from: "source:inbox", to: "agent:books", color: "#000000", live: true }, l, 0)!;
	assert.deepEqual([woke[0][0], woke[woke.length - 1][0]], [inbox.x + inbox.w, books.x], "from the right side of what woke it to the agent's left");
	const uses = pathOf({ from: "agent:books", to: "skill:invoices", color: "#000000", live: true }, l, 0)!;
	assert.deepEqual([uses[0][0], uses[uses.length - 1][0]], [books.x + books.w, invoices.x]);
	// From agent to agent it runs beside the column, never across a box.
	const handed = pathOf({ from: "agent:main", to: "agent:scout", color: "#000000", live: true, side: true }, l, 0)!;
	assert.ok(handed.every(([x]: [number, number]) => x <= books.x), "left of the agents' boxes all the way");
	assert.equal(pathOf({ from: "agent:main", to: "nowhere", color: "#000000", live: true }, l, 0), undefined);
	// A short panel: the page scrolls as far as the tallest column needs, and a shorter column moves less.
	const short = layoutOf(s, { w: 560, h: 240 }, new Set(), T0);
	assert.ok(short.reach > 0);
	const tallest = short.cols.map((c: any) => c.tall).indexOf(Math.max(...short.cols.map((c: any) => c.tall)));
	assert.equal(offsetOf(short, tallest, short.reach), short.reach);
	for (const col of [0, 1, 2]) assert.ok(offsetOf(short, col, short.reach) <= short.reach && offsetOf(short, col, 0) === 0);
	assert.equal(offsetOf(l, 1, 0), 0);
	// A very narrow and a very wide panel keep the three columns side by side.
	for (const w of [320, 2000]) {
		const x = layoutOf(s, { w, h: 600 }, new Set(), T0);
		assert.ok(x.cols[0].x >= 0 && x.cols[2].x + x.cols[2].w <= Math.max(w, 300) && x.cols[1].w >= 90, `${w}: ${JSON.stringify(x.cols.map((c: any) => [c.x, c.w]))}`);
	}
});

test("what just happened shows for a moment: a box lights up, an agent's box says a few words", () => {
	const recent = new Recent();
	for (const h of [{ k: "event", input: "source:inbox" }, { k: "scheduled", name: "morning", agent: "main" }, { k: "tool", work: 2, agent: "scout", tool: "mcp__web__web_search", mcp: "web" }, { k: "skill", work: 5, agent: "books", skill: "invoices" }, { k: "sent", work: 5, agent: "books", tool: "send" }, { k: "branched", agent: "main", conversation: 2, from: 1, worktree: true }] as any[]) recent.hear(h, T0);
	assert.deepEqual([...recent.hot.keys()], ["source:inbox", "sched:morning", "mcp:web", "skill:invoices"]);
	const s = state(STORY(T0));
	const texts = (now: number) => layoutOf(s, { w: 560, h: 700 }, new Set(), now, recent).byId.get("agent:books")!.lines!.map((x: any) => x.text);
	assert.equal(texts(T0 + 500).at(-1), "sent something out");
	assert.ok(!texts(T0 + 6000).includes("sent something out"), "and is gone again");
	assert.equal(layoutOf(s, { w: 560, h: 700 }, new Set(), T0 + 500, recent).byId.get("agent:main")!.lines!.at(-1)!.text, "made a branch, in a worktree");
});

// A canvas that draws nothing and takes every call: enough to run all of the drawing and see that none of it throws.
function fakeCtx(): any {
	return new Proxy({ measureText: (t: string) => ({ width: t.length * 6 }) } as any, { get: (t, k: string) => (k in t ? t[k] : (t[k] = () => undefined)), set: (t, k: string, v) => ((t[k] = v), true) });
}

test("the whole page draws in every state: narrow and wide, dark and light, scrolled, with the pointer over each kind of box", () => {
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
				const l = layoutOf(s, size, open, now, recent);
				for (const hover of [undefined, "agent:scout", "you", "source:inbox", "sched:morning", "mcp:web", "skill:invoices", "outside:hook"]) {
					draw(g, s, l, now, { hover, selected: step % 3 ? "agent:books" : undefined, scroll: step % 4 ? 0 : Math.min(40, l.reach), recent });
					frames++;
				}
			}
		}
	}
	assert.equal(frames, 30 * 3 * 2 * 8);
	assert.equal(view.default.pineView, 1, "the file's default export is the view");
});
