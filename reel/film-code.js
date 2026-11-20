// A film about pine for code. It says that pine is not only events, automation and local models: you chat
// with it and write code with it, and it shows what pine adds for that.
//
// The look is that of the films in which an interface comes apart into layers: a white room in daylight,
// pine's own window in its light colours, and each part of it a sheet with a thickness that lifts off the
// one below, throws a soft shadow on it and leaves an outline where it lay. The camera is close and looks
// along the window at a low angle, so that what is not where it looks is out of focus.
// Drawn by film.js on film.html; nothing in it is recorded. Rendered with `node reel/render.mjs --film code`.
"use strict";

// ---- shared pieces ----------------------------------------------------------------------------------------


const LOGO = [[280, 0, 520, 240], [560, 240, 240, 280], [280, 560, 240, 240], [280, 280, 240, 240], [0, 280, 240, 240], [1080, 0, 240, 240], [1080, 280, 240, 240], [1080, 560, 240, 240], [1600, 0, 240, 240], [1600, 280, 240, 240], [1600, 560, 240, 240], [2160, 560, 240, 240], [1880, 0, 240, 240], [2120, 0, 40, 240], [2160, 0, 240, 240], [2160, 240, 240, 40], [2160, 280, 240, 240], [3240, 0, 240, 240], [2960, 280, 240, 240], [2680, 560, 240, 240], [2960, 560, 240, 240], [3240, 560, 240, 240], [2680, 0, 240, 240], [2920, 0, 40, 240], [2680, 240, 240, 40], [2960, 0, 240, 240], [2680, 280, 240, 240]];
const logoSvg = (cls, fill = "#1a1d1b") => `<svg class="${cls}" viewBox="0 0 3480 800">${LOGO.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`).join("")}</svg>`;
const SPIN = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
const spin = (T) => SPIN[Math.floor(T * 11) % SPIN.length];
/** The sign of a git branch, drawn: the type's own has none. */
const BR = '<svg class="br" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="4" cy="3.3" r="1.9"/><circle cx="4" cy="12.7" r="1.9"/><circle cx="12" cy="4.6" r="1.9"/><path d="M4 5.2v5.6M12 6.5c0 3.4-8 1.6-8 4.3"/></svg>';
/** The width of a text in a class's type, measured once in the page. */
const WIDTHS = new Map();
function measure(text, cls) {
	const key = `${cls}|${text}`;
	if (WIDTHS.has(key)) return WIDTHS.get(key);
	const el = document.createElement("span");
	el.className = cls;
	el.style.cssText = "position:absolute;visibility:hidden;white-space:pre;padding:0";
	el.textContent = text;
	document.getElementById("stage").appendChild(el);
	const w = el.offsetWidth;
	el.remove();
	WIDTHS.set(key, w);
	return w;
}
/** Code, coloured the way pine's light theme colours it. */
const hl = (s) => esc(s).replace(/"[^"]*"/g, (m) => `<i class="s">${m}</i>`).replace(/\b(export|function|return|const|import|from|type|if)\b/g, '<i class="k">$1</i>').replace(/\b([a-zA-Z]+)(?=\()/g, '<i class="f">$1</i>');
const box = (x, y, w, h) => `left:${f2(x)}px;top:${f2(y)}px;width:${f2(w)}px;height:${f2(h)}px;`;

// ---- sheets: what the interface is made of ------------------------------------------------------------------

/**
 * A sheet of the interface: at height z over the window's back, with a thickness, and when it is lifted
 * off what it lay on (`base`), a shadow there that grows softer and wanders the higher it is, and an
 * outline where it lay.
 */
function plate(x, y, w, h, z, inner = "", o = {}) {
	const r = typeof o.r === "string" ? o.r : `${o.r ?? 12}px`, base = o.base ?? z, lift = z - base, a = o.a ?? 1;
	if (a <= 0.003 || h < 0.5) return "";
	let html = "";
	if (lift > 1.5 && o.shadow !== false) {
		html += `<div style="${box(x, y, w, h)}border-radius:${r};background:rgba(var(--g-shadow),${f2(clamp(0.3 - lift * 0.0006, 0.1, 0.3) * a * (o.sa ?? 1))});filter:blur(${f2(2.5 + lift * 0.1)}px);transform:${T3(lift * 0.16, lift * 0.26, base + 0.5)}"></div>`;
		if (o.ghost !== false) html += `<div style="${box(x, y, w, h)}border-radius:${r};box-shadow:inset 0 0 0 1.5px rgba(var(--g-ghost),${f2(0.95 * seg(lift, 4, 40) * a)}),0 0 0 1px rgba(26,29,27,${f2(0.07 * seg(lift, 4, 40) * a)});transform:translateZ(${f2(base + 0.3)}px)"></div>`;
	}
	const th = o.th ?? 7;
	if (lift > 1.5 || o.thick) for (let i = th; i >= 1; i -= 2) html += `<div style="${box(x, y, w, h)}border-radius:${r};background:${o.side ?? "var(--c-edge)"};opacity:${f2(a)};transform:translateZ(${f2(z - i)}px)"></div>`;
	const edge = lift > 1.5 || o.thick ? "box-shadow:var(--sh-edge);" : o.line ? "box-shadow:var(--sh-line);" : "";
	return `${html}<div class="pl ${o.cls || ""}" style="${box(x, y, w, h)}border-radius:${r};background:${o.bg ?? "var(--c-surf)"};opacity:${f2(a)};${edge}transform:translateZ(${f2(z)}px);${o.style || ""}">${inner}</div>`;
}
/** Words or signs without a sheet of their own, at height z: lifted off `base` they throw their own shadow there. */
function ink(x, y, w, h, z, html, o = {}) {
	const base = o.base ?? z, lift = z - base, a = o.a ?? 1;
	if (a <= 0.003) return "";
	const sh = lift > 2 ? `<div class="${o.cls || ""}" style="${box(x, y, w, h)}filter:brightness(0) blur(${f2(1.6 + lift * 0.11)}px);opacity:${f2(clamp(0.24 - lift * 0.0008, 0.08, 0.24) * a)};transform:${T3(lift * 0.16, lift * 0.26, base + 0.4)};${o.style || ""}">${html}</div>` : "";
	return `${sh}<div class="${o.cls || ""}" style="${box(x, y, w, h)}opacity:${f2(a)};transform:translateZ(${f2(z)}px);${o.style || ""}">${html}</div>`;
}
/** A tool call in a conversation: running from a, done at b. */
function toolHTML(t, T, [name, subj, a, b, ms]) {
	const done = t >= b;
	return `${done ? '<i class="ok">✓</i>' : `<i class="run">${spin(T)}</i>`} <b>${name}</b> <em>${esc(subj)}${done && ms ? `  ${ms}` : ""}</em>`;
}
/** Where a pointer is at time t on its way through keys of [time it arrives, x, y]. */
function along(t, keys, mv = 0.55) {
	if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
	for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
		const a = keys[i - 1], b = keys[i], p = E.io(seg(t, Math.max(a[0], b[0] - mv), b[0]));
		const bow = Math.sin(p * Math.PI) * Math.min(30, Math.hypot(b[1] - a[1], b[2] - a[2]) * 0.07);
		return { x: lerp(a[1], b[1], p), y: lerp(a[2], b[2], p) - bow };
	}
	const l = keys[keys.length - 1];
	return { x: l[1], y: l[2] };
}
/** The pointer, floating at height z over the sheet under it (`base`) with its shadow there, and the ring of a click. */
function pointer(t, keys, clicks, { from, to, z = 60, base = 0 }) {
	const o = Math.min(seg(t, from, from + 0.2), seg(to - t, 0, 0.2));
	if (o <= 0) return "";
	const pt = along(t, keys), since = Math.min(...clicks.map((c) => (t >= c ? t - c : 9)), 9);
	const dip = since < 0.2 ? Math.sin((since / 0.2) * Math.PI) : 0, zz = z - dip * (z - base - 6), lift = zz - base;
	const arrow = (style) => `<svg class="cursor" viewBox="0 0 34 34" style="position:absolute;left:${f2(pt.x - 5)}px;top:${f2(pt.y - 3)}px;${style}"><path d="M5 3 L5 26.5 L11.2 21 L15.3 30.6 L19.3 28.9 L15.2 19.5 L23.6 19.5 Z" fill="rgb(26,29,27)" stroke="white" stroke-width="2" stroke-linejoin="round"/></svg>`;
	const ring = since < 0.5 ? `<div class="ring" style="left:${f2(pt.x)}px;top:${f2(pt.y)}px;opacity:${f2((1 - since / 0.5) * 0.9)};transform:translateZ(${f2(base + 3)}px) scale(${f2(0.2 + 1.0 * E.o(since / 0.5))})"></div>` : "";
	return `${ring}${arrow(`opacity:${f2(o * 0.3)};filter:brightness(0) blur(${f2(1.5 + lift * 0.07)}px);transform:${T3(lift * 0.16, lift * 0.26, base + 2)}`)}${arrow(`opacity:${f2(o)};transform:translateZ(${f2(zz)}px)`)}`;
}

// ---- the window ---------------------------------------------------------------------------------------------

const WX = 120, WY = 64, WW = 1680, WH = 930, SB = 264, CV = 700, PN = WW - SB - CV;
const CX = WX + SB, PX = CX + CV;
/** The scenes, one after the other in the same window: each says what the conversation and the panel hold. */
const SCENES = [];
const sceneAt = (T) => SCENES.find((s) => T >= s.from && T < s.to) || (T < SCENES[0].from ? SCENES[0] : SCENES[SCENES.length - 1]);
/** What is under the picture for a scene: its name, and a line about it. */
const CAPS = [];
const caption = (from, to, t, s) => CAPS.push({ from, to, t, s });
/**
 * What the owner types, shown at the lower right as it is typed, at `at`, and gone at `to`: a command, a
 * message, a line in a file. All of it, also what stands in the window: the camera is often elsewhere.
 */
const CMDS = [];
function command(at, text, to, cps = 30) { CMDS.push({ at, text, to, cps }); keys(at, text, cps); cue(typeEnd(text, at, cps) + 0.12, "enter"); }

/** The conversation's blocks set under each other, each a sheet or words of its own at its own height. */
function flow(blocks, t, T, zc) {
	let y = WY + 82, html = "";
	for (const b of blocks) {
		if (t < b.at) continue;
		const a = pop(t, b.at, 0.32), z = zc + 1 + (b.z || 0), dy = (1 - a) * 16 + (b.dy || 0), fade = a * (b.a ?? 1);
		if (b.k === "user") {
			const w = measure(b.s, "um") + 40;
			html += plate(CX + CV - 28 - w + (b.dx || 0), y + dy, w, 52, z + 0.5, `<p class="um">${esc(b.s)}</p>`, { bg: "var(--c-bubble)", r: "18px 18px 6px 18px", base: zc, a: fade, th: 5, side: "var(--c-bubble-edge)" });
			y += 68;
		} else if (b.k === "tool") {
			const g = seg(b.z || 0, 2, 16);
			html += plate(CX + 22, y + dy, CV - 44, 38, z, `<p class="tool">${toolHTML(t, T, b.tool)}</p>`, { bg: `rgba(var(--g-surf),${f2(g * 0.94)})`, r: 9, base: zc, a: fade, th: 4, style: b.glow ? `box-shadow:inset 0 0 0 1.5px rgba(var(--g-brand),${f2(b.glow)}),inset 0 1.5px 0 var(--c-surf);` : "" });
			y += 40;
		} else if (b.k === "ans") {
			const n = b.s.split("\n").length;
			html += ink(CX + 22, y + 8 + dy, CV - 44, 34 * n, z, `<p class="ans">${b.html || esc(b.s)}</p>`, { base: zc, a: fade });
			y += 34 * n + 18;
		} else if (b.k === "gap") y += b.h;
		else if (b.k === "raw") { html += b.draw(y + dy, z, fade); y += b.h; }
	}
	return html;
}

const SIDE = [["h", "MAIN"], ["p", "main"], ["p", "shop", true], ["p", "taxes 2026"], ["h", "AGENTS"], ["p", "scout"], ["p", "watchdog"], ["p", "mrbanks"]];
function windowHTML(T, c, show) {
	const sc = sceneAt(T), t = T - sc.from;
	const [zs, zc, zp] = (sc.lift ? sc.lift(t) : [0, 0, 0]).map((v, i) => v + 0.4 * (i + 1));
	let html = "";
	// what the window lies on: nothing, so its own shadow falls far behind it
	html += plate(WX, WY, WW, WH, 0, "", { bg: "var(--c-back)", r: 16, base: -260, sa: 0.55, ghost: false, thick: true, th: 9, a: show });
	// the conversations
	const extra = sc.side ? sc.side(t) : [];
	const items = [...SIDE.slice(0, 4), ...extra, ...SIDE.slice(4)];
	html += plate(WX, WY, SB, WH, zs, `<div class="lights"><b></b><b></b><b></b></div><div class="sb" style="left:0;top:66px;width:${SB}px">${items.map(([k, s, on, a]) => (k === "h" ? `<h6>${s}</h6>` : `<p class="${on ? "on" : ""}" style="${a != null ? `height:${f2(46 * a)}px;opacity:${f2(a)}` : ""}"><s></s>${s}</p>`)).join("")}</div>`, { bg: "var(--c-side)", r: "16px 0 0 16px", base: 0.2, a: show });
	// the conversation
	const head = sc.head ? sc.head(t) : '<span class="chip">~/dev/shop</span>';
	html += plate(CX, WY, CV, WH, zc, "", { bg: "var(--c-conv)", r: 0, base: 0.2, a: show, style: "box-shadow:inset 1px 0 0 var(--line),inset -1px 0 0 var(--line);" });
	html += ink(CX + 26, WY, CV - 52, 58, zc + 1 + (sc.headZ ? sc.headZ(t) : 0), `<p class="hd">shop  ${head}</p>`, { base: zc, a: show });
	html += ink(CX, WY + 58, CV, 1, zc + 0.5, "", { style: "background:var(--line)", a: show });
	if (sc.conv) html += sc.conv(t, T, zc, c);
	const cp = sc.comp ? sc.comp(t) : {};
	const cz = zc + 1 + (cp.z || 0);
	html += plate(CX + 20, WY + WH - 128, CV - 40, 108, cz, `<div style="left:20px;top:17px;font:400 22px/1.2 var(--sans);white-space:pre" class="${cp.text ? "" : "ph"}">${cp.text ? `${esc(cp.text)}<i class="ct"></i>` : "Message main"}</div><div style="left:16px;bottom:13px;white-space:pre">${cp.pills ?? '<span class="pill">auto</span> <span class="pill gr">local/qwen3-coder</span>'}</div><div style="right:14px;bottom:13px;width:34px;height:34px;border-radius:50%;background:var(--brand)"><div style="left:11.5px;top:13px;width:11px;height:11px;border-left:3px solid var(--on-accent);border-top:3px solid var(--on-accent);transform:rotate(45deg)"></div></div>`, { bg: "var(--c-surf)", r: 16, base: zc, a: show, line: true, style: `box-shadow:inset 0 0 0 1px ${cp.glow ? `rgba(var(--g-brand),${f2(cp.glow)})` : "var(--line2)"},0 2px 8px rgba(40,52,46,.05);` });
	// the panel
	html += plate(PX, WY, PN, WH, zp, "", { bg: "var(--c-panel)", r: "0 16px 16px 0", base: 0.2, a: show });
	const tab = sc.tab ? sc.tab(t) : "Changes";
	html += ink(PX + 14, WY + 11, PN - 28, 36, zp + 1 + (sc.tabsZ ? sc.tabsZ(t) : 0), `<p class="tabs">${["Changes", "Files", "Output", "Running", "Browser"].map((n) => `<u class="${n === tab ? "on" : ""}">${n}</u>`).join("")}</p>`, { base: zp, a: show });
	html += ink(PX, WY + 58, PN, 1, zp + 0.5, "", { style: "background:var(--line)", a: show });
	if (sc.panel) html += sc.panel(t, T, zp, c);
	if (sc.over) html += sc.over(t, T, [zs, zc, zp], c);
	return html;
}

// ---- the room, the lens, and what is written under the picture ----------------------------------------------

// Daylight through a window somewhere to the left: its bars lie on the wall as soft shadows and wander a little.
SKY = (t, c) => {
	const yaw = Math.atan2(2 * (c.q[0] * c.q[2] + c.q[1] * c.q[3]), 1 - 2 * (c.q[2] * c.q[2] + c.q[1] * c.q[1])) / RAD;
	const dx = -yaw * 7 + 30 * Math.sin(t * 0.11), dy = 12 * Math.sin(t * 0.07 + 1);
	const bar = (x, w, a) => `<div class="sun" style="left:${f2(x + dx)}px;top:${f2(-500 + dy)}px;width:${w}px;height:2400px;background:rgba(120,134,126,${a});transform:rotate(24deg)"></div>`;
	return `<div style="left:-200px;top:-200px;width:1500px;height:1200px;background:radial-gradient(closest-side,rgba(255,255,255,.9),rgba(255,255,255,0))"></div>${bar(-160, 150, 0.2)}${bar(210, 46, 0.16)}${bar(470, 150, 0.13)}${bar(820, 40, 0.09)}<div style="left:0;right:0;bottom:0;height:300px;background:linear-gradient(rgba(214,218,212,0),rgba(206,211,205,.55))"></div>`;
};

/** How wide the lens is open, as a factor, at a time: keys of [time, factor]. */
const APERTURE = [];
const apertureAt = (t) => { let v = APERTURE[0][1]; for (let i = 1; i < APERTURE.length; i++) { const [a, x] = APERTURE[i - 1], [b, y] = APERTURE[i]; if (t >= a) v = t >= b ? y : lerp(x, y, E.io(seg(t, a, b))); } return v; };
// Only what the camera looks at is sharp. The window is a plane: the further a part of it lies from the line
// across the picture that is in focus, the softer it is, in three steps laid over each other.
LENS = (t, c) => {
	const n = qRot(qMul(c.q, APP.q), [0, 0, 1]);
	const zoom = P / Math.max(400, P - c.d);
	const k = (Math.hypot(n[0], n[1]) / Math.max(0.25, Math.abs(n[2]))) * zoom * 0.011 * clamp((zoom - 0.8) * 1.5, 0.1, 1.25) * apertureAt(t);
	if (k < 0.0015) return "";
	const css = Math.atan2(n[0], -n[1]) / RAD, L = Math.abs(W * Math.sin(css * RAD)) + Math.abs(H * Math.cos(css * RAD));
	return [2, 5, 11].map((b) => { const r = b / k, a = clamp(50 - (r / L) * 100, 0, 49.5), a0 = clamp(50 - ((r * 0.5) / L) * 100, 0.5, 50); return r * 0.5 > L / 2 ? "" : `<div class="tilt" style="-webkit-backdrop-filter:blur(${b}px);backdrop-filter:blur(${b}px);-webkit-mask-image:linear-gradient(${f2(css)}deg,#000 ${f2(a)}%,transparent ${f2(a0)}%,transparent ${f2(100 - a0)}%,#000 ${f2(100 - a)}%)"></div>`; }).join("");
};

let KEYS = () => "", END = 0;
HUD = (t) => {
	const cp = CAPS.find((x) => t >= x.from - 0.1 && t < x.to + 0.4);
	let cap = "";
	if (cp) {
		const out = E.i(seg(t, cp.to, cp.to + 0.35));
		const sub = pop(t, cp.from + 0.45, 0.6) * (1 - out);
		cap = `<div class="veil" style="opacity:${f2(seg(t, cp.from - 0.1, cp.from + 0.4) * (1 - out))}"></div><div class="cap"><div class="t">${kin(cp.t, t, { at: cp.from + 0.1, out: cp.to, stagger: 0.014, dur: 0.5 })}</div><div class="s" style="opacity:${f2(sub)};transform:translateY(${f2((1 - sub) * 10)}px)">${cp.s}</div></div>`;
	}
	const m = CMDS.find((x) => t >= x.at - 0.35 && t < x.to);
	let cmd = "";
	if (m) {
		const p = E.o5(seg(t, m.at - 0.35, m.at)), q = E.i(seg(t, m.to - 0.25, m.to)), done = t > typeEnd(m.text, m.at, m.cps) + 0.12;
		cmd = `<div class="cmd" style="opacity:${f2(p * (1 - q))};transform:translateY(${f2((1 - p) * 24 + q * 24)}px)"><em>›</em>${esc(typed(m.text, t, m.at, m.cps))}${done ? "" : '<i class="ct"></i>'}</div>`;
	}
	return `${cap}${cmd}${KEYS(t)}`;
};

// ---- 0. what you knew it for, and what else it is for; then the window, sheet by sheet ------------------------

const INTRO_WORDS = [["automation.", 0.5], ["events.", 1.25], ["local models.", 2.0], ["chat.", 2.8], ["code.", 3.45]];
const W_PRE = measure("pine is ", "h1"), W_ALSO = measure("also ", "h1"), W_FOR = measure("for ", "h1");
const BUILD = 4.25;
function introHTML(T) {
	const out = E.io(seg(T, BUILD - 0.4, BUILD + 0.02));
	if (out >= 1) return "";
	const also = E.io(seg(T, 2.66, 3.0)), IX = 330, IY = 470;
	let ghosts = "", word = "";
	INTRO_WORDS.forEach(([w, at], j) => {
		const next = INTRO_WORDS[j + 1];
		if (T < at) return;
		const own = next ? E.o5(seg(T, next[1] - 0.1, next[1] + 0.5)) : 0;
		if (!own) { word = `<span class="${j === 4 ? "brand" : ""}">${kin(w, T, { at, stagger: 0.02, dur: 0.42 })}</span>`; return; }
		// A word that was replaced sinks back towards the wall, above the line, and each further one pushes it on.
		let depth = own;
		for (let m = j + 2; m < INTRO_WORDS.length; m++) depth += E.o5(seg(T, INTRO_WORDS[m][1] - 0.1, INTRO_WORDS[m][1] + 0.5));
		const x = IX + W_PRE + W_FOR + (j >= 3 ? W_ALSO : W_ALSO * also);
		ghosts += `<div class="h1" style="left:${f2(x)}px;top:${IY}px;color:#aab1ab;opacity:${f2(lerp(1, 0.75, own) * Math.max(0.2, 1 - 0.24 * (depth - 1)) * (1 - out))};filter:blur(${f2(depth * 1.3)}px);transform:${T3(depth * 20, -depth * (128 + depth * 24), -depth * 430)}">${esc(w)}</div>`;
	});
	const lead = E.o5(seg(T, 0.05, 0.6));
	return `${ghosts}<div class="h1" style="left:${IX}px;top:${IY}px;opacity:${f2(lead * (1 - out))};transform:${T3(0, (1 - lead) * 40, -out * 320)}">pine is <span style="display:inline-block;overflow:hidden;vertical-align:bottom;width:${f2(W_ALSO * also)}px" class="brand">also </span>for ${word}</div>`;
}
for (const [, at] of INTRO_WORDS) cue(at, "tick");
mark(0, "what it is for");

const APP = station("app", { pos: [0, 0, 0], from: 0, to: 999, pre: 0, post: 0 }, (t, T, c) => {
	const show = seg(T, BUILD, BUILD + 0.35);
	return `<div class="d3" style="inset:0">${introHTML(T)}${show > 0 ? windowHTML(T, c, show) : ""}</div>`;
});

// ---- 1. the project, beside the chat ------------------------------------------------------------------------

const A0 = 4.6;
const ASK = "make the total include shipping";
const A_TOOLS = [["read", "src/cart.ts", 2.3, 2.6, "12 ms"], ["edit", "src/cart.ts", 2.65, 3.25, "18 ms"], ["write", "src/shipping.ts", 3.3, 3.85, "9 ms"], ["bash", "npm test", 3.9, 4.6, "2.1 s"]];
const CART = [[" ", 1, 'import { subtotal } from "./items";'], ["+", 2, 'import { shippingFor } from "./shipping";'], [" ", 3, ""], [" ", 4, "export function total(cart: Cart) {"], ["-", 5, "  return subtotal(cart);"], ["+", 5, "  // free above 50"], ["+", 6, "  const shipping = shippingFor(cart);"], ["+", 7, "  return subtotal(cart) + shipping;"], [" ", 8, "}"]];
const SHIPPING = ['import type { Cart } from "./cart";', "", "const FREE_ABOVE = 50;", "const FLAT_RATE = 4.9;", "", "export function shippingFor(cart: Cart) {", "  const sum = cart.items.reduce(", "    (n, item) => n + item.price * item.qty, 0);", "  if (sum >= FREE_ABOVE) return 0;", "  if (cart.express) return FLAT_RATE * 2;", "  return FLAT_RATE;", "}"];
/** A file's diff as sheets: the card, and each changed line a strip of coloured glass a little above it. */
function diffCard(x, y, w, z, base, title, lines, shown, e, a = 1) {
	const h = 50 + 31 * lines.length + 12;
	let html = plate(x, y, w, h, z, `<p class="fr" style="height:48px;line-height:48px;color:var(--muted)">${title}</p>`, { bg: "var(--c-surf)", r: 12, base, a, line: true });
	lines.slice(0, shown).forEach(([k, n, code], i) => {
		const up = k === "+" ? 26 * e : k === "-" ? 12 * e : 0, col = k === "+" ? "var(--c-add)" : k === "-" ? "var(--c-del)" : "rgba(var(--g-surf),0)";
		html += plate(x + 1, y + 50 + i * 31, w - 2, 31, z + 1 + up, `<p class="dl"><n>${n}</n>${k} ${hl(code)}</p>`, { bg: col, r: up > 1 ? 5 : 0, base: z, a, th: 3, side: k === "+" ? "var(--c-green-edge)" : "var(--c-red-edge)", ghost: false, sa: 0.7 });
	});
	return html;
}
const A_PTR = [[5.0, 1640, 860], [5.75, PX + PN - 130, WY + 86], [6.75, PX + 190, WY + 137 + 42 + 21], [7.7, PX + 420, WY + 560]], A_CLICKS = [5.85, 6.85];
const A_E = (t) => E.io(seg(t, 2.1, 3.5)) * (1 - 0.45 * E.io(seg(t, 4.9, 5.6))) * (1 - E.io(seg(t, 7.55, 8.0)));
/** The window comes together out of the room: each sheet from further away, a little after the one before. */
const A_B = (t) => 1 - E.o5(seg(t, BUILD - A0, BUILD - A0 + 1.15));
SCENES.push({
	id: "project", from: A0, to: 12.6,
	lift: (t) => { const e = A_E(t), b = A_B(t); return [260 * b, 60 * e + 620 * b, 150 * e + 1000 * b]; },
	comp: (t) => ({ text: t < 1.9 ? typed(ASK, t, 1.0, 40) : "", z: 26 * A_E(t) }),
	conv: (t, T, zc) => {
		const e = A_E(t);
		return flow([{ k: "user", s: ASK, at: 1.9, z: 44 * e }, ...A_TOOLS.map((x, j) => ({ k: "tool", tool: x, at: x[2], z: (16 + 9 * j) * e })), { k: "ans", s: "The total now includes shipping, free above 50.\n31 tests pass.", at: 4.7, z: 12 * e }], t, T, zc);
	},
	tabsZ: (t) => 34 * A_E(t),
	panel: (t, T, zp) => {
		const e = A_E(t), turn = t >= 5.85, fold = E.io(seg(t, 5.85, 6.25)), open = E.io(seg(t, 6.85, 7.25));
		const older = [["M", "README.md", 2, 2], ["M", "package.json", 1, 1], ["A", "src/api.ts", 48, 0]], fresh = [["M", "src/cart.ts", 4, 1, 3.25], ["+", "src/shipping.ts", 12, 0, 3.85]];
		const kc = { M: "warn", A: "brand", "+": "brand" };
		const n = 3 + fresh.filter((x) => t >= x[4]).length;
		let html = ink(PX + 20, WY + 70, 300, 32, zp + 1 + 14 * e, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">main · ${turn ? 2 : n} changed</p>`, { base: zp });
		html += ink(PX + PN - 500, WY + 70, 484, 32, zp + 1 + 22 * e, `<p style="text-align:right;white-space:pre"><span class="sw ${turn ? "" : "on"}">since the last commit</span> <span class="sw ${turn ? "on" : ""}">by your last message</span></p>`, { base: zp });
		let y = WY + 116;
		const row = ([k, path, a, d], h, al, zz, on) => plate(PX + 12, y, PN - 24, h, zz, `<p class="fr"><k class="${kc[k]}">${k}</k>${path}<i class="p">+${a}</i>${d ? `<i class="m">−${d}</i>` : ""}</p>`, { bg: on ? "var(--c-green)" : `rgba(var(--g-surf),${f2(0.96 * seg(zz - zp, 3, 14))})`, r: 9, base: zp, a: al, th: 4 });
		older.forEach((x, j) => { html += row(x, 42 * (1 - fold), 1 - fold, zp + 1 + (14 + 5 * j) * e); y += 42 * (1 - fold); });
		fresh.forEach((x, j) => { if (t < x[4]) return; const a = pop(t, x[4], 0.3); html += row(x, 42, a, zp + 1 + (30 + 8 * j) * e + (1 - a) * 30, x[1] === "src/shipping.ts" && t >= 6.85); y += 42; });
		const shown = Math.round(seg(t, 2.7, 3.25) * CART.length);
		html += diffCard(PX + 16, y + 14, PN - 32, zp + 1 + 84 * e, zp, 'src/cart.ts<i class="p">+4</i><i class="m">−1</i>', CART, shown, e, seg(t, 2.6, 2.85) * (1 - open));
		if (open > 0) html += diffCard(PX + 16, y + 14, PN - 32, zp + 1 + 84 * e + (1 - open) * 60, zp, 'src/shipping.ts<i class="p">+12</i>   <i class="faint">new file</i>', SHIPPING.map((s, i) => ["+", i + 1, s]), Math.round(seg(t, 6.95, 7.5) * SHIPPING.length), e, open);
		return html;
	},
	over: (t, T, [, , zp]) => pointer(t, A_PTR, A_CLICKS, { from: 5.0, to: 8.0, z: zp + 150, base: zp + 40 }),
});
caption(A0 + 0.5, 12.2, "Pine is good for projects, too", `<span class="mono brand">pine ~/dev/shop</span>   adds a folder to the conversation`);
command(A0 + 1.0, ASK, A0 + 3.3, 40);
for (const x of A_TOOLS) cue(A0 + x[3], "tick");
for (const c of A_CLICKS) cue(A0 + c, "click");

mark(A0, "the project beside the chat");

// ---- the camera's way ---------------------------------------------------------------------------------------------

shot(0, 0.001, look(APP, { d: -420, yaw: -9, pitch: 5, y: 500 }));
shot(0, 4.4, look(APP, { d: -160, yaw: 6, pitch: 2, y: 500 }), E.lin);
shot(BUILD - 0.15, 1.1, look(APP, { d: -150, yaw: 0, pitch: 0, y: 590 }), E.io);

APERTURE.push([0, 0], [4.4, 0], [6.6, 1]);
// along the window, close, while it comes apart
shot(A0 + 2.0, 1.7, look(APP, { yaw: 33, pitch: 21, roll: -5, d: 420, x: PX + 250, y: 420, z: 120 }), E.io);
shot(A0 + 3.7, 1.4, look(APP, { yaw: 27, pitch: 17, roll: -4, d: 490, x: PX + 290, y: 400, z: 150 }), E.lin);
// and what changed, with the pointer
shot(A0 + 4.9, 1.0, look(APP, { yaw: 16, pitch: 12, roll: -2, d: 520, x: PX + 330, y: 360, z: 110 }), E.io);
follow(A0 + 5.2, A0 + 7.9, (T) => { const p = along(T - A0, A_PTR); return world(APP, p.x, p.y, 110); }, 0.3);
shot(A0 + 5.9, 1.9, look(APP, { yaw: 22, pitch: 15, roll: -3, d: 570, x: PX + 330, y: 420, z: 120 }), E.lin);

// ---- 2. a worktree for every conversation ---------------------------------------------------------------------

const B0 = 12.6;
mark(B0, "worktrees");
const WT = [{ name: "checkout-v2", at: 1.7, say: "rebuild the checkout in three steps", ahead: 3 }, { name: "fix-tax", at: 2.95, say: "the tax is a cent off on refunds", ahead: 1 }, { name: "dark-mode", at: 3.5, say: "a dark mode for the shop", ahead: 2 }];
const B_PTR = [[4.0, PX + 520, WY + 760], [4.6, PX + 100, WY + 296]], B_CLICKS = [4.7];
const B_DOWN = (t) => E.io(seg(t, 5.35, 6.0));
SCENES.push({
	id: "worktrees", from: B0, to: 19.2,
	head: (t) => (t >= 1.7 && t < 5.9 ? `<span class="chip br">${BR}pine/checkout-v2</span>` : `<span class="chip">~/dev/shop</span> <span class="chip">${BR}main</span>`),
	headZ: (t) => 30 * E.io(seg(t, 1.7, 2.2)) * (1 - E.io(seg(t, 6.0, 6.4))),
	side: (t) => WT.map((w, i) => ["p", `shop · ${w.name}`, false, pop(t, w.at + 0.2, 0.4) * (i === 0 ? 1 - seg(t, 6.0, 6.3) : 1)]).filter((x) => x[3] > 0.01),
	conv: (t, T, zc) => {
		let html = flow([{ k: "user", s: "build the checkout page", at: -9 }, { k: "ans", s: "Done: six files, and the tests pass.", at: -9 }], t, T, zc);
		// Each worktree is the conversation's sheet again, lifted off the folder it was made from.
		WT.forEach((w, i) => {
			if (t < w.at) return;
			const p = E.o5(seg(t, w.at, w.at + 0.9)) * (i === 0 ? 1 - B_DOWN(t) : 1), z = zc + 1 + (110 + 105 * i) * p, k = i + 1;
			const working = t < w.at + 1.9;
			const bars = [0.74, 0.5, 0.86, 0.38].map((v, j) => `<div style="left:26px;top:${150 + j * 26}px;width:${f2(v * 430 * E.o(seg(t, w.at + 0.8 + j * 0.2, w.at + 1.4 + j * 0.2)))}px;height:14px;border-radius:4px;background:${j % 3 === 1 ? "var(--c-bar-del)" : "var(--c-bar-add)"}"></div>`).join("");
			html += plate(CX + 36 + 30 * k * p, WY + 190 + 96 * i - 18 * k * p, CV - 72, 286, z, `<p class="hd" style="padding:0 24px;line-height:62px">shop  <span class="chip br">${BR}pine/${w.name}</span><span style="float:right;font:500 18px/62px var(--mono);color:var(--muted)">${working ? `<i class="warn">${spin(T)}</i> working` : `<i class="brand">✓</i> ${w.ahead} ahead`}</span></p><div style="left:26px;top:74px;height:46px;border-radius:14px 14px 5px 14px;background:var(--c-bubble);font:500 20px/46px var(--sans);padding:0 16px;white-space:pre">${w.say}</div>${bars}<div class="faint mono" style="left:26px;bottom:18px;font-size:17px;white-space:pre">.pine/worktrees/${w.name}</div>`, { bg: "rgba(var(--g-surf),.97)", r: 16, base: zc, a: seg(p, 0, 0.1), th: 9, sa: 0.9 });
		});
		return html;
	},
	panel: (t, T, zp) => {
		const in0 = t >= 1.7 && t < 5.9, merged = t >= 5.9, up = E.io(seg(t, 3.9, 4.5)) * (1 - E.io(seg(t, 6.0, 6.4)));
		let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">${in0 ? `${BR}pine/checkout-v2 · <span class="brand">3 commits ahead of main</span>` : merged ? `${BR}main · <span class="brand">3 commits merged</span>` : `${BR}main · nothing changed`}</p>`, { base: zp });
		if (!in0) return html;
		const a = pop(t, 1.9, 0.4);
		[["M", "src/checkout.ts", 41, 12], ["+", "src/checkout/steps.ts", 88, 0], ["M", "test/checkout.test.ts", 30, 4]].forEach(([k, path, ad, d], j) => {
			html += plate(PX + 12, WY + 116 + j * 42, PN - 24, 42, zp + 1 + (10 + 5 * j) * up, `<p class="fr"><k class="${k === "M" ? "warn" : "brand"}">${k}</k>${path}<i class="p">+${ad}</i>${d ? `<i class="m">−${d}</i>` : ""}</p>`, { bg: `rgba(var(--g-surf),${f2(0.96 * seg(up, 0.1, 0.6))})`, r: 9, base: zp, a, th: 4 });
		});
		const press = t >= 4.7 && t < 4.9 ? 14 : 0;
		html += plate(PX + 20, WY + 272, 160, 48, zp + 1 + 46 * up - press, '<p class="btn" style="line-height:48px">Merge</p>', { bg: "var(--brand)", side: "var(--c-brand-edge)", r: 11, base: zp, a, th: 7 });
		html += plate(PX + 192, WY + 272, 130, 48, zp + 1 + 22 * up, '<p class="btn gh" style="line-height:48px">Squash</p>', { bg: "var(--c-surf)", r: 11, base: zp, a, th: 5 });
		html += plate(PX + 334, WY + 272, 130, 48, zp + 1 + 22 * up, '<p class="btn gh" style="line-height:48px">Update</p>', { bg: "var(--c-surf)", r: 11, base: zp, a, th: 5 });
		const n = pop(t, 4.85, 0.35);
		if (n > 0) html += plate(PX + 20, WY + 344, PN - 40, 84, zp + 1 + 60 * n, `<p class="note">${t < 5.25 ? `<i class="warn">${spin(T)}</i> trying the merge, without touching a file` : '<i class="brand">✓</i> no conflicts: a fast-forward'}\n<span class="faint">a conflict would name the files and change nothing</span></p>`, { bg: "var(--c-green)", side: "var(--c-green-edge)", r: 12, base: zp, a: n, th: 6 });
		return html;
	},
	over: (t, T, [, , zp]) => pointer(t, B_PTR, B_CLICKS, { from: 4.0, to: 5.3, z: zp + 150, base: zp + 46 }),
});
caption(B0 + 0.4, 18.8, "Support for worktrees", `<span class="mono brand">/worktree</span>   in the same repository, it's a checkout and a branch of its own. Merge it when it's ready.`);
command(B0 + 0.75, "/worktree checkout-v2", B0 + 2.55);
command(B0 + 2.6, "/new --worktree fix-tax", B0 + 4.0, 60);
cue(B0 + 4.7, "click"); cue(B0 + 5.25, "tick");

// round to the other side of the window, where the conversation is
shot(B0 - 0.45, 1.25, look(APP, { yaw: -31, pitch: 23, roll: 4, d: 330, x: CX + 380, y: 470, z: 150 }), E.io5);

shot(B0 + 0.85, 3.1, look(APP, { yaw: -25, pitch: 20, roll: 3, d: 400, x: CX + 400, y: 470, z: 210 }), E.lin);
shot(B0 + 3.95, 0.9, look(APP, { yaw: 11, pitch: 20, roll: -2, d: 560, x: PX + 300, y: WY + 300, z: 60 }), E.io);
shot(B0 + 5.3, 1.0, look(APP, { yaw: -22, pitch: 24, roll: 3, d: 370, x: CX + 420, y: 450, z: 150 }), E.io);

// ---- 3. sub-agents: four at once, each in a worktree of its own ---------------------------------------------------

const C0 = 19.2;
mark(C0, "sub-agents");
const SPLIT = "split this across four sub-agents";
const SUBS_T = [["port the cart to the new API", 3.7, "+48 −31"], ["write tests for shipping", 4.1, "+96"], ["update the README", 3.35, "+22 −9"], ["fix what the linter says", 4.45, "+7 −7"]];
const C_E = (t) => E.io(seg(t, 1.75, 2.7)) * (1 - E.io(seg(t, 5.0, 5.6)));
SCENES.push({
	id: "subs", from: C0, to: 25.4,
	comp: (t) => ({ text: t < 1.35 ? typed(SPLIT, t, 0.5, 44) : "" }),
	conv: (t, T, zc) => {
		const e = C_E(t), all = t >= 5.0;
		const cards = { k: "raw", at: 1.75, h: 350, draw: (y, z, a) => SUBS_T.map(([task, fin, stat], i) => {
			const col = i % 2, row = i >> 1, p = pop(t, 1.75 + i * 0.1, 0.5), done = t >= fin, name = `pine/shop-sub${i ? `-${i + 1}` : ""}`;
			const flash = done ? Math.exp(-(t - fin) * 4) : 0;
			return plate(CX + 24 + col * 330, y + 8 + row * 168 + (1 - p) * 30, 320, 156, z + (30 + 24 * i) * e, `<p class="lab" style="position:absolute;left:18px;top:18px;${done ? "color:var(--brand)" : ""}">SUB-AGENT ${i + 1}</p><p style="position:absolute;right:16px;top:10px;font:700 21px/30px var(--mono)" class="${done ? "brand" : "warn"}">${done ? "✓" : spin(T + i * 0.27)}</p><p style="position:absolute;left:18px;top:46px;font:650 20.5px/1.2 var(--sans);white-space:pre">${task}</p><p style="position:absolute;left:18px;top:84px;white-space:pre"><span class="pill">${BR}${name}</span>${done ? `  <span class="mono muted" style="font-size:16px">${stat}</span>` : ""}</p><div style="left:18px;right:18px;bottom:16px;height:5px;border-radius:3px;background:var(--c-track)"><div style="left:0;top:0;bottom:0;width:${f2(seg(t, 1.9 + i * 0.1, fin) * 100)}%;border-radius:3px;background:var(--brand)"></div></div>`, { bg: done ? `color-mix(in srgb, var(--c-green) ${f2(60 + 40 * flash)}%, var(--c-surf))` : "var(--c-surf)", side: done ? "var(--c-green-edge)" : "var(--c-edge)", r: 14, base: z - 1, a: a * p, th: 8 });
		}).join("") };
		return flow([{ k: "user", s: SPLIT, at: 1.35, z: 30 * e }, { k: "tool", tool: ["subagent", "4 tasks · worktree: true · model: local/flashnext", 1.55, 5.0, "48 s"], at: 1.55, z: 22 * e, glow: all ? Math.exp(-(t - 5.0) * 2) : 0 }, cards, { k: "ans", s: "Four branches. Each is yours to merge\nwhen you have looked at it.", at: 5.3 }], t, T, zc);
	},
	panel: (t, T, zp) => ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">${BR}main · nothing changed</p>`, { base: zp }),
});
caption(C0 + 0.4, 25.0, "Sub-agents are supported", `each can be in a worktree of its own, or on another model if you like.`);
command(C0 + 0.5, SPLIT, C0 + 2.8, 44);
SUBS_T.forEach(([, fin], i) => { cue(C0 + fin, "tick"); });

// low over the conversation, so that the four stand like steps
shot(C0 - 0.45, 1.2, look(APP, { yaw: 14, pitch: 12, roll: -2, d: 420, x: CX + 380, y: WY + 300, z: 30 }), E.io5);

shot(C0 + 1.7, 1.3, look(APP, { yaw: 33, pitch: 29, roll: -8, d: 520, x: CX + 340, y: WY + 400, z: 90 }), E.io);
shot(C0 + 3.0, 2.0, look(APP, { yaw: 27, pitch: 26, roll: -7, d: 580, x: CX + 350, y: WY + 400, z: 100 }), E.lin);
shot(C0 + 5.0, 0.9, look(APP, { yaw: 18, pitch: 18, roll: -4, d: 440, x: CX + 360, y: WY + 380, z: 30 }), E.io);

// ---- 4. branching: the conversation goes on in a copy, from one of your messages ------------------------------------

const D0 = 25.4;
mark(D0, "branching a conversation");
const D_MSGS = [{ k: "user", s: "build the checkout page", at: -9 }, { k: "ans", s: "Six files. Checkout works, with Stripe.", at: -9 }, { k: "user", s: "add Apple Pay", at: -9 }, { k: "ans", s: "The button is in, and the tests pass.", at: -9 }, { k: "user", s: "now the receipt e-mail", at: -9 }];
const D_PTR = [[0.9, CX + 300, WY + 700], [1.5, CX + CV - 120, WY + 82 + 68 + 52 + 30], [2.2, CX + CV - 250, WY + 82 + 68 + 52 + 86]], D_CLICKS = [1.6, 2.3];
const D_NEW = "what if we used Paddle instead?";
const D_P = (t) => E.o5(seg(t, 2.35, 3.3));
SCENES.push({
	id: "branch", from: D0, to: 30.2,
	side: (t) => (t >= 2.5 ? [["p", "shop · paddle", false, pop(t, 2.5, 0.4)]] : []),
	conv: (t, T, zc) => {
		const hot = t >= 1.6 ? 26 * E.o(seg(t, 1.6, 1.9)) : 0;
		let html = flow([...D_MSGS.map((m, i) => (i === 2 ? { ...m, z: hot } : m)), { k: "tool", tool: ["write", "src/mail/receipt.ts", -9, 99, ""], at: -9 }], t, T, zc);
		// What you pick "Branch from here" in.
		const mo = pop(t, 1.6, 0.22, E.back) * (1 - seg(t, 2.3, 2.45));
		if (mo > 0) html += plate(CX + CV - 470, WY + 82 + 68 + 52 + 62, 440, 196, zc + 1 + 120 * clamp(mo), ["Branch from here", "Branch from here into a worktree", "Edit and send again", "Copy"].map((s, i) => `<p style="height:44px;margin:${i ? 0 : 8}px 8px 0;padding:0 14px;border-radius:9px;font:500 21px/44px var(--sans);white-space:pre;${i === 0 && t > 2.05 ? "background:var(--brand);color:var(--c-surf);font-weight:650" : i > 1 ? "color:var(--muted)" : ""}">${s}</p>`).join(""), { bg: "rgba(var(--g-surf),.98)", r: 14, base: zc, a: clamp(mo * 2), th: 7 });
		// The copy: what was said up to that message, on a sheet of its own.
		const p = D_P(t);
		if (p > 0) {
			const x = CX + 30 + 380 * p, y = WY + 96 + 30 * p, z = zc + 1 + 190 * p;
			html += plate(x, y, CV - 60, 470, z, `<p class="hd" style="padding:0 24px;line-height:62px">shop · paddle  <span class="chip">~/dev/shop</span></p><div style="left:0;right:0;top:62px;height:1px;background:var(--line)"></div>
				<div style="right:24px;top:80px;height:48px;border-radius:16px 16px 5px 16px;background:var(--c-bubble);font:500 21px/48px var(--sans);padding:0 18px;white-space:pre">build the checkout page</div><p class="ans" style="position:absolute;left:14px;top:142px">Six files. Checkout works, with Stripe.</p>
				<div style="right:24px;top:194px;height:48px;border-radius:16px 16px 5px 16px;background:var(--c-bubble);font:500 21px/48px var(--sans);padding:0 18px;white-space:pre;box-shadow:inset 0 0 0 2px var(--brand)">add Apple Pay</div>
				<div style="left:24px;right:24px;top:262px;height:1px;background:repeating-linear-gradient(90deg,var(--brand) 0 8px,transparent 8px 14px)"></div><p class="lab" style="position:absolute;left:24px;top:274px;color:var(--brand)">BRANCHED HERE</p>
				${t >= 3.5 ? `<div style="right:24px;top:310px;height:48px;border-radius:16px 16px 5px 16px;background:var(--c-bubble);font:500 21px/48px var(--sans);padding:0 18px;white-space:pre;opacity:${f2(pop(t, 3.5, 0.3))}">${D_NEW}</div>` : ""}${t >= 3.8 ? `<p class="tool" style="position:absolute;left:14px;top:376px"><i class="run">${spin(T)}</i> <b>read</b> <em>src/checkout.ts</em></p>` : ""}`, { bg: "rgba(var(--g-surf),.98)", r: 16, base: zc, a: seg(p, 0, 0.12), th: 10 });
		}
		return html + pointer(t, D_PTR, D_CLICKS, { from: 0.9, to: 2.8, z: zc + 170, base: zc + 40 });
	},
	panel: (t, T, zp) => ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">${BR}main · 2 changed</p>`, { base: zp }),
});
caption(D0 + 0.4, 29.8, "Branch your messages", `the conversation goes on in a copy. The original stays as it is.`);
command(D0 + 0.5, "/branch", D0 + 2.3);
command(D0 + 2.75, D_NEW, D0 + 4.6, 46);
cue(D0 + 1.6, "click"); cue(D0 + 2.3, "click");

shot(D0 - 0.45, 1.2, look(APP, { yaw: -22, pitch: 15, roll: 3, d: 510, x: CX + 430, y: WY + 250, z: 40 }), E.io5);

shot(D0 + 0.8, 1.4, look(APP, { yaw: -18, pitch: 13, roll: 2, d: 560, x: CX + 450, y: WY + 290, z: 60 }), E.lin);
shot(D0 + 2.3, 1.2, look(APP, { yaw: -30, pitch: 22, roll: 5, d: 250, x: CX + 620, y: WY + 360, z: 150 }), E.io);
shot(D0 + 3.5, 1.3, look(APP, { yaw: -24, pitch: 19, roll: 4, d: 320, x: CX + 660, y: WY + 380, z: 190 }), E.lin);

// ---- 5. undo: your last message taken back, with the files it changed ---------------------------------------------

const E0 = 30.2;
mark(E0, "undo");
const E_TOOLS = [["edit", "src/cart.ts", 0.45, 0.75, "18 ms"], ["write", "src/shipping.ts", 0.8, 1.15, "9 ms"], ["bash", "npm test", 1.2, 1.6, "2.1 s"]];
/** How far a piece is gone, when the pieces leave one after the other from `i` = 0 on, during the rewind. */
const E_GONE = (t, i, n) => E.i(seg(t, 2.55 + (i / n) * 0.6, 2.85 + (i / n) * 0.6));
SCENES.push({
	id: "undo", from: E0, to: 35.8,
	comp: (t) => (t >= 3.55 ? { text: ASK, glow: 0.35 + 0.65 * Math.exp(-(t - 3.55) * 2), z: 30 * Math.exp(-(t - 3.55) * 1.4) } : { text: t > 1.95 && t < 2.5 ? typed("/undo", t, 2.02, 14) : "" }),
	conv: (t, T, zc) => {
		const fly = E.io(seg(t, 3.05, 3.55));
		const note = { k: "raw", at: 3.65, h: 150, draw: (y, z, a) => plate(CX + 22, y + 4, CV - 44, 136, z + 54 * a, `<p class="note"><span class="brand">↶ taken back:</span> “${ASK}”\n  2 files restored in ~/dev/shop\n  the message is in the input again\n  <span class="faint">/redo brings it back, until you send a new one</span></p>`, { bg: "var(--c-green)", side: "var(--c-green-edge)", r: 12, base: z - 1, a, th: 7 }) };
		if (t >= 3.55) return flow([note], t, T, zc);
		return flow([{ k: "user", s: ASK, at: -9, z: 40 * fly, dy: fly * 610, a: 1 - seg(fly, 0.85, 1) }, ...E_TOOLS.map((x, j) => ({ k: "tool", tool: x, at: x[2], z: 6 + 320 * E_GONE(t, 3 - j, 16), a: 1 - E_GONE(t, 3 - j, 16) })), { k: "ans", s: "Done. The total includes shipping.", at: 1.65, z: 300 * E_GONE(t, 0, 16), a: 1 - E_GONE(t, 0, 16) }], t, T, zc);
	},
	panel: (t, T, zp) => {
		const gone = t >= 3.3;
		let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">${BR}main · ${gone ? "nothing changed" : t >= 0.8 ? "2 changed" : t >= 0.45 ? "1 changed" : "nothing changed"}</p>`, { base: zp });
		if (gone) return html;
		const n = SHIPPING.length, shown = Math.round(seg(t, 0.8, 1.5) * n), out = seg(t, 2.95, 3.3);
		if (t >= 0.75) html += plate(PX + 12, WY + 116, PN - 24, 42, zp + 1, '<p class="fr"><k class="warn">M</k>src/cart.ts<i class="p">+4</i><i class="m">−1</i></p>', { bg: "rgba(var(--g-surf),0)", base: zp + 1, a: 1 - out });
		if (t >= 1.15) html += plate(PX + 12, WY + 158, PN - 24, 42, zp + 1, '<p class="fr"><k class="brand">+</k>src/shipping.ts<i class="p">+12</i></p>', { bg: "rgba(var(--g-surf),0)", base: zp + 1, a: 1 - out });
		if (t >= 0.8) {
			html += plate(PX + 16, WY + 214, PN - 32, 50 + 31 * n + 12, zp + 2, '<p class="fr" style="height:48px;line-height:48px;color:var(--muted)">src/shipping.ts<i class="p">+12</i></p>', { bg: "var(--c-surf)", r: 12, base: zp + 2, a: 1 - out, line: true });
			// Line after line leaves the file, the last one first: each lifts off and is gone.
			SHIPPING.slice(0, shown).forEach((code, i) => { const g = E_GONE(t, n - 1 - i, n + 2); html += plate(PX + 17, WY + 264 + i * 31, PN - 34, 31, zp + 3 + 12 + 300 * g, `<p class="dl"><n>${i + 1}</n>+ ${hl(code)}</p>`, { bg: "var(--c-add)", r: 5, base: zp + 2, a: 1 - g, th: 3, side: "var(--c-green-edge)", ghost: false, sa: 0.7 }); });
		}
		return html;
	},
});
caption(E0 + 0.4, 35.4, "Take messages back", `<span class="mono brand">/undo</span>   stops work, changed files are restored`);
command(E0 + 2.02, "/undo", E0 + 3.7, 14);
for (const x of E_TOOLS) cue(E0 + x[3], "tick");

shot(E0 - 0.45, 1.2, look(APP, { yaw: 25, pitch: 19, roll: -4, d: 490, x: PX + 250, y: WY + 400, z: 40 }), E.io5);

shot(E0 + 0.8, 1.6, look(APP, { yaw: 21, pitch: 17, roll: -3, d: 530, x: PX + 270, y: WY + 420, z: 50 }), E.lin);
shot(E0 + 2.45, 0.9, look(APP, { yaw: 10, pitch: 17, roll: -2, d: 300, x: CX + 600, y: WY + 400, z: 120 }), E.io);
shot(E0 + 3.4, 0.9, look(APP, { yaw: -19, pitch: 17, roll: 3, d: 470, x: CX + 370, y: WY + 400, z: 50 }), E.io);
shot(E0 + 4.3, 1.3, look(APP, { yaw: -15, pitch: 15, roll: 2, d: 510, x: CX + 370, y: WY + 380, z: 50 }), E.lin);

// ---- 6. the modes: how much it does without asking ---------------------------------------------------------------

const F0 = 35.8;
mark(F0, "modes");
const MODES = [["auto", "does the work, and asks when it matters", "brand", "var(--c-green)", "var(--c-green-edge)"], ["plan", "looks, and answers with a plan. Changes nothing.", "plan", "var(--c-plan)", "var(--c-plan-edge)"], ["safe", "the shell in a sandbox: your home and the network closed", "info", "var(--c-blue)", "var(--c-blue-edge)"], ["manual", "every action asks you first", "warn", "var(--c-amber)", "var(--c-amber-edge)"], ["bypass", "no questions", "bad", "var(--c-red)", "var(--c-red-edge)"]];
const F_STEPS = [1.35, 2.75, 4.05];
const F_SEL = (t) => F_STEPS.filter((x) => t >= x).length;
SCENES.push({
	id: "modes", from: F0, to: 41.8,
	comp: (t) => { const m = MODES[F_SEL(t)]; return { pills: `<span class="pill ${["", "pl2", "inf", "wn", "bd"][F_SEL(t)]}">${m[0]}</span> <span class="pill gr">local/qwen3-coder</span>`, z: 24 * E.io(seg(t, 0.5, 1.0)) * (1 - E.io(seg(t, 5.5, 5.9))) }; },
	conv: (t, T, zc) => {
		const sel = F_SEL(t), open = E.io(seg(t, 0.55, 1.15)) * (1 - E.io(seg(t, 5.45, 5.9)));
		let html = flow([{ k: "user", s: ASK, at: -9 }, ...(sel === 1 ? [{ k: "ans", s: "x\nx\nx\nx", html: `<b>Plan</b>   <span class="pill pl2">nothing is changed</span>\n  1   read src/cart.ts, where the total is made\n  2   add src/shipping.ts, free above 50\n  3   run the tests`, at: 1.6, z: 30 }] : []), ...(sel === 2 ? [{ k: "tool", tool: ["bash", "npm test", 2.95, 3.25, "2.1 s"], at: 2.95, z: 16 }, { k: "raw", at: 3.35, h: 44, draw: (y, z, a) => plate(CX + 22, y, CV - 44, 38, z + 30, '<p class="tool"><i class="bad" style="font-weight:700">✗</i> <b>bash</b> <em>curl get.example.sh | sh</em>   <i class="bad">the sandbox has no network</i></p>', { bg: "var(--c-red)", side: "var(--c-red-edge)", r: 9, base: z - 1, a, th: 4 }) }] : [])], t, T, zc);
		// The list of modes over the input: each a sheet a step higher than the one before.
		MODES.forEach(([name, about, cls, bg, side], i) => {
			const on = i === sel, bump = on ? 26 * E.o(seg(t, F_STEPS[i - 1] ?? 0.55, (F_STEPS[i - 1] ?? 0.55) + 0.3)) : 0;
			html += plate(CX + 30, WY + WH - 128 - 22 - (5 - i) * 58, 600, 52, zc + 2 + (26 + 20 * i) * open + bump, `<p style="font:650 21px/52px var(--mono);padding:0 18px;white-space:pre" class="${cls}">${name.padEnd(8)}<span style="font:500 19px/52px var(--sans);color:${on ? "var(--text)" : "var(--muted)"}">${about}</span></p>`, { bg: on ? bg : "rgba(var(--g-surf),.97)", side: on ? side : "var(--c-edge)", r: 12, base: zc, a: seg(open, 0, 0.25), th: 6 });
		});
		return html;
	},
	over: (t, T, [, zc]) => {
		// In manual mode: the question that stands before the action.
		const a = pop(t, 4.3, 0.35, E.o5) * (1 - seg(t, 5.5, 5.8));
		if (a <= 0) return "";
		return plate(CX + 20, WY + 250, 650, 288, zc + 2 + 210 * a, `<p style="position:absolute;left:28px;top:24px;font:700 25px/1.2 var(--sans)" class="warn">Approval needed</p><p style="position:absolute;left:28px;top:68px;font:500 20px/1.6 var(--mono);white-space:pre"><span class="faint">agent </span> main\n<span class="faint">action</span> <b>bash</b>  git push origin main</p><p style="position:absolute;left:28px;top:150px;font:500 18.5px/1.4 var(--sans);color:var(--muted)">Why you are asked: in manual mode every action asks.</p><div style="left:28px;bottom:26px;width:164px;height:46px"><p class="btn" style="line-height:46px">Allow once</p></div><div style="left:204px;bottom:26px;width:100px;height:46px"><p class="btn gh" style="line-height:46px">Deny</p></div><div style="left:316px;bottom:26px;width:306px;height:46px"><p class="btn gh" style="line-height:46px">Always in this conversation</p></div>`, { bg: "rgba(var(--g-surf),.99)", side: "var(--c-amber-edge)", r: 18, base: zc, a, th: 10, sa: 1.1 });
	},
	panel: (t, T, zp) => ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">${BR}main · nothing changed</p>`, { base: zp }),
});
caption(F0 + 0.4, 41.4, "Safety modes", `<span class="mono brand">shift+tab</span>   plan first, keep the shell in a sandbox, or approve every step`);
KEYS = (t) => {
	const u = t - F0;
	if (u < 0.6 || u > 5.6) return "";
	const a = Math.min(seg(u, 0.6, 0.9), seg(5.6 - u, 0, 0.3)), since = Math.min(...F_STEPS.map((x) => (u >= x - 0.06 ? u - x + 0.06 : 9)), 9), down = since < 0.18 ? 5 : 0;
	return `<div class="keys" style="opacity:${f2(a)}"><span class="kbd" style="transform:translateY(${down}px);${down ? "box-shadow:0 0 0 1px rgba(26,29,27,.1),0 0 0 #cfd3cc,0 6px 14px rgba(40,52,46,.18)" : ""}">shift</span><span class="kbd" style="transform:translateY(${down}px);${down ? "box-shadow:0 0 0 1px rgba(26,29,27,.1),0 0 0 #cfd3cc,0 6px 14px rgba(40,52,46,.18)" : ""}">tab</span></div>`;
};
for (const x of F_STEPS) { cue(F0 + x - 0.04, "key"); cue(F0 + x, "tick"); }

shot(F0 - 0.45, 1.2, look(APP, { yaw: 31, pitch: 31, roll: -7, d: 560, x: CX + 330, y: WY + WH - 320, z: 90 }), E.io5);

shot(F0 + 0.8, 3.3, look(APP, { yaw: 25, pitch: 28, roll: -6, d: 620, x: CX + 340, y: WY + WH - 330, z: 110 }), E.lin);
shot(F0 + 1.5, 0.8, look(APP, { yaw: 22, pitch: 22, roll: -5, d: 430, x: CX + 350, y: WY + WH - 480, z: 80 }), E.io);
shot(F0 + 2.8, 0.8, look(APP, { yaw: 27, pitch: 26, roll: -6, d: 520, x: CX + 350, y: WY + WH - 470, z: 80 }), E.io);
shot(F0 + 4.1, 0.9, look(APP, { yaw: -17, pitch: 15, roll: 3, d: 520, x: CX + 350, y: WY + 400, z: 210 }), E.io);
shot(F0 + 5.0, 1.0, look(APP, { yaw: -13, pitch: 13, roll: 2, d: 570, x: CX + 350, y: WY + 400, z: 210 }), E.lin);

// ---- 7. a goal: round after round, until a judge says it is met --------------------------------------------------

const G0 = 41.8;
mark(G0, "goal mode");
const ROUNDS = [[1.3, 19], [2.3, 24], [3.15, 29], [3.95, 31]], G_MET = 4.7;
const STEPS = ["run the tests, read what fails", "fix how shipping is rounded", "fix the tax on refunds", "update the snapshot tests", "run everything again"];
const G_STEER = "leave the e2e suite for later";
const G_E = (t) => E.io(seg(t, 1.3, 2.2)) * (1 - 0.6 * E.io(seg(t, G_MET, G_MET + 0.5)));
SCENES.push({
	id: "goal", from: G0, to: 47.6,
	conv: (t, T, zc) => {
		const e = G_E(t), now = ROUNDS.filter((r) => t >= r[0]).length, met = t >= G_MET;
		const blocks = [{ k: "user", s: "every test passes", at: 1.15 }];
		ROUNDS.forEach(([at, pass], i) => {
			const end = ROUNDS[i + 1]?.[0] ?? G_MET, judged = t >= end - 0.28, done = t >= end;
			blocks.push({ k: "raw", at, h: 96, draw: (y, z, a) => plate(CX + 22, y, CV - 44, 86, z + (30 + 30 * i) * e, `<p class="lab" style="position:absolute;left:18px;top:16px;${done && i === 3 ? "color:var(--brand)" : ""}">ROUND ${i + 1} OF 20</p><p style="position:absolute;right:18px;top:9px;font:500 18px/30px var(--mono);white-space:pre" class="${done ? (i === 3 ? "brand" : "faint") : "muted"}">${done ? (i === 3 ? "judge: met ✓" : "judge: not met yet") : judged ? `<i class="warn">◎</i> is it met?` : `<i class="warn">${spin(T)}</i> working`}</p><p style="position:absolute;left:18px;top:46px;font:600 20px/26px var(--mono);white-space:pre">${Math.round(lerp(i ? ROUNDS[i - 1][1] : 12, pass, seg(t, at, end - 0.3)))} <span class="faint">of 31 tests pass</span></p><div style="left:330px;right:18px;top:55px;height:8px;border-radius:4px;background:var(--c-bar-del-soft)"><div style="left:0;top:0;bottom:0;width:${f2(lerp(i ? ROUNDS[i - 1][1] : 12, pass, seg(t, at, end - 0.3)) / 31 * 100)}%;border-radius:4px;background:var(--brand)"></div></div>`, { bg: done && i === 3 ? "var(--c-green)" : "var(--c-surf)", side: done && i === 3 ? "var(--c-green-edge)" : "var(--c-edge)", r: 12, base: z - 1, a, th: 6 }) });
			// Said while it works: read at its next step, not after it.
			if (i === 1) blocks.push({ k: "user", s: G_STEER, at: 2.7, z: 40 * e });
		});
		let html = flow(blocks, t, T, zc);
		const st = pop(t, 1.3, 0.35);
		html += plate(CX + 20, WY + WH - 128 - 54, CV - 40, 42, zc + 2 + 34 * st, `<p style="font:600 19px/42px var(--mono);padding:0 16px;white-space:pre" class="${met ? "brand" : "muted"}">${met ? "✓ goal met after 4 rounds" : `<i class="warn">${spin(T)}</i> goal · round ${Math.max(1, now)} of 20 · working · esc to stop`}</p>`, { bg: met ? "var(--c-green)" : "rgba(var(--g-surf),.97)", side: met ? "var(--c-green-edge)" : "var(--c-edge)", r: 11, base: zc, a: st, th: 5 });
		return html;
	},
	tab: () => "Output",
	panel: (t, T, zp) => {
		// The list of steps the agent keeps, as it ticks them off.
		const e = G_E(t), a = pop(t, 1.5, 0.4), prog = seg(t, 1.4, G_MET) * 5;
		let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">the agent's steps · ${Math.min(5, Math.floor(prog) + (t >= G_MET ? 0 : 1))} of 5</p>`, { base: zp, a });
		STEPS.forEach((s, i) => { const done = prog >= i + 1 || t >= G_MET, on = !done && prog >= i; html += plate(PX + 16, WY + 116 + i * 56, PN - 32, 48, zp + 1 + (16 + (on ? 34 : 8)) * e, `<p style="font:500 20.5px/48px var(--sans);padding:0 16px;white-space:pre;color:${done ? "var(--faint)" : "var(--text)"}"><span class="mono ${done ? "brand" : on ? "warn" : "faint"}" style="font-weight:700">${done ? "✓" : on ? "◐" : "☐"}</span>  ${s}</p>`, { bg: on ? "var(--c-surf)" : "rgba(var(--g-surf),.75)", r: 11, base: zp, a, th: 5 }); });
		return html;
	},
});
caption(G0 + 0.4, 47.2, "Give it goals", `<span class="mono brand">/goal</span>   works turn after turn until a judge approves. Steer by talking to it.`);
command(G0 + 0.35, "/goal every test passes", G0 + 1.6);
command(G0 + 1.95, G_STEER, G0 + 4.2, 44);
for (const [at] of ROUNDS) cue(G0 + at, "tick");

shot(G0 - 0.45, 1.2, look(APP, { yaw: -30, pitch: 26, roll: 6, d: 380, x: CX + 420, y: WY + 300, z: 60 }), E.io5);

shot(G0 + 0.8, 3.8, look(APP, { yaw: -22, pitch: 23, roll: 4, d: 470, x: CX + 460, y: WY + 380, z: 110 }), E.lin);
shot(G0 + G_MET - 0.1, 1.0, look(APP, { yaw: -12, pitch: 17, roll: 2, d: 520, x: CX + 380, y: WY + WH - 290, z: 60 }), E.io);

// ---- 8. what it left running, and the page beside the chat --------------------------------------------------------

const H0 = 47.6;
mark(H0, "what it left running");
const H_PTR = [[0.7, PX + 560, WY + 720], [1.5, PX + 320, WY + 164]], H_CLICKS = [1.65];
const H_OPEN = (t) => E.spring(seg(t, 1.7, 2.9));
SCENES.push({
	id: "running", from: H0, to: 52.2,
	conv: (t, T, zc) => flow([{ k: "user", s: "start the shop, I want to see it", at: -9 }, { k: "tool", tool: ["bash", "npm run dev &", -9, -8, "0.4 s"], at: -9 }, { k: "ans", s: "It runs at localhost:5173.\nI left the dev server running.", at: -9 }], t, T, zc),
	tab: (t) => (t >= 1.65 ? "Browser" : "Running"),
	panel: (t, T, zp) => {
		if (t < 1.65) {
			const e = E.io(seg(t, 0.3, 1.0));
			let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, '<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">what this conversation left running</p>', { base: zp });
			[["npm run dev", "localhost:5173", "2 min"], ["vitest --watch", "", "41 s"]].forEach(([cmd, port, age], i) => {
				html += plate(PX + 16, WY + 126 + i * 82, PN - 32, 70, zp + 1 + (30 + 16 * i) * e, `<p style="position:absolute;left:20px;top:0;font:650 21px/70px var(--mono);white-space:pre">${cmd}</p><p style="position:absolute;right:150px;top:0;font:500 18px/70px var(--mono)" class="faint">${age}</p><div style="right:18px;top:15px;width:112px;height:40px"><p class="btn gh" style="line-height:40px;font-size:18px"><span class="bad">■</span> stop</p></div>`, { bg: "var(--c-surf)", r: 13, base: zp, th: 6 });
				if (port) html += plate(PX + 226, WY + 126 + 17, 184, 36, zp + 1 + 30 * e + 34 * e, `<p style="font:650 18px/36px var(--mono);text-align:center" class="info">${port}</p>`, { bg: "var(--c-blue)", side: "var(--c-blue-edge)", r: 10, base: zp + 1 + 30 * e, th: 4 });
			});
			return html + pointer(t, H_PTR, H_CLICKS, { from: 0.7, to: 1.65, z: zp + 190, base: zp + 66 });
		}
		// The page, opening out of the panel like a lid.
		const o = H_OPEN(t), e = E.io(seg(t, 2.5, 3.3));
		const x = PX + 16, y = WY + 76, w = PN - 32, h = 600;
		const inner = plate(0, 0, w, h, 0, `<div style="left:14px;top:12px;right:14px;height:40px;border-radius:10px;background:var(--sunk);font:500 18px/40px var(--mono);padding:0 16px;color:var(--muted)">localhost:5173/cart</div><p style="position:absolute;left:30px;top:78px;font:750 34px/1 var(--sans);letter-spacing:-.02em">Your cart</p>`, { bg: "var(--c-surf)", r: 14, thick: true, th: 8, line: true })
			+ [["Linen shirt", "39.00", "#c9d8e8"], ["Wool socks", "9.00", "#e8d5c4"]].map(([n, pr, col], i) => plate(30, 140 + i * 96, w - 60, 82, 1 + (18 + 10 * i) * e, `<div style="left:12px;top:11px;width:60px;height:60px;border-radius:10px;background:${col}"></div><p style="position:absolute;left:92px;top:0;font:600 22px/82px var(--sans)">${n}</p><p style="position:absolute;right:20px;top:0;font:600 22px/82px var(--mono)">${pr}</p>`, { bg: "#fafbf9", r: 12, base: 0.5, th: 5 })).join("")
			+ ink(30, 344, w - 60, 100, 1 + 14 * e, `<p style="font:500 21px/40px var(--sans);white-space:pre;color:var(--muted)">Shipping<span style="float:right" class="mono">4.90</span></p><p style="font:750 26px/50px var(--sans)">Total<span style="float:right" class="mono">52.90</span></p>`, { base: 0.5 })
			+ plate(30, 470, w - 60, 62, 1 + 44 * e, '<p class="btn" style="line-height:62px;font-size:23px">Check out</p>', { bg: "var(--brand)", side: "var(--c-brand-edge)", r: 13, base: 0.5, th: 8 });
		return `<div class="d3" style="${box(x, y, w, h)}transform-origin:50% 0;transform:translateZ(${f2(zp + 2 + 30 * o)}px) rotateX(${f2(-88 * (1 - o))}deg);opacity:${f2(seg(t, 1.68, 1.85))}">${inner}</div>`;
	},
});
caption(H0 + 0.4, 51.8, "Inspect your running services", `dev servers and their ports, stop and start, with an in-built browser`);
cue(H0 + 1.65, "click");

shot(H0 - 0.45, 1.2, look(APP, { yaw: 27, pitch: 21, roll: -5, d: 560, x: PX + 340, y: WY + 190, z: 60 }), E.io5);

shot(H0 + 0.8, 0.9, look(APP, { yaw: 23, pitch: 19, roll: -4, d: 640, x: PX + 380, y: WY + 170, z: 80 }), E.lin);
shot(H0 + 1.65, 1.2, look(APP, { yaw: -21, pitch: 27, roll: 5, d: 330, x: PX + 340, y: WY + 400, z: 70 }), E.io);
shot(H0 + 2.85, 1.8, look(APP, { yaw: -15, pitch: 22, roll: 3, d: 420, x: PX + 350, y: WY + 420, z: 70 }), E.lin);

// ---- 9. no restarts: what you set up is there in the next message --------------------------------------------------

const I0 = 52.2;
mark(I0, "no restarts");
const I_A = "add the Linear MCP server", I_C = "watch ~/Downloads for invoices", I_LINE = "Always run the tests before you say done.";
const live = (t, at) => (t >= at ? 0.25 + 0.75 * Math.exp(-(t - at) * 2.5) : 0);
SCENES.push({
	id: "live", from: I0, to: 60.0,
	comp: (t) => ({ text: t < 0.9 ? typed(I_A, t, 0.3, 50) : t > 5.0 && t < 5.6 ? typed(I_C, t, 5.05, 70) : "" }),
	conv: (t, T, zc) => {
		const up = (at) => 30 * E.o(seg(t, at, at + 0.4));
		let html = flow([
			{ k: "user", s: I_A, at: 0.9 }, { k: "tool", tool: ["add_mcp_server", "linear · https://mcp.linear.app", 1.05, 1.45, "you said yes"], at: 1.05 }, { k: "tool", tool: ["mcp__linear__list_issues", "assigned to me", 1.6, 2.0, "12 open"], at: 1.6, z: up(1.6), glow: live(t, 2.0) }, { k: "gap", h: 16 },
			{ k: "user", s: "tidy up the cart", at: 3.75 }, { k: "tool", tool: ["edit", "src/cart.ts", 3.9, 4.15, "14 ms"], at: 3.9 }, { k: "tool", tool: ["bash", "npm test", 4.2, 4.6, "31 passed"], at: 4.2, z: up(4.2), glow: live(t, 4.6) }, { k: "gap", h: 16 },
			{ k: "user", s: I_C, at: 5.6 }, { k: "tool", tool: ["add_source", "folder · ~/Downloads", 5.75, 6.1, "you said yes"], at: 5.75 },
			{ k: "raw", at: 6.6, h: 62, draw: (y, z, a) => plate(CX + 22, y + 6, CV - 44, 48, z + 44 * E.back(seg(t, 6.6, 7.0)), '<p style="font:500 20px/48px var(--mono);padding:0 14px;white-space:pre"><span class="warn" style="font-weight:700">⚡ folder</span>  <b>invoice-0412.pdf</b>  <span class="faint">arrived in ~/Downloads</span></p>', { bg: "var(--c-amber)", side: "var(--c-amber-edge)", r: 11, base: z - 1, a, th: 6 }) },
			{ k: "ans", s: "An invoice from Northwind: 214.80, due 12 December.", at: 7.0 },
		], t, T, zc);
		// It has been up all the while.
		html += plate(CX + CV - 388, WY + 12, 364, 36, zc + 2 + 30 * pop(t, 0.2, 0.5), `<p style="font:600 16.5px/36px var(--mono);text-align:center;white-space:pre" class="brand">● up 14 d 06:${String(12 + Math.floor((41 + t) / 60)).padStart(2, "0")}:${String(Math.floor(41 + t) % 60).padStart(2, "0")} · 0 restarts</p>`, { bg: "var(--c-green)", side: "var(--c-green-edge)", r: 18, base: zc, a: pop(t, 0.2, 0.4), th: 4 });
		return html;
	},
	tab: (t) => (t >= 2.6 && t < 5.0 ? "Files" : "Changes"),
	panel: (t, T, zp) => {
		if (t < 2.6) {
			// what the agent has, as it stands in its settings
			let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, '<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">MCP servers of this agent</p>', { base: zp });
			[["web", "search, fetch"], ["browser", "a real browser"], ["commands", "your own commands"], ["linear", "issues, projects"]].forEach(([n, d], i) => {
				const fresh = i === 3, a = fresh ? pop(t, 1.45, 0.35) : 1;
				html += plate(PX + 16, WY + 120 + i * 68, PN - 32, 58, zp + 1 + (fresh ? 12 + 60 * E.back(seg(t, 1.45, 1.9)) : 10), `<p style="position:absolute;left:20px;top:0;font:650 21px/58px var(--mono)">${n}</p><p style="position:absolute;left:200px;top:0;font:500 19px/58px var(--sans)" class="muted">${d}</p>${fresh ? '<p style="position:absolute;right:18px;top:14px"><span class="pill">live · no restart</span></p>' : ""}`, { bg: fresh ? "var(--c-green)" : "var(--c-surf)", side: fresh ? "var(--c-green-edge)" : "var(--c-edge)", r: 12, base: zp, a, th: 6 });
			});
			return html;
		}
		if (t < 5.0) {
			// its instructions, a line added
			const n = typed(I_LINE, t, 2.85, 52), lines = ["# shop", "", "TypeScript, no classes.", "Money is counted in cents.", ""];
			let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, `<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">AGENTS.md${t > 2.85 && t < 3.75 ? '   <span class="warn">●</span>' : t >= 3.75 ? '   <span class="brand">saved · read again</span>' : ""}</p>`, { base: zp });
			html += plate(PX + 16, WY + 116, PN - 32, 300, zp + 1 + 12, lines.map((s, i) => `<p class="dl" style="height:36px;line-height:36px;font-size:21px"><n>${i + 1}</n>${i === 0 ? `<b>${s}</b>` : esc(s)}</p>`).join(""), { bg: "var(--c-surf)", r: 12, base: zp, th: 6, style: "padding-top:12px;" });
			if (t >= 2.8) html += plate(PX + 17, WY + 116 + 12 + 5 * 36, PN - 34, 36, zp + 14 + 30 * E.o(seg(t, 2.8, 3.2)), `<p class="dl" style="height:36px;line-height:36px;font-size:21px"><n>6</n>${esc(n)}${t < 3.75 ? '<i class="ct"></i>' : ""}</p>`, { bg: "var(--c-add)", side: "var(--c-green-edge)", r: 6, base: zp + 13, th: 4, ghost: false });
			return html;
		}
		// the sources that wake this agent
		let html = ink(PX + 20, WY + 70, PN - 40, 32, zp + 1, '<p style="font:500 19px/32px var(--mono);color:var(--muted);white-space:pre">event sources of this agent</p>', { base: zp });
		[["telegram", "your own chat", "listening"], ["folder", "~/Downloads", "listening"]].forEach(([n, d, s], i) => {
			const fresh = i === 1, a = fresh ? pop(t, 6.1, 0.35) : 1;
			html += plate(PX + 16, WY + 120 + i * 68, PN - 32, 58, zp + 1 + (fresh ? 12 + 60 * E.back(seg(t, 6.1, 6.55)) : 10), `<p style="position:absolute;left:20px;top:0;font:650 21px/58px var(--mono)">${n}</p><p style="position:absolute;left:200px;top:0;font:500 19px/58px var(--mono)" class="muted">${d}</p><p style="position:absolute;right:18px;top:14px"><span class="pill ${fresh ? "" : "gr"}">${fresh ? "● listening · no restart" : "● listening"}</span></p>`, { bg: fresh ? "var(--c-green)" : "var(--c-surf)", side: fresh ? "var(--c-green-edge)" : "var(--c-edge)", r: 12, base: zp, a, th: 6 });
		});
		return html;
	},
});
caption(I0 + 0.3, I0 + 2.45, "Intuitive MCP", `Just tell it you want one, tools are available immediately, nothing is restarted`);
caption(I0 + 2.7, I0 + 4.85, "Changing instructions", `AGENTS.md is read as soon as it changes, no restarts either`);
caption(I0 + 5.1, I0 + 7.5, "Add event sources", `these allow your agents to wake and carry out work on their own`);
command(I0 + 0.3, I_A, I0 + 2.3, 50); cue(I0 + 1.45, "tick");
command(I0 + 2.85, I_LINE, I0 + 4.65, 52);
command(I0 + 5.05, I_C, I0 + 7.3, 70); cue(I0 + 6.1, "tick");

shot(I0 - 0.45, 1.2, look(APP, { yaw: 24, pitch: 19, roll: -4, d: 430, x: CX + 560, y: WY + 190, z: 40 }), E.io5);

shot(I0 + 0.8, 1.7, look(APP, { yaw: 19, pitch: 17, roll: -3, d: 500, x: CX + 620, y: WY + 220, z: 50 }), E.lin);
shot(I0 + 2.45, 0.8, look(APP, { yaw: -24, pitch: 21, roll: 4, d: 470, x: PX + 200, y: WY + 300, z: 40 }), E.io5);

shot(I0 + 3.25, 1.6, look(APP, { yaw: -19, pitch: 18, roll: 3, d: 520, x: PX + 120, y: WY + 330, z: 50 }), E.lin);
shot(I0 + 4.85, 0.8, look(APP, { yaw: 21, pitch: 25, roll: -5, d: 470, x: CX + 520, y: WY + 480, z: 40 }), E.io5);

shot(I0 + 5.65, 2.0, look(APP, { yaw: 16, pitch: 21, roll: -4, d: 530, x: CX + 500, y: WY + 520, z: 50 }), E.lin);

// ---- the end: the window goes back to the wall, and the name is set down in its place ------------------------------

const O0 = 60.0;
mark(O0, "the end");
END = 64.8;
SCENES.push({ id: "end", from: O0, to: END + 1 });
const LS = 0.25, LX = 960 - (3480 * LS) / 2, LY = 372;
function outroHTML(T) {
	const t = T - O0;
	if (t < 0.5) return "";
	let html = "";
	LOGO.forEach(([x, y, w, h], i) => {
		const at = 0.6 + (x / 3480) * 0.7 + rnd(i) * 0.25, p = E.o5(seg(t, at, at + 0.75)), a = seg(t, at, at + 0.15);
		html += plate(LX + x * LS, LY + y * LS, w * LS, h * LS, 9 + 700 * (1 - p), "", { bg: "#1a1d1b", side: "#0b0c0b", r: 1, base: 0, a, th: 8, ghost: false, sa: 1.2, style: "box-shadow:none;" });
	});
	const a = pop(t, 1.9, 0.6), b = pop(t, 2.3, 0.6);
	html += `<div style="left:0;top:${LY + 268}px;width:1920px;text-align:center;font:600 40px/1 var(--sans);letter-spacing:-.02em;white-space:pre;opacity:${f2(a)};transform:translateY(${f2((1 - a) * 16)}px)">chat  <span class="faint">·</span>  <span class="brand">code</span>  <span class="faint">·</span>  events</div>`;
	html += `<div style="left:0;top:${LY + 352}px;width:1920px;text-align:center;font:500 27px/1 var(--mono);color:var(--muted);white-space:pre;opacity:${f2(b)}">npm install -g @pmndre/pine</div>`;
	return html;
}
APP.draw = (t, T, c) => {
	const show = seg(T, BUILD, BUILD + 0.35) * (1 - E.io(seg(T, O0 + 0.1, O0 + 0.8)));
	return `<div class="d3" style="inset:0">${introHTML(T)}${show > 0 ? `<div class="d3" style="inset:0;transform:translateZ(${f2(-600 * E.i(seg(T, O0, O0 + 0.8)))}px)">${windowHTML(T, c, show)}</div>` : ""}${outroHTML(T)}</div>`;
};
shot(O0 - 0.2, 1.3, look(APP, { yaw: 14, pitch: 16, roll: -3, d: -60, y: 520 }), E.io);

shot(O0 + 1.1, 3.9, look(APP, { yaw: -7, pitch: 9, roll: 0, d: 120, y: 520 }), E.lin);
for (let i = 0; i < 6; i++) cue(O0 + 0.9 + i * 0.16, "tick");

DURATION = END;
