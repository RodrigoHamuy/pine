// overview: all of pine on one page, in words. A view for the panel of the Pine app
// (docs/references/views.md); it draws what "pine/view" tells it and nothing else.
//
// Nothing here has to be learned first. There are three columns of boxes, and every box says in words what it is:
//
//   on the left         what wakes agents: you, every event source ("inbox, wakes books"), every schedule
//                       ("lights, wakes home, in 20 s")
//   in the middle       the agents. Under its name each says what it does right now, as a sentence: "searches the
//                       web, for main", "waits for scout", "asks you", "resting". Its copies (sub-agents) are
//                       lines of their own in its box
//   on the right        what agents use: every MCP server, every skill
//
// A line joins two boxes only while something happens between them, in the color of the agent it happens to: from
// what woke an agent to the agent, from an agent to what it uses, from an agent to the agent it handed a task to,
// and in red from an agent to you while it waits for your answer. Dots run along a line the way things go. So what
// is on the page at any moment reads as a sentence: you asked main, main asked scout, scout uses the web.
//
// Everything else is there when it is pointed at: the pointer over a box draws thin lines to all it is wired to
// (an agent's sources, schedules, MCP servers and skills; for a source, who listens to it) and lets the rest fade.
// A click on an agent opens its box: a line for each of its conversations, branches under what they were branched
// from. A click also shows it under the view, a double click opens it.
//
// There is no timeline: what happened, in order, is what the panel lists under every view.

import { defineView, mix, type ViewAgent, type ViewConversation, type ViewHappening, type ViewHost, type ViewInput, type ViewSchedule, type ViewState, type ViewWork } from "pine/view";

// ---- what is said ---------------------------------------------------------------------------------------------------------

const ENDED = ["done", "failed", "cancelled"];
const ended = (w: ViewWork) => ENDED.includes(w.doing);

/** What pine's everyday tools do, as somebody would say it. A tool that is not here is called by its name. */
const SAY: Record<string, string> = {
	bash: "runs a command",
	read: "reads a file",
	edit: "edits a file",
	write: "writes a file",
	grep: "searches files",
	find: "looks for files",
	ls: "looks into a folder",
	manual: "reads pine's manual",
	download: "downloads something",
	todo: "plans its steps",
	question: "has a question",
	delegate: "hands work on",
	subagent: "starts copies of itself",
	send: "sends a message",
	publish_event: "publishes an event",
	read_source: "reads from a source",
	request_access: "asks for access",
};

/** A tool's name without its server's: "mcp__web__web_search" of "web" is "search". */
const toolWord = (tool: string | undefined, mcp?: string) => {
	const t = tool ?? "";
	if (!mcp) return t.replace(/_/g, " ") || "a tool";
	return t.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(new RegExp(`^${mcp}_`), "").replace(/_/g, " ") || "a tool";
};

/** What a piece of work does right now, as a sentence without its subject. */
export function sentenceOf(w: ViewWork, s: ViewState): string {
	if (w.asking) return "asks you";
	if (w.doing === "done") return "is done";
	if (w.doing === "failed") return "failed";
	if (w.doing === "cancelled") return "was stopped";
	if (w.doing === "tool") {
		if (w.skill) return `reads its skill ${w.skill}`;
		if (w.mcp) return `uses ${w.mcp}: ${toolWord(w.tool, w.mcp)}`;
		return SAY[w.tool ?? ""] ?? `uses ${toolWord(w.tool)}`;
	}
	if (w.doing === "writing") return "writes its answer";
	if (w.doing === "waiting") {
		const on = w.waitingOn.map((id) => s.work.find((x) => x.id === id)).filter((x): x is ViewWork => Boolean(x && !ended(x)));
		const copies = on.filter((x) => x.copy).length;
		const who = [...new Set(on.filter((x) => !x.copy).map((x) => x.agent)), ...(copies ? [copies === 1 ? "its copy" : `its ${copies} copies`] : [])];
		return who.length ? `waits for ${who.join(" and ")}` : "waits";
	}
	return "thinks";
}

/** Why a piece of work runs, in a few words: who it is for, or what woke the agent. */
export function causeOf(w: ViewWork): string {
	const f = w.from;
	return f.k === "you" ? "for you" : f.k === "clock" ? `on schedule${f.name ? ` ${f.name}` : ""}` : f.k === "source" ? `woken by ${f.name}` : f.k === "outside" ? `woken by ${f.name}` : f.k === "agent" ? `for ${f.id}` : "";
}

const span = (ms: number) => (ms < 1500 ? "now" : ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : ms < 129_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`);
const listOf = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max - 1).join(", ")} and ${names.length - max + 1} more`);

// ---- what just happened, for a moment -------------------------------------------------------------------------------------

/** What the state does not say: that something came in just now, that an agent just sent something out. It fades. */
export class Recent {
	/** When something last happened at a box, by the box's id. */
	hot = new Map<string, number>();
	/** A few words at an agent's box, for a moment. */
	notes = new Map<string, { text: string; at: number }>();

	hear(h: ViewHappening, at: number): void {
		const note = (agent: string | undefined, text: string) => agent && this.notes.set(agent, { text, at });
		switch (h.k) {
			case "event":
				this.hot.set(h.input, at);
				break;
			case "scheduled":
				this.hot.set(`sched:${h.name ?? ""}`, at);
				break;
			case "said":
				this.hot.set("you", at);
				break;
			case "tool":
				if (h.mcp) this.hot.set(`mcp:${h.mcp}`, at);
				break;
			case "skill":
				this.hot.set(`skill:${h.skill}`, at);
				break;
			case "sent":
				note(h.agent, "sent something out");
				break;
			case "branched":
				note(h.agent, h.worktree ? "made a branch, in a worktree" : "made a branch");
				break;
			case "goal":
				note(h.agent, h.status === "met" ? "reached its goal" : `its goal is ${h.status}`);
				break;
			case "outside":
				note(h.agent, "read content from outside");
				break;
			case "decided":
				note(h.agent, h.allowed ? "you said yes" : "you said no");
				break;
			case "ended":
				note(h.agent, h.failed ? "a piece of work failed" : "finished a piece of work");
				break;
			default:
				break;
		}
	}
}

// ---- where everything is ---------------------------------------------------------------------------------------------------

/** A box of the page: something that wakes agents, an agent, or something agents use. */
export interface Box {
	/** "you", an input's id ("source:inbox", "outside:hook"), "sched:<name>", "agent:<id>", "mcp:<name>", "skill:<name>". */
	id: string;
	col: 0 | 1 | 2;
	kind: "you" | "source" | "outside" | "sched" | "agent" | "mcp" | "skill";
	/** Its place in its column: `y` counts from the column's top, which scrolls. */
	x: number;
	y: number;
	w: number;
	h: number;
	title: string;
	/** A second line, smaller: what it is, whom it wakes. And words at the right of the first line. */
	sub?: string;
	right?: string;
	/** For an agent: the lines under its name. The first is what it does. */
	lines?: Array<{ text: string; tone: "now" | "ask" | "dim" | "note"; indent?: boolean }>;
	agent?: ViewAgent;
	bad?: boolean;
	busy?: boolean;
}
export interface Layout {
	w: number;
	h: number;
	top: number;
	cols: Array<{ x: number; w: number; tall: number; title: string }>;
	heads: Array<{ col: number; y: number; text: string }>;
	boxes: Box[];
	byId: Map<string, Box>;
	/** How far the page can be scrolled: the tallest column decides, and the others follow at their own pace. */
	reach: number;
}
/** A line between two boxes: something that happens now (`live`), or wiring that is shown for what the pointer is over. */
export interface Link {
	from: string;
	to: string;
	color: string;
	live: boolean;
	/** A task handed from an agent to an agent: it runs down the side of the middle column. */
	side?: boolean;
}

const TOP = 34;
const HEAD = 22;
const PAD = 10;
const ASK = "#ff5d73";

/** Everything on the page for a panel of this size. `open` are the agents whose boxes are unfolded. */
export function layoutOf(s: ViewState, size: { w: number; h: number }, open: Set<string>, now: number, recent?: Recent): Layout {
	const W = Math.max(300, size.w);
	const gap = Math.max(18, Math.min(84, Math.round(W * 0.075)));
	const side = Math.max(70, Math.min(210, Math.round((W - 2 * PAD - 2 * gap) * 0.25)));
	const mid = Math.min(480, W - 2 * PAD - 2 * gap - 2 * side);
	const x0 = Math.round((W - (2 * side + 2 * gap + mid)) / 2);
	const cols = [
		{ x: x0, w: side, tall: 0, title: "what wakes them" },
		{ x: x0 + side + gap, w: mid, tall: 0, title: "agents" },
		{ x: x0 + side + gap + mid + gap, w: side, tall: 0, title: "what they use" },
	];
	const boxes: Box[] = [];
	const heads: Layout["heads"] = [];
	const y = [0, 0, 0];
	const head = (col: number, text: string) => {
		if (y[col]) y[col] += 6;
		heads.push({ col, y: y[col], text });
		y[col] += 18;
	};
	const put = (col: 0 | 1 | 2, b: Omit<Box, "col" | "x" | "y" | "w" | "h">, h: number) => {
		boxes.push({ ...b, col, x: cols[col].x, y: y[col], w: cols[col].w, h });
		y[col] += h + 6;
	};

	// On the left: you, the event sources, the schedules, and any other way in.
	const asks = s.work.filter((w) => !ended(w) && w.asking);
	put(0, { id: "you", kind: "you", title: "you", sub: asks.length ? `${asks.length} question${asks.length === 1 ? "" : "s"} for you` : undefined, bad: asks.length > 0 }, asks.length ? 40 : 26);
	const sources = s.inputs.filter((i) => i.kind === "source").sort((a, b) => a.name.localeCompare(b.name));
	if (sources.length) head(0, "events");
	const listeners = (i: ViewInput) => [...new Set([...i.agents, ...s.agents.filter((a) => a.sources.includes(i.name)).map((a) => a.id)])];
	for (const i of sources) {
		const who = listeners(i);
		put(0, { id: i.id, kind: "source", title: i.name, sub: i.failing ? "not running" : who.length ? `wakes ${listOf(who, 2)}` : (i.type ?? "nobody listens"), bad: i.failing }, 40);
	}
	const scheds: ViewSchedule[] = [];
	for (const x of [...s.schedules].sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || a.name.localeCompare(b.name))) if (!scheds.some((k) => k.name === x.name)) scheds.push(x);
	if (scheds.length) head(0, "schedules");
	for (const x of scheds) put(0, { id: `sched:${x.name}`, kind: "sched", title: x.name, right: x.next !== undefined && x.next > now - 1000 ? `in ${span(x.next - now)}` : undefined, sub: x.agent ? `wakes ${x.agent}` : "wakes all agents" }, 40);
	const others = s.inputs.filter((i) => i.kind === "outside");
	if (others.length) head(0, "other ways in");
	for (const i of others) put(0, { id: i.id, kind: "outside", title: i.name }, 26);

	// In the middle: the agents, each with what it does as a sentence.
	for (const a of s.agents) {
		const mine = s.work.filter((w) => w.agent === a.id && !ended(w)).sort((p, q) => p.started - q.started);
		const own = mine.filter((w) => !w.copy);
		const copies = mine.filter((w) => w.copy);
		const first = own.find((w) => w.asking) ?? own[0] ?? copies[0];
		const lines: NonNullable<Box["lines"]> = [];
		if (first) {
			// What it does, and under it in smaller words why, and how far it is.
			const more = [causeOf(first), first.steps ? `step ${first.steps.done} of ${first.steps.total}` : "", first.round ? `round ${first.round} of its goal` : "", first.branch ? "in a branch" : "", first.worktree ? "in a worktree" : ""].filter(Boolean).join(" · ");
			lines.push({ text: sentenceOf(first, s), tone: first.asking ? "ask" : "now" });
			if (more) lines.push({ text: more, tone: "dim" });
			for (const w of own) if (w !== first) lines.push({ text: `and ${sentenceOf(w, s)}${causeOf(w) ? `, ${causeOf(w)}` : ""}`, tone: w.asking ? "ask" : "now" });
			const shown = first.copy ? copies.slice(1) : copies;
			for (const c of shown.slice(0, 3)) lines.push({ text: `a copy ${sentenceOf(c, s)}`, tone: "now", indent: true });
			if (shown.length > 3) lines.push({ text: `and ${shown.length - 3} more copies`, tone: "dim", indent: true });
		} else lines.push({ text: "resting", tone: "dim" });
		const said = recent?.notes.get(a.id);
		if (said && now - said.at < 4000) lines.push({ text: said.text, tone: "note" });
		if (open.has(a.id)) for (const [i, c] of a.conversations.entries()) lines.push({ text: convText(c, a, i), tone: "dim", indent: c.branchOf !== undefined });
		put(1, { id: `agent:${a.id}`, kind: "agent", title: a.id, right: a.mode, lines, agent: a, busy: mine.length > 0, bad: mine.some((w) => w.asking) }, 28 + lines.length * 16 + 4);
	}

	// On the right: the MCP servers and the skills, those that most agents have first.
	const ranked = (pick: (a: ViewAgent) => string[]) => {
		const n = new Map<string, number>();
		for (const a of s.agents) for (const name of pick(a)) n.set(name, (n.get(name) ?? 0) + 1);
		return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
	};
	const servers = ranked((a) => a.mcp);
	const skills = ranked((a) => a.skills);
	if (servers.length) head(2, "MCP servers");
	for (const name of servers) put(2, { id: `mcp:${name}`, kind: "mcp", title: name }, 26);
	if (skills.length) head(2, "skills");
	for (const name of skills) put(2, { id: `skill:${name}`, kind: "skill", title: name }, 26);

	cols.forEach((c, i) => (c.tall = y[i]));
	const room = size.h - TOP - HEAD - 8;
	return { w: W, h: size.h, top: TOP + HEAD, cols, heads, boxes, byId: new Map(boxes.map((b) => [b.id, b])), reach: Math.max(0, Math.max(...y) - room) };
}

/** A conversation in words: never its name, which a view is not told. */
function convText(c: ViewConversation, a: ViewAgent, i: number): string {
	const what = c.main ? "its main conversation" : c.branchOf !== undefined ? `a branch of ${a.conversations.find((x) => x.id === c.branchOf)?.main ? "the main one" : "another"}` : `conversation ${i + 1}`;
	return [what, c.busy ? "at work" : "", c.worktree ? "in a worktree" : "", c.goal ? `goal ${c.goal}` : "", c.outside ? "has read outside content" : ""].filter(Boolean).join(", ");
}

/** How far a column has moved up when the page is scrolled by `scroll`: a short column moves less, so that all end together. */
export function offsetOf(l: Layout, col: number, scroll: number): number {
	const room = l.h - l.top - 8;
	const longest = Math.max(...l.cols.map((c) => c.tall));
	return longest <= room ? 0 : (scroll * Math.max(0, l.cols[col].tall - room)) / (longest - room);
}

/** What happens right now, as lines between boxes. */
export function linksOf(s: ViewState, l: Layout): Link[] {
	const out: Link[] = [];
	const colorOf = (id: string) => s.agents.find((a) => a.id === id)?.color ?? "#8899aa";
	const add = (link: Link) => {
		if (l.byId.has(link.from) && l.byId.has(link.to) && !out.some((x) => x.from === link.from && x.to === link.to)) out.push(link);
	};
	for (const w of s.work) {
		if (ended(w)) continue;
		const me = `agent:${w.agent}`;
		const color = colorOf(w.agent);
		// It waits for your answer: that counts for more than what once woke it.
		if (w.asking) add({ from: me, to: "you", color: ASK, live: true });
		if (!w.copy) {
			const f = w.from;
			if (f.k === "you" && !s.work.some((x) => x.agent === w.agent && !ended(x) && x.asking)) add({ from: "you", to: me, color, live: true });
			else if (f.k === "source") add({ from: `source:${f.name}`, to: me, color, live: true });
			else if (f.k === "outside") add({ from: `outside:${f.name}`, to: me, color, live: true });
			else if (f.k === "clock") add({ from: `sched:${f.name ?? ""}`, to: me, color, live: true });
			else if (f.k === "agent" && f.id !== w.agent) add({ from: `agent:${f.id}`, to: me, color: colorOf(f.id), live: true, side: true });
		}
		if (w.doing === "tool" && w.skill) add({ from: me, to: `skill:${w.skill}`, color, live: true });
		else if (w.doing === "tool" && w.mcp) add({ from: me, to: `mcp:${w.mcp}`, color, live: true });
	}
	return out;
}

/** What a box is wired to, whether or not anything happens there: what is drawn while the pointer is over it. */
export function wiringOf(id: string | undefined, s: ViewState, l: Layout): Link[] {
	const b = id ? l.byId.get(id) : undefined;
	if (!b) return [];
	const out: Link[] = [];
	const of = (a: ViewAgent) => {
		const me = `agent:${a.id}`;
		const add = (other: string, incoming: boolean) => l.byId.has(other) && !out.some((k) => (incoming ? k.from === other && k.to === me : k.from === me && k.to === other)) && out.push(incoming ? { from: other, to: me, color: a.color, live: false } : { from: me, to: other, color: a.color, live: false });
		for (const i of s.inputs) if (i.kind === "source" && (i.agents.includes(a.id) || a.sources.includes(i.name))) add(i.id, true);
		for (const x of s.schedules) if (x.agent === a.id) add(`sched:${x.name}`, true);
		for (const name of a.schedules) add(`sched:${name}`, true);
		for (const name of a.mcp) add(`mcp:${name}`, false);
		for (const name of a.skills) add(`skill:${name}`, false);
	};
	if (b.agent) of(b.agent);
	else for (const a of s.agents) of(a);
	return b.agent ? out : out.filter((k) => k.from === id || k.to === id);
}

/** The box under a point of the panel. */
export function hitAt(l: Layout, p: { x: number; y: number }, scroll: number): Box | undefined {
	if (p.y < l.top) return undefined;
	return l.boxes.find((b) => {
		const y = l.top + b.y - offsetOf(l, b.col, scroll);
		return p.x >= b.x && p.x < b.x + b.w && p.y >= y && p.y < y + b.h;
	});
}

/** What a box is, in a few pieces of a sentence: what the line on top says while the pointer is over it. */
export function tipOf(b: Box | undefined, s: ViewState, now: number): string[] {
	if (!b) return [];
	const who = (list: ViewAgent[]) => list.map((a) => a.id);
	if (b.agent) {
		const a = b.agent;
		const br = a.conversations.filter((c) => c.branchOf !== undefined).length;
		const next = s.schedules.filter((x) => x.agent === a.id && x.next !== undefined && x.next > now).sort((p, q) => p.next! - q.next!)[0];
		// What it is wired to, the lines on the page show; here is what they do not.
		return [
			`${a.id}${a.main ? ", the main agent" : ""}, works in ${a.mode} mode`,
			`${a.conversations.length} conversation${a.conversations.length === 1 ? "" : "s"}${br ? `, ${br} of them ${br === 1 ? "a branch" : "branches"}` : ""}`,
			next ? `${next.name} in ${span(next.next! - now)}` : "",
			"click for its conversations, double click to open it",
		].filter(Boolean);
	}
	if (b.kind === "you") return ["you: what you say starts an agent's work, and what an agent asks you waits here"];
	if (b.kind === "source" || b.kind === "outside") {
		const i = s.inputs.find((x) => x.id === b.id);
		const listen = s.agents.filter((a) => i?.agents.includes(a.id) || a.sources.includes(b.title));
		return [
			`${b.title}: ${b.kind === "source" ? `an event source${i?.type ? ` (${i.type})` : ""}` : "a way in from outside"}`,
			i?.failing ? "not running" : "",
			listen.length ? `wakes ${who(listen).join(", ")}` : b.kind === "source" ? "nobody listens to it" : "",
			i ? `${i.count} event${i.count === 1 ? "" : "s"} so far${i.last !== undefined ? `, the last ${span(now - i.last)} ago` : ""}` : "",
		].filter(Boolean);
	}
	if (b.kind === "sched") {
		const x = s.schedules.find((k) => `sched:${k.name}` === b.id);
		return [`${b.title}: a schedule`, x?.agent ? `wakes ${x.agent}` : "for all agents", x?.when ? `set to ${x.when}` : "", x?.next !== undefined && x.next > now ? `next in ${span(x.next - now)}` : ""].filter(Boolean);
	}
	const has = s.agents.filter((a) => (b.kind === "mcp" ? a.mcp : a.skills).includes(b.title));
	const using = [...new Set(s.work.filter((w) => !ended(w) && w.doing === "tool" && (b.kind === "mcp" ? w.mcp : w.skill) === b.title).map((w) => w.agent))];
	return [`${b.title}: ${b.kind === "mcp" ? "an MCP server" : "a skill"}`, `${who(has).join(", ")} ${has.length === 1 ? "has" : "have"} it`, using.length ? `${using.join(", ")} ${using.length === 1 ? "uses" : "use"} it right now` : ""].filter(Boolean);
}

// ---- drawing ---------------------------------------------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
interface Theme {
	bg: string;
	box: string;
	rule: string;
	text: string;
	dim: string;
}
const DARK: Theme = { bg: "#1b1e28", box: "#232634", rule: "#34384a", text: "#e4f0fb", dim: "#8d93b0" };
const LIGHT: Theme = { bg: "#fbfaf7", box: "#ffffff", rule: "#dcd9d0", text: "#22242b", dim: "#6d7280" };
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

const WIDTHS = new Map<string, number>();
function widthOf(g: Ctx, text: string): number {
	const key = `${g.font}|${text}`;
	let w = WIDTHS.get(key);
	if (w === undefined) {
		if (WIDTHS.size > 4000) WIDTHS.clear();
		w = g.measureText(text).width;
		WIDTHS.set(key, w);
	}
	return w;
}
/** Text cut to a width, with an ellipsis where it was cut. */
function fit(g: Ctx, text: string, max: number): string {
	if (widthOf(g, text) <= max) return text;
	let n = text.length;
	while (n > 1 && widthOf(g, `${text.slice(0, n)}…`) > max) n--;
	return n > 1 ? `${text.slice(0, n)}…` : "";
}

function rounded(g: Ctx, x: number, y: number, w: number, h: number, r: number): void {
	g.beginPath();
	g.moveTo(x + r, y);
	g.arcTo(x + w, y, x + w, y + h, r);
	g.arcTo(x + w, y + h, x, y + h, r);
	g.arcTo(x, y + h, x, y, r);
	g.arcTo(x, y, x + w, y, r);
	g.closePath();
}

/** The way of a line across the page, as points close enough together to draw it and to run a dot along it. */
export function pathOf(link: Link, l: Layout, scroll: number, nth = 0): Array<[number, number]> | undefined {
	const a = l.byId.get(link.from);
	const b = l.byId.get(link.to);
	if (!a || !b) return undefined;
	const ya = l.top + a.y - offsetOf(l, a.col, scroll) + Math.min(a.h / 2, 14);
	const yb = l.top + b.y - offsetOf(l, b.col, scroll) + Math.min(b.h / 2, 14);
	const pts: Array<[number, number]> = [];
	if (link.side || a.col === b.col) {
		// From agent to agent: out of the giver's left side, down or up beside the column, into the taker's left side.
		const x = a.x - 7 - (nth % 3) * 5;
		const r = Math.min(6, Math.abs(yb - ya) / 2);
		const dir = yb > ya ? 1 : -1;
		pts.push([a.x, ya], [x + r, ya]);
		for (let i = 1; i <= 4; i++) pts.push([x + r - Math.sin((i / 4) * (Math.PI / 2)) * r, ya + dir * (r - Math.cos((i / 4) * (Math.PI / 2)) * r)]);
		pts.push([x, yb - dir * r]);
		for (let i = 1; i <= 4; i++) pts.push([x + r - Math.cos((i / 4) * (Math.PI / 2)) * r, yb - dir * (r - Math.sin((i / 4) * (Math.PI / 2)) * r)]);
		pts.push([b.x, yb]);
		return pts;
	}
	// From one column to the next: out of one box's side, in a soft S, into the other's.
	const leftToRight = a.col < b.col;
	const xa = leftToRight ? a.x + a.w : a.x;
	const xb = leftToRight ? b.x : b.x + b.w;
	for (let i = 0; i <= 20; i++) {
		const t = i / 20;
		const k = t * t * (3 - 2 * t);
		pts.push([xa + (xb - xa) * t, ya + (yb - ya) * k]);
	}
	return pts;
}

export interface Shown {
	/** The box the pointer is over, and the one that was clicked. */
	hover?: string;
	selected?: string;
	scroll: number;
	recent: Recent;
}

/** The whole page, into a canvas whose units are the panel's own pixels. */
export function draw(g: Ctx, s: ViewState, l: Layout, now: number, o: Shown): void {
	const th = s.dark ? DARK : LIGHT;
	const deep = (c: string) => (s.dark ? c : mix(c, "#15171d", 0.25));
	g.globalAlpha = 1;
	g.fillStyle = th.bg;
	g.fillRect(0, 0, l.w, l.h);
	g.textBaseline = "middle";
	g.lineCap = "round";
	g.lineJoin = "round";

	const live = linksOf(s, l);
	const focus = o.hover ?? o.selected;
	const wires = wiringOf(focus, s, l);
	// What belongs with the box the pointer is over; everything else steps back.
	const near = new Set<string>();
	if (focus) {
		near.add(focus);
		for (const k of [...wires, ...live]) if (k.from === focus || k.to === focus) near.add(k.from), near.add(k.to);
	}
	const faded = (id: string) => focus !== undefined && !near.has(id);
	const yOf = (b: Box) => l.top + b.y - offsetOf(l, b.col, o.scroll);

	g.save();
	g.beginPath();
	g.rect(0, l.top - 2, l.w, l.h - l.top + 2);
	g.clip();

	// The lines first, so that every box lies on the ends of its lines.
	const stroke = (pts: Array<[number, number]>) => {
		g.beginPath();
		pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
		g.stroke();
	};
	wires.forEach((k, i) => {
		if (live.some((x) => x.from === k.from && x.to === k.to)) return;
		const pts = pathOf(k, l, o.scroll, i);
		if (!pts) return;
		g.globalAlpha = 0.5;
		g.strokeStyle = deep(k.color);
		g.lineWidth = 1;
		stroke(pts);
	});
	const sides = new Map<string, number>();
	const ways = live.map((k) => {
		const n = k.side ? (sides.get(k.to) ?? sides.size) : 0;
		if (k.side) sides.set(k.to, n);
		return { k, pts: pathOf(k, l, o.scroll, n) };
	});
	const lit = (k: Link) => !focus || k.from === focus || k.to === focus;
	for (const { k, pts } of ways) {
		if (!pts) continue;
		g.globalAlpha = lit(k) ? 0.9 : 0.15;
		g.strokeStyle = deep(k.color);
		g.lineWidth = 2;
		stroke(pts);
	}

	// The boxes.
	for (const head of l.heads) {
		const y = l.top + head.y - offsetOf(l, head.col, o.scroll);
		g.globalAlpha = focus ? 0.5 : 1;
		g.font = `600 9.5px ${FONT}`;
		g.textAlign = "left";
		g.fillStyle = th.dim;
		g.fillText(head.text.toUpperCase(), l.cols[head.col].x + 2, y + 10);
	}
	for (const b of l.boxes) {
		const y = yOf(b);
		if (y + b.h < l.top - 4 || y > l.h) continue;
		const mineLive = live.filter((k) => k.from === b.id || k.to === b.id);
		const hot = now - (o.recent.hot.get(b.id) ?? -1e9) < 1400;
		const active = b.kind === "agent" ? Boolean(b.busy) : mineLive.length > 0 || hot;
		const color = b.agent?.color ?? mineLive[0]?.color;
		const edge = b.bad ? ASK : active && color ? deep(color) : th.rule;
		const alpha = faded(b.id) ? 0.28 : 1;
		g.globalAlpha = alpha;
		rounded(g, b.x + 0.5, y + 0.5, b.w - 1, b.h - 1, 6);
		g.fillStyle = hot ? mix(th.box, color ?? th.text, 0.22) : active && color ? mix(th.box, color, s.dark ? 0.1 : 0.07) : th.box;
		g.fill();
		g.lineWidth = b.bad || b.id === focus ? 1.6 : 1;
		g.strokeStyle = b.id === focus && !b.bad ? th.text : edge;
		if (b.bad) g.globalAlpha = alpha * (0.7 + 0.3 * Math.sin(now / 280));
		g.stroke();
		g.globalAlpha = alpha;
		const padX = b.kind === "agent" ? 12 : 8;
		if (b.agent) {
			// An agent's own color, down the side of its box.
			g.fillStyle = b.busy ? b.agent.color : mix(th.box, b.agent.color, 0.5);
			rounded(g, b.x + 3, y + 4, 3, b.h - 8, 1.5);
			g.fill();
		}
		g.textAlign = "left";
		g.font = `10px ${FONT}`;
		const rightW = b.right && (b.kind === "sched" || b.w > 150) ? widthOf(g, b.right) + 14 : 0;
		if (rightW) {
			g.textAlign = "right";
			g.fillStyle = th.dim;
			g.fillText(b.right!, b.x + b.w - 8, y + 14);
			g.textAlign = "left";
		}
		g.font = `600 12px ${FONT}`;
		g.fillStyle = b.kind !== "agent" || b.busy ? th.text : mix(th.text, th.dim, 0.55);
		g.fillText(fit(g, b.title, b.w - padX - 6 - rightW), b.x + padX, y + 14);
		if (b.sub) {
			g.font = `10.5px ${FONT}`;
			g.fillStyle = b.bad ? ASK : th.dim;
			g.fillText(fit(g, b.sub, b.w - padX - 6), b.x + padX, y + 29);
		}
		(b.lines ?? []).forEach((line, i) => {
			g.font = `${line.tone === "ask" ? "600 " : ""}11px ${FONT}`;
			g.fillStyle = line.tone === "ask" ? ASK : line.tone === "now" ? th.text : line.tone === "note" ? deep(b.agent?.color ?? th.dim) : th.dim;
			const dx = line.indent ? 10 : 0;
			g.fillText(fit(g, line.text, b.w - padX - 8 - dx), b.x + padX + dx, y + 31 + i * 16);
		});
	}

	// Dots run along the lines of what happens, the way it goes.
	for (const { k, pts } of ways) {
		if (!pts || !lit(k)) continue;
		const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
		const total = lens.reduce((n, v) => n + v, 0);
		const count = Math.max(1, Math.round(total / 46));
		for (let d = 0; d < count; d++) {
			let at = ((now / 1400 + d / count) % 1) * total;
			let p = pts[0];
			for (let i = 0; i < lens.length; i++) {
				if (at <= lens[i] || i === lens.length - 1) {
					const u = lens[i] ? Math.min(1, at / lens[i]) : 0;
					p = [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
					break;
				}
				at -= lens[i];
			}
			g.globalAlpha = 1;
			g.fillStyle = th.bg;
			g.beginPath();
			g.arc(p[0], p[1], 3.6, 0, Math.PI * 2);
			g.fill();
			g.fillStyle = deep(k.color);
			g.beginPath();
			g.arc(p[0], p[1], 2.4, 0, Math.PI * 2);
			g.fill();
		}
	}
	g.restore();

	// Over the columns, what each one is.
	g.globalAlpha = 1;
	g.fillStyle = th.bg;
	g.fillRect(0, 0, l.w, l.top - 2);
	g.font = `600 11px ${FONT}`;
	g.textAlign = "left";
	g.fillStyle = th.dim;
	for (const c of l.cols) g.fillText(fit(g, c.title, c.w), c.x + 2, TOP + 9);
}

// ---- the view: the page in the panel ---------------------------------------------------------------------------------------

const STYLE = `
.overview { position: absolute; inset: 0; overflow: hidden; font: 11px ${FONT}; -webkit-font-smoothing: antialiased; }
.overview canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.overview-bar { position: absolute; left: 12px; right: 8px; top: 5px; height: 24px; display: flex; align-items: center; gap: 6px; }
.overview-sum { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dim); font-size: 12px; }
.overview-sum b { color: var(--text); font-weight: 600; }
.overview-sum .ask { color: ${ASK}; font-weight: 600; }
.overview-words { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
`;

export default defineView((host: ViewHost) => {
	const root = host.root;
	const style = document.createElement("style");
	style.textContent = STYLE;
	const box = document.createElement("div");
	box.className = "overview";
	const canvas = document.createElement("canvas");
	canvas.setAttribute("aria-label", "All of pine on one page: what wakes agents on the left, the agents and what each does in the middle, what they use on the right");
	const bar = document.createElement("div");
	bar.className = "overview-bar";
	const sum = document.createElement("div");
	sum.className = "overview-sum";
	const words = document.createElement("ul");
	words.className = "overview-words";
	words.dataset.slot = "overview-words";
	bar.append(sum);
	box.append(canvas, bar, words);
	root.append(style, box);

	const open = new Set<string>();
	const recent = new Recent();
	let pointer: { x: number; y: number } | undefined;
	let scroll = 0;
	let layout: Layout | undefined;
	let touched = 0;
	let timer = 0;
	let frame = 0;
	let slow = false;

	const size = () => ({ w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) });
	const at = (e: MouseEvent) => {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	/** Something was touched: the next frame comes now, not when the slow pace of a page at rest says. */
	const wake = () => {
		touched = Date.now();
		if (slow) {
			window.clearTimeout(timer);
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(tick);
		}
	};
	canvas.addEventListener("pointermove", (e) => {
		pointer = at(e);
		wake();
	});
	canvas.addEventListener("pointerleave", () => {
		pointer = undefined;
		wake();
	});
	canvas.addEventListener("click", (e) => {
		const b = layout && hitAt(layout, at(e), scroll);
		wake();
		if (b?.agent) {
			// A click opens an agent's box and shows it below; a second click closes both.
			if (open.delete(b.agent.id)) host.select();
			else {
				open.add(b.agent.id);
				host.select({ agent: b.agent.id });
			}
		} else if (!b) host.select();
	});
	canvas.addEventListener("dblclick", (e) => {
		const b = layout && hitAt(layout, at(e), scroll);
		if (b?.agent) host.open({ agent: b.agent.id });
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			scroll += e.deltaY;
			wake();
		},
		{ passive: false },
	);

	const say = (s: ViewState) => {
		words.replaceChildren(
			...s.agents.map((a) => {
				const mine = s.work.filter((w) => w.agent === a.id && !ended(w));
				const li = document.createElement("li");
				li.dataset.agent = a.id;
				li.textContent = `${a.id}, ${a.mode} mode${a.main ? ", the main agent" : ""}: ${mine.length ? mine.map((w) => `${w.copy ? "a copy " : ""}${sentenceOf(w, s)}${causeOf(w) ? `, ${causeOf(w)}` : ""}`).join("; ") : "at rest"}. ${[a.sources.length ? `Woken by ${a.sources.join(", ")}` : "", a.schedules.length ? `schedules ${a.schedules.join(", ")}` : "", a.mcp.length ? `MCP servers ${a.mcp.join(", ")}` : "", a.skills.length ? `skills ${a.skills.join(", ")}` : "", `${a.conversations.length} conversations, ${a.conversations.filter((c) => c.branchOf !== undefined).length} of them branches`].filter(Boolean).join("; ")}`;
				return li;
			}),
		);
	};
	const stopState = host.on("state", (s) => {
		say(s);
		wake();
	});
	const stopHearing = host.on("happening", (h) => {
		recent.hear(h, Date.now());
		wake();
	});
	say(host.state());

	const tick = () => {
		let wait = 1000;
		try {
			const s = host.state();
			const now = Date.now();
			const { w, h } = size();
			const dpr = Math.min(3, window.devicePixelRatio || 1);
			if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
				canvas.width = Math.round(w * dpr);
				canvas.height = Math.round(h * dpr);
			}
			const th = s.dark ? DARK : LIGHT;
			for (const [k, v] of Object.entries({ "--text": th.text, "--dim": th.dim, "--rule": th.rule, "--box": th.box })) box.style.setProperty(k, v);
			for (const id of open) if (!s.agents.some((a) => a.id === id)) open.delete(id);
			layout = layoutOf(s, { w, h }, open, now, recent);
			scroll = Math.max(0, Math.min(scroll, layout.reach));
			const over = pointer && hitAt(layout, pointer, scroll);
			canvas.style.cursor = over?.agent ? "pointer" : "default";
			const picked = s.selected;
			const sel = picked ? `agent:${"agent" in picked ? picked.agent : (s.work.find((x) => x.id === picked.work)?.agent ?? "")}` : undefined;
			const g = canvas.getContext("2d")!;
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			draw(g, s, layout, now, { hover: over?.id, selected: sel && layout.byId.has(sel) ? sel : undefined, scroll, recent });

			const running = s.work.filter((x) => !ended(x));
			const asks = running.filter((x) => x.asking).length;
			const next = s.schedules.find((x) => x.next !== undefined && x.next > now - 1000);
			const bad = s.inputs.filter((i) => i.failing).map((i) => i.name);
			const part = (cls: string, text: string) => Object.assign(document.createElement(cls === "b" ? "b" : "span"), { className: cls === "b" ? "" : cls, textContent: text });
			// The line on top: how things stand; and while the pointer is over a box, what that box is.
			const about = tipOf(over, s, now);
			sum.replaceChildren(
				...(about.length
					? [part("b", about[0]), ...about.slice(1).map((text) => `  ·  ${text}`)]
					: [
							part("b", running.length ? `${new Set(running.map((x) => x.agent)).size} of ${s.agents.length} agents at work` : `all ${s.agents.length} agents resting`),
							asks ? part("ask", `  ·  ${asks} question${asks === 1 ? "" : "s"} for you`) : "",
							bad.length ? part("ask", `  ·  ${bad.join(", ")} not running`) : "",
							next ? `  ·  next: ${next.name} in ${span(next.next! - now)}` : "",
						].filter(Boolean)),
			);
			// Often while dots run or the pointer is here, once a second at rest, seldom while the window is behind.
			const moving = running.length > 0 || [...recent.hot.values()].some((t) => now - t < 1500);
			wait = !s.focused ? 2000 : moving || now - touched < 1200 ? 40 : 1000;
		} catch (e) {
			window.clearTimeout(timer);
			throw e;
		}
		slow = wait > 50;
		timer = window.setTimeout(() => (frame = requestAnimationFrame(tick)), wait);
	};
	frame = requestAnimationFrame(tick);
	const watch = new ResizeObserver(() => wake());
	watch.observe(root);

	return () => {
		window.clearTimeout(timer);
		cancelAnimationFrame(frame);
		watch.disconnect();
		stopState();
		stopHearing();
	};
});
