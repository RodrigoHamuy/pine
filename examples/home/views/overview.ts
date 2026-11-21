// overview: all of pine on one board, in words. A view for the panel of the Pine app
// (docs/references/views.md); it draws what "pine/view" tells it and nothing else.
//
// Nothing here has to be learned first. There are three columns, and everything in them says in words what it is:
//
//   Triggers            what starts an agent's work: you, every event source ("inbox, triggers books"), every
//                       schedule ("lights, triggers home, in 20 s"), every webhook
//   Agents              every agent, those that work on top and the idle ones below them. Under its name what
//                       it is doing right now, as a person would say it:
//                       "Running a command", "Waiting for scout", "Needs your answer", "Idle"; under that why
//                       ("for you", "delegated by main", "triggered by inbox") and how far ("step 2 of 5").
//                       Each of its sub-agents is a line of its own under it, one that a sub-agent started
//                       standing in under that one
//   Tools               what agents use. On top the boards, where a job that several work on is kept: a card
//                       for each, with how far it is ("7/24"), a bar of how its tasks stand, and one small
//                       tile per task in the order they were posted: an outline for one that is open (a faint
//                       one while it waits for another), filled in the agent's color while a sub-agent works
//                       on it, filled in the text's color when it is done, in the color of a question when
//                       its worker asked something, in the color of what failed when it failed. A task that
//                       comes after another (a check of somebody's work) stands under it. Under the boards
//                       every MCP server and every skill
//
// It looks like the app it is shown in: the app's font, its cards with their thin borders and round corners, an
// agent's avatar as the side bar draws it, its mode as a small badge, and the app's own colors for a question and
// for what failed. It has no ground of its own: the panel's shows through, in any theme. The lines are what it has
// from a circuit board: traces that turn at 45 degrees. A trace joins two cards only while something happens
// between them, in the color of the agent it happens to: from a trigger to the agent it started, from an agent to
// the tool it is using, at the left of the agents from one to the agent it delegated a task to, and in the color
// of a question from an agent to you while it waits for your answer. When a delegated task ends, its answer goes
// back at the right of the agents, from the one that did it to the one that asked, for a few seconds (in the color
// of what failed, if it did); and what you asked for comes back to you the same way. A trace starts with a dot,
// ends with an arrowhead, and one dot runs along it the way things go. Every trace has a lane of its own, so that
// no two run on top of each other. What is on the board at any moment reads as a sentence: you asked main, main
// delegated to scout, scout is using the web. While an agent works, a small dot beside its name fades out and in.
//
// The board is larger than the panel may be, and a camera looks at it. While the eye at the top right is pressed
// it follows what happens: it keeps every part that something happens at in view, and moves there softly. Drag
// the board, scroll, or pinch (or scroll with ctrl or cmd held) to look yourself; the eye, or a double click on
// the empty board, follows again. The button beside it shows the whole board.
//
// How much each thing says goes by how close it is looked at. From far away a box is one line: a name and how it
// stands ("working", "asks you", "7/24" and a bar), so that all of pine fits in the panel. In the middle it is as
// described above. From close by it tells all a view is told: under each piece of work and each sub-agent how long it
// has run, how many tools it called and its last tool calls as small pills (one that failed in the color of what
// failed, the one it is in now in the agent's), what it finished lately, what it has, and its conversations; a
// board as a row for every task, with its number, what its worker is doing and for how long, what it waits for, and
// at the right its notes and whether it had an answer, a task that comes after another standing in under it. A level
// takes the place of another around the pointer, at about the size its words had. A click on a board or on one of
// its tasks shows it under the view, where the panel says what the task is in its own words: this view is never told.
//
// Everything else is there when it is pointed at: the pointer over anything draws thin traces to all it is wired
// to (an agent's sources, schedules, MCP servers and skills; for a source, who listens to it), the rest fades, and
// the line on top says what it is. A click on an agent unfolds it: a line for each of its conversations, branches
// under what they were branched from. A click also shows it under the view, a double click opens it.
//
// There is no timeline: what happened, in order, is what the panel lists under every view.

import { defineView, detailAt, ease, frame, mix, rgb, tasksOf, tiling, unsettled, type TaskTile, type Box as Rect, type Cam, type Detail, type ViewAgent, type ViewCall, type ViewBoard, type ViewConversation, type ViewTask, type ViewHappening, type ViewHost, type ViewInput, type ViewSchedule, type ViewState, type ViewWork } from "pine/view";

// ---- what is said ---------------------------------------------------------------------------------------------------------

const ENDED = ["done", "failed", "cancelled"];
const ended = (w: ViewWork) => ENDED.includes(w.doing);

/** What pine's everyday tools do, as somebody would say it. A tool that is not here is called by its name. */
const DOING: Record<string, string> = {
	bash: "Running a command",
	read: "Reading a file",
	edit: "Editing a file",
	write: "Writing a file",
	grep: "Searching files",
	find: "Finding files",
	ls: "Listing a folder",
	manual: "Reading the manual",
	download: "Downloading a file",
	todo: "Planning next steps",
	question: "Asking a question",
	delegate: "Delegating a task",
	subagent: "Starting sub-agents",
	send: "Sending a message",
	publish_event: "Publishing an event",
	read_source: "Reading from a source",
	request_access: "Requesting access",
	boards: "Listing boards",
	board_read: "Reading the board",
	board_post: "Posting on the board",
	board_claim: "Taking a task",
	board_done: "Settling a task",
	board_answer: "Answering a sub-agent",
};

/** A tool's name without its server's: "mcp__web__web_search" of "web" is "search". */
const toolWord = (tool: string | undefined, mcp?: string) => {
	const t = tool ?? "";
	if (!mcp) return t.replace(/_/g, " ") || "a tool";
	return t.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, "").replace(new RegExp(`^${mcp}_`), "").replace(/_/g, " ") || "a tool";
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a piece of work is doing right now, as a person would put it. */
export function sentenceOf(w: ViewWork, s: ViewState): string {
	if (w.asking) return "Needs your answer";
	if (w.doing === "done") return "Done";
	if (w.doing === "failed") return "Failed";
	if (w.doing === "cancelled") return "Stopped";
	if (w.doing === "tool") {
		if (w.skill) return `Reading skill: ${w.skill}`;
		if (w.mcp) return `Using ${w.mcp}: ${toolWord(w.tool, w.mcp)}`;
		return DOING[w.tool ?? ""] ?? `Using ${toolWord(w.tool)}`;
	}
	if (w.doing === "writing") return "Writing an answer";
	if (w.doing === "waiting") {
		const on = w.waitingOn.map((id) => s.work.find((x) => x.id === id)).filter((x): x is ViewWork => Boolean(x && !ended(x)));
		const subs = on.filter((x) => x.copy).length;
		const who = [...new Set(on.filter((x) => !x.copy).map((x) => x.agent)), ...(subs ? [plural(subs, "sub-agent")] : [])];
		return who.length ? `Waiting for ${who.join(" and ")}` : "Waiting";
	}
	return "Thinking";
}

/** Why a piece of work runs, in a few words: who it is for, or what triggered it. */
export function causeOf(w: ViewWork): string {
	const f = w.from;
	return f.k === "you" ? "for you" : f.k === "clock" ? `triggered by ${f.name ?? "a schedule"}` : f.k === "source" || f.k === "outside" ? `triggered by ${f.name}` : f.k === "agent" ? `delegated by ${f.id}` : "";
}

const span = (ms: number) => (ms < 1500 ? "now" : ms < 90_000 ? `${Math.round(ms / 1000)} s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : ms < 129_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`);
const listOf = (names: string[], max = 3) => (names.length <= max ? names.join(", ") : `${names.slice(0, max - 1).join(", ")} +${names.length - max + 1}`);

/** The boards of a state. (An app older than this view tells it none.) */
const boardsOf = (s: ViewState): ViewBoard[] => s.boards ?? [];
/** A board by what it is called: its name, or whose it is. A view is never told what stands on it. */
export const boardTitle = (b: ViewBoard) => b.name ?? (b.agent ? `${b.agent}'s board` : "Board");
/** How a board stands, in a few words. */
export function boardLine(b: ViewBoard): string {
	const tasks = b.open + b.taken + b.done + b.failed + b.blocked;
	if (b.blocked) return b.blocked === 1 ? "Waits for an answer" : `${b.blocked} wait for an answer`;
	return tasks ? `${b.done} of ${tasks} done` : b.notes ? plural(b.notes, "note") : "Empty";
}
/** What happens on a board right now, in a few words: what its card says under its name. */
export function boardWords(b: ViewBoard): string {
	const tasks = b.open + b.taken + b.done + b.failed + b.blocked;
	if (!tasks) return b.notes ? plural(b.notes, "note") : "Empty";
	if (b.blocked) return b.blocked === 1 ? "Waits for an answer" : `${b.blocked} wait for an answer`;
	const parts = [b.taken ? `${b.taken} in progress` : "", b.open ? `${b.open} to do` : "", b.failed ? `${b.failed} failed` : ""].filter(Boolean);
	return parts.length ? parts.slice(0, 2).join(" · ") : "Done";
}

/** A task's tile in a board's card, from the card's left edge and the top of its tiles. */
export type Tile = TaskTile;
/**
 * A board's tasks as tiles in its card (`tiling` of pine/view): as large as lets every piece of work stand in one
 * row with what comes after it under it, smaller where there are more, and never higher than sixty pixels.
 */
export function tilesOf(b: ViewBoard, width: number): { size: number; tiles: Tile[]; height: number; more: number } {
	return tiling(b, width, 60, [[8, 2], [7, 2], [6, 2], [5, 2], [4, 1]], 3);
}
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
				note(h.agent, "Sent a message");
				break;
			case "branched":
				note(h.agent, h.worktree ? "New branch in a worktree" : "New branch");
				break;
			case "goal":
				note(h.agent, h.status === "met" ? "Goal reached" : `Goal ${h.status}`);
				break;
			case "outside":
				note(h.agent, "Read outside content");
				break;
			case "decided":
				note(h.agent, h.allowed ? "You approved" : "You declined");
				break;
			case "ended":
				note(h.agent, h.failed ? "Task failed" : "Task finished");
				break;
			case "answered":
				note(h.from, `Answered ${h.to}`);
				note(h.to, `Answer from ${h.from}`);
				break;
			case "board":
				this.hot.set(`board:${h.board}`, at);
				break;
			default:
				break;
		}
	}
}

// ---- where everything is ---------------------------------------------------------------------------------------------------

/** A box of the page: something that wakes agents, an agent, or something agents use. */
export interface Box {
	/** "you", an input's id ("source:inbox", "outside:hook"), "sched:<name>", "agent:<id>", "board:<number>", "mcp:<name>", "skill:<name>". */
	id: string;
	col: 0 | 1 | 2;
	kind: "you" | "source" | "outside" | "sched" | "agent" | "board" | "mcp" | "skill";
	/** Its place on the board. */
	x: number;
	y: number;
	w: number;
	h: number;
	title: string;
	/** A second line, smaller: what it is, whom it wakes. And words at the right of the first line. */
	sub?: string;
	right?: string;
	/** For an agent: the lines under its name. The first is what it does. */
	lines?: Array<{ text: string; tone: "now" | "ask" | "sub" | "dim" | "note"; indent?: number; calls?: ViewCall[]; /** It goes on what stands above it: no corner in front of it. */ more?: boolean }>;
	agent?: ViewAgent;
	/** For a board: the board, whose tasks its card draws. From close by, a row for each task. */
	board?: ViewBoard;
	rows?: TaskRow[];
	bad?: boolean;
	busy?: boolean;
}
/** A row of a board's card when it is looked at from close by: one task, or under the tasks a word about the whole board. */
export interface TaskRow {
	task?: ViewTask;
	/** How deep it stands under the task it comes after. */
	indent: number;
	text: string;
	/** What else there is to say of it, at the right: its notes, an answer it had. */
	flags: string;
}
export interface Layout {
	/** How much of everything the boxes say: see `layoutOf`. */
	detail: Detail;
	/** The size of the board: everything on it lies between 0 and these. It does not depend on the panel's size. */
	w: number;
	h: number;
	cols: Array<{ x: number; w: number; title: string }>;
	heads: Array<{ col: number; y: number; text: string }>;
	boxes: Box[];
	byId: Map<string, Box>;
}
/** A line between two boxes: something that happens now (`live`), or wiring that is shown for what the pointer is over. */
export interface Link {
	from: string;
	to: string;
	color: string;
	live: boolean;
	/** A task delegated from an agent to an agent: it runs beside the agents, at their left. */
	side?: boolean;
	/** The answer to a delegated task, on its way back: it runs beside the agents at their right. */
	back?: boolean;
}

/** How long an answer is shown on its way back, once the work is over. */
const ANSWER_MS = 3500;

/** The board's measures: a narrow column at each side, the agents between them, and a gap for the lines. */
const SIDE = 128;
const MID = 236;
const GAP = 46;
/** The room on top of a column for what it is called. */
const TITLE = 26;
/** How far from a box a line begins and ends: the room for the dot it starts with and the arrowhead it ends with. */
export const PIN = 3;
/** The color of a line that is a question for you, and of an answer that failed: names, which the drawing turns into the theme's own colors. */
export const ASK = "ask";
export const FAILED = "failed";

/** The columns' measures at each level of detail: narrow where a box is a name, wide where it tells everything. */
const MEASURES: Record<Detail, { side: number; mid: number; gap: number }> = { far: { side: 118, mid: 170, gap: 40 }, mid: { side: SIDE, mid: MID, gap: GAP }, near: { side: 250, mid: 330, gap: GAP } };
/**
 * How large each level is drawn for: the board from close by is drawn for a zoom a third closer than the one in
 * the middle, the one from far for a zoom that shows nearly twice as much. So a level takes the place of another
 * at about the size its words have on the panel, and what changes is how much is said.
 */
export const SCALE: Record<Detail, number> = { far: 0.6, mid: 1, near: 1.3 };
/** A task's row in a board's card from close by, and where the rows begin. */
export const ROW = 17;
const ROWS_AT = 54;

/** How a task stands, for its row: what its worker is doing and for how long, or what it waits for. */
function rowOf(t: ViewTask, s: ViewState, now: number): { text: string; flags: string } {
	const w = t.worker !== undefined ? s.work.find((x) => x.id === t.worker) : undefined;
	const time = t.since !== undefined ? span(Math.max(0, now - t.since)) : "";
	const ago = time ? (time === "now" ? "just now" : `${time} ago`) : "";
	const text =
		t.state === "taken" ? `${w ? sentenceOf(w, s) : "In progress"}${time && time !== "now" ? ` · ${time}` : ""}`
		: t.state === "blocked" ? `Waiting for an answer${time && time !== "now" ? ` · ${time}` : ""}`
		: t.state === "waiting" ? `After task ${t.after.join(" and ")}`
		: t.state === "open" ? `To do${t.by ? ` · from ${t.by}` : ""}`
		: `${t.state === "done" ? "Done" : "Failed"}${ago ? ` ${ago}` : ""}`;
	return { text, flags: [t.asked === "answered" ? "answered" : "", t.notes ? plural(t.notes, "note") : "", t.outside ? "outside content" : ""].filter(Boolean).join(" · ") };
}
/** A board's tasks as rows: in the order they were posted, each task that comes after another standing in under it. */
export function rowsOf(b: ViewBoard, s: ViewState, now: number): TaskRow[] {
	const tasks = tasksOf(b);
	const ids = new Set(tasks.map((t) => t.id));
	const placed = new Set<number>();
	const rows: TaskRow[] = [];
	const walk = (t: ViewTask, indent: number) => {
		if (placed.has(t.id)) return;
		placed.add(t.id);
		rows.push({ task: t, indent, ...rowOf(t, s, now) });
		for (const next of tasks) if (next.after.includes(t.id) && next.after.every((a) => placed.has(a) || !ids.has(a))) walk(next, Math.min(indent + 1, 3));
	};
	for (const t of tasks) if (!t.after.some((a) => ids.has(a))) walk(t, 0);
	for (const t of tasks) walk(t, 1);
	const shown = rows.slice(0, 80);
	if (rows.length > shown.length) shown.push({ indent: 0, text: `+${plural(rows.length - shown.length, "more task")}`, flags: "" });
	if (b.notes) shown.push({ indent: 0, text: `${plural(b.notes, "note")} on this board`, flags: "" });
	return shown;
}

/**
 * Everything on the board. `open` are the agents whose boxes are unfolded. `detail` is how much the boxes say:
 * from far a name and how it stands, in the middle what each is doing, from close by all there is to tell.
 */
export function layoutOf(s: ViewState, open: Set<string>, now: number, recent?: Recent, detail: Detail = "mid"): Layout {
	const m = MEASURES[detail];
	const far = detail === "far";
	const near = detail === "near";
	type Lines = NonNullable<Box["lines"]>;
	/** A box with lines under its two rows of words is as high as they need. */
	const tall = (lines: Lines, base: number) => (lines.length ? 40 + lines.length * 18 : base);
	const dim = (texts: Array<string | undefined | false>): Lines => texts.filter((t): t is string => Boolean(t)).map((text) => ({ text, tone: "dim" as const }));
	const cols = [
		{ x: 0, w: m.side, title: "Triggers" },
		{ x: m.side + m.gap, w: m.mid, title: "Agents" },
		{ x: m.side + m.gap + m.mid + m.gap, w: m.side, title: "Tools" },
	];
	const boxes: Box[] = [];
	const heads: Layout["heads"] = [];
	const y = [TITLE, TITLE, TITLE];
	const head = (col: number, text: string) => {
		if (y[col] > TITLE) y[col] += 6;
		heads.push({ col, y: y[col], text });
		y[col] += 18;
	};
	const put = (col: 0 | 1 | 2, b: Omit<Box, "col" | "x" | "y" | "w" | "h">, h: number) => {
		boxes.push({ ...b, col, x: cols[col].x, y: y[col], w: cols[col].w, h });
		y[col] += h + 6;
	};

	// On the left: you, the event sources, the schedules, and any other way in.
	// (A task of a board that waits for your answer is a question for you like any other.)
	const asks = s.work.filter((w) => !ended(w) && w.asking).length + boardsOf(s).reduce((n, b) => n + b.blocked, 0);
	// (From close by: who asks.)
	const asking = near ? [...s.work.filter((w) => !ended(w) && w.asking).map((w) => `${w.agent}${w.copy ? "'s sub-agent" : ""} needs your answer`), ...boardsOf(s).flatMap((b) => tasksOf(b).filter((t) => t.state === "blocked").map((t) => `Task ${t.id} on ${boardTitle(b)} waits for an answer`))].slice(0, 8).map((text) => ({ text, tone: "ask" as const })) : [];
	put(0, { id: "you", kind: "you", title: "You", sub: asks && !far ? `${plural(asks, "question")} for you` : undefined, right: far && asks ? plural(asks, "question") : undefined, lines: asking, bad: asks > 0 }, far ? 30 : tall(asking, asks ? 44 : 30));
	const sources = s.inputs.filter((i) => i.kind === "source").sort((a, b) => a.name.localeCompare(b.name));
	if (sources.length) head(0, "Events");
	const listeners = (i: ViewInput) => [...new Set([...i.agents, ...s.agents.filter((a) => a.sources.includes(i.name)).map((a) => a.id)])];
	for (const i of sources) {
		const who = listeners(i);
		if (far) {
			put(0, { id: i.id, kind: "source", title: i.name, right: i.failing ? "down" : undefined, bad: i.failing }, 30);
			continue;
		}
		const more = near ? dim([i.type ? `${i.type} source` : "", `${plural(i.count, "event")}${i.last !== undefined ? `, last ${span(now - i.last)} ago` : ""}`, who.length > 2 ? `triggers ${who.join(", ")}` : ""]) : [];
		put(0, { id: i.id, kind: "source", title: i.name, sub: i.failing ? "down" : who.length ? `triggers ${listOf(who, 2)}` : "no listeners", lines: more, bad: i.failing }, tall(more, 44));
	}
	const scheds: ViewSchedule[] = [];
	for (const x of [...s.schedules].sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || a.name.localeCompare(b.name))) if (!scheds.some((k) => k.name === x.name)) scheds.push(x);
	if (scheds.length) head(0, "Schedules");
	for (const x of scheds) {
		const more = near ? dim([x.when, x.last !== undefined ? `last ran ${span(Math.max(0, now - x.last))} ago` : "has not run since the panel opened"]) : [];
		put(0, { id: `sched:${x.name}`, kind: "sched", title: x.name, right: x.next !== undefined && x.next > now - 1000 ? `in ${span(x.next - now)}` : undefined, sub: far ? undefined : x.agent ? `triggers ${x.agent}` : "triggers all agents", lines: more }, far ? 30 : tall(more, 44));
	}
	const others = s.inputs.filter((i) => i.kind === "outside");
	if (others.length) head(0, "Webhooks");
	for (const i of others) {
		const more = near ? dim([`${plural(i.count, "event")}${i.last !== undefined ? `, last ${span(now - i.last)} ago` : ""}`]) : [];
		put(0, { id: i.id, kind: "outside", title: i.name, sub: near ? "webhook" : undefined, lines: more }, tall(more, 30));
	}

	// In the middle: the agents, each with what it does as a sentence.
	// Those that work stand on top, the idle ones below them, each group in pine's own order. One whose work has just
	// ended keeps its place for as long as its answer is on its way back, so that the page does not jump twice.
	const atWork = (a: ViewAgent) => s.work.some((w) => w.agent === a.id && (!ended(w) || (w.finished !== undefined && now >= w.finished && now - w.finished <= ANSWER_MS)));
	for (const a of [...s.agents.filter(atWork), ...s.agents.filter((x) => !atWork(x))]) {
		const mine = s.work.filter((w) => w.agent === a.id && !ended(w)).sort((p, q) => p.started - q.started);
		const own = mine.filter((w) => !w.copy);
		const copies = mine.filter((w) => w.copy);
		const first = own.find((w) => w.asking) ?? own[0] ?? copies[0];
		const lines: NonNullable<Box["lines"]> = [];
		if (far) {
			// From far away: its name and one word for how it stands.
			const state = mine.some((w) => w.asking) ? "asks you" : !mine.length ? "idle" : mine.every((w) => w.doing === "waiting") ? "waiting" : "working";
			put(1, { id: `agent:${a.id}`, kind: "agent", title: a.id, right: state, lines, agent: a, busy: mine.length > 0, bad: mine.some((w) => w.asking) }, 36);
			continue;
		}
		// From close by, under each piece of work: how long it has run, how many tools it called, the mode it is held to,
		// and its last tool calls by name, the one it is in last.
		const more = (w: ViewWork, indent?: number) => {
			if (!near) return;
			const time = span(Math.max(0, now - w.started));
			const parts = [time === "now" ? "just started" : `for ${time}`, w.tools ? plural(w.tools, "tool call") : "", w.mode && w.mode !== a.mode ? `${w.mode} mode` : "", w.outside ? "read outside content" : ""].filter(Boolean);
			lines.push({ text: parts.join(" · "), tone: "dim", indent, more: true });
			if (w.calls?.length) lines.push({ text: w.calls.map((c) => toolWord(c.tool, c.mcp)).join(", "), tone: "dim", indent, calls: w.calls, more: true });
		};
		if (first) {
			// What it is doing, and under it in smaller words why, and then how far it is.
			const why = causeOf(first);
			const howFar = [first.steps ? `step ${first.steps.done} of ${first.steps.total}` : "", first.round ? `goal round ${first.round}` : ""].filter(Boolean).join(" · ");
			const where = [first.branch ? "in a branch" : "", first.worktree ? "in a worktree" : ""].filter(Boolean).join(" · ");
			lines.push({ text: sentenceOf(first, s), tone: first.asking ? "ask" : "now" });
			for (const text of [why, howFar, where]) if (text) lines.push({ text, tone: "dim" });
			more(first);
			// The board its sub-agents work through: how many of its tasks are done.
			for (const b of boardsOf(s)) if (b.scope === "conversation" && b.agent === a.id && unsettled(b) > 0) lines.push({ text: b.blocked ? `Board: ${b.blocked === 1 ? "a task waits" : `${b.blocked} tasks wait`} for an answer` : `Board: ${boardLine(b).toLowerCase()}${b.taken ? ` · ${b.taken} in progress` : ""}`, tone: b.blocked ? "ask" : "dim" });
			for (const w of own) {
				if (w === first) continue;
				lines.push({ text: `${sentenceOf(w, s)}${causeOf(w) ? ` · ${causeOf(w)}` : ""}`, tone: w.asking ? "ask" : "now" });
				more(w);
			}
			const shown = first.copy ? copies.slice(1) : copies;
			// Its sub-agents as a tree: one that a sub-agent started itself stands in under that one.
			const ids = new Set(shown.map((c) => c.id));
			const tree: Array<{ w: ViewWork; level: number }> = [];
			const walk = (parent: number | undefined, level: number) => {
				for (const c of shown) {
					if ((c.parent !== undefined && ids.has(c.parent) ? c.parent : undefined) !== parent) continue;
					tree.push({ w: c, level });
					walk(c.id, Math.min(level + 1, 3));
				}
			};
			walk(undefined, 1);
			// One that has a task of a board is called by that task's number, which is the tile's in the board's card.
			const taskOf = (w: ViewWork) => (w.board === undefined ? undefined : tasksOf(boardsOf(s).find((b) => b.id === w.board) ?? ({} as ViewBoard)).find((t) => t.worker === w.id)?.id);
			const most = near ? 24 : 6;
			for (const t of tree.slice(0, most)) {
				lines.push({ text: `${taskOf(t.w) !== undefined ? `Task ${taskOf(t.w)}` : "Sub-agent"}: ${sentenceOf(t.w, s).toLowerCase()}`, tone: t.w.asking ? "ask" : "sub", indent: t.level });
				more(t.w, t.level);
			}
			if (tree.length > most) lines.push({ text: `+${plural(tree.length - most, "more sub-agent")}`, tone: "dim", indent: 1 });
		} else lines.push({ text: "Idle", tone: "dim" });
		const said = recent?.notes.get(a.id);
		if (said && now - said.at < 4000) lines.push({ text: said.text, tone: "note" });
		if (near) {
			// What it finished a while ago, and what it has: from close by there is room for it.
			const done = s.work.filter((w) => w.agent === a.id && !w.copy && ended(w) && w.finished !== undefined).sort((p, q) => q.finished! - p.finished!).slice(0, 3);
			for (const w of done) lines.push({ text: `${sentenceOf(w, s)} ${span(Math.max(0, now - w.finished!))} ago · took ${span(w.finished! - w.started)}${w.tools ? ` · ${plural(w.tools, "tool call")}` : ""}`, tone: "dim" });
			lines.push(...dim([a.sources.length ? `Listens to ${listOf(a.sources, 5)}` : "", a.schedules.length ? `Schedules: ${listOf(a.schedules, 5)}` : "", a.mcp.length ? `MCP servers: ${listOf(a.mcp, 5)}` : "", a.skills.length ? `Skills: ${listOf(a.skills, 5)}` : ""]));
		}
		if (open.has(a.id) || near) for (const [i, c] of a.conversations.entries()) lines.push({ text: convText(c, a, i), tone: "dim", indent: c.branchOf !== undefined ? 1 : undefined });
		put(1, { id: `agent:${a.id}`, kind: "agent", title: a.id, right: a.mode, lines, agent: a, busy: mine.length > 0, bad: mine.some((w) => w.asking) }, 40 + lines.length * 18);
	}

	// On the right, first: the boards that have work on them, and those with a name, which are there to stay.
	const boards = boardsOf(s).filter((b) => unsettled(b) > 0 || b.name).slice(0, 6);
	if (boards.length) head(2, "Boards");
	for (const b of boards) {
		const all = b.open + b.taken + b.done + b.failed + b.blocked;
		if (far) {
			// From far away: its name, how far it is, and the bar.
			put(2, { id: `board:${b.id}`, kind: "board", title: b.name ?? b.agent ?? "Board", right: all ? `${b.done}/${all}` : undefined, board: b, busy: b.taken > 0, bad: b.blocked > 0 }, all ? 40 : 30);
			continue;
		}
		if (near) {
			// From close by: a row for every task.
			const rows = rowsOf(b, s, now);
			put(2, { id: `board:${b.id}`, kind: "board", title: b.name ?? b.agent ?? "Board", right: all ? `${b.done}/${all}` : undefined, sub: boardWords(b), board: b, rows, busy: b.taken > 0, bad: b.blocked > 0 }, 44 + (all ? 12 : 0) + (rows.length ? rows.length * ROW + 6 : 0));
			continue;
		}
		const tiles = tilesOf(b, m.side - 20);
		// Its name and how far it is, what happens on it, a bar, and its tasks as tiles.
		put(2, { id: `board:${b.id}`, kind: "board", title: b.name ?? b.agent ?? "Board", right: all ? `${b.done}/${all}` : undefined, sub: boardWords(b), board: b, busy: b.taken > 0, bad: b.blocked > 0 }, 44 + (all ? 12 : 0) + (tiles.height ? tiles.height + 10 : 0) + (tiles.more ? 12 : 0));
	}

	// Under them: the MCP servers and the skills, those that most agents have first.
	const ranked = (pick: (a: ViewAgent) => string[]) => {
		const n = new Map<string, number>();
		for (const a of s.agents) for (const name of pick(a)) n.set(name, (n.get(name) ?? 0) + 1);
		return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
	};
	const servers = ranked((a) => a.mcp);
	const skills = ranked((a) => a.skills);
	if (servers.length) head(2, "MCP servers");
	// (From close by: who has it, and who is using it now.)
	const used = (kind: "mcp" | "skill", name: string) => {
		if (!near) return {};
		const has = s.agents.filter((a) => (kind === "mcp" ? a.mcp : a.skills).includes(name)).map((a) => a.id);
		const using = [...new Set(s.work.filter((w) => !ended(w) && w.doing === "tool" && (kind === "mcp" ? w.mcp : w.skill) === name).map((w) => w.agent))];
		return { sub: `available to ${listOf(has, 4)}`, lines: using.map((id) => ({ text: `in use by ${id}`, tone: "now" as const })) };
	};
	for (const name of servers) {
		const u = used("mcp", name);
		put(2, { id: `mcp:${name}`, kind: "mcp", title: name, ...u }, near ? tall(u.lines ?? [], 44) : 30);
	}
	if (skills.length) head(2, "Skills");
	for (const name of skills) {
		const u = used("skill", name);
		put(2, { id: `skill:${name}`, kind: "skill", title: name, ...u }, near ? tall(u.lines ?? [], 44) : 30);
	}

	return { detail, w: cols[2].x + cols[2].w, h: Math.max(...y) - 6, cols, heads, boxes, byId: new Map(boxes.map((b) => [b.id, b])) };
}

/** A conversation in words: never its name, which a view is not told. */
function convText(c: ViewConversation, a: ViewAgent, i: number): string {
	const what = c.main ? "Main conversation" : c.branchOf !== undefined ? `Branch of ${a.conversations.find((x) => x.id === c.branchOf)?.main ? "main" : "a conversation"}` : `Conversation ${i + 1}`;
	return [what, c.busy ? "active" : "", c.worktree ? "in a worktree" : "", c.goal ? `goal ${c.goal}` : "", c.outside ? "read outside content" : ""].filter(Boolean).join(" · ");
}

/**
 * What happens right now, as lines between boxes; and for a few seconds after a piece of work has ended, its
 * answer on the way back to whoever asked for it: to the agent that delegated it, or to you.
 */
export function linksOf(s: ViewState, l: Layout, now: number = s.at): Link[] {
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
		// It has a task of a board: a line to that board, for as long as it has it.
		if (w.board !== undefined) add({ from: me, to: `board:${w.board}`, color, live: true });
		if (w.doing === "tool" && w.skill) add({ from: me, to: `skill:${w.skill}`, color, live: true });
		else if (w.doing === "tool" && w.mcp) add({ from: me, to: `mcp:${w.mcp}`, color, live: true });
	}
	for (const w of s.work) {
		if (!ended(w) || w.copy || w.finished === undefined || now - w.finished > ANSWER_MS || now < w.finished) continue;
		const me = `agent:${w.agent}`;
		const color = w.doing === "failed" ? FAILED : colorOf(w.agent);
		const f = w.from;
		if (f.k === "agent" && f.id !== w.agent) add({ from: me, to: `agent:${f.id}`, color, live: true, side: true, back: true });
		else if (f.k === "you" && w.doing !== "cancelled") add({ from: me, to: "you", color, live: true });
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
		for (const x of boardsOf(s)) if (x.scope === "all" || x.agent === a.id) add(`board:${x.id}`, false);
	};
	if (b.agent) of(b.agent);
	else for (const a of s.agents) of(a);
	return b.agent ? out : out.filter((k) => k.from === id || k.to === id);
}

/** The box at a point of the board. */
export function hitAt(l: Layout, p: { x: number; y: number }): Box | undefined {
	return l.boxes.find((b) => p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h);
}

/** Where a board's tiles begin in its card: under its two lines of words and its bar. */
const TILES_AT = { x: 10, y: 54 };
/** The task whose tile is at a point of the board, in a board's card. */
export function tileAt(b: Box | undefined, p: { x: number; y: number } | undefined): ViewTask | undefined {
	if (!b?.board || !p || b.rows || !b.sub) return undefined;
	const { size, tiles } = tilesOf(b.board, b.w - 20);
	const x = p.x - b.x - TILES_AT.x;
	const y = p.y - b.y - TILES_AT.y;
	// (A tile's own square and the gap at its right and under it: the pointer need not be that exact.)
	return tiles.find((t) => x >= t.x - 1 && x < t.x + size + 1 && y >= t.y - 1 && y < t.y + size + 1)?.task;
}
/** The task whose row is at a point of the board, in a board's card from close by. */
export function rowAt(b: Box | undefined, p: { x: number; y: number } | undefined): ViewTask | undefined {
	if (!b?.rows || !p || p.y < b.y + ROWS_AT) return undefined;
	return b.rows[Math.floor((p.y - b.y - ROWS_AT) / ROW)]?.task;
}
/** The task at a point of a board's card, as a tile or as a row. */
export const taskAt = (b: Box | undefined, p: { x: number; y: number } | undefined): ViewTask | undefined => rowAt(b, p) ?? tileAt(b, p);
/** How a task stands, as somebody would say it. */
export function taskWords(t: ViewTask, b: ViewBoard): string {
	const next = tasksOf(b).filter((x) => x.after.includes(t.id)).map((x) => x.id);
	const state =
		t.state === "taken" ? `in progress${t.agent ? `, a sub-agent of ${t.agent} has it` : ""}` : t.state === "waiting" ? `waiting for task ${t.after.join(" and ")}` : t.state === "blocked" ? "waiting for an answer" : t.state === "open" ? "to do" : t.state;
	return `${state}${t.state !== "waiting" && t.after.length ? `, comes after task ${t.after.join(" and ")}` : ""}${next.length ? `, followed by task ${next.join(" and ")}` : ""}`;
}

/** What a box is, in a few pieces of a sentence: what the line on top says while the pointer is over it. `at` is where the pointer is on the board. */
export function tipOf(b: Box | undefined, s: ViewState, now: number, at?: { x: number; y: number }): string[] {
	if (!b) return [];
	const who = (list: ViewAgent[]) => list.map((a) => a.id);
	if (b.agent) {
		const a = b.agent;
		const br = a.conversations.filter((c) => c.branchOf !== undefined).length;
		const next = s.schedules.filter((x) => x.agent === a.id && x.next !== undefined && x.next > now).sort((p, q) => p.next! - q.next!)[0];
		// What it is wired to, the lines on the page show; here is what they do not.
		return [`${a.id}${a.main ? " (main agent)" : ""}`, `${a.mode} mode`, `${plural(a.conversations.length, "conversation")}${br ? `, ${plural(br, "branch", "branches")}` : ""}`, next ? `${next.name} in ${span(next.next! - now)}` : "", "click to expand, zoom in for more, double-click to open"].filter(Boolean);
	}
	if (b.kind === "you") return ["You", "your messages start an agent's work, and its questions wait here"];
	if (b.kind === "source" || b.kind === "outside") {
		const i = s.inputs.find((x) => x.id === b.id);
		const listen = s.agents.filter((a) => i?.agents.includes(a.id) || a.sources.includes(b.title));
		return [`${b.title}: ${b.kind === "source" ? `event source${i?.type ? ` (${i.type})` : ""}` : "webhook"}`, i?.failing ? "down" : "", listen.length ? `triggers ${who(listen).join(", ")}` : b.kind === "source" ? "no listeners" : "", i ? `${plural(i.count, "event")}${i.last !== undefined ? `, last ${span(now - i.last)} ago` : ""}` : ""].filter(Boolean);
	}
	if (b.kind === "sched") {
		const x = s.schedules.find((k) => `sched:${k.name}` === b.id);
		return [`${b.title}: schedule`, x?.agent ? `triggers ${x.agent}` : "triggers all agents", x?.when ?? "", x?.next !== undefined && x.next > now ? `next in ${span(x.next - now)}` : ""].filter(Boolean);
	}
	if (b.kind === "board") {
		const x = boardsOf(s).find((k) => `board:${k.id}` === b.id);
		if (!x) return [b.title];
		// Over one of its tiles: that task.
		const tile = taskAt(b, at);
		if (tile) return [`Task ${tile.id} on ${boardTitle(x)}`, taskWords(tile, x), "click to read it"];
		const whose = x.scope === "all" ? "board for all agents" : x.scope === "agent" ? `board of ${x.agent ?? "an agent"}` : `board of a conversation${x.agent ? ` of ${x.agent}` : ""}`;
		const waits = tasksOf(x).filter((t) => t.state === "waiting").length;
		const states = [x.taken ? `${x.taken} in progress` : "", x.open ? `${x.open} to do${waits ? ` (${waits} after other tasks)` : ""}` : "", x.blocked ? `${plural(x.blocked, "task")} waiting for an answer` : "", x.failed ? `${x.failed} failed` : "", x.done ? `${x.done} done` : ""].filter(Boolean);
		return [`${b.title}: ${whose}`, states.join(", ") || "no tasks", x.notes ? plural(x.notes, "note") : "", "click to read it, zoom in for every task"].filter(Boolean);
	}
	const has = s.agents.filter((a) => (b.kind === "mcp" ? a.mcp : a.skills).includes(b.title));
	const using = [...new Set(s.work.filter((w) => !ended(w) && w.doing === "tool" && (b.kind === "mcp" ? w.mcp : w.skill) === b.title).map((w) => w.agent))];
	return [`${b.title}: ${b.kind === "mcp" ? "MCP server" : "skill"}`, `available to ${who(has).join(", ")}`, using.length ? `in use by ${using.join(", ")}` : ""].filter(Boolean);
}
// ---- the camera ------------------------------------------------------------------------------------------------------------

/** The room around the board that the camera may show, and the line on top of the panel, under which the board lies. */
const MARGIN = 12;
const BAR = 32;
const Z_MAX = 1.4;
type Size = { w: number; h: number };

/** The board with the room around it: what the camera never leaves. */
export const wholeOf = (l: Layout): Rect => ({ x: -MARGIN, y: -MARGIN, w: l.w + 2 * MARGIN, h: l.h + 2 * MARGIN });
const roomOf = (view: Size): Size => ({ w: Math.max(1, view.w), h: Math.max(1, view.h - BAR) });

/** A point of the panel as a point of the board. */
export function toBoard(p: { x: number; y: number }, cam: Cam, view: Size): { x: number; y: number } {
	return { x: (p.x - view.w / 2) / cam.z + cam.x, y: (p.y - BAR - (view.h - BAR) / 2) / cam.z + cam.y };
}

/** A board shorter than the panel hangs from its top, like a page: it does not float in the middle. */
function hung(cam: Cam, l: Layout, view: Size): Cam {
	const room = roomOf(view);
	const whole = wholeOf(l);
	return room.h / cam.z >= whole.h ? { ...cam, y: whole.y + room.h / cam.z / 2 } : cam;
}

/**
 * Where the camera goes to show these boxes: the board as wide as the panel, and of its height the part they are
 * in; further out only when they do not fit. With none, the top of the board.
 */
export function focusOf(l: Layout, ids: Iterable<string>, view: Size): Cam {
	const boxes = [...ids].map((id) => l.byId.get(id)).filter((b): b is Box => b !== undefined);
	const top = boxes.length ? Math.min(...boxes.map((b) => b.y)) - TITLE : 0;
	const bottom = boxes.length ? Math.max(...boxes.map((b) => b.y + b.h)) : 1;
	return hung(frame({ x: -MARGIN / 2, y: top, w: l.w + MARGIN, h: bottom - top }, roomOf(view), wholeOf(l), { zMax: Z_MAX, min: { w: l.w + MARGIN, h: 1 }, step: 0.01, zMin: 0.2 }), l, view);
}

/** Where the camera goes to show the whole board. */
export function allOf(l: Layout, view: Size): Cam {
	return hung(frame(wholeOf(l), roomOf(view), wholeOf(l), { zMax: Z_MAX, min: { w: l.w, h: 1 }, step: 0.01, zMin: 0.1 }), l, view);
}

/** A camera somebody moved by hand, kept where some of the board is still to be seen. */
export function held(cam: Cam, l: Layout): Cam {
	const whole = wholeOf(l);
	return { x: Math.max(whole.x, Math.min(whole.x + whole.w, cam.x)), y: Math.max(whole.y, Math.min(whole.y + whole.h, cam.y)), z: Math.max(0.25, Math.min(3, cam.z)) };
}

// ---- drawing ---------------------------------------------------------------------------------------------------------------

type Ctx = CanvasRenderingContext2D;
/**
 * The colors of the Pine app, as far as a view can know them: it is told whether the app is dark, not its theme.
 * So the board has no ground of its own (the panel's shows through), and every surface and line is the text's
 * color, thinned: the way pine's own themes make theirs. Only what warns is a color of its own.
 */
interface Theme {
	text: string;
	muted: string;
	faint: string;
	/** A question for you, and what is down or failed. */
	warn: string;
	bad: string;
}
const DARK: Theme = { text: "#e4f0fb", muted: "#a6accd", faint: "#767c9d", warn: "#fffac2", bad: "#d0679d" };
const LIGHT: Theme = { text: "#1f2328", muted: "#59636e", faint: "#818b98", warn: "#9a6700", bad: "#cf222e" };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", system-ui, sans-serif';
/** A color, thinned: what lies under it shows through. */
const veil = (hex: string, alpha: number) => `rgba(${rgb(hex).join(", ")}, ${alpha})`;
/** White or a near-black, whichever reads better on a color: as the app writes an agent's initial on its avatar. */
function onColor(hex: string): string {
	const lum = (c: string) => {
		const [r, g, b] = rgb(c).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const l = lum(hex);
	return 1.05 / (l + 0.05) >= (l + 0.05) / (lum("#141414") + 0.05) ? "#ffffff" : "#141414";
}

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

/** A path of straight pieces with each corner cut off at 45 degrees, the way a trace turns on a board. */
function chamfer(pts: Array<[number, number]>, r: number): Array<[number, number]> {
	const out: Array<[number, number]> = [pts[0]];
	for (let i = 1; i < pts.length - 1; i++) {
		const [px, py] = pts[i];
		const [ax, ay] = pts[i - 1];
		const [bx, by] = pts[i + 1];
		const la = Math.hypot(ax - px, ay - py);
		const lb = Math.hypot(bx - px, by - py);
		const k = Math.min(r, la / 2, lb / 2);
		if (k < 0.5) out.push([px, py]);
		else out.push([px + ((ax - px) / la) * k, py + ((ay - py) / la) * k], [px + ((bx - px) / lb) * k, py + ((by - py) / lb) * k]);
	}
	out.push(pts[pts.length - 1]);
	return out;
}

/** Where `n` lines meet one side of a box: an agent's beside its name and down from there, anything else's around its middle. */
function pinsOf(b: Box, n: number): number[] {
	if (b.kind === "agent") {
		const pitch = n > 1 ? Math.min(8, (b.h - 30) / (n - 1)) : 0;
		return Array.from({ length: n }, (_, i) => b.y + 17 + i * pitch);
	}
	const pitch = n > 1 ? Math.min(7, (b.h - 14) / (n - 1)) : 0;
	return Array.from({ length: n }, (_, i) => b.y + b.h / 2 + (i - (n - 1) / 2) * pitch);
}

/**
 * The way of every line across the board, as a board's traces run. A line leaves a box at its side, runs
 * straight across, turns into a lane of its own between the columns, and turns once more into the box it goes
 * to; every turn is cut at 45 degrees. No two lines share a lane, and several at one side of a box meet it a
 * little apart. A task delegated from agent to agent runs in a lane close beside the agents at their left,
 * its answer at their right.
 */
export function routesOf(links: Link[], l: Layout): Array<Array<[number, number]> | undefined> {
	const mid = (b: Box) => b.y + Math.min(b.h / 2, 14);
	const info = links.map((k) => {
		const a = l.byId.get(k.from);
		const b = l.byId.get(k.to);
		return a && b ? { a, b, same: a.col === b.col, forward: a.col < b.col, back: Boolean(k.back) && a.col === b.col } : undefined;
	});
	// Where each line meets its two boxes: several on one side of a box are spread, in the order of where they come from.
	type End = { key: number; box: Box; other: number };
	const sides = new Map<string, End[]>();
	info.forEach((v, i) => {
		if (!v) return;
		const put = (key: number, box: Box, other: Box, side: string) => sides.set(`${box.id}|${side}`, [...(sides.get(`${box.id}|${side}`) ?? []), { key, box, other: mid(other) }]);
		put(i * 2, v.a, v.b, v.same ? (v.back ? "r" : "l") : v.forward ? "r" : "l");
		put(i * 2 + 1, v.b, v.a, v.same ? (v.back ? "r" : "l") : v.forward ? "l" : "r");
	});
	const yOf = new Map<number, number>();
	for (const list of sides.values()) {
		list.sort((p, q) => p.other - q.other || p.key - q.key);
		const ys = pinsOf(list[0].box, list.length);
		list.forEach((e, n) => yOf.set(e.key, ys[n]));
	}
	// A lane for each line. Those from agent to agent first, the shortest nearest the agents.
	const lane = new Map<number, number>();
	const reach = (i: number) => Math.abs(yOf.get(i * 2)! - yOf.get(i * 2 + 1)!);
	const beside = (back: boolean) => info.map((v, i) => (v?.same && v.back === back ? i : -1)).filter((i) => i >= 0).sort((p, q) => reach(p) - reach(q));
	const out = beside(false);
	const home = beside(true);
	out.forEach((i, n) => lane.set(i, l.cols[1].x - PIN - 6 - n * 6));
	home.forEach((i, n) => lane.set(i, l.cols[1].x + l.cols[1].w + PIN + 6 + n * 6));
	const keptLeft = out.length ? 6 + out.length * 6 : 0;
	const keptRight = home.length ? 6 + home.length * 6 : 0;
	for (const left of [true, false]) {
		const x0 = (left ? l.cols[0].x + l.cols[0].w : l.cols[1].x + l.cols[1].w) + PIN + (left ? 0 : keptRight);
		const x1 = (left ? l.cols[1].x : l.cols[2].x) - PIN - (left ? keptLeft : 0);
		const mine = info.map((v, i) => (v && !v.same && (Math.min(v.a.col, v.b.col) === 0) === left ? i : -1)).filter((i) => i >= 0);
		// The end of a line at the left of the gap, and at its right, whichever way the line goes.
		const yl = (i: number) => yOf.get(info[i]!.forward ? i * 2 : i * 2 + 1)!;
		const yr = (i: number) => yOf.get(info[i]!.forward ? i * 2 + 1 : i * 2)!;
		// Lines that go down, the lowest in the lane furthest left; then lines that go up, the highest furthest left: so they nest and do not cross.
		const down = mine.filter((i) => yr(i) >= yl(i)).sort((p, q) => yl(q) - yl(p));
		const up = mine.filter((i) => yr(i) < yl(i)).sort((p, q) => yl(p) - yl(q));
		const all = [...down, ...up];
		all.forEach((i, n) => lane.set(i, Math.round(x0 + 4 + ((x1 - x0 - 8) * (n + 1)) / (all.length + 1))));
	}
	return info.map((v, i) => {
		if (!v) return undefined;
		const ya = yOf.get(i * 2)!;
		const yb = yOf.get(i * 2 + 1)!;
		const right = (b: Box) => b.x + b.w + PIN;
		const xa = v.same ? (v.back ? right(v.a) : v.a.x - PIN) : v.forward ? right(v.a) : v.a.x - PIN;
		const xb = v.same ? (v.back ? right(v.b) : v.b.x - PIN) : v.forward ? v.b.x - PIN : right(v.b);
		if (!v.same && Math.abs(ya - yb) < 1) return [[xa, ya], [xb, yb]];
		const x = lane.get(i)!;
		return chamfer([[xa, ya], [x, ya], [x, yb], [xb, yb]], 5);
	});
}

export interface Shown {
	/** The box the pointer is over, and the one that was clicked. */
	hover?: string;
	selected?: string;
	recent: Recent;
	/** The task that is shown under the view, if one is: its board's number and its own. */
	task?: { board: number; task: number };
	/** Where the camera is, and the size of the panel. */
	cam: Cam;
	view: Size;
}

/** The whole board as the camera sees it, into a canvas whose units are the panel's own pixels. The canvas is left clear where nothing is drawn. */
export function draw(g: Ctx, s: ViewState, l: Layout, now: number, o: Shown): void {
	const th = s.dark ? DARK : LIGHT;
	const deep = (c: string) => (c === ASK ? th.warn : c === FAILED ? th.bad : s.dark ? c : mix(c, "#15171d", 0.25));
	const z = o.cam.z;
	// Where the board's corner is on the panel.
	const ox = o.view.w / 2 - o.cam.x * z;
	const oy = BAR + (o.view.h - BAR) / 2 - o.cam.y * z;
	g.globalAlpha = 1;
	g.clearRect(0, 0, o.view.w, o.view.h);
	g.save();
	// The line on top of the panel is not drawn under.
	g.beginPath();
	g.rect(0, BAR, o.view.w, o.view.h - BAR);
	g.clip();

	// The ground: a grid of faint dots, as far as the panel reaches.
	let grid = 16;
	while (grid * z < 12) grid *= 2;
	const step = grid * z;
	g.fillStyle = veil(th.text, s.dark ? 0.07 : 0.1);
	g.beginPath();
	for (let x = ((ox % step) + step) % step; x < o.view.w; x += step) for (let y = ((oy % step) + step) % step; y < o.view.h; y += step) g.rect(Math.round(x), Math.round(y), 1, 1);
	g.fill();

	g.translate(ox, oy);
	g.scale(z, z);
	g.textBaseline = "middle";
	g.lineCap = "round";
	g.lineJoin = "round";
	const seen = (b: { y: number; h: number }) => (b.y + b.h) * z + oy > BAR - 8 && b.y * z + oy < o.view.h + 8;

	const live = linksOf(s, l, now);
	const focus = o.hover ?? o.selected;
	const wires = wiringOf(focus, s, l).filter((k) => !live.some((x) => x.from === k.from && x.to === k.to));
	// What belongs with the box the pointer is over; everything else steps back.
	const near = new Set<string>();
	if (focus) {
		near.add(focus);
		for (const k of [...wires, ...live]) if (k.from === focus || k.to === focus) near.add(k.from), near.add(k.to);
	}
	const faded = (id: string) => focus !== undefined && !near.has(id);
	const lit = (k: Link) => !focus || k.from === focus || k.to === focus;

	// What each column is, and under it what each group in it is: as the app's side bar names its groups.
	g.textAlign = "left";
	g.globalAlpha = focus ? 0.5 : 1;
	g.font = `500 12px ${FONT}`;
	g.fillStyle = th.muted;
	for (const c of l.cols) g.fillText(c.title, c.x + 2, 9);
	g.font = `11px ${FONT}`;
	g.fillStyle = th.faint;
	for (const head of l.heads) if (seen({ y: head.y, h: 18 })) g.fillText(head.text, l.cols[head.col].x + 2, head.y + 10);

	// Every box is a card of the app: a surface a little lighter than the ground, a thin border, round corners.
	for (const b of l.boxes) {
		if (!seen(b)) continue;
		const mine = live.filter((k) => k.from === b.id || k.to === b.id);
		const hot = now - (o.recent.hot.get(b.id) ?? -1e9) < 1400;
		// An agent whose answer is still on its way back is part of what happens, though its work is over.
		const active = Boolean(b.busy) || mine.length > 0 || hot;
		// What warns: a source that is down in the color of what failed, a question for you in the color of a question.
		const alarm = b.bad ? (b.kind === "source" ? th.bad : th.warn) : undefined;
		const color = alarm ?? deep(b.agent?.color ?? mine[0]?.color ?? th.muted);
		const fade = faded(b.id) ? 0.3 : 1;
		const r = b.kind === "agent" ? 10 : 8;
		g.globalAlpha = fade;
		rounded(g, b.x, b.y, b.w, b.h, r);
		g.fillStyle = veil(th.text, s.dark ? 0.035 : 0.03);
		g.fill();
		if (active || alarm) {
			g.fillStyle = veil(color, hot ? 0.2 : s.dark ? 0.08 : 0.07);
			g.fill();
		}
		g.lineWidth = 1;
		g.strokeStyle = b.id === focus ? veil(th.text, 0.45) : active || alarm ? veil(color, 0.55) : veil(th.text, s.dark ? 0.1 : 0.14);
		rounded(g, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, r);
		g.stroke();

		g.textAlign = "left";
		if (b.agent) {
			// The agent's avatar, as the app draws it everywhere: its initial on its own color.
			const ax = b.x + 19;
			const ay = b.y + 18;
			g.fillStyle = b.agent.color;
			g.beginPath();
			g.arc(ax, ay, 9, 0, Math.PI * 2);
			g.fill();
			g.font = `600 10px ${FONT}`;
			g.textAlign = "center";
			g.fillStyle = onColor(b.agent.color);
			g.fillText(b.title.slice(0, 1).toUpperCase(), ax, ay + 0.5);
			// Its mode, as a small badge at the right; the one that asks nothing in the color of what warns.
			g.font = `500 10.5px ${FONT}`;
			const mode = b.right ?? "";
			const badge = mode ? widthOf(g, mode) + 12 : 0;
			if (mode) {
				const bx = b.x + b.w - 10 - badge;
				rounded(g, bx + 0.5, ay - 8.5, badge, 17, 8.5);
				g.strokeStyle = veil(th.text, s.dark ? 0.12 : 0.16);
				g.stroke();
				g.fillStyle = mode === "bypass" ? th.bad : mode === "asks you" ? th.warn : th.muted;
				g.fillText(mode, bx + badge / 2 + 0.5, ay + 0.5);
			}
			g.textAlign = "left";
			g.font = `600 13px ${FONT}`;
			g.fillStyle = active || alarm ? th.text : th.muted;
			const name = fit(g, b.title, b.w - 34 - 16 - badge - (b.busy ? 14 : 0));
			g.fillText(name, b.x + 34, ay + 0.5);
			if (b.busy) {
				// While it works, the app's own sign of something going on: a small dot that fades out and in, in steps.
				g.globalAlpha = fade * [1, 0.75, 0.5, 0.75][Math.floor(now / 300) % 4];
				g.fillStyle = alarm ?? th.muted;
				g.beginPath();
				g.arc(b.x + 34 + widthOf(g, name) + 9, ay + 0.5, 3, 0, Math.PI * 2);
				g.fill();
				g.globalAlpha = fade;
			}
		} else {
			g.font = `11px ${FONT}`;
			const rightW = b.right ? widthOf(g, b.right) + 10 : 0;
			if (b.right) {
				g.textAlign = "right";
				g.fillStyle = th.faint;
				g.fillText(b.right, b.x + b.w - 10, b.y + 15.5);
				g.textAlign = "left";
			}
			g.font = `500 12.5px ${FONT}`;
			g.fillStyle = active || alarm ? th.text : mix(th.text, th.muted, 0.6);
			g.fillText(fit(g, b.title, b.w - 20 - rightW), b.x + 10, b.y + 15.5);
			if (b.sub) {
				g.font = `11px ${FONT}`;
				g.fillStyle = alarm ?? th.faint;
				g.fillText(fit(g, b.sub, b.w - 20), b.x + 10, b.y + 31);
			}
			if (b.board) drawBoard(g, b, b.board, s, th, deep, now, fade, l.detail, o.task?.board === b.board.id ? o.task.task : undefined);
		}
		(b.lines ?? []).forEach((line, i) => {
			const ly = b.y + 43 + i * 18;
			const dx = (line.indent ?? 0) * 12;
			if (line.indent && !line.more) {
				// What stands under something: a small corner in front of it, as deep in as it is under.
				g.fillStyle = veil(th.text, 0.3);
				g.fillRect(b.x + 14 + dx - 10, ly - 8, 1, 8);
				g.fillRect(b.x + 14 + dx - 10, ly, 6, 1);
			}
			if (line.calls) {
				// Its last tool calls as small pills, the newest at the right: as many as there is room for. One that
				// failed is in the color of what failed, the one it is in now in the agent's own.
				g.font = `10.5px ${FONT}`;
				const room = b.w - 26 - dx;
				const pills: Array<{ c: ViewCall; text: string; w: number }> = [];
				let used = 0;
				for (const c of [...line.calls].reverse()) {
					const text = toolWord(c.tool, c.mcp);
					const w = widthOf(g, text) + 12;
					if (used + w > room) break;
					pills.unshift({ c, text, w });
					used += w + 4;
				}
				let px = b.x + 14 + dx;
				for (const { c, text, w } of pills) {
					const running = c.ms === undefined;
					const color = c.ok === false ? th.bad : running ? deep(b.agent?.color ?? th.muted) : th.faint;
					rounded(g, px + 0.5, ly - 7.5, w, 15, 7.5);
					g.strokeStyle = veil(color, running || c.ok === false ? 0.8 : 0.35);
					g.lineWidth = 1;
					g.stroke();
					g.fillStyle = c.ok === false ? th.bad : running ? th.text : th.muted;
					g.textAlign = "center";
					g.fillText(text, px + w / 2 + 0.5, ly + 0.5);
					g.textAlign = "left";
					px += w + 4;
				}
				return;
			}
			g.font = `${line.tone === "ask" ? "600 " : line.tone === "now" ? "500 " : ""}12.5px ${FONT}`;
			g.fillStyle = line.tone === "ask" ? th.warn : line.tone === "now" ? th.text : line.tone === "sub" ? th.muted : line.tone === "note" ? deep(b.agent?.color ?? th.muted) : th.faint;
			g.fillText(fit(g, line.text, b.w - 26 - dx), b.x + 14 + dx, ly);
		});
	}

	// The lines: thin where the pointer asks what a box is wired to, full where something happens.
	const stroke = (pts: Array<[number, number]>) => {
		g.beginPath();
		pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
		g.stroke();
	};
	routesOf(wires, l).forEach((pts, i) => {
		if (!pts) return;
		g.globalAlpha = 0.5;
		g.strokeStyle = deep(wires[i].color);
		g.lineWidth = 1;
		stroke(pts);
	});
	const ways = routesOf(live, l).map((pts, i) => ({ k: live[i], pts }));
	for (const { k, pts } of ways) {
		if (!pts) continue;
		g.globalAlpha = lit(k) ? 1 : 0.14;
		g.strokeStyle = g.fillStyle = deep(k.color);
		g.lineWidth = 1.5;
		stroke(pts);
		// Where it comes from, a dot; where it goes, an arrowhead that touches the box.
		const first = pts[0];
		const last = pts[pts.length - 1];
		const dir = last[0] >= pts[pts.length - 2][0] ? 1 : -1;
		g.beginPath();
		g.arc(first[0], first[1], 2.5, 0, Math.PI * 2);
		g.fill();
		g.beginPath();
		g.moveTo(last[0] + dir * PIN, last[1]);
		g.lineTo(last[0] - dir * 3.5, last[1] - 3.6);
		g.lineTo(last[0] - dir * 3.5, last[1] + 3.6);
		g.closePath();
		g.fill();
	}

	// One dot runs along each line of what happens, the way it goes: lighter than its line, so that it shows on it.
	for (const { k, pts } of ways) {
		if (!pts || !lit(k)) continue;
		const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
		const total = lens.reduce((n, v) => n + v, 0);
		if (total < 24) continue;
		let at = ((now / (900 + total * 6)) % 1) * total;
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
		g.fillStyle = mix(deep(k.color), s.dark ? "#ffffff" : "#000000", 0.45);
		g.beginPath();
		g.arc(p[0], p[1], 3, 0, Math.PI * 2);
		g.fill();
	}
	g.restore();
	g.globalAlpha = 1;
}

/**
 * A board's card under its two lines of words: a bar of how its tasks stand, and a tile for each task. A task
 * somebody works on is in that agent's color and breathes; one whose worker asked is in the color of a question.
 */
function drawBoard(g: Ctx, box: Box, b: ViewBoard, s: ViewState, th: Theme, deep: (c: string) => string, now: number, fade: number, detail: Detail = "mid", chosen?: number): void {
	const all = b.open + b.taken + b.done + b.failed + b.blocked;
	if (!all) return;
	const x0 = box.x + 10;
	const w = box.w - 20;
	const colorOf = (id?: string) => deep(s.agents.find((a) => a.id === (id ?? b.agent))?.color ?? th.muted);
	const pulse = 0.62 + 0.38 * Math.sin(now / 320);
	// The bar: done, in progress, asking, failed, and the rest still to do.
	const by = box.y + (detail === "far" ? 27 : 42);
	rounded(g, x0, by, w, 4, 2);
	g.fillStyle = veil(th.text, s.dark ? 0.1 : 0.12);
	g.fill();
	let at = x0;
	for (const [n, color, alpha] of [[b.done, th.text, 0.6], [b.taken, colorOf(), pulse], [b.blocked, th.warn, 1], [b.failed, th.bad, 1]] as Array<[number, string, number]>) {
		if (!n) continue;
		const part = Math.max(2, (w * n) / all);
		g.globalAlpha = fade * alpha;
		g.fillStyle = color;
		rounded(g, at, by, Math.min(part, x0 + w - at), 4, 2);
		g.fill();
		at += part;
	}
	g.globalAlpha = fade;
	if (detail === "far") return;
	/** A task's tile: an outline while nobody has it, filled once somebody has or had. */
	const tile = (t: ViewTask, tx: number, tyy: number, size: number, r: number) => {
		if (t.state === "open" || t.state === "waiting") {
			g.strokeStyle = veil(th.text, t.state === "open" ? (s.dark ? 0.5 : 0.55) : s.dark ? 0.2 : 0.25);
			g.lineWidth = 1;
			rounded(g, tx + 0.5, tyy + 0.5, size - 1, size - 1, r);
			g.stroke();
		} else {
			g.globalAlpha = fade * (t.state === "taken" ? pulse : t.state === "done" ? 0.6 : 1);
			g.fillStyle = t.state === "taken" ? colorOf(t.agent) : t.state === "blocked" ? th.warn : t.state === "failed" ? th.bad : th.text;
			rounded(g, tx, tyy, size, size, r);
			g.fill();
			g.globalAlpha = fade;
		}
		if (t.id === chosen) {
			// The task that is read under the view: a ring around its tile.
			g.strokeStyle = veil(th.text, 0.8);
			g.lineWidth = 1;
			rounded(g, tx - 1.5, tyy - 1.5, size + 3, size + 3, r + 1.5);
			g.stroke();
		}
	};
	if (box.rows) {
		// From close by: a row for each task. Its tile, its number, how it stands, and at the right what else there is.
		box.rows.forEach((row, i) => {
			const ry = box.y + ROWS_AT + i * ROW + ROW / 2;
			const dx = row.indent * 12;
			const t = row.task;
			let tx = x0 + dx;
			if (t?.id === chosen && t) {
				rounded(g, box.x + 4, ry - ROW / 2, box.w - 8, ROW, 4);
				g.fillStyle = veil(th.text, s.dark ? 0.08 : 0.07);
				g.fill();
			}
			if (row.indent) {
				g.fillStyle = veil(th.text, 0.3);
				g.fillRect(tx - 8, ry - 8, 1, 8);
				g.fillRect(tx - 8, ry, 5, 1);
			}
			if (t) {
				tile(t, tx, ry - 4, 8, 2);
				tx += 14;
				g.font = `500 11px ${FONT}`;
				g.fillStyle = th.muted;
				g.fillText(`${t.id}`, tx, ry + 0.5);
				tx += widthOf(g, `${t.id}`) + 7;
			}
			g.font = `10.5px ${FONT}`;
			const fw = row.flags ? Math.min(widthOf(g, row.flags), w * 0.4) + 8 : 0;
			if (row.flags) {
				g.textAlign = "right";
				g.fillStyle = th.faint;
				g.fillText(fit(g, row.flags, w * 0.4), x0 + w, ry + 0.5);
				g.textAlign = "left";
			}
			g.font = `11.5px ${FONT}`;
			g.fillStyle = !t ? th.faint : t.state === "taken" ? th.text : t.state === "blocked" ? th.warn : t.state === "failed" ? th.bad : t.state === "done" ? th.muted : th.faint;
			g.fillText(fit(g, row.text, x0 + w - tx - fw), tx, ry + 0.5);
		});
		return;
	}
	// The tiles.
	const { size, tiles, more } = tilesOf(b, w);
	const ty = box.y + TILES_AT.y;
	for (const { task: t, x, y } of tiles) tile(t, x0 + x, ty + y, size, size > 4 ? 2 : 1);
	if (more) {
		g.font = `10px ${FONT}`;
		g.fillStyle = th.faint;
		g.textAlign = "right";
		g.fillText(`+${more}`, x0 + w, box.y + box.h - 8);
		g.textAlign = "left";
	}
}

// ---- the view: the board in the panel ---------------------------------------------------------------------------------------

const STYLE = `
.overview { position: absolute; inset: 0; overflow: hidden; font: 12.5px ${FONT}; -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none; }
.overview canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.overview canvas.over { cursor: pointer; }
.overview canvas.drag { cursor: grabbing; }
.overview-bar { position: absolute; left: 0; right: 0; top: 0; height: ${BAR}px; box-sizing: border-box; padding: 0 6px 0 12px; display: flex; align-items: center; gap: 2px; }
.overview-sum { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--faint); }
.overview-sum b { color: var(--text); font-weight: 500; }
.overview-sum .ask { color: var(--warn); }
.overview-sum .bad { color: var(--bad); }
.overview-bar button { flex: none; width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 8px; background: transparent; color: var(--faint); cursor: pointer; }
.overview-bar button:hover { color: var(--text); background: var(--hover); }
.overview-bar button[aria-pressed="true"] { color: var(--text); background: var(--press); }
.overview-bar svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.overview-words { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
`;
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/></svg>';
const ALL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
/** How long a box stays in what the camera follows after the last thing happened at it: a short tool call does not make it sway. */
const LINGER_MS = 4000;

export default defineView((host: ViewHost) => {
	const root = host.root;
	const style = document.createElement("style");
	style.textContent = STYLE;
	const box = document.createElement("div");
	box.className = "overview";
	const canvas = document.createElement("canvas");
	canvas.setAttribute("aria-label", "All of pine on one page: triggers on the left, the agents and what each is doing in the middle, their boards and tools on the right");
	const bar = document.createElement("div");
	bar.className = "overview-bar";
	const sum = document.createElement("div");
	sum.className = "overview-sum";
	const button = (label: string, icon: string) => {
		const b = document.createElement("button");
		b.type = "button";
		b.title = label;
		b.setAttribute("aria-label", label);
		b.innerHTML = icon;
		return b;
	};
	const followButton = button("Follow activity: the camera moves to where something is happening. Drag, scroll or pinch to look around yourself", EYE);
	const allButton = button("Show everything", ALL);
	const words = document.createElement("ul");
	words.className = "overview-words";
	words.dataset.slot = "overview-words";
	bar.append(sum, followButton, allButton);
	box.append(canvas, bar, words);
	root.append(style, box);

	const open = new Set<string>();
	const recent = new Recent();
	let pointer: { x: number; y: number } | undefined;
	let layout: Layout | undefined;
	let touched = 0;
	let handled = 0;
	let timer = 0;
	let raf = 0;
	let slow = false;
	/** Where each box is drawn right now: it glides to where it belongs, it does not jump there. */
	const glide = new Map<string, number>();
	let before = 0;
	/** The camera; whether it follows what happens; and where it is on its way to after "Show everything". */
	let cam: Cam | undefined;
	let follow = true;
	let going: Cam | undefined;
	/** When something last happened at a box: what the camera keeps in view. */
	const linger = new Map<string, number>();
	let drag: { x: number; y: number; moved: boolean } | undefined;
	let dragged = false;
	/** How much the boxes say. The hand's zoom changes it; following what happens shows the middle one. */
	let detail: Detail = "mid";

	const size = () => ({ w: Math.max(1, root.clientWidth), h: Math.max(1, root.clientHeight) });
	const at = (e: MouseEvent) => {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	const boxAt = (p: { x: number; y: number }) => (layout && cam && p.y >= BAR ? hitAt(layout, toBoard(p, cam, size())) : undefined);
	/** Something was touched: the next frame comes now, not when the slow pace of a board at rest says. */
	const wake = () => {
		touched = Date.now();
		if (slow) {
			window.clearTimeout(timer);
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(tick);
		}
	};
	/** A hand is on the board: it is drawn at every frame for a moment, so that it moves with the hand. */
	const hand = () => {
		handled = Date.now();
		wake();
	};
	/**
	 * Another level of detail takes the place of the one that is shown. The boxes are other sizes then, so the
	 * camera is set anew: what was under `p` of the panel (the pointer, or its middle) is under it again, at about
	 * the size its words had.
	 */
	const relevel = (want: Detail, p?: { x: number; y: number }) => {
		if (want === detail) return;
		const was = layout;
		const from = cam;
		const z = (from?.z ?? 1) * (SCALE[detail] / SCALE[want]);
		detail = want;
		glide.clear();
		if (!was || !from) return;
		const view = size();
		const sp = p ?? { x: view.w / 2, y: BAR + (view.h - BAR) / 2 };
		const q = toBoard(sp, from, view);
		const mid = (b: Box) => Math.hypot(Math.max(b.x - q.x, 0, q.x - b.x - b.w), Math.max(b.y - q.y, 0, q.y - b.y - b.h));
		const old = [...was.boxes].sort((a, b) => mid(a) - mid(b))[0];
		layout = layoutOf(host.state(), open, Date.now(), recent, detail);
		const now = old && layout.byId.get(old.id);
		const part = (v: number) => Math.max(-0.5, Math.min(1.5, v));
		const to = old && now ? { x: now.x + part((q.x - old.x) / old.w) * now.w, y: now.y + part((q.y - old.y) / old.h) * now.h } : q;
		cam = held({ x: to.x - (sp.x - view.w / 2) / z, y: to.y - (sp.y - BAR - (view.h - BAR) / 2) / z, z }, layout);
	};
	const setFollow = (on: boolean) => {
		if (on) relevel("mid");
		follow = on;
		going = undefined;
		followButton.setAttribute("aria-pressed", String(on));
		hand();
	};
	setFollow(true);
	/** The owner moves the camera: it stops following, and stays where some of the board is to be seen. */
	const move = (next: Cam) => {
		if (!layout) return;
		setFollow(false);
		cam = held(next, layout);
	};

	canvas.addEventListener("pointerdown", (e) => {
		drag = { x: e.clientX, y: e.clientY, moved: false };
		canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener("pointermove", (e) => {
		pointer = at(e);
		if (drag && cam && (drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3)) {
			move({ ...cam, x: cam.x - (e.clientX - drag.x) / cam.z, y: cam.y - (e.clientY - drag.y) / cam.z });
			drag = { x: e.clientX, y: e.clientY, moved: true };
			canvas.classList.add("drag");
		}
		hand();
	});
	const drop = () => {
		dragged = Boolean(drag?.moved);
		drag = undefined;
		canvas.classList.remove("drag");
	};
	canvas.addEventListener("pointerup", drop);
	canvas.addEventListener("pointercancel", drop);
	canvas.addEventListener("pointerleave", () => {
		pointer = undefined;
		hand();
	});
	canvas.addEventListener("click", (e) => {
		if (dragged) return;
		const b = boxAt(at(e));
		hand();
		if (b?.agent) {
			// A click opens an agent's box and shows it below; a second click closes both.
			if (open.delete(b.agent.id)) host.select();
			else {
				open.add(b.agent.id);
				host.select({ agent: b.agent.id });
			}
		} else if (b?.board && cam) {
			// A click on a task shows what it says under the view, in the panel's own words; on the card, the whole board.
			const t = taskAt(b, toBoard(at(e), cam, size()));
			const sel = host.state().selected;
			const same = sel && "board" in sel && sel.board === b.board.id && sel.task === t?.id;
			host.select(same ? undefined : t ? { board: b.board.id, task: t.id } : { board: b.board.id });
		} else if (!b) host.select();
	});
	canvas.addEventListener("dblclick", (e) => {
		const b = boxAt(at(e));
		if (b?.agent) host.open({ agent: b.agent.id });
		else if (!b) setFollow(true);
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			if (!cam) return;
			if (e.ctrlKey || e.metaKey) {
				// A pinch, or the wheel with a key held: closer or further, around where the pointer is.
				const { w, h } = size();
				const p = at(e);
				const px = p.x - w / 2;
				const py = p.y - BAR - (h - BAR) / 2;
				const z = Math.max(0.25, Math.min(3, cam.z * Math.exp(-e.deltaY * 0.01)));
				move({ x: cam.x + px / cam.z - px / z, y: cam.y + py / cam.z - py / z, z });
				// Closer or further than a level is drawn for: the next one takes its place, around the pointer.
				if (cam) relevel(detailAt(cam.z * SCALE[detail], detail), p);
			} else move({ ...cam, x: cam.x + e.deltaX / cam.z, y: cam.y + e.deltaY / cam.z });
		},
		{ passive: false },
	);
	followButton.addEventListener("click", () => setFollow(!follow));
	allButton.addEventListener("click", () => {
		setFollow(false);
		if (layout) {
			// Everything: in the middle level if its words can still be read then, else from far.
			const s = host.state();
			const whole = allOf(layoutOf(s, open, Date.now(), recent, "mid"), size());
			relevel(detailAt(whole.z, "mid"), undefined);
			layout = layoutOf(s, open, Date.now(), recent, detail);
			going = allOf(layout, size());
		}
		hand();
	});

	const say = (s: ViewState) => {
		words.replaceChildren(
			...s.agents.map((a) => {
				const mine = s.work.filter((w) => w.agent === a.id && !ended(w));
				const li = document.createElement("li");
				li.dataset.agent = a.id;
				li.textContent = `${a.id}, ${a.mode} mode${a.main ? ", the main agent" : ""}: ${mine.length ? mine.map((w) => `${w.copy ? "sub-agent " : ""}${sentenceOf(w, s).toLowerCase()}${causeOf(w) ? `, ${causeOf(w)}` : ""}`).join("; ") : "idle"}. ${[a.sources.length ? `Triggered by ${a.sources.join(", ")}` : "", a.schedules.length ? `schedules: ${a.schedules.join(", ")}` : "", a.mcp.length ? `MCP servers: ${a.mcp.join(", ")}` : "", a.skills.length ? `skills: ${a.skills.join(", ")}` : "", `${plural(a.conversations.length, "conversation")}, ${plural(a.conversations.filter((c) => c.branchOf !== undefined).length, "branch", "branches")}`].filter(Boolean).join("; ")}`;
				return li;
			}),
			// The boards, as the page shows them: whose each is and how its tasks stand.
			...boardsOf(s).filter((b) => unsettled(b) > 0 || b.name).map((b) => {
				const li = document.createElement("li");
				li.dataset.board = String(b.id);
				li.textContent = `${boardTitle(b)}: ${boardLine(b).toLowerCase()}${b.taken ? `, ${b.taken} in progress` : ""}.`;
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
			const view = size();
			const dpr = Math.min(3, window.devicePixelRatio || 1);
			if (canvas.width !== Math.round(view.w * dpr) || canvas.height !== Math.round(view.h * dpr)) {
				canvas.width = Math.round(view.w * dpr);
				canvas.height = Math.round(view.h * dpr);
			}
			const th = s.dark ? DARK : LIGHT;
			for (const [k, v] of Object.entries({ "--text": th.text, "--faint": th.faint, "--warn": th.warn, "--bad": th.bad, "--hover": veil(th.text, 0.07), "--press": veil(th.text, 0.12) })) box.style.setProperty(k, v);
			// The frame is see-through only while it is dark where the app is dark: then the panel's own ground is the board's.
			root.ownerDocument.documentElement.style.colorScheme = s.dark ? "dark" : "light";
			for (const id of open) if (!s.agents.some((a) => a.id === id)) open.delete(id);
			layout = layoutOf(s, open, now, recent, detail);
			const live = linksOf(s, layout, now);
			const dt = before ? Math.min(100, now - before) : 0;
			before = now;

			// The camera. While it follows, it keeps in view every box that something happens at, and a while longer.
			for (const b of layout.boxes) if (b.busy || (b.bad && b.kind !== "source")) linger.set(b.id, now);
			for (const k of live) linger.set(k.from, now), linger.set(k.to, now);
			for (const [id, t] of linger) if (now - t > LINGER_MS || !layout.byId.has(id)) linger.delete(id);
			const target = follow ? focusOf(layout, linger.keys(), view) : going;
			let panning = false;
			if (!cam) cam = target ?? focusOf(layout, [], view);
			else if (target) {
				// Slower than a camera that is sent somewhere: it is to keep up, not to chase.
				cam = ease(cam, target, follow ? dt * 0.55 : dt);
				panning = cam.x !== target.x || cam.y !== target.y || cam.z !== target.z;
				if (!panning && !follow) going = undefined;
			}

			// When an agent starts or stops, boxes change places: each moves most of its way in a fifth of a second.
			let gliding = false;
			const seen = new Set<string>();
			const eased = (key: string, to: number) => {
				seen.add(key);
				const was = glide.get(key);
				const y = was === undefined || !dt || Math.abs(to - was) < 0.6 ? to : was + (to - was) * (1 - Math.exp(-dt / 90));
				if (y !== to) gliding = true;
				glide.set(key, y);
				return y;
			};
			for (const b of layout.boxes) b.y = eased(b.id, b.y);
			for (const head of layout.heads) head.y = eased(`head:${head.col}:${head.text}`, head.y);
			for (const key of glide.keys()) if (!seen.has(key)) glide.delete(key);

			const over = pointer && !drag?.moved ? boxAt(pointer) : undefined;
			canvas.classList.toggle("over", Boolean(over?.agent || over?.board));
			const picked = s.selected;
			const sel = picked ? ("board" in picked ? `board:${picked.board}` : `agent:${"agent" in picked ? picked.agent : (s.work.find((x) => x.id === picked.work)?.agent ?? "")}`) : undefined;
			const g = canvas.getContext("2d")!;
			g.setTransform(dpr, 0, 0, dpr, 0, 0);
			draw(g, s, layout, now, { hover: over?.id, selected: sel && layout.byId.has(sel) ? sel : undefined, task: picked && "board" in picked && picked.task !== undefined ? { board: picked.board, task: picked.task } : undefined, recent, cam, view });

			const running = s.work.filter((x) => !ended(x));
			const asks = running.filter((x) => x.asking).length + boardsOf(s).reduce((n, b) => n + b.blocked, 0);
			const next = s.schedules.find((x) => x.next !== undefined && x.next > now - 1000);
			const bad = s.inputs.filter((i) => i.failing).map((i) => i.name);
			const part = (cls: string, text: string) => Object.assign(document.createElement(cls === "b" ? "b" : "span"), { className: cls === "b" ? "" : cls, textContent: text });
			// The line on top: how things stand; and while the pointer is over a box, what that box is.
			const about = tipOf(over, s, now, pointer && cam ? toBoard(pointer, cam, size()) : undefined);
			sum.replaceChildren(
				...(about.length
					? [part("b", about[0]), ...about.slice(1).map((text) => `  ·  ${text}`)]
					: [
							part("b", running.length ? `${new Set(running.map((x) => x.agent)).size} of ${s.agents.length} agents working` : `All ${s.agents.length} agents idle`),
							asks ? part("ask", `  ·  ${plural(asks, "question")} for you`) : "",
							bad.length ? part("bad", `  ·  ${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} down`) : "",
							next ? `  ·  next: ${next.name} in ${span(next.next! - now)}` : "",
						].filter(Boolean)),
			);
			// Every frame while the camera or a box moves or a hand is on it, often while dots run, once a second at rest, seldom while the window is behind.
			const moving = running.length > 0 || [...recent.hot.values()].some((t) => now - t < 1500) || live.length > 0;
			wait = !s.focused ? 2000 : panning || gliding || drag || now - handled < 250 ? 0 : moving || now - touched < 1200 ? 40 : 1000;
		} catch (e) {
			window.clearTimeout(timer);
			throw e;
		}
		slow = wait > 50;
		timer = window.setTimeout(() => (raf = requestAnimationFrame(tick)), wait);
	};
	raf = requestAnimationFrame(tick);
	const watch = new ResizeObserver(() => wake());
	watch.observe(root);

	return () => {
		window.clearTimeout(timer);
		cancelAnimationFrame(raf);
		watch.disconnect();
		stopState();
		stopHearing();
	};
});
