// A third film: an agent that watches a house. It is made in one conversation: cameras upload their clips
// to it by FTP, it reaches its owner on Telegram, its instructions go into AGENTS.md. Then it works:
// it learns who lives there by asking, lets a garden party be, and warns when somebody goes round the
// house at night. The house, the people and every clip are made up (assets/cam/, made by a video model;
// README.md says how). Rendered with `node reel/render.mjs --story watchdog`.

// ---- helpers (as in story.js) ----------------------------------------------------------------------

let TAB = "main";
const MODEL = "local/qwen27b";
const newTab = (key, agent, session, folder = "") => ({ key, agent, session, folder, doc: [], running: false, toolCalls: 0, context: 0, startedAt: 0 });
function intro(key, about) {
	inst((st) => {
		const tb = tabOf(st, key);
		tb.doc.push({ k: "text", s: `⟦b.d|${tb.agent}⟧⟦d| · ${about}⟧` });
		tb.doc.push({ k: "text", gap: false, s: `⟦d|session ${tb.session} · model ${MODEL} · type a message, / for commands, or click the bar below⟧` });
	});
}
function typeIn(s, cps = 27) { keySounds(s, cps); op(s.length / cps, (st, p) => { st.input = s.slice(0, Math.round(p * s.length)); }); }
function send(s) {
	const k = TAB, t0 = T, id = uid();
	inst((st) => { const tb = tabOf(st, k); st.input = ""; tb.doc.push({ k: "user", id, s }); tb.running = true; tb.startedAt = t0; tb.toolCalls = 0; });
}
const cell = (col, row) => ({ x: ORIGIN.x + col * CW, y: ORIGIN.y + (row + 0.5) * RH });
const onWindow = (dur = 0.9) => shot(960, 556, 1.1, dur);
const wide = (dur = 1) => shot(960, 540, 1, dur);
const onInput = (z = 1.5, dur = 0.8) => focus(cell(z > 1.4 ? 41 : 46, ROWS - 3), z, dur, 0.5, 0.76);
function say(s, o = {}) {
	onInput(o.z);
	wait(0.25);
	if (o.follow) focus(cell(Math.min(s.length, 96) + 2, ROWS - 3), o.z, s.length / (o.cps || 27), 0.8, 0.76);
	typeIn(s, o.cps);
	wait(o.pause ?? 0.25);
	sound("enter");
	send(s);
	onWindow(0.8);
	wait(0.25);
}
function tap(p, effect, o = {}) {
	if (!o.still) focus(p, o.z ?? 1.6, o.move ?? 0.8, o.ax ?? 0.5, o.ay ?? 0.5);
	moveTo(p, o.move ?? 0.8);
	wait(o.hover ?? 0.28);
	click(effect);
	wait(o.after ?? 0.55);
}
function toolStart(name, subj, gap = true) {
	const k = TAB, id = uid();
	inst((st) => { const tb = tabOf(st, k); tb.doc.push({ k: "tool", id, name, subj, state: "run", gap }); tb.toolCalls++; });
	return (ms) => inst((st) => { const b = blockOf(st, id); b.state = "ok"; b.ms = ms; });
}
function tool(name, subj, secs, ms, gap = true) { const end = toolStart(name, subj, gap); wait(secs); end(ms); wait(0.06); }
function answer(lines, cps = 300, gap = true) {
	const segs = lines.map((l) => (l === "" ? { gap: true, cells: [] } : typeof l === "object" ? { pre: true, cells: L(l.pre) } : l.startsWith("- ") ? { cells: L(`⟦a|-⟧ ${l.slice(2)}`), hang: 2 } : { cells: L(l) }));
	const total = segs.reduce((n, s) => n + s.cells.length, 0);
	const k = TAB, id = uid();
	op(total / cps, (st, p) => { tabOf(st, k).doc.push({ k: "md", id, segs, total, p, gap }); });
}
function done(context, outside) { const k = TAB; inst((st) => { const tb = tabOf(st, k); tb.running = false; tb.context = context; if (outside) tb.outside = true; }); }
function event(label, s) { const k = TAB, t0 = T; inst((st) => { const tb = tabOf(st, k); tb.doc.push({ k: "event", label, s }); tb.running = true; tb.startedAt = t0; tb.toolCalls = 0; }); wait(0.25); }
function table(head, rows) {
	const all = [head, ...rows], widths = head.map((_, i) => Math.max(...all.map((r) => r[i].replace(/⟦[^|]*\||⟧/g, "").length)));
	const line = (l, m, r) => ({ pre: `${l}${widths.map((w) => "─".repeat(w + 2)).join(m)}${r}` });
	const row = (r, bold) => ({ pre: `│${r.map((s, i) => ` ${bold ? `⟦b|${s}⟧` : s}${" ".repeat(widths[i] - s.replace(/⟦[^|]*\||⟧/g, "").length)} `).join("│")}│` });
	const out = [line("┌", "┬", "┐"), row(head, true)];
	for (const r of rows) out.push(line("├", "┼", "┤"), row(r));
	return [...out, line("└", "┴", "┘")];
}

// ---- the phone: the camera's app, then the chat with the agent ---------------------------------------

const phoneIn = (dur = 0.7) => op(dur, (st, p) => { st.phone.show = p; st.phone.name = "kevin"; st.winDim = 0.4 * p; st.winShift = -160 * ease(p); st.winScale = 0.13 * ease(p); });
const phoneOut = (dur = 0.55) => op(dur, (st, p) => { st.phone.show = 1 - p; st.winDim = 0.4 * (1 - p); st.winShift = -160 * ease(1 - p); st.winScale = 0.13 * ease(1 - p); });
const onPhone = (dur = 1.0) => shot(1180, 540, 1.24, dur);
const clock = (s) => inst((st) => { st.phone.clock = s; });
const msg = (m, dur = 0.3) => op(dur, (st, p) => { st.phone.msgs.push({ ...m, p }); }, true);
const typing = (dur) => op(dur, (st, p, s) => { if (p < 1) st.phone.msgs.push({ typing: true, p: clamp(s / 0.2) }); });
const write = (s, cps = 19) => { keySounds(s, cps, "tap"); op(s.length / cps, (st, p) => { st.phone.input = s.slice(0, Math.round(p * s.length)); }); wait(0.3); sound("tap"); inst((st) => { st.phone.input = ""; }); };
/** Earlier messages leave the chat, so that the new ones have room. */
const clearChat = () => inst((st) => { st.phone.msgs = []; });

// ---- what the cameras send -------------------------------------------------------------------------

// The clips: assets/cam/<name>/001.jpg on, 12 frames a second, the camera's date, clock and name printed on them.
const CLIP = (name, seconds) => ({ src: `cam/${name}`, frames: seconds * 12, fps: 12, loop: true });
const CLIPS = {
	gardening: CLIP("gardening", 5), walkIn: CLIP("walk-in", 8), dog: CLIP("dog", 5), party: CLIP("party", 5),
	front: CLIP("prowler-front", 6), garden: CLIP("prowler-garden", 5), back: CLIP("prowler-back", 6),
};
/** A camera's picture in a small window on the desk. */
function camShow(id, clip, box, dur = 0.45) { const t0 = T; op(dur, (st, p) => { st.cams.push({ id, ...clip, ...box, show: p, t0 }); }, true); }
function camHide(id, dur = 0.35) { op(dur, (st, p) => { const c = st.cams.find((x) => x.id === id); if (c) c.show = 1 - p; }, true); }
// Lower right, clear of the lines of the conversation, which begin at the top left.
const RIGHT = { x: 1040, y: 372, w: 760 };
/** One clip arrives and is handled: what pine shows of it, as lines of the agent's tab. */
function clipArrives(file) { event("reolink: source/reolink@kevin/upload", `{ "file": "${file}" }`); }
const verdict = (s) => { answer([s], 240, false); done(3, true); };

/** How much quicker the film plays than it is written (SPEED, set at the end). */
const SPEED_FILM = 1.09;

// ---- 0. a title ----------------------------------------
mark("title");
pace(1);

// A title over the shell, then pine is opened: one word.
at(-0.1);
inst((st) => { st.card = 1; st.cardText = "<b>pine</b> · an agent that watches the house"; });
focus(cell(24, 2), 1.5, 0.01, 0.42, 0.3);
at(0);
wait(1.7);
op(0.5, (st, p) => { st.card = 1 - p; });
wait(0.15);
keySounds("pine", 8);
op(0.5, (st, p) => { st.shell.typed = "pine".slice(0, Math.round(p * 4)); });
wait(0.2);
sound("enter");
inst((st) => { st.mode = "pine"; st.title = "pine"; st.model = MODEL; st.tabs = [newTab("main", "main", "main")]; st.active = 0; });
intro("main", "Your main agent");
onWindow(0.7);
wait(0.45);

// ---- 1. a new agent ----------------------------------------
mark("a new agent");
pace(0.66);

caption("Ask the main agent for a new one", 4.0);
say("new agent: kevin. he watches the house", { cps: 21 });
tool("create_agent", "kevin", 1.0, "1.4 s");
answer(["⟦y|kevin⟧ is live, in a tab of his own."], 120);
done(4);
inst((st) => { st.tabs.push(newTab("kevin", "kevin", "main")); });
intro("kevin", "House watcher: the cameras, the book of who came and went, Telegram");
wait(0.5);
pointerShow({ x: 700, y: 420 });
tap(find("2 kevin"), (st) => { st.active = 1; }, { z: 1.5, ax: 0.3, ay: 0.3, move: 0.6, after: 0.35 });
pointerHide();
onWindow(0.7);
TAB = "kevin";

// ---- 2. the cameras upload to pine ----------------------------------------
mark("the cameras");
pace(0.66);

caption("Cameras send their clips by FTP: an event source", 5.2);
say("watch the cameras. they upload their clips by ftp", { cps: 24 });
tool("add_source", "reolink · ftp, port 2121", 0.9, "1.1 s");
answer([
	"The FTP drop is open. Enter this in the camera's app:",
	...table(["Server", "Port", "User", "Password"], [["192.168.1.20", "2121", "reolink", "in pine's .env, made just now"]]),
], 210);
done(5);
wait(0.9);

// The camera's app, on the phone: the four values go in, and the camera's test upload arrives.
{
	const F = [["Server address", "192.168.1.20"], ["Port", "2121"], ["Username", "reolink"], ["Password", "tK4wq9ZpLm2x"]];
	const app = (n, chars, extra = {}) => ({ show: 1, title: "Garden cam", section: "FTP settings", button: "FTP test", ...extra,
		fields: F.map(([label, value], i) => ({ label, secret: i === 3, on: i === n, value: i < n ? value : i === n ? value.slice(0, chars) : "" })) });
	op(0.7, (st, p) => { st.phone.show = p; st.phone.app = { ...app(-1, 0), show: 1 }; st.winDim = 0.4 * p; st.winShift = -160 * ease(p); st.winScale = 0.13 * ease(p); });
	onPhone(0.9);
	caption("In the camera's app: where to upload", 5.0);
	wait(0.3);
	F.forEach(([, value], i) => {
		keySounds(value, 16, "tap");
		op(value.length / 16, (st, p) => { st.phone.app = app(i, Math.round(p * value.length)); });
		wait(0.12);
	});
	inst((st) => { st.phone.app = app(4, 0); });
	wait(0.25);
	sound("tap");
	inst((st) => { st.phone.app = app(4, 0, { pressed: true }); });
	wait(0.2);
	op(0.4, (st, p) => { st.phone.app = app(4, 0, { result: p, resultText: "✓ Test file uploaded" }); });
	wait(1.1);
	op(0.55, (st, p) => { st.phone.show = 1 - p; st.phone.app = app(4, 0, { result: 1, resultText: "✓ Test file uploaded" }); st.winDim = 0.4 * (1 - p); st.winShift = -160 * ease(1 - p); st.winScale = 0.13 * ease(1 - p); });
	inst((st) => { st.phone.app = null; });
	onWindow(0.7);
}
event("reolink: source/reolink@kevin/upload", '{ "file": "garden_00_20261121130112.txt", "from": "192.168.1.31" }');
answer(["The garden camera's test upload arrived. It is connected."], 200, false);
done(6, true);
wait(0.9);

// ---- 3. a way to reach the owner ----------------------------------------
mark("telegram");
pace(0.67);

caption("Telegram is a source too, and the way back to you", 5.4);
say("and write to me on telegram", { cps: 23 });
tool("add_source", "telegram · token and pairing typed into pine", 0.9, "42 s");
tool("send", "telegram", 0.5, "310 ms", false);
answer(["Paired with your account. From now on what you have to hear reaches you there."], 220, false);
done(7, true);
phoneIn();
onPhone(0.9);
clock("13:04");
wait(0.2);
typing(0.7);
msg({ html: "Kevin here. I'm watching the house.", time: "13:04" });
wait(1.9);
phoneOut();
onWindow(0.7);

// ---- 4. what he is to do ----------------------------------------
mark("instructions");
pace(0.67);

caption("Say what you want. It becomes his instructions", 6.6);
say("judge every clip: who is it, coming or going? skip the ordinary, tell me what matters, alarm on danger. ask me when you don't know someone", { cps: 38, z: 1.3, pause: 0.4, follow: true });
tool("write", "AGENTS.md", 0.7, "34 ms");
tool("write", "camera/book.py", 0.5, "29 ms", false);
answer(["Written to my ⟦y|AGENTS.md⟧. I keep a book of who came and went, so every clip is judged knowing the last hour."], 230, false);
done(9, true);
// The file itself, with what matters marked.
{
	const text = [
		'<span class="hd"># Kevin, the house watcher</span>',
		"For every clip: who is in it, are they coming or going,",
		"does the owner have to hear about it now.",
		'<span class="nw">skip   write it in the book and say nothing</span>',
		'<span class="nw">tell   a short message on Telegram, with the picture</span>',
		'<span class="nw">alarm  an urgent one: danger, or a stranger at night</span>',
		"",
		'<span class="hd">## Who is it</span>',
		"A sub-agent compares the frames with the people of the house.",
		'<span class="nw">Somebody you cannot name is unknown, not a threat: ask.</span>',
		"",
		'<span class="hd">## The book</span>',
		"You start fresh for every clip. What you know is in the book.",
	].join("\n");
	shot(960, 470, 1.42, 0.8);
	op(0.5, (st, p) => { st.finder = { show: 0, sel: -1, rows: [], ql: p, text, qlTitle: "AGENTS.md" }; st.winDim = 0.5 * p; });
	caption("AGENTS.md: a file the agent keeps and reads every time", 4.6);
	wait(3.4);
	op(0.4, (st, p) => { st.finder = { show: 0, sel: -1, rows: [], ql: 1 - p, text, qlTitle: "AGENTS.md" }; st.winDim = 0.5 * (1 - p); });
	onWindow(0.6);
}

// ---- 5. an afternoon in the garden ----------------------------------------
mark("the garden");
pace(0.69);

inst((st) => { tabOf(st, "kevin").doc = []; });
caption("A clip arrives. Kevin wakes, fresh, and looks", 6.0);
camShow("a", CLIPS.gardening, RIGHT);
wait(0.9);
clipArrives("garden_00_20261121140510.mp4");
tool("bash", "camera/book.py next", 0.35, "90 ms");
tool("media", "watch_video", 0.9, "21 s", false);
tool("media", "find_person", 0.35, "5 s", false);
caption("A sub-agent on a vision model says who it is", 4.6);
tool("subagent", "RECOGNISE · local/qwen27b", 0.9, "17 s", false);
verdict("garden 14:05 · two people and a dog · unknown → ⟦y|tell, ask⟧");
tool("send", "telegram · picture and clip", 0.4, "1.2 s", false);
wait(0.3);
camHide("a");
phoneIn();
onPhone(0.9);
clock("14:06");
clearChat();
msg({ img: "cam/still-gardening.jpg", html: "Garden, 14:05: a man and a woman raking leaves, a dog with them. I don't know them yet.\nWho is this?", time: "14:06" });
caption("He asks once", 3.4);
wait(2.0);
write("that's us! Anna and Tom, and Milo");
msg({ me: true, html: "that's us! Anna and Tom, and Milo", time: "14:06" });
wait(0.5);
typing(0.7);
msg({ html: "Noted. I know you now.", time: "14:06" });
wait(1.2);
phoneOut();
onWindow(0.7);
inst((st) => { tabOf(st, "kevin").doc = []; });
tool("bash", "camera/book.py correct · portrait Anna, Tom", 0.4, "110 ms");
tool("edit", "MEMORY.md", 0.35, "19 ms", false);
caption("And from then on he knows who belongs here", 5.0);
camShow("b", CLIPS.walkIn, RIGHT);
wait(0.5);
clipArrives("garden_00_20261121140940.mp4");
verdict("garden 14:09 · Tom, coming in, Milo behind → ⟦g|skip⟧");
wait(0.7);
camHide("b", 0.25);
camShow("c", CLIPS.dog, RIGHT, 0.3);
wait(0.4);
clipArrives("garden_00_20261121142005.mp4");
verdict("garden 14:20 · Milo, alone → ⟦g|skip⟧");
wait(0.9);
camHide("c");

// ---- 6. a party ----------------------------------------
mark("a party");
pace(0.69);

phoneIn();
onPhone(0.8);
clock("17:52");
clearChat();
write("garden party tonight, guests until midnight");
msg({ me: true, html: "garden party tonight, guests until midnight", time: "17:52" });
wait(0.4);
typing(0.6);
msg({ html: "Noted for the garden, until 00:00.", time: "17:52" });
wait(1.0);
phoneOut();
onWindow(0.7);
inst((st) => { tabOf(st, "kevin").doc = []; });
caption("Tell him what is going on, and he lets it be", 5.6);
camShow("d", CLIPS.party, RIGHT);
wait(0.6);
clipArrives("garden_00_20261128184015.mp4");
tool("media", "watch_video", 0.6, "22 s");
tool("subagent", "RECOGNISE · local/qwen27b", 0.6, "19 s", false);
verdict("garden 18:40 · 8 people, Anna and Tom among them → ⟦g|skip⟧");
wait(0.5);
caption("One look, then the same scene costs nothing", 4.6);
for (const [time, file] of [["18:41", "184102"], ["18:41", "184148"], ["18:42", "184231"], ["18:43", "184309"]]) {
	clipArrives(`garden_00_20261128${file}.mp4`);
	verdict(`garden ${time} · still the party, not looked at → ⟦g|skip⟧`);
	wait(0.12);
}
wait(0.7);
camHide("d");

// ---- 7. away, and somebody goes round the house ----------------------------------------
mark("at night");
pace(0.73);

phoneIn();
onPhone(0.8);
clock("09:12");
clearChat();
write("we're on vacation until sunday");
msg({ me: true, html: "we're on vacation until sunday", time: "09:12" });
wait(0.4);
typing(0.6);
msg({ html: "House is away until Sun 6 Dec, 18:00. I'll watch closely.", time: "09:12" });
wait(1.1);
phoneOut();
onWindow(0.7);
inst((st) => { tabOf(st, "kevin").doc = []; });
caption("02:13. The house is empty", 3.6);
const NIGHT = [{ x: 1250, y: 78, w: 560 }, { x: 1250, y: 400, w: 560 }, { x: 1250, y: 722, w: 560 }];
camShow("n1", { ...CLIPS.front, night: true }, NIGHT[0]);
wait(0.7);
clipArrives("front_00_20261206021304.mp4");
tool("media", "watch_video", 0.5, "24 s");
tool("subagent", "RECOGNISE · local/qwen27b", 0.5, "18 s", false);
verdict("front 02:13 · face covered, at the door → ⟦rd|alarm⟧");
tool("send", "telegram · picture and clip", 0.3, "1.2 s", false);
caption("One person, camera after camera: he keeps the track", 6.0);
camShow("n2", { ...CLIPS.garden, night: true }, NIGHT[1]);
wait(0.6);
clipArrives("garden_00_20261206021531.mp4");
verdict("garden 02:15 · same person, second camera → ⟦rd|alarm⟧");
camShow("n3", { ...CLIPS.back, night: true }, NIGHT[2]);
wait(0.6);
clipArrives("back_00_20261206021748.mp4");
verdict("back 02:17 · tries the terrace door → ⟦rd|alarm⟧");
tool("send", "telegram · picture and clip", 0.4, "1.3 s", false);
wait(0.8);
camHide("n1", 0.3); camHide("n2", 0.3); camHide("n3", 0.3);
phoneIn();
onPhone(0.9);
clock("02:18");
clearChat();
caption("The warning, with the evidence", 4.6);
msg({ html: "ALARM · front, 02:13\nSomebody at the front door, face covered. You are away.", time: "02:13" }, 0.01);
msg({ clip: { ...CLIPS.back, t0: T }, html: "ALARM · back, 02:17\nThe same person, now at the terrace door, trying the handle. Third camera in five minutes.\nSet off the siren?", time: "02:18" });
wait(3.2);
write("yes", 9);
msg({ me: true, html: "yes", time: "02:18" });
wait(0.5);
typing(0.5);
msg({ html: "Siren is on.", time: "02:18" });
wait(1.6);

// ---- 8. the end ----------------------------------------
mark("the end");
pace(1);

shot(960, 540, 1, 0.9);
op(0.8, (st, p) => { st.outro = p; });
wait(2.3);
SPEED = SPEED_FILM;
const DURATION = T / SPEED;
