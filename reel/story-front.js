// A film for the top of the README: half a minute that says what pine is. First where it runs and
// what for, each in two seconds: as a service, in the terminal for a chat, in the desktop app for
// code. Then the thing it is built for, which takes the rest: agents that are woken by events. A card
// says so, and three things happen in the world, each cut in for two seconds, and each time the
// picture goes back to pine, close on the event as it arrives, and out again while the agent works:
// somebody writes in Slack, a camera sees a stranger at the door at night, a letter goes through the
// scanner.
// It is made to be read small and without sound. The terminal, the team chat and the phone are drawn,
// as in the other films. Three things are not: the camera's clip (assets/cam/, made by a video model),
// the scanner (assets/scan/, filmed on a phone) and the desktop app, whose pictures
// `node reel/app-shots.mjs` takes from the real app (assets/front/). Without the app's pictures its
// two scenes are left out. Rendered with `node reel/render.mjs --story front --webp`.

// ---- helpers (as in the other films, at a quicker pace) -----------------------------------------------

let TAB = "main";
const MODEL = "local/flashnext";
const newTab = (key, agent, session) => ({ key, agent, session, folder: "", doc: [], running: false, toolCalls: 0, context: 0, startedAt: 0 });
function intro(key, about) {
	inst((st) => {
		const tb = tabOf(st, key);
		tb.doc.push({ k: "text", s: `⟦b.d|${tb.agent}⟧⟦d| · ${about}⟧` });
		tb.doc.push({ k: "text", gap: false, s: `⟦d|session ${tb.session} · model ${MODEL} · type a message, / for commands⟧` });
	});
}
const cell = (col, row) => ({ x: ORIGIN.x + col * CW, y: ORIGIN.y + (row + 0.5) * RH });
const wide = (dur = 0.7) => shot(960, 540, 1, dur);
/** The terminal fills the picture from edge to edge: as close as it gets with every column in view. */
const near = (dur = 0.7) => shot(960, 572, 1.29, dur);
/** One line of words under the picture at a time: the one before ends where this one begins. */
const cap = (s, dur) => { const last = captions[captions.length - 1]; if (last && last.to > T - 0.15) last.to = T - 0.15; caption(s, dur); };
function tool(name, subj, secs, ms, gap = true) {
	const k = TAB, id = uid();
	inst((st) => { const tb = tabOf(st, k); tb.doc.push({ k: "tool", id, name, subj, state: "run", gap }); tb.toolCalls++; });
	wait(secs);
	inst((st) => { const b = blockOf(st, id); b.state = "ok"; b.ms = ms; });
	wait(0.06);
}
function answer(lines, cps = 260, gap = true) {
	const segs = lines.map((l) => (l === "" ? { gap: true, cells: [] } : l.startsWith("- ") ? { cells: L(`⟦a|-⟧ ${l.slice(2)}`), hang: 2 } : { cells: L(l) }));
	const total = segs.reduce((n, s) => n + s.cells.length, 0);
	const k = TAB, id = uid();
	op(total / cps, (st, p) => { tabOf(st, k).doc.push({ k: "md", id, segs, total, p, gap }); });
}
function done(context) { const k = TAB; inst((st) => { const tb = tabOf(st, k); tb.running = false; tb.context = context; tb.outside = true; }); }
/** An event arrives in the agent's conversation, and the agent is at work from then on. */
function event(label, s) { const k = TAB, t0 = T; sound("click"); inst((st) => { const tb = tabOf(st, k); tb.doc.push({ k: "event", label, s }); tb.running = true; tb.startedAt = t0; tb.toolCalls = 0; }); }
/** Back at pine after a cut: this agent's tab in front, and the camera close on the line where its next event will stand. */
function backAtPine(key, row = 5) {
	TAB = key;
	inst((st) => { st.room = 0; st.clip = null; st.card = 0; st.active = st.tabs.findIndex((x) => x.key === key); });
	focus(cell(27, row), 1.85, 0.01, 0.5, 0.4);
}
/** A clip cut in over the whole picture: frames `from` to `to` of assets/<src>/, played in `secs`. */
function cutTo(src, from, to, secs) {
	const fps = (to - from) / (secs * PACE);
	const t0 = T - from / fps;
	op(secs, (st) => { st.clip = { show: 1, src, frames: to, fps, t0 }; });
}

// The desktop app, in pictures of the real one.
const HAS_APP = typeof SHOTS !== "undefined";
if (HAS_APP) Object.assign(APP, { x: 180, y: 45, s: 1.5 });
/** What the app's window did between two of its pictures, played in `dur`: each stays as long as it did, in proportion. */
function appPlay(seq, from, to, dur) {
	const part = SHOTS.seqs[seq].slice(from, to), t0 = part[0][1], span = part.at(-1)[1] - t0;
	op(dur, (st, p) => { let now = part[0]; for (const f of part) if (f[1] <= t0 + p * span) now = f; st.app.shot = now[0]; });
}
const appCut = (name) => inst((st) => { st.app = { show: 1, dir: "front", shot: name, only: true }; st.clip = null; st.card = 0; });
const appGone = () => inst((st) => { st.app = { show: 0, dir: "", shot: "", only: false }; });

// ---- 1. it runs as a service ------------------------------------------------------------------------------
mark("a service");

// Everything below is written at an easy pace and played at this one.
pace(0.86);
at(-0.2);
inst((st) => { st.model = MODEL; });
focus(cell(20, 1), 1.72, 0.01, 0.5, 0.3);
at(0);
// (The first picture is what a README shows before anything moves: its words are there from the start.)
captions.push({ from: -1, to: 2.35 * PACE, s: "pine runs as a service" });
wait(0.35);
{
	const cmd = "pine start";
	keySounds(cmd, 17);
	op(cmd.length / 17, (st, p) => { st.shell.typed = cmd.slice(0, Math.round(p * cmd.length)); });
	wait(0.15);
	sound("enter");
	inst((st) => { st.shell.lines.push(`${st.shell.prompt} ⟦a|❯⟧ ${cmd}`); st.shell.typed = ""; st.shell.busy = true; });
	focus(cell(49, 2), 1.3, 0.6, 0.5, 0.3);
	wait(0.25);
	const log = (s) => inst((st) => { st.shell.lines.push(`⟦d|2026-11-17T08:02:11.114Z⟧ ⟦g|INFO ⟧ [pine] ${s}`); });
	log("http listening on 127.0.0.1:7463");
	wait(0.18);
	log("pine is up: 4 agents, 0 routes, 3 event sources (3 running)");
	wait(0.95);
}

// ---- 2. in the terminal: a chat -----------------------------------------------------------------------------
mark("a chat in the terminal");

inst((st) => {
	st.mode = "pine";
	st.title = "pine";
	st.tabs = [newTab("main", "main", "main"), newTab("scout", "scout", "main"), newTab("watchdog", "watchdog", "main")];
	st.active = 0;
});
intro("main", "Your main agent");
intro("scout", "Reads your Slack, and tells you what matters");
intro("watchdog", "Watches the house: the cameras, who came and went, Telegram");
near(0.01);
cap("In the terminal, for a chat", 2.8);
wait(0.3);
{
	const asks = "what's the weather in Lisbon this weekend?";
	keySounds(asks, 55);
	op(asks.length / 55, (st, p) => { st.input = asks.slice(0, Math.round(p * asks.length)); });
	wait(0.15);
	sound("enter");
	const t0 = T, id = uid();
	inst((st) => { const tb = tabOf(st, "main"); st.input = ""; tb.doc.push({ k: "user", id, s: asks }); tb.running = true; tb.startedAt = t0; tb.toolCalls = 0; });
	wait(0.15);
	tool("mcp__web__search", "Lisbon weather Saturday Sunday", 0.3, "640 ms");
	answer(["Sunny on both days, ⟦b|19 to 21 °C⟧, with a light wind from the north. The evenings get cool by the river: take a jacket."]);
	done(5);
	wait(1.0);
}

// ---- 3. in the desktop app: code ------------------------------------------------------------------------------
if (HAS_APP) {
	mark("code in the desktop app");

	const code = SHOTS.seqs.code;
	appCut(code[0][0]);
	shot(960, 540, 1.12, 0.01);
	cap("Or in the desktop app, for code", 3.3);
	wait(0.55);
	sound("enter");
	appPlay("code", 1, code.length, 1.5);
	pointerShow(inApp(860, 330));
	focus(inApp(700, 300), 1.4, 0.6);
	moveTo(appPoint("file"), 0.45);
	wait(0.12);
	click((st) => { st.app.shot = SHOTS.seqs.file.at(-1)[0]; });
	pointerHide();
	wait(1.15);
	appGone();
}

// ---- 4. and what it is built for ---------------------------------------------------------------------------------
mark("a card");

inst((st) => { st.card = 1; st.cardText = "<b>pine</b> is built on an event bus.<br>Agents can react to any external stimuli."; });
wait(2.2);

// ---- 5. somebody writes in Slack ---------------------------------------------------------------------------------
mark("slack");

const MAYA = { name: "Maya Lindqvist", color: "#c2553f" }, ALEX = { name: "Alex Reed", color: "#2f7d6b" };
const ASKS = "Hey Alex, do you have the numbers from last night's load test?";
inst((st) => {
	st.card = 0;
	st.room = 1;
	st.chat = {
		ws: "Northwind", with: ALEX, channels: ["general", "api", "releases", "random"], input: "", thread: null,
		people: [ALEX, { name: "Jonas Weber", color: "#5b6fb5" }, { name: "Priya Nair", color: "#b0802f" }, { ...MAYA, you: true }],
		msgs: [{ day: "Yesterday" }, { ...MAYA, time: "2:05 PM", html: "How did the deploy go? Anything I should watch?" }, { ...ALEX, time: "4:12 PM", html: "All good. The new cache is live since four." }],
	};
});
shot(1010, 660, 1.36, 0.01);
cap("A colleague writes to you in Slack", 2.3);
wait(0.3);
keySounds(ASKS, 60);
op(ASKS.length / 60, (st, p) => { st.chat.input = ASKS.slice(0, Math.round(p * ASKS.length)); });
wait(0.2);
sound("enter");
inst((st) => { st.chat.input = ""; });
op(0.25, (st, p) => { st.chat.msgs.push({ day: "Today", p }, { ...MAYA, time: "10:41 AM", html: ASKS, p }); }, true);
wait(0.75);

backAtPine("scout");
cap("In pine, that is an event", 1.3);
wait(0.25);
event("slack: source/slack@scout/message", '{ "userName": "Maya Lindqvist", "kind": "dm", "why": ["dm"] }');
wait(0.85);
cap("It wakes the agent that listens", 2.9);
near(0.7);
wait(0.2);
tool("read_source", "slack · the message, and the thread before it", 0.35, "310 ms");
answer(["⟦am|✉⟧ ⟦b|Maya Lindqvist⟧ ⟦d|· direct message · 10:41⟧", "She asks for the numbers from last night's load test. They are in ⟦y|reports/load-test.csv⟧: p95 at 41 ms, no errors.", "- Shall I send them to her?"]);
done(9);
wait(1.15);

// ---- 6. a camera sees a stranger at the door ------------------------------------------------------------------------
mark("the camera");

cap("02:13 · a camera sees somebody at the door", 2.1);
cutTo("cam/prowler-front", 30, 76, 2.0);

backAtPine("watchdog");
cap("The clip is an event", 1.25);
wait(0.25);
event("reolink: source/reolink@watchdog/upload", '{ "file": "front_00_20261206021304.mp4" }');
wait(0.8);
cap("The agent watches it, and decides", 2.1);
near(0.7);
wait(0.2);
tool("media", "watch_video", 0.4, "24 s");
answer(["front 02:13 · face covered, nobody I know, and it is the middle of the night → ⟦rd|alarm⟧"], 260, false);
tool("send", "telegram · picture and clip", 0.3, "1.2 s", false);
done(7);
wait(0.3);
// The owner's phone: the agent writes there, with the clip, and asks.
op(0.45, (st, p) => { st.phone.show = p; st.phone.name = "watchdog"; st.phone.clock = "02:13"; st.winDim = 0.4 * p; st.winShift = -160 * ease(p); st.winScale = 0.13 * ease(p); });
shot(1250, 540, 1.2, 0.6);
cap("It writes to you on Telegram, and asks", 2.9);
sound("tap", 0.1);
{
	const t0 = T;
	op(0.3, (st, p) => { st.phone.msgs.push({ clip: { src: "cam/prowler-front", frames: 72, fps: 12, loop: true, t0 }, html: "Front door, 02:13. Somebody with a covered face. I don't know them, and it is the middle of the night.\nShould I ring the alarm?", time: "02:13", p }); }, true);
}
wait(0.5);
// Close on what it wrote, so that it can be read.
shot(1560, 740, 1.95, 0.7);
wait(2.1);

// ---- 7. a letter goes through the scanner ---------------------------------------------------------------------------
mark("the scanner");

cap("A letter goes through the scanner", 2.0);
cutTo("scan", 250, 404, 1.9);
inst((st) => { st.clip = null; st.phone.show = 0; st.winDim = 0; st.winShift = 0; st.winScale = 0; });

if (HAS_APP) {
	// mrbanks's conversation in the app, and beside it the list it keeps: the event as it arrives, close;
	// then the whole window while the agent works.
	const n = SHOTS.seqs.letter.length, half = Math.round(n * 0.55);
	appCut(SHOTS.seqs.before[0][0]);
	focus(inApp(410, 372), 2.05, 0.01);
	cap("The scan is an event", 1.4);
	wait(0.3);
	sound("click");
	inst((st) => { st.app.shot = SHOTS.seqs.letter[1][0]; });
	wait(0.95);
	cap("The agent reads the letter", 1.8);
	focus(inApp(600, 330), 1.42, 0.8);
	appPlay("letter", 2, half, 1.4);
	cap("and puts what is due on your TODO list", 3.2);
	focus(inApp(700, 300), 1.42, 0.8);
	appPlay("letter", half - 1, n, 1.6);
	wait(1.3);
}

// ---- 8. the end -------------------------------------------------------------------------------------------------------
mark("the end");

wide(0.5);
inst((st) => { st.outroText = "npm install -g @pmndre/pine"; });
op(0.5, (st, p) => { st.outro = p; });
wait(1.7);
// Played slightly quicker than written, to stay under half a minute.
SPEED = 1.07;
const DURATION = T / SPEED;
