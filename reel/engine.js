// The reel's engine: a terminal drawn on a character grid, a timeline of small steps that build
// the state of everything on screen, a mouse pointer with a camera that leans towards it, and
// the mocked windows around it. Everything on screen is a pure function of the time: renderAt(t)
// draws second t, so the film can be captured frame by frame.

const CW = 14.4, RH = 30, COLS = 100, ROWS = 28;
const WIN = { x: 218, y: 52, w: 22 + COLS * CW + 22, h: 50 + ROWS * RH + 22 };
const ORIGIN = { x: WIN.x + 22, y: WIN.y + 50 };
const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const lerp = (a, b, p) => a + (b - a) * p;

// ---- text as cells -------------------------------------------------------------------------------

/** "plain ⟦b.y|bold yellow⟧ plain" as cells: one character and its classes each. */
function L(s) {
	const out = [];
	const re = /⟦([^|⟧]*)\|([^⟧]*)⟧/g;
	let i = 0, m;
	const add = (text, c) => { for (const ch of text) out.push({ ch, c }); };
	while ((m = re.exec(s))) {
		if (m.index > i) add(s.slice(i, m.index), "");
		add(m[2], m[1].split(".").join(" "));
		i = re.lastIndex;
	}
	if (i < s.length) add(s.slice(i), "");
	return out;
}
const sp = (n, c = "") => Array.from({ length: Math.max(0, n) }, () => ({ ch: " ", c }));
const text = (cells) => cells.map((x) => x.ch).join("");
const withClass = (cells, c) => cells.map((x) => ({ ch: x.ch, c: `${x.c} ${c}`.trim() }));
const fit = (cells, w, c = "") => (cells.length >= w ? cells.slice(0, w) : [...cells, ...sp(w - cells.length, c)]);

/** Break cells into lines of at most `width`, at spaces; later lines start `hang` cells in. */
function wrap(cells, width, hang = 0) {
	const lines = [];
	let line = [], word = [];
	const room = () => width - (lines.length ? hang : 0);
	const flush = () => {
		if (!word.length) return;
		if (line.length && line.length + word.length > room()) {
			while (line.length && line[line.length - 1].ch === " ") line.pop();
			lines.push(line);
			line = [];
		}
		while (word.length > room()) {
			lines.push(word.splice(0, room()));
		}
		line.push(...word);
		word = [];
	};
	for (const cell of cells) {
		if (cell.ch === " ") {
			flush();
			if (line.length) line.push(cell);
		} else word.push(cell);
	}
	flush();
	while (line.length && line[line.length - 1].ch === " ") line.pop();
	lines.push(line);
	return lines.map((l, i) => (i && hang ? [...sp(hang), ...l] : l));
}

const BOX = { "─": "L R", "│": "U D", "╭": "R D", "┌": "R D", "╮": "L D", "┐": "L D", "╰": "R U", "└": "R U", "╯": "L U", "┘": "L U", "├": "U D R", "┤": "U D L", "┬": "L R D", "┴": "L R U", "┼": "L R U D" };
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function rowHTML(cells) {
	let html = "", run = "", cls = null;
	const flush = () => {
		if (run) html += `<span class="${cls}">${escape(run)}</span>`;
		run = "";
	};
	for (let i = 0; i < cells.length; i++) {
		const { ch, c } = cells[i];
		if (ch === "─") {
			// A run of line cells is one piece, so that no gaps show between cells.
			let n = 1;
			while (i + n < cells.length && cells[i + n].ch === "─" && cells[i + n].c === c) n++;
			flush();
			cls = null;
			html += `<i class="bx L R ${c}" style="width:${(n * CW).toFixed(2)}px"> </i>`;
			i += n - 1;
			continue;
		}
		if (ch.charCodeAt(0) < 127 && ch.length === 1) {
			if (c !== cls) flush(), (cls = c);
			run += ch;
			continue;
		}
		flush();
		cls = null;
		if (BOX[ch]) html += `<i class="bx ${BOX[ch]} ${c}"> </i>`;
		else if (ch === "█") html += `<i class="blk ${c}"> </i>`;
		else html += `<i class="${c}">${escape(ch)}</i>`;
	}
	flush();
	return html;
}

// ---- the timeline --------------------------------------------------------------------------------

const ops = [];
let T = 0, seq = 0, sorted = false;
const uid = () => `b${++seq}`;
const at = (t) => (T = t);
/** How long everything written from here on takes, as a factor: below 1 is quicker. Set per scene. */
let PACE = 1;
const pace = (f) => (PACE = f);
const wait = (d) => (T += d * PACE);
/** Something that takes `dur` seconds; fn gets the state, how far it is (0..1) and the seconds since it began. */
function op(dur, fn, parallel = false) {
	dur *= PACE;
	ops.push({ at: T, dur, fn, n: ops.length });
	sorted = false;
	if (!parallel) T += dur;
}
const inst = (fn) => op(0, fn);

function initial() {
	return {
		mode: "shell", title: "~ — zsh",
		shell: { lines: [], prompt: "⟦b.c|~⟧", typed: "", busy: false },
		tabs: [], active: 0, input: "", attach: [], pane: { open: false, view: "changes", sub: "" }, overlay: null,
		app: { show: 0, dir: "", shot: "", only: false }, outroText: "",
		vs: { show: 0, typed: 0, dirty: false }, phone: { show: 0, msgs: [], input: "", app: null }, cams: [], room: 0, chat: null, web: null, drag: null, outro: 0, winDim: 0, winShift: 0, card: 0, cardText: "", finder: { show: 0, sel: -1, rows: [], ql: 0, text: "" },
	};
}

function stateAt(t) {
	if (!sorted) ops.sort((a, b) => a.at - b.at || a.n - b.n), (sorted = true);
	const st = initial();
	st.t = t;
	for (const o of ops) {
		if (o.at > t) break;
		o.fn(st, o.dur ? clamp((t - o.at) / o.dur) : 1, t - o.at);
	}
	return st;
}

// ---- the pine screen -----------------------------------------------------------------------------

const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const rule = (w, c = "d") => L(`⟦${c}|${"─".repeat(w)}⟧`);
const tabOf = (st, key) => st.tabs.find((x) => x.key === key);
const blockOf = (st, id) => { for (const tb of st.tabs) { const b = tb.doc.find((x) => x.id === id); if (b) return b; } };

/** One block of a conversation as lines of `w` cells. */
function blockLines(b, w, t) {
	const inner = w - 2;
	const pad = (cells, c = "") => fit([...sp(1, c), ...cells], w, c);
	switch (b.k) {
		case "text":
			return wrap(L(b.s), inner, b.hang || 0).map((l) => pad(l));
		case "user": {
			const lines = b.s.split("\n").flatMap((part) => (part ? wrap(L(part), inner) : [[]])).map((l) => pad(withClass(l, "U"), "U"));
			for (const a of b.attached || []) lines.push(pad(L(`⟦d.U|attached: ${a}⟧`), "U"));
			return lines;
		}
		case "tool": {
			const mark = b.state === "ok" ? "⟦g|✓⟧" : "⟦am|●⟧";
			return wrap(L(`${mark} ⟦b|${b.name}⟧${b.subj ? ` ⟦d|${b.subj}⟧` : ""}${b.state === "ok" && b.ms ? ` ⟦d|${b.ms}⟧` : ""}`), inner).map((l) => pad(l));
		}
		case "md": {
			// Streamed: only the first `shown` characters of all its segments are there yet.
			let left = Math.ceil(b.total * b.p);
			const lines = [];
			for (const seg of b.segs) {
				if (left <= 0) break;
				if (seg.gap) { lines.push(sp(w)); continue; }
				const cells = seg.cells.slice(0, left);
				left -= seg.cells.length;
				if (seg.pre) lines.push(pad(cells));
				else lines.push(...wrap(cells, inner, seg.hang || 0).map((l) => pad(l)));
			}
			return lines.length ? lines : [sp(w)];
		}
		case "pre":
			return b.lines.map((s) => pad(L(s)));
		case "img":
		case "vid": {
			const lines = [];
			if (b.alt) lines.push(pad(L(b.alt)));
			lines.push(Object.assign(sp(w), { img: b }));
			for (let i = 1; i < b.rows; i++) lines.push(sp(w));
			lines.push(pad(L(typeof b.cap === "function" ? b.cap(t - b.t0) : b.cap)));
			return lines;
		}
		case "fold": {
			// What pine draws for <details> in an answer: one line while it is folded, the text set in under it once a click
			// has opened it. The arrow and the hint are grey, the summary is the answer's own text.
			const head = pad(L(b.open ? `⟦d|▾⟧ ${b.summary} ⟦d|· click here to close⟧` : `⟦d|▸⟧ ${b.summary} ⟦d|· click to open⟧`));
			return b.open ? [head, ...b.body.flatMap((x) => wrap(L(x), inner - 2).map((l) => pad([...sp(2), ...l])))] : [head];
		}
		case "event":
			return [pad(L(`⟦am|⚡⟧ ⟦b|${b.label}⟧`)), ...wrap(L(`⟦d|${b.s}⟧`), inner - 2).map((l) => pad([...sp(2), ...l]))];
	}
	return [];
}

function docLines(tab, w, t) {
	const lines = [];
	tab.doc.forEach((b, i) => {
		if (i && b.gap !== false) lines.push(sp(w));
		lines.push(...blockLines(b, w, t));
	});
	return lines;
}

function boxed(lines, w, c = "d") {
	const inner = w - 4;
	return [L(`⟦${c}|╭${"─".repeat(w - 2)}╮⟧`), ...lines.map((l) => [...L(`⟦${c}|│⟧ `), ...fit(l, inner), ...L(` ⟦${c}|│⟧`)]), L(`⟦${c}|╰${"─".repeat(w - 2)}╯⟧`)];
}

function overlayLines(o) {
	if (o.k === "pick") {
		const w = 64, col = Math.max(...o.items.map((x) => x.label.length)) + 2;
		const rows = o.items.map((x, i) => (i === o.sel ? L(`⟦a|→ ⟧⟦b.a|${x.label.padEnd(col)}⟧⟦b.a|${x.desc || ""}⟧`) : L(`  ${x.label.padEnd(col)}⟦d|${x.desc || ""}⟧`)));
		return { w, lines: boxed([L(`⟦b|${o.title}⟧`), L("⟦a|>⟧ ⟦d|type to search · enter picks · esc closes⟧"), ...rows], w) };
	}
	if (o.k === "convs") {
		const w = 78, inner = w - 4, name = Math.max(10, ...o.items.map((x) => x.session.length)) + 1;
		const rows = [L("  + new conversation")];
		o.items.forEach((x, i) => {
			const left = L(`${x.pinned ? "⟦a|★⟧" : " "} ${i === o.sel ? `⟦a|${x.session.padEnd(name)}⟧` : x.session.padEnd(name)} ⟦d|${x.info}⟧`);
			const right = x.main ? [] : L(`⟦a|${x.pinned ? "unpin" : "pin"}⟧   ⟦d|×⟧`);
			rows.push([...fit(left, inner - right.length - 2), ...sp(2), ...right]);
		});
		return { w, lines: boxed([L(`⟦b|${o.title}⟧`), L("⟦a|>⟧ ⟦d|type to search · enter opens · ctrl+p pins · ctrl+x removes · esc closes⟧"), ...rows, L("⟦d|pin keeps a conversation for good · × removes it now⟧")], w) };
	}
	if (o.k === "ask") {
		// What pine shows when an agent asks: the question, the answers it offers with the one it recommends first, a line for the owner's own words.
		const w = 80, inner = w - 4;
		const rows = o.choices.map((x, i) => (i === o.sel ? L(`⟦A| ${i + 1}  ${x} ⟧`) : L(` ${i + 1}  ${x}`)));
		return { w, lines: boxed([L(`⟦b.a|${o.agent} asks⟧`), [], ...o.question.flatMap((q) => wrap(L(q), inner)), [], ...rows, [], L("⟦d|or in your own words:⟧ ⟦A| ⟧"), [], L("⟦d|enter or a click answers · 1-9 picks by number · esc: later⟧")], w, "a") };
	}
	if (o.k === "approve") {
		const w = 76, inner = w - 4;
		const indented = (str) => wrap(L(str), inner - 2).map((l) => [...sp(2), ...l]);
		// A request that needs something only the owner has: a field for it, dots for a secret.
		// Each value is a block of its own, as in pine: its name, what it is, a bar to type into, an empty line before it.
		const n = (o.fields || []).length;
		const fields = (o.fields || []).flatMap((f, i) => {
			const on = i === (o.on || 0);
			const [, name, about] = f.label.match(/^([\w.-]+): ([\s\S]+)$/) || [null, f.label, ""];
			const count = n > 1 ? L(`⟦d|${i + 1} of ${n}⟧`) : [];
			const shown = f.secret === false ? f.value : "•".repeat(f.value.length);
			const typed = shown || on ? [...(shown ? L(`⟦y.P|${shown}⟧`) : []), ...(on ? L("⟦A| ⟧") : [])] : L("⟦d.P|empty⟧");
			return [[], [...fit(L(on ? `⟦b.a|${name}⟧` : `⟦b|${name}⟧`), inner - count.length), ...count], ...(about ? wrap(L(about), inner) : []), [...(on ? L("⟦a|>⟧ ") : sp(2)), ...fit(typed, inner - 2, "P")]];
		});
		const secret = (o.fields || []).some((f) => f.secret !== false);
		const hint = !o.fields ? [] : wrap(L(`⟦d|${!secret ? "Type it here and press enter. Without it, this cannot be allowed." : n > 1 ? "Type or paste each one into its bar; tab goes to the next. They are not shown, go into pine's .env file, and never reach the agent or its model." : "Type or paste it here. It is not shown, goes into pine's .env file, and never reaches the agent or its model."}⟧`), inner);
		const body = [
			L(`⟦b.am|${o.fields ? "Approval needed, and something only you have" : "Approval needed"}⟧`), [],
			L(`⟦d|agent ⟧ ${o.agent}${o.task ? ` ⟦d|(task #${o.task})⟧` : ""}`), L(`⟦d|action⟧ ⟦b|${o.tool}⟧`), ...o.summary.flatMap(indented), [],
			...wrap(L(`⟦d|Why you are asked: ${o.why}⟧`), inner),
			...(fields.length ? [...fields, [], ...hint] : []), [],
			L(o.fields ? "⟦A| Save and allow (enter) ⟧   Deny    Later (esc)   " : "⟦A| Allow once (a) ⟧   Deny (d)    Later (esc)   "),
		];
		return { w, lines: boxed(body, w, "am") };
	}
	return { w: 0, lines: [] };
}

function paneLines(st, w, h) {
	const p = st.pane, data = PANE;
	const tabs = ["changes", "files", "output"].map((v) => (p.view === v ? `⟦A| ${v[0].toUpperCase()}${v.slice(1)} ⟧` : `⟦d| ${v[0].toUpperCase()}${v.slice(1)} ⟧`)).join(" ");
	const head = L(` ${tabs}`);
	const right = L("⟦d| ↻  × ⟧");
	const lines = [[...fit(head, w - right.length), ...right], fit(L(` ⟦d|${(data.info || {})[p.view] || ""}⟧`), w), rule(w)];
	// `shown`: only so many of its lines are there yet (a file that is being written).
	const body = (data[`${p.view}${p.sub ? `:${p.sub}` : ""}`] || []).slice(0, p.shown ?? 1e9).map((s) => fit([...sp(1), ...L(s)], w));
	return [...lines, ...body].slice(0, h).concat(Array.from({ length: Math.max(0, h - 3 - body.length) }, () => sp(w)));
}

function pineScreen(st) {
	const grid = [], images = [];
	const tab = st.tabs[st.active];
	// the tab bar
	let head = L("⟦b.a| pine ⟧");
	st.tabs.forEach((x, i) => {
		const on = i === st.active;
		const name = x.session === "main" ? x.agent : `${x.agent}·${x.session}`;
		head.push(...L(on ? `⟦A| ${i + 1} ${name} ×⟧` : `⟦d| ${i + 1} ${name} ×⟧`));
		head.push(...(x.running ? L(`⟦am|${SPIN[Math.floor(st.t * 9) % SPIN.length]}⟧ `) : x.unread && !on ? L("⟦a|•⟧ ") : sp(2)));
	});
	head.push(...L("⟦d| + ⟧"));
	const code = L(st.pane.open ? "⟦A| ▤ code ⟧" : "⟦d| ▤ code ⟧");
	grid.push([...fit(head, COLS - code.length), ...code], rule(COLS));
	// the dock: status, attachments, input, bar
	const dock = [];
	const helpers = tab.running ? `⟦am|${SPIN[Math.floor(st.t * 9) % SPIN.length]}⟧ ⟦d|working · ${Math.max(0, Math.floor(st.t - tab.startedAt))}s${tab.toolCalls ? ` · ${tab.toolCalls} tool call${tab.toolCalls === 1 ? "" : "s"}` : ""} · esc to stop⟧` : st.notice ? `⟦am|${st.notice}⟧` : "";
	dock.push(fit(L(` ${helpers}`), COLS));
	if (st.attach.length) dock.push(fit(L(`⟦d| attached: ⟧${st.attach.map((a) => `⟦b|${a.name}⟧ ⟦d|${a.size} × ⟧`).join(" ")}`), COLS));
	const typed = [];
	// What is typed may have lines of its own (a list); each is broken where the window ends.
	for (const part of st.input.split("\n")) for (let i = 0; i <= part.length; i += COLS - 3) typed.push(part.slice(i, i + COLS - 3));
	dock.push(rule(COLS));
	typed.forEach((s, i) => dock.push(fit(L(` ${s}${i === typed.length - 1 ? "█" : ""}`), COLS)));
	dock.push(rule(COLS));
	const bar = L(` ⟦b|${tab.agent}⟧⟦d| · ${tab.session} · ⟧${tab.folder ? `⟦c|${tab.folder}⟧` : "⟦d|no folder⟧"}⟦d| · ${st.model || "dev/claude-haiku"} · reasoning off · auto${tab.context ? ` · context ${tab.context}%` : ""}⟧${tab.outside ? "⟦y| · outside content⟧" : ""}`);
	dock.push(bar.length > COLS - 7 ? fit(bar, COLS) : [...fit(bar, COLS - 6), ...L("⟦d|/help ⟧")]);
	// the conversation, and the pane beside it
	const h = ROWS - 2 - dock.length;
	const w = st.pane.open ? 49 : COLS;
	const all = docLines(tab, w, st.t);
	const start = Math.max(0, all.length - h);
	all.forEach((line, i) => { if (line.img) images.push({ b: line.img, row: i - start }); });
	const shown = all.slice(start);
	const pane = st.pane.open ? paneLines(st, COLS - 50, h) : null;
	for (let r = 0; r < h; r++) {
		const left = shown[r] || sp(w);
		grid.push(pane ? [...fit(left, 49), ...L("⟦d|│⟧"), ...pane[r]] : left);
	}
	grid.push(...dock);
	if (st.overlay) {
		const o = overlayLines(st.overlay);
		const col = Math.floor((COLS - o.w) / 2), row = Math.max(2, Math.floor((ROWS - o.lines.length) / 2));
		o.lines.forEach((l, i) => grid[row + i].splice(col, o.w, ...fit(l, o.w)));
		// What the box covers is not drawn as a picture where it lies across it.
		st.overlayBox = { col, row, w: o.w, h: o.lines.length };
	}
	return { grid, images, bodyTop: 2, bodyRows: h, bodyCols: w };
}

function shellScreen(st) {
	const grid = [sp(COLS)];
	for (const s of st.shell.lines) for (let cells = L(s); cells.length || !grid.done; cells = cells.slice(COLS - 2)) {
		grid.push(fit([...sp(1), ...cells.slice(0, COLS - 2)], COLS));
		if (cells.length <= COLS - 2) break;
	}
	if (!st.shell.busy) grid.push(fit(L(` ${st.shell.prompt} ⟦a|❯⟧ ${st.shell.typed}█`), COLS));
	while (grid.length < ROWS) grid.push(sp(COLS));
	return { grid: grid.slice(-ROWS), images: [], bodyTop: 0, bodyRows: ROWS, bodyCols: COLS };
}

const screenOf = (st) => (st.mode === "pine" ? pineScreen(st) : shellScreen(st));

/** Where a piece of text is on screen at time t, as a point in the window: its middle. */
function find(needle, opts = {}) {
	const scr = screenOf(stateAt(opts.t ?? T));
	const hits = [];
	scr.grid.forEach((cells, row) => {
		const line = text(cells);
		for (let col = line.indexOf(needle); col >= 0; col = line.indexOf(needle, col + 1)) if (col >= (opts.minCol || 0)) hits.push({ row, col });
	});
	const hit = hits[(opts.nth ?? 1) - 1] ?? hits[hits.length - 1];
	if (!hit) throw new Error(`"${needle}" is not on screen at ${(opts.t ?? T).toFixed(2)}s`);
	return { x: ORIGIN.x + (hit.col + needle.length / 2) * CW + (opts.dx || 0), y: ORIGIN.y + (hit.row + 0.5) * RH + (opts.dy || 0) };
}

// ---- pointer and camera --------------------------------------------------------------------------

const keys = [], clicks = [], seen = [], captions = [], cam = [], MARKS = [], SFX = [];
/** A dice that falls the same way at every render, so that the typing sounds the same each time. */
let seed = 11;
const dice = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
/**
 * The sound of `s` being typed from now on, `cps` characters a second. The text may appear faster
 * than anyone types; the keys are heard at the pace of a hand, about ten a second and never
 * evenly. One sound per character at thirty a second is not typing but a purr.
 */
function keySounds(s, cps, kind = "key") {
	const dur = (s.length / cps) * PACE;
	for (let t = 0.02 + dice() * 0.03; t < dur || t < 0.06; ) {
		const ch = s[Math.min(s.length - 1, Math.floor((t / dur) * s.length))];
		SFX.push({ t: T + t, k: ch === " " ? `${kind}-space` : kind });
		// Mostly quick, now and then the short stop of a finger looking for its key.
		t += Math.max(1 / cps, dice() < 0.12 ? 0.17 + dice() * 0.08 : 0.068 + dice() * 0.07);
	}
}
const sound = (k, dt = 0) => SFX.push({ t: T + dt * PACE, k });
const mark = (name) => MARKS.push([T, name]);
const pointerAt = (t) => {
	if (!keys.length) return { x: 960, y: 540 };
	if (t <= keys[0].t) return keys[0];
	for (let i = 1; i < keys.length; i++) {
		if (t <= keys[i].t) {
			const a = keys[i - 1], b = keys[i], p = ease(clamp((t - b.t0) / Math.max(0.001, b.t - b.t0)));
			// A slight arc, as a hand moves.
			const bow = Math.sin(p * Math.PI) * Math.min(26, Math.hypot(b.x - a.x, b.y - a.y) * 0.06);
			return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) - bow };
		}
	}
	return keys[keys.length - 1];
};
const envelope = (t, list, ramp) => list.reduce((v, s) => Math.max(v, Math.min(clamp((t - s.from) / ramp), clamp((s.to - t) / ramp))), 0);
function pointerShow(p) { keys.push({ t: T, t0: T, x: p.x, y: p.y }); seen.push({ from: T, to: 1e9 }); }
function pointerHide() { seen[seen.length - 1].to = T; }
function moveTo(p, dur = 0.5) { dur *= PACE; keys.push({ t0: T, t: T + dur, x: p.x, y: p.y }); T += dur; }
function click(effect, pause = 0.12) { clicks.push(T); sound("click"); wait(pause); if (effect) inst(effect); }
function caption(s, dur) { captions.push({ from: T, to: T + dur * PACE, s }); }
/**
 * The camera: from now on it moves to look at (x, y) with this zoom, taking `dur` seconds. The
 * point is kept inside the picture: the camera never shows what lies beyond the stage.
 */
function shot(x, y, z = 1, dur = 0.9) {
	cam.push({ t: T, dur: Math.max(0.01, dur * PACE), z, x: clamp(x, 960 / z, 1920 - 960 / z), y: clamp(y, 540 / z, 1080 - 540 / z) });
}
/** Look at a point so that it lies at (ax, ay) of the picture, 0..1 each; the middle by default. */
function focus(p, z, dur = 0.9, ax = 0.5, ay = 0.5) { shot(p.x - (ax - 0.5) * 1920 / z, p.y - (ay - 0.5) * 1080 / z, z, dur); }
function cameraAt(t) {
	const step = (from, k, time) => { const p = ease(clamp((time - k.t) / k.dur)); return { x: lerp(from.x, k.x, p), y: lerp(from.y, k.y, p), z: lerp(from.z, k.z, p) }; };
	let from = { x: 960, y: 540, z: 1 }, v = from;
	for (let i = 0; i < cam.length && cam[i].t <= t; i++) {
		// Each move starts from wherever the camera was when it began.
		if (i) from = step(from, cam[i - 1], cam[i].t);
		v = step(from, cam[i], t);
	}
	return v;
}

// ---- the desktop app -----------------------------------------------------------------------------

/** Where the app's window lies on the stage, and how much larger than it was when its pictures were taken. */
const APP = { x: 193, y: 36, s: 1.3 };
/** A point of the app's window on the stage, given as it was in the window. */
const inApp = (x, y) => ({ x: APP.x + x * APP.s, y: APP.y + y * APP.s });
/** Where something in the app's window is on the stage; the places come with the pictures (assets/<story>/shots.js). */
const appPoint = (name) => inApp(SHOTS.boxes[name].x, SHOTS.boxes[name].y);

// ---- drawing -------------------------------------------------------------------------------------

/** How far to the right the second desk lies (somebody else's computer); the camera slides there and back. */
const ROOM_DX = 2720;
/** One message of the team chat on the second desk: who, when, what, a file, and how many answers it has. */
function chatRow(m) {
	const a = ease(clamp(m.p ?? 1));
	const style = `opacity:${a};transform:translateY(${(1 - a) * 14}px)`;
	if (m.day) return `<div class="day" style="${style}"><span>${m.day}</span></div>`;
	if (m.count) return `<div class="cnt" style="${style}">${m.count}</div>`;
	const file = m.link ? `<div class="file link"><i></i><b>${m.link}</b><span>${m.linkTitle}</span></div>` : m.file ? `<div class="file"><i></i>${m.file}<span>${m.fileKind || "Spreadsheet"}</span></div>` : "";
	const rep = m.replies ? `<div class="rep"><s style="background:${m.replyColor || "#2f7d6b"}"></s>${m.replies}<em>${m.replied || ""}</em></div>` : "";
	return `<div class="row" style="${style}"><span class="av" style="background:${m.color}">${m.name[0]}</span><b>${m.name}</b><small>${m.time}</small><p>${m.html}</p>${file}${rep}</div>`;
}
/** The agent's browser on a pull request: its changes, the box in which a review is written, and the page after the review. */
function webHTML(w) {
	const tabs = (on) => `<div class="g-tabs">${[["Conversation", w.comments + (w.approved ? 1 : 0)], ["Commits", w.commits], ["Checks", w.checks], ["Files changed", w.files.length]].map(([n, c]) => `<u class="${n === on ? "on" : ""}">${n}<i>${c}</i></u>`).join("")}${on === "Files changed" ? `<span class="g-btn${w.pressed === "review" ? " dn" : ""}">Review changes ▾</span>` : ""}</div>`;
	const head = `<div class="g-top">${w.repo.split("/").join("<span>/</span>")}</div><div class="g-title">${w.title} <span>#${w.number}</span></div><div class="g-meta"><span class="pill">Open</span><b>${w.author}</b> wants to merge ${w.commits} commits into <code>main</code> from <code>${w.branch}</code></div>`;
	let body;
	if (w.tab === "files") {
		body = tabs("Files changed") + w.files.map((f, i) => {
			let a = f.from || 1;
			const lines = f.lines.map(([k, s]) => `<div class="dl ${k === "+" ? "add" : k === "-" ? "del" : ""}"><n>${k === "-" ? "&nbsp;" : a++}</n>${k} ${escape(s)}</div>`).join("");
			return `<div class="g-file"><div class="fh">${f.path}<em>+${f.add}</em>${f.del ? `<em>−${f.del}</em>` : ""}<span class="seen${i < (w.seen || 0) ? " on" : ""}">${i < (w.seen || 0) ? "✓ Viewed" : "Viewed"}</span></div>${lines}</div>`;
		}).join("");
	} else {
		body = tabs("Conversation") + `<div class="g-ev"><span class="av" style="background:${w.me.color}">${w.me.name[0]}</span><div class="hd"><span class="ok">✓</span><b>${w.me.login}</b> approved these changes · now</div><div class="bd">${escape(w.review.text)}</div></div><div class="g-merge"><p><b>✓ Changes approved</b><span>1 approving review by a reviewer with write access</span></p><p><b>✓ All checks have passed</b><span>${w.checks} successful checks</span></p><p><span class="mb">Merge pull request</span></p></div>`;
	}
	const r = w.review;
	const review = r && w.tab === "files" && r.open ? `<div class="rv" style="opacity:${ease(clamp(r.open))}"><h4>Finish your review</h4><div class="ta${r.typing ? " on" : ""}">${escape(r.text.slice(0, r.typed))}${r.typing ? '<i class="ct"></i>' : ""}</div>${[["Comment", "Submit general feedback without explicit approval."], ["Approve", "Submit feedback and approve merging these changes."], ["Request changes", "Submit feedback that must be addressed before merging."]].map(([n, d]) => `<p class="${r.pick === n ? "on" : ""}"><s></s>${n}<small>${d}</small></p>`).join("")}<span class="sub${w.pressed === "submit" ? " dn" : ""}">Submit review</span></div>` : "";
	// Further down the page its title and the button for a review stay in sight, as on the real page.
	const stick = w.tab === "files" && (w.scroll || 0) > 150 ? `<div class="g-stick"><span class="pill">Open</span>${w.title} <span>#${w.number}</span><span class="g-btn${w.pressed === "review" ? " dn" : ""}">Review changes ▾</span></div>` : "";
	const ping = w.ping && w.ping.p < 1 ? `<div class="ping" style="left:${w.ping.x}px;top:${w.ping.y}px;opacity:${1 - w.ping.p};transform:scale(${0.3 + 0.9 * ease(w.ping.p)})"></div>` : "";
	// The agent's own pointer, with its name beside it: whoever watches sees that it is the agent that moves here, not the owner.
	const ptr = w.ptr ? `<div class="agent" style="left:${w.ptr.x}px;top:${w.ptr.y}px;opacity:${w.ptr.o ?? 1}"><svg viewBox="0 0 34 34"><path d="M5 3 L5 26.5 L11.2 21 L15.3 30.6 L19.3 28.9 L15.2 19.5 L23.6 19.5 Z"/></svg><span>agent</span></div>` : "";
	return `<div class="wb-tabs"><div class="lights"><b></b><b></b><b></b></div><div class="tab">${w.title} · Pull Request #${w.number}</div></div><div class="wb-bar"><span class="nav">‹›↻</span><div class="url">${w.host}<em>/${w.repo}/pull/${w.number}${w.tab === "files" ? "/files" : ""}</em></div></div><div class="wb-info">Chrome is being controlled by automated test software.</div><div class="pg"><div class="in" style="transform:translateY(${-(w.scroll || 0)}px)">${head}${body}</div>${stick}${review}</div>${ping}${ptr}`;
}
function chatHTML(c, t) {
	const box = (text, hint) => `<div class="comp"><div class="tb">BIS</div><div class="tx${text ? "" : " ph"}">${text ? `${escape(text)}<i class="ct"></i>` : hint}</div><span class="ic">+Aa</span><span class="snd${text ? " on" : ""}"></span></div>`;
	const people = c.people.map((x) => `<p class="${x.name === c.with.name ? "on" : ""}"><s style="background:${x.color}"></s>${x.name}${x.you ? "  you" : ""}</p>`).join("");
	const thread = c.thread ? `<div class="ct-thr"><div class="th">Thread<small>${c.with.name}</small><em>×</em></div><div class="tl">${c.thread.msgs.map(chatRow).join("")}</div>${box(c.thread.input, "Reply…")}</div>` : "";
	return `<div class="ct-top"><div class="lights"><b></b><b></b><b></b></div><div class="srch">Search ${c.ws}</div></div>
<div class="ct-rail"><b>${c.ws[0]}</b><i class="on"></i><span>Home</span><i></i><span>DMs</span><i></i><span>Activity</span></div>
<div class="ct-side"><h5>${c.ws}</h5><p><u>≡</u>Threads</p><p><u>➤</u>Drafts &amp; sent</p><h6>Channels</h6>${c.channels.map((n) => `<p><u>#</u>${n}</p>`).join("")}<h6>Direct messages</h6>${people}</div>
<div class="ct-main"><div class="ct-head"><s style="background:${c.with.color}"></s>${c.with.name}</div><div class="ct-tabs"><u class="on">Messages</u><u>Files</u><u>+</u></div><div class="ct-list"><div class="in">${c.msgs.map(chatRow).join("")}</div></div>${box(c.input, `Message ${c.with.name}`)}</div>${thread}`;
}

/** The frame of a clip that is due at time t: its frames are assets/<src>/001.jpg on, `fps` a second of the finished film; it plays once and holds, or again and again with `loop`. */
function frameOf(c, t) {
	const s = Math.max(0, t - c.t0) / SPEED;
	const i = Math.floor(s * c.fps);
	const n = (c.loop ? i % c.frames : Math.min(i, c.frames - 1)) + 1;
	return `assets/${c.src}/${String(n).padStart(3, "0")}.jpg`;
}

let SPEED = 1;
function renderAt(seconds) {
	const t = seconds * SPEED;
	const st = stateAt(t);
	const scr = screenOf(st);
	$("title").textContent = st.title;
	$("term").innerHTML = scr.grid.map((cells, r) => `<div class="r" style="top:${r * RH}px">${rowHTML(cells)}</div>`).join("");
	const imgs = $("imgs");
	imgs.style.top = `${50 + scr.bodyTop * RH}px`;
	imgs.style.width = `${scr.bodyCols * CW}px`;
	imgs.style.height = `${scr.bodyRows * RH}px`;
	const box = st.mode === "pine" && st.overlay ? st.overlayBox : null;
	imgs.innerHTML = scr.images.map(({ b, row }) => {
		const top = row * RH, wpx = b.cols * CW, hpx = b.rows * RH;
		// A menu over a picture: the part under it is cut away, the menu's cells are drawn in the grid.
		const clip = box ? `clip-path: polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${(box.col * CW)}px ${((box.row - scr.bodyTop) * RH - top)}px, ${(box.col * CW)}px ${((box.row + box.h - scr.bodyTop) * RH - top)}px, ${((box.col + box.w) * CW)}px ${((box.row + box.h - scr.bodyTop) * RH - top)}px, ${((box.col + box.w) * CW)}px ${((box.row - scr.bodyTop) * RH - top)}px, ${(box.col * CW)}px ${((box.row - scr.bodyTop) * RH - top)}px);` : "";
		if (b.k === "vid") {
			const n = Math.floor(Math.max(0, t - b.t0) * 10) % b.frames;
			const side = hpx;
			return `<div style="left:0;top:${top}px;width:${wpx}px;height:${hpx}px;background:#000;${clip}"><img src="assets/${b.src}-${String(n).padStart(2, "0")}.jpg" style="left:${(wpx - side) / 2}px;top:0;width:${side}px;height:${side}px"></div>`;
		}
		// Several pictures in one block (the pages of a document) stand side by side, two cells apart.
		return (b.srcs || [b.src]).map((src, i) => `<img src="assets/${src}" style="left:${i * (wpx + 2 * CW)}px;top:${top}px;width:${wpx}px;height:${hpx}px;${clip}">`).join("");
	}).join("");

	// window: dimmed and moved aside when something else is in front
	const win = $("win");
	win.style.left = `${WIN.x + st.winShift}px`;
	win.style.top = `${WIN.y}px`;
	win.style.width = `${WIN.w}px`;
	win.style.height = `${WIN.h}px`;
	win.style.filter = st.winDim ? `brightness(${1 - 0.45 * st.winDim})` : "";
	win.style.transformOrigin = "0 50%";
	win.style.transform = st.winScale ? `scale(${1 - st.winScale})` : "";
	win.style.display = st.app.only ? "none" : "";

	// the desktop app: one picture of the real one at a time, in the terminal's place or over it
	const ap = $("app");
	ap.style.display = st.app.show > 0.001 ? "block" : "none";
	if (st.app.show > 0.001) {
		const p = ease(st.app.show);
		ap.style.left = `${APP.x + st.winShift}px`;
		ap.style.top = `${APP.y}px`;
		ap.style.width = `${SHOTS.size.w * APP.s}px`;
		ap.style.height = `${SHOTS.size.h * APP.s}px`;
		ap.style.opacity = p;
		ap.style.filter = st.winDim ? `brightness(${1 - 0.45 * st.winDim})` : "";
		ap.style.transformOrigin = st.app.show < 1 ? "50% 60%" : "0 50%";
		ap.style.transform = `translate(0, ${(1 - p) * 70}px) scale(${(0.95 + 0.05 * p) * (1 - (st.winScale || 0))})`;
		const src = `assets/${st.app.dir}/${st.app.shot}`;
		if (ap.firstChild.dataset.src !== src) ap.firstChild.src = ap.firstChild.dataset.src = src;
	}

	// the editor
	const vs = $("vs");
	vs.style.display = st.vs.show > 0.001 ? "block" : "none";
	if (st.vs.show > 0.001) {
		const p = ease(st.vs.show);
		vs.style.opacity = p;
		vs.style.transform = `translate(${(1 - p) * 60}px, ${(1 - p) * 90}px) scale(${0.94 + 0.06 * p})`;
		const add = VS.add.slice(0, st.vs.typed);
		$("vsed").innerHTML = VS.lines.map((s, i) => `<div class="${i === 2 ? "cur" : ""} ${i === 2 && st.vs.typed ? "chg" : ""}"><n>${i + 1}</n>${s}${i === 2 ? `${escape(add)}${Math.floor(t * 2.2) % 2 || st.vs.typing ? '<span class="caret"></span>' : ""}` : ""}</div>`).join("");
		$("vsdot").textContent = st.vs.dirty ? "●" : "×";
		$("vsfile").className = st.vs.typed ? "sel mod" : "sel";
		$("vsfile").lastChild.textContent = st.vs.typed && !st.vs.dirty ? "M" : st.vs.typed ? "M" : "";
		$("vscol").textContent = 57 + add.length;
	}

	// the phone
	const ph = $("phone");
	ph.style.display = st.phone.show > 0.001 ? "block" : "none";
	if (st.phone.show > 0.001) {
		const p = ease(st.phone.show);
		ph.style.transform = `translate(${(1 - p) * 520}px, ${(1 - p) * 30}px) rotate(${(1 - p) * 4}deg)`;
		ph.className = st.phone.theme || "";
		// A team chat instead of a messenger: each message a row with who wrote it and when, days set apart, files as chips.
		if (st.phone.theme === "team") $("msgs").innerHTML = st.phone.msgs.map((m) => {
			const a = ease(clamp(m.p * 1.0));
			const style = `opacity:${a};transform:translateY(${(1 - a) * 18}px)`;
			if (m.day) return `<div class="tday" style="${style}"><span>${m.day}</span></div>`;
			if (m.typing) return `<div class="ttyp" style="${style}"><b>${m.who}</b> is typing…</div>`;
			return `<div class="trow${m.fresh ? " new" : ""}" style="${style}"><span class="tav" style="background:${m.color || "#4a6fa5"}">${m.name[0]}</span><b>${m.name}</b><small>${m.time}</small><p>${m.html}</p>${m.file ? `<div class="tfile"><i></i>${m.file}</div>` : ""}${m.replies ? `<div class="trep">${m.replies}</div>` : ""}</div>`;
		}).join("");
		else $("msgs").innerHTML = st.phone.msgs.map((m) => {
			const a = ease(clamp(m.p * 1.0));
			const style = `opacity:${a};transform:translateY(${(1 - a) * 22}px) scale(${0.96 + 0.04 * a});transform-origin:${m.me ? "100% 100%" : "0 100%"}`;
			if (m.typing) return `<div class="msg in ty" style="${style}">•••</div>`;
			// A picture or a clip sent along: a clip is drawn as the frame that is due (frameOf), with a mark that it plays.
			const pic = m.clip ? `<div class="pic vid"><img src="${frameOf(m.clip, t)}"></div>` : m.img ? `<div class="pic"><img src="assets/${m.img}"></div>` : "";
			return `<div class="msg ${m.me ? "out" : "in"}${pic ? " media" : ""}" style="${style}">${pic}${m.html}<small>${m.time}${m.me ? " ✓✓" : ""}</small></div>`;
		}).join("");
		$("phin").textContent = st.phone.input || st.phone.placeholder || "Message";
		$("phsub").textContent = st.phone.sub ?? "bot";
		$("phin").className = st.phone.input ? "has" : "";
		$("phtime").textContent = st.phone.clock || "17:42";
		$("phname").textContent = st.phone.name || "pine";
		// The bot's picture when it has one (assets/<avatar>), else the first letter of its name.
		if (st.phone.avatar) $("phav").innerHTML = `<img src="assets/${st.phone.avatar}" alt="">`;
		else $("phav").textContent = (st.phone.initial || st.phone.name || "pine")[0].toUpperCase();
		// Another app on the same phone: a settings page with fields that are filled in (a camera's upload settings).
		const app = $("phapp"), ap = st.phone.app;
		app.style.display = ap && ap.show > 0.001 ? "block" : "none";
		if (ap && ap.show > 0.001) {
			app.style.opacity = ease(ap.show);
			app.innerHTML = `<div class="at"><span class="bk">‹</span>${ap.title}</div><h6>${ap.section}</h6><div class="grp">${ap.fields.map((f) => `<p><span>${f.label}</span><b class="${f.on ? "on" : ""}">${f.secret ? "•".repeat(f.value.length) : escape(f.value)}${f.on ? '<i class="ct"></i>' : ""}</b></p>`).join("")}</div><div class="btn${ap.pressed ? " dn" : ""}">${ap.button}</div>${ap.result ? `<div class="res" style="opacity:${ease(clamp(ap.result))}">${ap.resultText}</div>` : ""}`;
		}
	}

	// Finder, and Quick Look over it
	const fd = $("finder"), fs = st.finder;
	fd.style.display = fs.show > 0.001 ? "block" : "none";
	if (fs.show > 0.001) {
		const p = ease(fs.show);
		fd.style.opacity = p;
		fd.style.transform = `translate(${(1 - p) * 40}px, ${(1 - p) * 70}px) scale(${0.95 + 0.05 * p})`;
		$("frows").innerHTML = fs.rows.map((r, i) => `<div class="fr${i === fs.sel ? " sel" : ""}" style="top:${86 + i * 30}px"><span style="left:8px"><i class="ic${r.dir ? " dir" : ""}"></i>${r.name}</span><span class="c2">${r.date}</span><span class="c3">${r.size}</span><span class="c4">${r.kind}</span></div>`).join("");
	}
	const ql = $("ql");
	ql.style.display = fs.ql > 0.001 ? "block" : "none";
	if (fs.ql > 0.001) {
		const p = ease(fs.ql);
		ql.style.opacity = p;
		ql.style.transform = `scale(${0.6 + 0.4 * p})`;
		$("qltext").innerHTML = fs.text;
		$("qltitle").textContent = fs.qlTitle || "TODO.md";
	}

	// what a camera sees: clips in small monitor windows on the desk, each a run of frames in assets/<src>/
	$("cams").innerHTML = (st.cams || []).filter((c) => c.show > 0.001).map((c) => {
		const p = ease(c.show);
		return `<div class="cam${c.night ? " ir" : ""}" style="left:${c.x}px;top:${c.y}px;width:${c.w}px;opacity:${p};transform:scale(${0.92 + 0.08 * p})"><img src="${frameOf(c, t)}"><span class="rec"></span></div>`;
	}).join("");

	// a clip filmed on a phone, cut in over the whole picture: its frames are pictures in assets/<src>/,
	// 001.jpg on, at `fps` frames a second of the finished film
	const clip = $("clip");
	const cs = st.clip;
	clip.style.display = cs && cs.show > 0.001 ? "block" : "none";
	if (cs && cs.show > 0.001) {
		clip.style.opacity = ease(cs.show);
		const s = Math.max(0, t - cs.t0) / SPEED;
		const n = Math.round(clamp(s * cs.fps, 0, cs.frames - 1)) + 1;
		clip.firstChild.src = `assets/${cs.src}/${String(n).padStart(3, "0")}.jpg`;
		clip.firstChild.style.transform = `scale(${1.0 + 0.04 * clamp(s / (cs.frames / cs.fps))})`;
	}

	// pointer, what it drags, the ring of a click
	const vis = envelope(t, seen, 0.18);
	const pt = pointerAt(t);
	const cur = $("cursor");
	cur.style.opacity = vis;
	const sinceClick = Math.min(...clicks.map((c) => (t >= c ? t - c : 9)), 9);
	const press = sinceClick < 0.16 ? 1 - 0.14 * Math.sin((sinceClick / 0.16) * Math.PI) : 1;
	cur.style.transform = `translate(${pt.x - 5}px, ${pt.y - 3}px) scale(${press})`;
	const ring = $("ring");
	ring.style.opacity = sinceClick < 0.42 ? (1 - sinceClick / 0.42) * 0.9 : 0;
	ring.style.transform = `translate(${pt.x}px, ${pt.y}px) scale(${0.25 + 0.9 * ease(clamp(sinceClick / 0.42))})`;
	const drag = $("drag");
	drag.style.display = st.drag ? "block" : "none";
	if (st.drag) {
		const a = st.drag.p ?? 1;
		drag.style.opacity = a;
		drag.style.transform = `translate(${pt.x - 60}px, ${pt.y - 46}px) scale(${(0.55 + 0.45 * a) * 1.45}) rotate(-4deg)`;
		drag.innerHTML = `${st.drag.kind === "pdf" ? '<div class="doc"></div>' : `<div class="thumb" style="background-image:url(assets/${st.drag.src})"></div>`}<span class="name">${st.drag.name}</span>`;
	}

	// the second desk, and the team chat that is open on it
	const chat = $("chat");
	chat.style.display = st.chat ? "block" : "none";
	if (st.chat) {
		chat.className = st.chat.thread ? "thr" : "";
		chat.innerHTML = chatHTML(st.chat, t);
	}

	// the agent's browser, when it is a window on the owner's screen
	const web = $("web");
	web.style.display = st.web && st.web.show > 0.001 ? "block" : "none";
	if (st.web && st.web.show > 0.001) {
		const p = ease(st.web.show);
		web.style.opacity = p;
		web.style.transform = `translate(${(1 - p) * 70}px, ${(1 - p) * 60}px) scale(${0.95 + 0.05 * p})`;
		web.innerHTML = webHTML(st.web);
	}

	// the camera. Sliding over to the other desk it goes fast, and what goes fast is blurred the way it moves.
	const view = cameraAt(t);
	const world = $("world");
	world.style.transform = `translate(${960 - (view.x + st.room * ROOM_DX) * view.z}px, ${540 - view.y * view.z}px) scale(${view.z})`;
	const dt = 1 / 60;
	const speed = Math.abs(stateAt(t + dt).room - stateAt(Math.max(0, t - dt)).room) / (2 * dt) * ROOM_DX;
	const sigma = Math.min(90, speed * 0.008);
	$("mbg").setAttribute("stdDeviation", `${sigma.toFixed(1)} 0`);
	world.style.filter = sigma > 0.5 ? "url(#mb)" : "";

	const cap = captions.map((c) => ({ c, v: Math.min(clamp((t - c.from) / 0.35), clamp((c.to - t) / 0.35)) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)[0];
	$("caption").innerHTML = cap ? `<span>${escape(cap.c.s)}</span>` : "";
	$("caption").style.opacity = cap ? ease(cap.v) : 0;
	$("card").style.display = st.card > 0.001 ? "flex" : "none";
	$("card").style.opacity = st.card;
	$("cardtext").innerHTML = st.cardText;
	if (st.outroText) $("outro").lastElementChild.textContent = st.outroText;
	$("outro").style.opacity = ease(st.outro);
	$("outro").style.display = st.outro > 0.001 ? "flex" : "none";
	return st;
}
