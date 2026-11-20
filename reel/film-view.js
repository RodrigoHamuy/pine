// The film about the view: somebody opens Pine on a Mac, looks at the agents, opens the view and watches
// them work; then asks the slack agent for the day's tasks and watches it hand the work on, to dev (which
// starts copies to look for pull requests) and to plan (which asks the calendar), until the answer is back
// in the conversation. No words over the picture.
//
// The desk and the app's window are drawn by this file. The house in the view is not: it is pine's own
// view (examples/home/views/office.ts), run as the app runs it and told a made-up pine by this file.
// The view keeps what it shows from frame to frame (robots walk, letters fly), so the film is drawn in
// order: a frame at second t is made by playing the view from the start up to t.
//
//   node reel/render.mjs --film view            -> reel/pine-reel-view.mp4
//   node reel/render.mjs --film view --at 12,30 -> single frames

const W = 1920, H = 1080, FPS = 30;
let SPEED = 1;
const SFX = [], MARKS = [];
// The film opens with a robot by itself, before the story's clock starts: every time below is a second of the
// story, and the film is this much ahead of it.
const INTRO = 2.6;
const cue = (t, k) => SFX.push({ t: t + INTRO, k });
const mark = (t, name) => MARKS.push([t + INTRO, name]);

// ---- the times of the story, in seconds --------------------------------------------------------------------------------

const T_DOCK = 1.5; // the click on Pine in the dock
const T_WIN = 1.75; // the window comes up
const T_VIEW = 5.0; // the click on the view's button
const T_REST = 14.4; // the agents' own work is done
const T_PICK = 17.2; // the click on slack in the side bar
const T_FIELD = 18.3; // the click into the message field
const T_TYPE = 18.9; // typing begins
const ASK = "Summarize all my tasks for today";
const CPS = 15;
const T_SEND = T_TYPE + ASK.length / CPS + 0.45;
const T0 = T_SEND + 0.1; // slack's work begins
const T_DONE = T0 + 17.8; // slack's answer is ready
const T_ANSWER = T_DONE + 0.7; // it begins to arrive in the conversation
const T_LAPSE = T_ANSWER + 8; // the day is wound on: the agents in fast motion, the sun down, the night
const LAPSE = 8.6;
const END = T_LAPSE + LAPSE;
const DURATION = END + INTRO;

mark(-INTRO, "a robot, glad");
mark(0, "the desk");
mark(T_DOCK, "Pine is opened");
mark(T_VIEW, "the view is opened: the agents at work");
mark(T_PICK, "slack is picked and asked");
mark(T0, "slack hands the work on: dev and its copies, plan and the calendar");
mark(T_ANSWER, "the answer, in the conversation");
mark(T_LAPSE, "the day is wound on, into the night");

// ---- small things ---------------------------------------------------------------------------------------------------

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
const out = (t) => 1 - (1 - clamp(t)) ** 3;
const span = (t, a, b) => clamp((t - a) / (b - a));
/** A value along keys [time, ...values], eased from each to the next; `hold` is how long of each stretch nothing moves. */
function along(keys, t) {
	if (t <= keys[0][0]) return keys[0].slice(1);
	for (let i = 1; i < keys.length; i++) {
		if (t > keys[i][0]) continue;
		const k = ease(span(t, keys[i - 1][0], keys[i][0]));
		return keys[i].slice(1).map((v, n) => lerp(keys[i - 1][n + 1], v, k));
	}
	return keys[keys.length - 1].slice(1);
}
const svg = (d, more = "") => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${more}>${d}</svg>`;
const ICON = {
	side: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>'),
	panel: svg('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>'),
	globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
	radar: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="M12 12l6-6"/>'),
	plus: svg('<path d="M12 5v14M5 12h14"/>'),
	x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
	search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>'),
	down: svg('<path d="M6 9l6 6 6-6"/>'),
	star: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>'),
	events: svg('<path d="M3 12v0M7 8v8M11 4v16M15 9v6M19 6v12"/>'),
	gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'),
	up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>', 'stroke-width="2.4"'),
	stop: svg('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
	mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>'),
	chip: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>'),
	spark: svg('<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>'),
	shield: svg('<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>'),
	folder: svg('<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>'),
	turn: svg('<path d="M5 5v6a3 3 0 003 3h10M14 10l4 4-4 4"/>'),
	check: svg('<path d="M5 12l5 5 9-10"/>', 'stroke-width="2.6"'),
};

// ---- the made-up pine: who there is, and what each does when -------------------------------------------------------------

const conv = (id, more = {}) => ({ id, main: false, worktree: false, busy: false, outside: false, ...more });
const AGENTS = [
	{ id: "main", main: true, color: "#3b82f6", mode: "safe", about: "The main agent.", mcp: ["web", "browser"], skills: ["pine"], sources: [], schedules: ["morning"], conversations: [conv(1, { main: true }), conv(2)] },
	{ id: "dev", main: false, color: "#8b5cf6", mode: "auto", about: "Code and pull requests.", mcp: ["github", "web"], skills: ["review", "release", "tests"], sources: [], schedules: [], conversations: [conv(3, { main: true }), conv(4, { branchOf: 3, worktree: true }), conv(5, { branchOf: 3 })] },
	{ id: "plan", main: false, color: "#14a89a", mode: "safe", about: "The calendar and plans.", mcp: ["calendar"], skills: ["agenda", "minutes"], sources: [], schedules: ["standup", "week"], conversations: [conv(6, { main: true })] },
	{ id: "slack", main: false, color: "#e0527a", mode: "safe", about: "Reads the team's Slack.", mcp: ["web"], skills: ["digest"], sources: ["slack"], schedules: [], conversations: [conv(7, { main: true })] },
	{ id: "support", main: false, color: "#f59e0b", mode: "safe", about: "Answers the inbox.", mcp: ["web"], skills: ["replies", "refunds"], sources: ["inbox"], schedules: [], conversations: [conv(8, { main: true })] },
	{ id: "travel", main: false, color: "#22a06b", mode: "manual", about: "Trips and bookings.", mcp: ["maps", "web"], skills: ["fares"], sources: [], schedules: ["fares"], conversations: [conv(9, { main: true }), conv(10)] },
	{ id: "watch", main: false, color: "#ef6a4a", mode: "safe", about: "The cameras at home.", mcp: ["home_link"], skills: [], sources: ["camera"], schedules: ["lights", "night"], conversations: [conv(11, { main: true })] },
];
const INPUTS = [
	{ id: "you", kind: "you", name: "you", count: 4, agents: [], failing: false },
	{ id: "clock", kind: "clock", name: "clock", count: 9, agents: [], failing: false },
	{ id: "source:camera", kind: "source", name: "camera", type: "onvif", count: 6, agents: ["watch"], failing: false },
	{ id: "source:inbox", kind: "source", name: "inbox", type: "mail", count: 31, agents: ["support"], failing: false },
	{ id: "source:slack", kind: "source", name: "slack", type: "slack", count: 58, agents: ["slack"], failing: false },
];
/** The clock the film is set at: a summer morning. */
const EPOCH = new Date(2026, 5, 18, 9, 41, 0).getTime();
let NOW = 0;
const ms = (t) => EPOCH + t * 1000;

/** A piece of work of the story: who, from second to second, and what it does from when on. */
const job = (id, agent, from, to, more, steps = []) => ({ id, agent, from, to, more, steps });
const JOBS = [
	// Before anybody asks: the agents' own work, woken by the clock and by what comes in.
	job(11, "dev", -9, T_REST - 0.6, { from: { k: "you" }, conversation: 4, branch: true, worktree: true, tools: 6, steps: { done: 3, total: 6 } }, [[-9, { doing: "tool", tool: "bash" }], [7.2, { doing: "tool", tool: "edit", steps: { done: 4, total: 6 } }], [9.4, { doing: "tool", tool: "bash", steps: { done: 5, total: 6 } }], [11.6, { doing: "writing", steps: { done: 6, total: 6 } }]]),
	job(12, "travel", -6, 12.2, { from: { k: "clock", name: "fares" }, tools: 3, steps: { done: 2, total: 4 } }, [[-6, { doing: "tool", tool: "mcp__maps__search_routes", mcp: "maps" }], [8, { doing: "tool", tool: "read", steps: { done: 3, total: 4 } }], [10.2, { doing: "writing", steps: { done: 4, total: 4 } }]]),
	job(13, "main", -3, 11.2, { from: { k: "clock", name: "morning" }, tools: 2 }, [[-3, { doing: "thinking" }], [6.6, { doing: "tool", tool: "read" }], [8.6, { doing: "tool", tool: "todo" }], [9.6, { doing: "writing" }]]),
	job(14, "support", 6.4, 13.2, { from: { k: "source", name: "inbox" }, outside: true }, [[8.6, { doing: "tool", tool: "read", skill: "replies", tools: 1 }], [10.2, { doing: "tool", tool: "edit", tools: 2 }], [11.4, { doing: "writing" }]]),
	job(15, "watch", 7.8, T_REST, { from: { k: "clock", name: "lights" } }, [[9.9, { doing: "tool", tool: "mcp__home_link__set_scene", mcp: "home_link", tools: 1 }], [12, { doing: "writing" }]]),
	// What is asked: slack hands on to dev and to plan, and waits for both.
	job(21, "slack", T0, T_DONE, { from: { k: "you" }, conversation: 7 }, [[T0 + 2.6, { doing: "waiting", waitingOn: [22], tools: 1 }], [T0 + 4.4, { doing: "waiting", waitingOn: [22, 23], tools: 2 }], [T0 + 12.4, { doing: "waiting", waitingOn: [22] }], [T0 + 13.4, { doing: "thinking", waitingOn: [] }], [T0 + 14.3, { doing: "writing", steps: { done: 1, total: 3 } }], [T0 + 15.5, { doing: "writing", steps: { done: 2, total: 3 } }], [T0 + 16.7, { doing: "writing", steps: { done: 3, total: 3 } }]]),
	job(22, "dev", T0 + 2.6, T0 + 13.4, { from: { k: "agent", id: "slack" }, parent: 21, depth: 1, mode: "safe", held: true }, [[T0 + 4.9, { doing: "tool", tool: "bash", tools: 1 }], [T0 + 6.2, { doing: "waiting", waitingOn: [24, 25, 26], tools: 2 }], [T0 + 11.5, { doing: "thinking", waitingOn: [] }], [T0 + 12.1, { doing: "writing" }]]),
	job(23, "plan", T0 + 4.4, T0 + 12.4, { from: { k: "agent", id: "slack" }, parent: 21, depth: 1 }, [[T0 + 8.1, { doing: "tool", tool: "mcp__calendar__list_events", mcp: "calendar", tools: 1 }], [T0 + 9.9, { doing: "tool", tool: "read", skill: "agenda", tools: 2 }], [T0 + 11.3, { doing: "writing" }]]),
	job(24, "dev", T0 + 6.2, T0 + 10.4, { copy: true, from: { k: "copy", id: "dev" }, parent: 22, depth: 2 }, [[T0 + 7, { doing: "tool", tool: "mcp__github__list_pull_requests", mcp: "github" }], [T0 + 9.4, { doing: "writing" }]]),
	job(25, "dev", T0 + 6.2, T0 + 10.9, { copy: true, from: { k: "copy", id: "dev" }, parent: 22, depth: 2 }, [[T0 + 7.3, { doing: "tool", tool: "grep" }], [T0 + 9.2, { doing: "tool", tool: "read" }], [T0 + 10.1, { doing: "writing" }]]),
	job(26, "dev", T0 + 6.2, T0 + 11.4, { copy: true, from: { k: "copy", id: "dev" }, parent: 22, depth: 2 }, [[T0 + 7.6, { doing: "tool", tool: "mcp__github__list_checks", mcp: "github" }], [T0 + 10.4, { doing: "writing" }]]),
];
// The day that is wound on at the end. The view's own clock runs nine times as fast, so that the robots hurry;
// the sky's runs through the day and into the night. These are seconds of the view's clock after it begins.
const S = T_LAPSE;
JOBS.push(
	job(31, "support", S + 2, S + 9, { from: { k: "source", name: "inbox" }, outside: true }, [[S + 4, { doing: "tool", tool: "read", skill: "replies" }], [S + 6, { doing: "tool", tool: "edit" }], [S + 7.5, { doing: "writing" }]]),
	job(32, "main", S + 4, S + 17, { from: { k: "clock", name: "morning" } }, [[S + 6, { doing: "tool", tool: "read" }], [S + 8, { doing: "waiting", waitingOn: [33] }], [S + 15, { doing: "writing" }]]),
	job(33, "dev", S + 8, S + 15, { from: { k: "agent", id: "main" }, parent: 32, depth: 1 }, [[S + 10, { doing: "tool", tool: "bash" }], [S + 11, { doing: "waiting", waitingOn: [34, 35] }], [S + 14, { doing: "writing" }]]),
	job(34, "dev", S + 11, S + 13.5, { copy: true, from: { k: "copy", id: "dev" }, parent: 33, depth: 2 }, [[S + 11.5, { doing: "tool", tool: "grep" }]]),
	job(35, "dev", S + 11, S + 14, { copy: true, from: { k: "copy", id: "dev" }, parent: 33, depth: 2 }, [[S + 11.8, { doing: "tool", tool: "read" }]]),
	job(36, "travel", S + 7, S + 14, { from: { k: "clock", name: "fares" } }, [[S + 9, { doing: "tool", tool: "mcp__maps__search_routes", mcp: "maps" }], [S + 12, { doing: "writing" }]]),
	job(37, "plan", S + 13, S + 21, { from: { k: "clock", name: "standup" } }, [[S + 15, { doing: "tool", tool: "mcp__calendar__list_events", mcp: "calendar" }], [S + 17.5, { doing: "tool", tool: "send" }], [S + 19, { doing: "writing" }]]),
	job(38, "slack", S + 18, S + 30, { from: { k: "source", name: "slack" }, outside: true }, [[S + 20, { doing: "tool", tool: "read" }], [S + 21, { doing: "waiting", waitingOn: [41] }], [S + 28, { doing: "writing" }]]),
	job(41, "dev", S + 21, S + 28, { from: { k: "agent", id: "slack" }, parent: 38, depth: 1 }, [[S + 23, { doing: "tool", tool: "bash" }], [S + 25, { doing: "tool", tool: "edit" }], [S + 26.5, { doing: "writing" }]]),
	job(39, "watch", S + 22, S + 29, { from: { k: "source", name: "camera" } }, [[S + 24, { doing: "tool", tool: "mcp__home_link__set_scene", mcp: "home_link" }], [S + 27, { doing: "writing" }]]),
	job(40, "support", S + 24, S + 32, { from: { k: "source", name: "inbox" }, outside: true }, [[S + 26, { doing: "tool", tool: "read", skill: "refunds" }], [S + 28, { doing: "tool", tool: "write" }], [S + 30, { doing: "writing" }]]),
	job(42, "main", S + 29, S + 37, { from: { k: "clock", name: "morning" } }, [[S + 31, { doing: "tool", tool: "todo" }], [S + 33, { doing: "writing" }]]),
	// In the night only the one that watches the cameras is woken.
	job(43, "watch", S + 55, S + 65, { from: { k: "source", name: "camera" } }, [[S + 57.5, { doing: "tool", tool: "mcp__home_link__set_scene", mcp: "home_link" }], [S + 61, { doing: "writing" }]]),
);
/** The view's own clock at a second of the film: the film's, until the day is wound on; then nine times as fast, after a second to get going. */
function simOf(t) {
	if (t <= T_LAPSE) return t;
	const d = t - T_LAPSE;
	const u = Math.min(1, d / 1.2);
	return T_LAPSE + d + 8 * (1.2 * (u ** 3 - u ** 4 / 2) + Math.max(0, d - 1.2));
}
/** How much later the sky's hour is than the view's clock, in hours: the day in four seconds, the sun down, and three seconds into the night. */
const SKY_KEYS = [[0, 0], [0.47, 10.3], [0.62, 11.6], [1, 16.8]];
function skyOf(t) {
	let p = clamp((t - T_LAPSE) / LAPSE);
	// It gets going over the first second.
	p = (p < 0.08 ? (p * p) / 0.16 : p - 0.04) / 0.96;
	for (let i = 1; i < SKY_KEYS.length; i++) if (p <= SKY_KEYS[i][0]) return lerp(SKY_KEYS[i - 1][1], SKY_KEYS[i][1], span(p, SKY_KEYS[i - 1][0], SKY_KEYS[i][0]));
	return SKY_KEYS[SKY_KEYS.length - 1][1];
}

/** What just happened, as the panel says it to a view, at its second. */
const HAPPENS = [
	[6.4, { k: "event", input: "source:inbox" }],
	[7.8, { k: "scheduled", name: "lights", agent: "watch" }],
	[7.8, { k: "event", input: "clock" }],
	[8.6, { k: "skill", work: 14, agent: "support", skill: "replies" }],
	[9.9, { k: "tool", work: 15, agent: "watch", tool: "mcp__home_link__set_scene", mcp: "home_link" }],
	[T0 + 8.1, { k: "tool", work: 23, agent: "plan", tool: "mcp__calendar__list_events", mcp: "calendar" }],
	[T0 + 7, { k: "tool", work: 24, agent: "dev", tool: "mcp__github__list_pull_requests", mcp: "github" }],
	[T0 + 9.9, { k: "skill", work: 23, agent: "plan", skill: "agenda" }],
	[S + 2, { k: "event", input: "source:inbox" }],
	[S + 4, { k: "skill", work: 31, agent: "support", skill: "replies" }],
	[S + 7, { k: "scheduled", name: "fares", agent: "travel" }],
	[S + 13, { k: "scheduled", name: "standup", agent: "plan" }],
	[S + 17.5, { k: "sent", work: 37, agent: "plan", tool: "send" }],
	[S + 18, { k: "event", input: "source:slack" }],
	[S + 22, { k: "event", input: "source:camera" }],
	[S + 24, { k: "event", input: "source:inbox" }],
	[S + 55, { k: "event", input: "source:camera" }],
];
/** What the panel writes under the view, newest first. */
const FEED = [
	[-9, "you asked dev: Make the webhook retry"],
	[-6, "the schedule fares woke travel"],
	[-3, "the schedule morning woke main"],
	[6.4, "inbox woke support"],
	[7.8, "the schedule lights woke watch"],
	[11.2, "main is done: The morning's notes"],
	[12.2, "travel is done: Fares to Lisbon"],
	[13.2, "support is done: A reply about an order"],
	[T_REST, "watch is done: The lights at home"],
	[T0, `you asked slack: ${ASK}`],
	[T0 + 2.6, "slack handed dev a task: Open pull requests and what waits for me"],
	[T0 + 4.4, "slack handed plan a task: Today's meetings from the calendar"],
	[T0 + 6.2, "dev started 3 copies"],
	[T0 + 12.4, "plan answered slack"],
	[T0 + 13.4, "dev answered slack"],
	[T_DONE, `slack is done: ${ASK}`],
];

/** pine at a second of the film, as a view is told it. */
function stateAt(t) {
	const work = [];
	for (const j of JOBS) {
		if (t < j.from) continue;
		const w = { id: j.id, agent: j.agent, copy: false, depth: 0, from: { k: "you" }, doing: "thinking", waitingOn: [], started: ms(j.from), tools: 0, asking: false, held: false, outside: false, branch: false, worktree: false, ...j.more };
		for (const [at, patch] of j.steps) if (t >= at) Object.assign(w, patch);
		if (t >= j.to) Object.assign(w, { doing: "done", finished: ms(j.to), waitingOn: [] });
		// A tool is named only while it runs, an MCP server only for a tool of its own.
		if (w.doing !== "tool") w.tool = w.skill = undefined;
		if (!w.tool?.startsWith("mcp__")) w.mcp = undefined;
		if (w.tool !== "read") w.skill = undefined;
		work.push(w);
	}
	const busy = new Set(work.filter((w) => w.doing !== "done" && w.conversation).map((w) => w.conversation));
	const agents = AGENTS.map((a) => ({ ...a, conversations: a.conversations.map((c) => ({ ...c, busy: busy.has(c.id) })) }));
	const schedules = [
		{ name: "standup", agent: "plan", when: "0 10 * * 1-5", next: ms(0) + 19 * 60_000 },
		{ name: "lights", agent: "watch", when: "every 30m", next: t < 7.8 ? ms(7.8) : ms(7.8) + 30 * 60_000, ...(t >= 7.8 ? { last: ms(7.8) } : {}) },
		{ name: "fares", agent: "travel", when: "every 2h", next: ms(0) + 114 * 60_000 },
	].sort((a, b) => a.next - b.next).map((x) => (t > T_LAPSE ? { name: x.name, agent: x.agent, when: x.when } : x));
	return { at: ms(t), agents, work, inputs: INPUTS, schedules, dark: true, focused: true };
}

// ---- the desk and the window: where everything lies --------------------------------------------------------------------

const WIN = { x: 150, y: 44, w: 1620, h: 940 };
// The robot of the opening: the size of its picture in its own pixels, and where its feet stand in it.
const BOT = { w: 76, h: 70, x: 36, y: 60 };
// The view's panel is drawn wide, as somebody who likes to watch it would drag it.
const TOP = 46, SIDE = 248, PAD = 8, VIEW_W = 820;
const VIEW_X = WIN.w - PAD - VIEW_W;
// What is said in a conversation stands in a column of this width.
const COLUMN = VIEW_X - PAD - SIDE - 58;
const CARD_H = WIN.h - TOP - PAD;
const ROWS_Y = TOP + 92;
const rowOf = (i) => ROWS_Y + i * 68;
const DOCK_APPS = [
	["linear-gradient(160deg,#6cc7ff,#2f7ef0)", '<circle cx="12" cy="12" r="6" fill="#fff"/>'],
	["linear-gradient(160deg,#ffd76a,#f59b23)", '<rect x="6" y="6" width="12" height="12" rx="2" fill="#fff"/>'],
	["linear-gradient(160deg,#9af0b0,#2fae6a)", '<path d="M6 16l4-6 3 4 2-3 3 5z" fill="#fff"/>'],
	["pine"],
	["linear-gradient(160deg,#ffa9c6,#e84f8a)", '<path d="M6 8h12M6 12h12M6 16h7" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'],
	["linear-gradient(160deg,#c9b6ff,#7c5cf0)", '<path d="M8 6l9 6-9 6z" fill="#fff"/>'],
	["linear-gradient(160deg,#e8edf2,#a9b4c2)", '<circle cx="12" cy="12" r="4" fill="none" stroke="#fff" stroke-width="2.6"/>'],
];
const DOCK_W = DOCK_APPS.length * 64 + 18 - 8;
const DOCK_X = (W - DOCK_W) / 2;
const PINE_AT = { x: DOCK_X + 9 + 3 * 64 + 28, y: H - 10 - 74 + 8 + 28 };

const ANSWER = [
	'<p class="lead">Here is your day, from <b>dev</b>, <b>plan</b> and the team\'s Slack:</p>',
	"<h4>Code</h4>",
	"<p><b>#412 Retry webhooks</b> waits for your review</p>",
	"<p><b>#407</b> has two failing checks: both in <code>billing.test.ts</code></p>",
	"<p>Three pull requests are approved and ready to merge</p>",
	"<h4>Calendar</h4>",
	"<p><b>10:00</b> Standup · <b>14:00</b> Design review · <b>16:30</b> 1:1 with Sam</p>",
	"<p>Nothing is booked between 11 and 14: the review fits there</p>",
	"<h4>Slack</h4>",
	"<p>Four threads mention you; Mira needs an answer on the release before 15:00</p>",
];
const wordsIn = (html) => html.replace(/<[^>]+>/g, " ").trim().split(/\s+/).length;
const wordsOf = (pieces) => pieces.reduce((n, p) => n + wordsIn(p), 0);

/** What the main agent's conversation holds when the window comes up: an agent made, a source, a schedule. */
const MAIN_SAID = [
	["me", "Create an agent called dev for our code. It works in ~/dev/shop and may run commands there."],
	["work", "<code>create_agent</code> dev · you allowed it"],
	["answer", '<p class="lead"><b>dev</b> is there. It works in <code>~/dev/shop</code> in <b>auto</b> mode, so its shell runs commands with your account, and it has the GitHub server. Ask it in its own conversation, or I hand it work.</p>'],
	["me", "Let slack listen to the team's Slack, and wake it for anything that mentions me."],
	["work", "<code>add_source</code> slack · you confirmed it"],
	["answer", '<p class="lead">The source <b>slack</b> is running and the slack agent is subscribed. What people write there reaches it as an event; it tells you what matters and keeps the rest.</p>'],
	["me", "Have plan put the agenda into Slack before every standup."],
	["work", "<code>add_schedule</code> standup · weekdays at 10:00 · plan"],
	["answer", '<p class="lead">Done: <b>standup</b> wakes plan on weekdays at 10:00. It reads the calendar and sends the agenda through slack.</p>'],
	["event", "#8b6cf0", "morning · a schedule", "It is time for your schedule: look at what the night brought, and write the notes for today."],
];
const MAIN_NOTES = ['<p class="lead">The notes for today are in <code>notes/today.md</code>: three pull requests moved, two invoices came in, and nothing from the night needs you.</p>'];
/** What slack's conversation holds: what was written in the team's Slack, and what slack made of it. */
const SLACK_SAID = [
	["event", "#e0527a", "slack · #releases", "Mira: can someone confirm the release notes before 15:00?"],
	["answer", '<p class="lead"><b>Mira</b> asks in #releases for the release notes to be confirmed before 15:00. That one is yours; I noted it for today.</p>'],
	["event", "#e0527a", "slack · #dev", "Jonas: CI on #407 is red again, the billing tests"],
	["answer", '<p class="lead"><b>#407</b> fails in the billing tests. Nothing for you yet: dev sees it in its checks.</p>'],
	["event", "#e0527a", "slack · a message to you", "Sam: moving our 1:1 to 16:30, ok?"],
	["answer", '<p class="lead">Sam moved your 1:1 to <b>16:30</b>. plan has put it into the calendar.</p>'],
];
/**
 * An answer of which the first `words` words have arrived. All of it is laid out from the start, the words
 * to come unseen: so the answer has its height at once, and the conversation does not jump line by line.
 */
function streamed(pieces, words) {
	let left = words;
	return pieces.map((piece) => {
		const n = wordsIn(piece);
		const mine = left;
		left -= n;
		if (mine >= n) return piece;
		if (mine <= 0) return piece.replace(/^<(\w+)/, '<$1 style="opacity:0"');
		let seen = 0;
		return piece.split(/(<[^>]+>)/).map((part) => (part.startsWith("<") ? part : part.split(/(\s+)/).map((w) => (!w.trim() || seen++ < mine ? w : `<span style="opacity:0">${w}</span>`)).join(""))).join("");
	}).join("");
}

function build() {
	const cam = document.getElementById("cam");
	const side = AGENTS.map((a, i) => `
		<div class="row" style="top:${rowOf(i)}px"><i class="chev">${ICON.down}</i><i class="av" style="background:${a.color}">${a.id[0].toUpperCase()}</i><b class="name">${a.id}</b><span class="desc" style="left:${60 + a.id.length * 8.2 + 10}px;right:30px">${a.about}</span><i class="plus">${ICON.plus}</i></div>
		<div class="row" id="conv-${a.id}" style="top:${rowOf(i) + 34}px"><i class="star">${ICON.star}</i><i class="live" style="display:none"></i><span class="sub">main conversation</span></div>`).join("");
	const dock = DOCK_APPS.map(([bg, glyph], i) => bg === "pine"
		? `<div class="app" id="pine-app" style="left:${9 + i * 64}px;background:#fff url(../desktop/assets/icon.png) center/cover"></div><i class="dot" id="pine-dot" style="left:${9 + i * 64 + 26}px;opacity:0"></i>`
		: `<div class="app" style="left:${9 + i * 64}px;background:${bg}"><i><svg viewBox="0 0 24 24" width="30" height="30">${glyph}</svg></i></div>${i < 2 ? `<i class="dot" style="left:${9 + i * 64 + 26}px"></i>` : ""}`).join("");
	cam.innerHTML = `
	<div id="wall"><div class="hill" style="bottom:-330px;height:620px;background:linear-gradient(#cfe9dd,#b5dcc9);opacity:.75"></div><div class="hill" style="bottom:-420px;left:28%;width:110%;height:640px;background:linear-gradient(#e2efe0,#cfe6d2);opacity:.8"></div></div>
	<canvas id="bot" width="${BOT.w}" height="${BOT.h}"></canvas>
	<div id="menubar"><b style="left:20px;font-weight:800;font-size:16px">◖</b><b id="mb-app" style="left:52px;font-weight:700">Finder</b><b id="mb-menus" style="left:118px">File    Edit    View    Go    Window    Help</b><b style="right:22px;position:absolute">Thu 18 Jun   9:41</b></div>
	<div id="dock" style="width:${DOCK_W}px">${dock}</div>
	<div id="win" style="left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px">
		<div class="lights"><i style="left:18px;background:#ff5f57"></i><i style="left:38px;background:#febc2e"></i><i style="left:58px;background:#28c840"></i></div>
		<i class="icon" style="left:${SIDE - 36}px;top:9px">${ICON.side}</i>
		<div class="tab on" id="tab-main" style="left:${SIDE + 4}px"><u></u>main   <span style="position:static;color:var(--faint)">×</span></div>
		<div class="tab" id="tab-slack" style="left:${SIDE + 96}px"><u></u>slack   <span style="position:static;color:var(--faint)">×</span></div>
		<i class="icon" id="tab-plus" style="left:${SIDE + 96}px;top:9px">${ICON.plus}</i>
		<i class="icon" style="left:${WIN.w - 118}px;top:9px">${ICON.panel}</i>
		<i class="icon" style="left:${WIN.w - 82}px;top:9px">${ICON.globe}</i>
		<i class="icon" id="view-button" style="left:${WIN.w - 46}px;top:9px">${ICON.radar}</i>
		<div class="row" style="top:${TOP + 6}px;color:var(--muted)"><i class="chev" style="left:10px;top:8px"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg></i><span style="left:36px">Search</span><span class="kbd" style="right:8px;top:7px">⌘K</span></div>
		<div class="row" style="top:${TOP + 56}px;color:var(--faint);font-size:12.5px"><span style="left:8px">Agents</span><i class="plus">${ICON.plus}</i></div>
		${side}
		<div class="row" style="top:${WIN.h - 108}px;color:var(--muted)"><i class="chev" style="left:10px;top:8px;width:16px">${ICON.events}</i><span style="left:36px">Events</span></div>
		<div class="row" style="top:${WIN.h - 74}px;color:var(--muted)"><i class="chev" style="left:10px;top:8px;width:16px">${ICON.gear}</i><span style="left:36px">Settings</span><span class="kbd" style="right:8px;top:7px">⌘,</span></div>
		<div class="row" style="top:${WIN.h - 40}px;color:var(--faint);font-size:12.5px"><i class="live" style="left:14px"></i><span style="left:36px">pine 0.49.0 · started here</span></div>
		<div class="card" id="conv" style="left:${SIDE}px;top:${TOP}px;height:${CARD_H}px">
			<div class="head"><span id="conv-title" style="left:16px;top:0;font-weight:600">main conversation</span><span id="conv-meter" style="right:16px;top:0;color:var(--faint);font-size:12.5px"></span></div>
			<div id="chat" style="width:${COLUMN}px;top:40px;bottom:150px"></div>
			<div id="status" class="work" style="bottom:136px"></div>
			<div class="composer" id="composer" style="bottom:20px;height:104px">
				<span class="text" id="typed"></span><i class="caret" id="caret" style="top:13px"></i>
				<i class="icon" style="left:10px;bottom:10px">${ICON.plus}</i><i class="icon" style="left:44px;bottom:10px">${ICON.chip}</i><i class="icon" style="left:78px;bottom:10px">${ICON.spark}</i><i class="icon" style="left:112px;bottom:10px">${ICON.shield}</i>
				<i class="icon" style="left:150px;bottom:10px;width:auto;padding:0 8px;font-size:13px;white-space:pre"><span style="position:static;display:inline-flex;gap:6px;align-items:center"><span style="position:static;width:15px;display:inline-block">${ICON.folder}</span>its workspace</span></i>
				<i class="icon" style="right:52px;bottom:12px">${ICON.mic}</i><i class="send" id="send">${ICON.up}</i>
			</div>
		</div>
		<div id="view-wrap" style="left:${VIEW_X}px;top:${TOP}px;width:${VIEW_W}px;height:${CARD_H}px;overflow:hidden">
			<div class="card" id="view-card" style="left:0;top:0;width:${VIEW_W}px;height:${CARD_H}px">
				<div class="head"><i class="icon" style="left:8px;top:6px">${ICON.radar}</i><span style="left:40px;top:0;font-weight:600">office</span><i class="icon" style="left:86px;top:6px;width:18px">${ICON.down}</i><i class="icon" style="right:8px;top:6px">${ICON.x}</i></div>
				<div id="view-root" style="width:${VIEW_W}px"></div>
				<div id="feed" class="feed" style="left:0;right:0;top:740px;bottom:0;border-top:1px solid var(--line)"></div>
			</div>
		</div>
	</div>
	<div id="ring"><i></i></div>
	<svg id="cursor" viewBox="0 0 24 24" style="position:absolute"><path d="M5 2.5v17l4.6-4.3 2.9 6.6 2.8-1.2-2.9-6.5H19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

// ---- the view: pine's own, run here on the film's clock -------------------------------------------------------------------

const realRaf = window.requestAnimationFrame.bind(window);
let OFFICE, stopView, pendingTick, listeners, viewAt = -1, random, skyHours = 0;
function seededRandom(seed) {
	let a = seed >>> 0;
	return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const READY = (async () => {
	build();
	if (!window.OFFICE_SRC) { document.title = "run node reel/render.mjs --film view once: it writes view-code.js"; return; }
	const kit = URL.createObjectURL(new Blob([window.KIT_SRC], { type: "text/javascript" }));
	OFFICE = await import(URL.createObjectURL(new Blob([window.OFFICE_SRC.replace(/(["'])pine\/view\1/g, JSON.stringify(kit))], { type: "text/javascript" })));
	// The view lives on the film's clock: its frames are asked for one by one, and chance is the same every time.
	Date.now = () => ms(NOW);
	Math.random = () => random();
	window.requestAnimationFrame = (fn) => ((pendingTick = fn), 1);
	window.cancelAnimationFrame = () => (pendingTick = undefined);
	window.setTimeout = (fn) => (fn(), 1);
	window.clearTimeout = () => {};
	OFFICE.setClock(() => new Date(ms(NOW) + skyHours * 3_600_000));
})();

/** Starts the view anew, or stops it: the film went back in time. */
function resetView() {
	stopView?.();
	stopView = undefined;
	pendingTick = undefined;
	viewAt = -1;
}
/** Plays the view on to second `t`, a frame of the film at a time. */
function playView(t) {
	if (!OFFICE) return;
	const from = T_VIEW - 0.5;
	if (t < from || t < viewAt) resetView();
	if (t < from) return;
	if (!stopView) {
		random = seededRandom(7);
		NOW = from;
		listeners = { state: new Set(), happening: new Set() };
		const host = { root: document.getElementById("view-root"), state: () => stateAt(NOW), on: (what, fn) => (listeners[what].add(fn), () => listeners[what].delete(fn)), select: () => {}, open: () => {} };
		stopView = OFFICE.default.start(host);
		viewAt = from;
	}
	// Before the day is wound on, the view is told to show all of the house (its own button for that): its camera
	// goes to whoever works, and at nine times the speed that is a jump each time.
	const WHOLE = T_LAPSE - 0.9;
	// A frame of the film: the view's clock goes on to where it is then, a twentieth of a second at a time (in
	// the wound-on day that is several steps a frame), and the sky's hour is set.
	const frame = (at) => {
		const target = simOf(at);
		skyHours = skyOf(at);
		if (viewAt < WHOLE && at >= WHOLE) document.querySelector("#view-root .office-bar button:nth-child(2)")?.click();
		do {
			const next = Math.min(target, NOW + 0.05);
			for (const [when, h] of HAPPENS) if (when > NOW && when <= next) for (const fn of listeners.happening) fn(h);
			NOW = next;
			const fn = pendingTick;
			pendingTick = undefined;
			fn?.(next * 1000);
		} while (NOW < target - 1e-6);
		viewAt = at;
	};
	while (viewAt + 1 / FPS < t - 1e-6) frame(viewAt + 1 / FPS);
	frame(t);
}

// ---- the camera, the pointer, and a frame --------------------------------------------------------------------------------

// Where things are on the desk, for the camera and the pointer.
const at = (x, y) => [WIN.x + x, WIN.y + y];
const P_VIEW_BTN = at(WIN.w - 32, 23);
const P_SLACK = at(120, rowOf(3) + 34 + 16);
const CONV_W = VIEW_X - PAD - SIDE;
const P_FIELD = at(SIDE + 150, TOP + CARD_H - 96);
const C_WIN = [WIN.x + WIN.w / 2, WIN.y + WIN.h / 2 + 6];
// The conversation and the view side by side; the house; the side bar and the conversation; the message field; the answer.
const C_BOTH = [(WIN.x + SIDE + WIN.x + WIN.w) / 2, 486, 1.4];
// The view's picture on the desk: its upper left corner, and its middle.
const PIC = [WIN.x + VIEW_X, WIN.y + TOP + 40];
const MID = PIC[0] + VIEW_W / 2;
/**
 * The camera: the point of the desk in the middle of the picture, and how close. It never leaves the window
 * once it is up, and in the view it goes to whoever works: the floors where the agents' own work runs, then
 * slack as it is asked, dev and its copies, plan at the calendar, and slack again as it writes.
 */
const CAMERA = [
	[0, W / 2, H / 2, 1],
	[T_WIN + 0.2, W / 2, H / 2, 1],
	[T_WIN + 1.9, C_WIN[0], C_WIN[1], 1.14],
	[T_VIEW - 0.9, C_WIN[0] + 110, C_WIN[1] - 60, 1.24],
	[T_VIEW + 1.9, ...C_BOTH],
	[8.2, MID + 20, PIC[1] + 300, 2.7],
	[10.4, MID - 90, PIC[1] + 380, 2.9],
	[12.6, MID + 60, PIC[1] + 330, 2.6],
	[T_REST + 0.8, ...C_BOTH],
	[T_PICK - 0.7, 792, 500, 1.5],
	[T_FIELD + 0.5, 770, 644, 1.58],
	[T_SEND + 0.5, 770, 644, 1.58],
	[T0 + 1.7, ...C_BOTH],
	// The floor where it happens: slack is asked and sends its two letters across it.
	[T0 + 3.3, MID, PIC[1] + 462, 2.4],
	[T0 + 5, MID, PIC[1] + 462, 2.4],
	// dev and plan, side by side, for as long as they work: dev's three copies come and go in a puff each, plan
	// stands at its rack and takes its starred book.
	[T0 + 6.3, PIC[0] + 290, PIC[1] + 472, 3],
	[T0 + 13.3, PIC[0] + 296, PIC[1] + 472, 3],
	// With dev's letter over to slack, which writes.
	[T0 + 16, PIC[0] + 560, PIC[1] + 468, 2.9],
	[T_DONE - 0.1, PIC[0] + 556, PIC[1] + 462, 2.9],
	[T_ANSWER + 1.4, 700, 560, 1.74],
	[T_ANSWER + 6.4, 700, 548, 1.74],
	// The day is wound on: the house and the sky over it fill the picture.
	[T_LAPSE + 0.4, WIN.x + WIN.w - 430, PIC[1] + 246, 2.2],
	[END, WIN.x + WIN.w - 430, PIC[1] + 262, 2.2],
];
/** The pointer: where it is when, on the desk. */
const POINTER = [
	[0, 1180, 640],
	[0.5, 1180, 640],
	[T_DOCK - 0.12, PINE_AT.x + 4, PINE_AT.y + 6],
	[T_WIN + 0.5, PINE_AT.x + 4, PINE_AT.y + 6],
	[T_WIN + 2, 1010, 560],
	[T_VIEW - 1.1, 1010, 560],
	[T_VIEW - 0.1, ...P_VIEW_BTN],
	[T_VIEW + 0.6, ...P_VIEW_BTN],
	[T_VIEW + 1.8, WIN.x + VIEW_X - 70, WIN.y + 560],
	[T_PICK - 1.3, WIN.x + VIEW_X - 70, WIN.y + 560],
	[T_PICK - 0.1, ...P_SLACK],
	[T_PICK + 0.4, ...P_SLACK],
	[T_FIELD - 0.1, ...P_FIELD],
	[T_SEND + 0.2, ...P_FIELD],
	[T_SEND + 1.3, P_FIELD[0] + 300, P_FIELD[1] - 150],
];
const CLICKS = [T_DOCK, T_VIEW, T_PICK, T_FIELD];
for (const c of CLICKS) cue(c, "click");
for (let i = 0; i < ASK.length; i++) cue(T_TYPE + i / CPS, ASK[i] === " " ? "key-space" : "key");
cue(T_SEND, "enter");

const $ = (id) => document.getElementById(id);
const ago = (s) => (s < 1 ? "now" : s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m`);
const tick = (done) => `<i class="dot${done ? "" : " go"}"></i>`;

function frameAt(t) {
	// The camera.
	let [cx, cy, z] = along(CAMERA, t);
	// Where the window fills the picture, the picture's edges stay inside it. While it does not quite, the camera is
	// drawn towards its middle the closer it comes to filling it, so that nothing jumps when it does.
	const hold = (v, lo, hi) => (lo <= hi ? clamp(v, lo, hi) : lerp((lo + hi) / 2, v, clamp((lo - hi) / 120)));
	cx = hold(cx, WIN.x + W / 2 / z - 6, WIN.x + WIN.w - W / 2 / z + 6);
	cy = hold(cy, WIN.y + H / 2 / z - 6, WIN.y + WIN.h - H / 2 / z + 6);
	$("cam").style.transform = `translate(${(W / 2 - cx * z).toFixed(2)}px, ${(H / 2 - cy * z).toFixed(2)}px) scale(${z.toFixed(4)})`;
	// The robot is there from the first frame, on white; the desk comes up around and behind it. At the end the
	// picture goes into the dark of the window.
	const desk = String(span(t, -0.9, 0.4));
	$("wall").style.opacity = $("menubar").style.opacity = $("dock").style.opacity = desk;
	$("fade").style.opacity = String(span(t, END - 1.1, END - 0.05));
	drawBot(t);

	// The dock: Pine bounces when it is opened, and has its dot from then on.
	const b = t - T_DOCK;
	$("pine-app").style.transform = b > 0 && b < 0.9 ? `translateY(${(-22 * Math.abs(Math.sin((b / 0.45) * Math.PI)) * (b < 0.45 ? 1 : 0.45)).toFixed(1)}px)` : "";
	$("pine-dot").style.opacity = String(span(t, T_WIN, T_WIN + 0.3));
	$("mb-app").textContent = t > T_WIN + 0.1 ? "Pine" : "Finder";
	$("mb-menus").style.left = t > T_WIN + 0.1 ? "100px" : "118px";
	$("mb-menus").textContent = t > T_WIN + 0.1 ? "File    Edit    View    Conversation    Window    Help" : "File    Edit    View    Go    Window    Help";

	// The window comes up out of the dock.
	const up = out(span(t, T_WIN, T_WIN + 0.5));
	const win = $("win");
	const s = lerp(0.06, 1, up);
	win.style.transform = `translate(${((PINE_AT.x - WIN.x) * (1 - up)).toFixed(2)}px, ${((PINE_AT.y - WIN.y) * (1 - up)).toFixed(2)}px) scale(${s.toFixed(4)})`;
	// It is solid from the moment it is there: what it comes up over never shows through it.
	win.style.display = t < T_WIN ? "none" : "";

	// The view's panel slides in beside the conversation.
	const open = out(span(t, T_VIEW + 0.05, T_VIEW + 0.5));
	const viewW = VIEW_W * open;
	$("view-wrap").style.left = `${WIN.w - PAD * open - viewW}px`;
	$("view-wrap").style.width = `${viewW}px`;
	const convW = WIN.w - SIDE - PAD - (viewW ? viewW + PAD * open : 0);
	$("conv").style.width = `${convW}px`;
	// What is said stands in a column of one width, in the middle: when the view comes in, it moves over and no line breaks anew.
	$("chat").style.left = $("status").style.left = `${(convW - COLUMN) / 2}px`;
	const fieldW = Math.min(convW - 48, 760);
	$("composer").style.left = `${(convW - fieldW) / 2}px`;
	$("composer").style.width = `${fieldW}px`;
	$("view-button").classList.toggle("on", t >= T_VIEW);

	// Which conversation shows: main's, then slack's.
	const slack = t >= T_PICK;
	const working = t >= T0 && t < T_DONE;
	$("tab-main").classList.toggle("on", !slack);
	$("tab-main").classList.toggle("busy", t < 11.2);
	$("tab-slack").style.display = slack ? "" : "none";
	$("tab-slack").classList.toggle("on", slack);
	$("tab-slack").classList.toggle("busy", working);
	$("tab-plus").style.left = `${SIDE + (slack ? 190 : 96)}px`;
	$("conv-main").classList.toggle("sel", !slack);
	$("conv-slack").classList.toggle("sel", slack);
	const st = stateAt(simOf(t));
	for (const a of AGENTS) {
		const busy = st.work.some((w) => w.agent === a.id && w.doing !== "done");
		const row = $(`conv-${a.id}`);
		row.querySelector(".live").style.display = busy ? "" : "none";
		row.querySelector(".star").style.display = busy ? "none" : "";
	}
	$("conv-title").textContent = "main conversation";
	$("chat").style.opacity = slack ? String(span(t, T_PICK, T_PICK + 0.18)) : "1";
	$("conv-meter").textContent = !slack ? (t >= 11.2 ? "12.9k · 22%" : "12.4k · 21%") : t >= T_ANSWER ? "9.6k · 16%" : t >= T_SEND ? "7.3k · 12%" : "6.8k · 11%";

	// The message field: a click, the words, Enter.
	const typed = t < T_TYPE ? 0 : Math.min(ASK.length, Math.floor((t - T_TYPE) * CPS) + 1);
	const sent = t >= T_SEND;
	const text = $("typed");
	text.textContent = sent ? (working ? "Say something to slack while it works…" : "Say something to slack…") : typed ? ASK.slice(0, typed) : slack ? "Say something to slack…" : t < 11.2 ? "Say something to main while it works…" : "Say something to main…";
	text.style.color = typed && !sent ? "var(--text)" : "var(--faint)";
	const caret = $("caret");
	caret.style.display = t >= T_FIELD && !sent && Math.floor((t - T_FIELD) * 1.8) % 2 === 0 || (typed && !sent && t < T_TYPE + ASK.length / CPS + 0.1) ? "" : "none";
	caret.style.left = `${16 + (typed && !sent ? text.offsetWidth + 1 : 0)}px`;
	$("composer").style.boxShadow = t >= T_FIELD && !sent ? "0 0 0 1.5px rgba(93,228,199,.6), 0 6px 22px rgba(8,10,16,.35)" : "";
	const mainWorks = !slack && t < 11.2;
	const send = $("send");
	send.style.background = working || mainWorks || (typed && !sent) ? "var(--brand)" : "var(--line2)";
	send.innerHTML = working || mainWorks ? ICON.stop : ICON.up;

	// The conversation. It is full when it is opened: main's with what was set up, slack's with what the team wrote
	// and what slack made of it. What is new comes in at the bottom and pushes the rest up.
	const blk = (born, cls, html, grow = 0.3) => {
		const k = ease(span(t, born, born + grow));
		return k <= 0 ? "" : `<div class="blk ${cls}" style="grid-template-rows:${k.toFixed(4)}fr;opacity:${k.toFixed(3)}"><div class="in">${html}</div></div>`;
	};
	const said = (list) => list.map(([kind, a, b, c]) => kind === "me" ? blk(-9, "me", `<div class="msg">${a}</div>`) : kind === "work" ? blk(-9, "", `<div class="work">${tick(true)}<span>${a}</span></div>`) : kind === "event" ? blk(-9, "", `<div class="event"><div class="from"><i style="background:${a}"></i>${b}</div>${c}</div>`) : blk(-9, "", `<div class="answer">${a}</div>`)).join("");
	const row = (born, done, html) => blk(born, "", `<div class="work">${tick(done)}<span>${html}</span></div>`);
	const sub2 = (html) => `<span style="display:inline-flex;gap:6px;align-items:center;color:var(--faint)"><span style="width:14px;display:inline-block">${ICON.turn}</span>${html}</span>`;
	let chat = "";
	if (!slack) {
		// main, woken by its schedule a moment ago, at work on the morning's notes. Its first row is "Thinking…" and
		// becomes its first tool call where it stands.
		chat = said(MAIN_SAID) + row(-9, t >= 8.6, t < 6.6 ? "Thinking…" : "<code>read</code> the night's events") + row(8.6, t >= 9.6, "<code>todo</code> · 3 steps");
		chat += blk(9.7, "", `<div class="answer">${streamed(MAIN_NOTES, Math.ceil(span(t, 9.8, 11.2) * wordsOf(MAIN_NOTES)))}</div>`, 0.6);
	} else {
		chat = said(SLACK_SAID);
		if (sent) {
			const rel = t - T0;
			chat += blk(T_SEND, "me", `<div class="msg">${ASK}</div>`);
			chat += row(T0 + 0.5, rel >= 13.4, rel < 2.6 ? "Thinking…" : "<code>delegate</code> dev");
			chat += blk(T0 + 2.7, "", `<div class="work">${sub2(`dev · Open pull requests${rel >= 6.2 ? ` · ${rel >= 11.4 ? "3 copies, done" : "3 copies at work"}` : ""}`)}</div>`);
			chat += row(T0 + 4.4, rel >= 12.4, "<code>delegate</code> plan") + blk(T0 + 4.5, "", `<div class="work">${sub2("plan · Today's meetings")}</div>`);
			chat += blk(T_ANSWER - 0.2, "", `<div class="answer">${streamed(ANSWER, Math.floor(span(t, T_ANSWER, T_ANSWER + 5) * wordsOf(ANSWER)))}</div>`, 0.9);
		}
	}
	if ($("chat").innerHTML !== chat) $("chat").innerHTML = chat;
	const mainBusy = !slack && t < 11.2;
	$("status").innerHTML = working ? `${tick(false)}<span>working · ${Math.floor(t - T0)}s · ${t - T0 >= 4.4 ? "2 tool calls · " : t - T0 >= 2.6 ? "1 tool call · " : ""}${t - T0 >= 2.6 && t - T0 < 13.4 ? `${t - T0 >= 4.4 && t - T0 < 12.4 ? 2 : 1} sub-task${t - T0 >= 4.4 && t - T0 < 12.4 ? "s" : ""} running` : "thinking"}</span>` : mainBusy ? `${tick(false)}<span>working · ${Math.floor(t + 3)}s${t >= 8.6 ? " · 2 tool calls" : t >= 6.6 ? " · 1 tool call" : ""}</span>` : "";

	// Under the view: what happened, newest first.
	const feed = FEED.filter(([when]) => when <= t).slice(-5).reverse();
	const lines = `<span style="left:14px;top:6px;color:var(--muted);font-weight:600">What happened</span><span style="right:12px;top:6px;color:var(--faint)">click anything to look closer · double-click to open it</span>${feed.map(([when, what], i) => `<span class="ago" style="top:${30 + i * 22}px">${ago(t - when)}</span><span class="what" style="top:${30 + i * 22}px">${what}</span>`).join("")}`;
	if ($("feed").innerHTML !== lines) $("feed").innerHTML = lines;

	// The pointer, and the ring of a click.
	const [px, py] = along(POINTER, t);
	const press = CLICKS.find((c) => t >= c && t < c + 0.5);
	const cursor = $("cursor");
	cursor.style.left = `${px - 5}px`;
	cursor.style.top = `${py - 3}px`;
	cursor.style.transform = `scale(${press !== undefined && t - press < 0.12 ? 0.88 : 1})`;
	cursor.style.opacity = String(Math.min(span(t, -0.2, 0.4), 1 - span(t, T_SEND + 1.6, T_SEND + 2.2)));
	const ring = $("ring");
	ring.style.display = press === undefined ? "none" : "";
	if (press !== undefined) {
		const k = (t - press) / 0.5;
		ring.style.left = `${px}px`;
		ring.style.top = `${py}px`;
		ring.firstElementChild.style.width = ring.firstElementChild.style.height = `${8 + out(k) * 34}px`;
		ring.firstElementChild.style.opacity = String(1 - k);
	}
}

// ---- the opening: one robot, glad ---------------------------------------------------------------------------------------

const INK = "#2b2140", PAPER = "#fff8ea";
/**
 * pmndre's P (the path of its own SVG, on a grid of 800): four tiles with a narrow gap between them. Three are
 * squares; the fourth is an L, the bar on top and the column down the right in one piece. Here a tile is four
 * pixels and a gap one: [x, y, width, height] of each rectangle.
 */
const MARK = [[0, 5, 4, 4], [5, 5, 4, 4], [5, 10, 4, 4], [5, 0, 9, 4], [10, 0, 4, 9]];
/**
 * The main agent's robot, as the view draws it, glad as it is when work is done: in the middle of the picture
 * before there is a desk, confetti over it and the logo's P in its bubble. It goes as Pine's window comes up.
 */
function drawBot(t) {
	// It stands on the desk, behind everything: once Pine's window is up it is covered, and no longer drawn.
	if (!OFFICE || t > T_WIN + 0.8) return;
	const g = $("bot").getContext("2d");
	g.clearRect(0, 0, BOT.w, BOT.h);
	const at = (t + INTRO) * 1000;
	const R = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
	// Confetti: a burst at once, and again and again.
	const colors = ["#3b82f6", "#ffcf3a", "#ff7aa8", "#34c98a", "#a78bfa", "#ff8a4a"];
	for (let b = 0; b < 6; b++) {
		const k = (at + 180 - b * 1150) / 1250;
		if (k <= 0 || k >= 1) continue;
		const r = seededRandom(31 + b * 7);
		for (let i = 0; i < 26; i++) {
			const a = -Math.PI / 2 + (r() - 0.5) * 2.6;
			const sp = 16 + r() * 26;
			const x = BOT.x + Math.cos(a) * sp * k;
			const y = BOT.y - 26 + Math.sin(a) * sp * k + 34 * k * k;
			if (k > 0.85 && i % 2) continue;
			R(x, y, i % 3 === 0 ? 2 : 1, i % 3 === 1 ? 2 : 1, colors[i % colors.length]);
		}
	}
	R(BOT.x - 6, BOT.y, 12, 1, "rgba(43,33,64,.1)");
	OFFICE.drawPortrait(g, "main", "#3b82f6", BOT.x, BOT.y, { pose: "cheer", t: at, main: true, lit: true });
	// Its bubble, with the P in it.
	const bob = Math.floor(at / 420) % 2;
	const bw = 22, bh = 22;
	const bx = BOT.x + 9, by = BOT.y - 54 - bob;
	const slab = (x, y, w, h, col, cut) => { for (let j = 0; j < h; j++) { const d = Math.min(j, h - 1 - j); const k = Math.max(0, cut - d); R(x + k, y + j, w - 2 * k, 1, col); } };
	slab(bx - 1, by - 1, bw + 2, bh + 2, INK, 3);
	slab(bx, by, bw, bh, PAPER, 2);
	// The tail, down to its head.
	for (let j = 0; j < 4; j++) { R(bx + 2 - j, by + bh + j, 5 - j, 1, INK); if (j < 3) R(bx + 3 - j, by + bh + j, 3 - j, 1, PAPER); }
	R(bx + 3, by + bh - 1, 3, 1, PAPER);
	for (const [x, y, w, h] of MARK) R(bx + 4 + x, by + 4 + y, w, h, INK);
}

/** Draws the film at second `t`. The view is played up to there first: it remembers. */
function renderAt(seconds) {
	const t = clamp(seconds * SPEED - INTRO, -INTRO, END);
	playView(t);
	frameAt(t);
}
/** A frame of this film is one moment: the view's own motion is in steps, as pixels move. */
const shutterTimes = (seconds) => [seconds];

/** Opened by hand, the film plays: space stops and starts it, the arrow keys step, a click on the bar jumps. */
READY.then(() => {
	if (navigator.webdriver) return;
	const stage = $("stage"), bar = $("scrub");
	const fit = () => { stage.style.transform = `scale(${Math.min(innerWidth / W, (innerHeight - 30) / H)})`; };
	addEventListener("resize", fit);
	fit();
	const q = new URLSearchParams(location.search);
	let now = Number(q.get("t") || 0), going = !q.has("t"), last = performance.now();
	const loop = (at) => {
		if (going) now = (now + (at - last) / 1000) % DURATION;
		last = at;
		renderAt(now);
		bar.firstElementChild.style.width = `${(now / DURATION) * 100}%`;
		bar.lastElementChild.textContent = `${now.toFixed(2)} s`;
		realRaf(loop);
	};
	addEventListener("keydown", (e) => {
		if (e.key === " ") going = !going;
		if (e.key === "ArrowRight") (now = Math.min(DURATION - 0.01, now + (e.shiftKey ? 1 : 1 / FPS))), (going = false);
		if (e.key === "ArrowLeft") (now = Math.max(0, now - (e.shiftKey ? 1 : 1 / FPS))), (going = false);
	});
	bar.style.display = "block";
	bar.addEventListener("click", (e) => { now = (e.clientX / innerWidth) * DURATION; });
	realRaf(loop);
});
