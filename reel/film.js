// The engine of the films that are one take through a 3D world (film.html): set pieces ("stations") stand
// in a space, each drawn as HTML by a function of the time, and one camera flies between them. As in
// engine.js, everything on screen is a pure function of the time: renderAt(t) draws second t, so the
// film is captured frame by frame.
//
// Motion blur is real: a frame in which something moves fast is drawn several times, at moments spread
// over the time the shutter is open (shutterTimes), and render.mjs averages the pictures. How many
// depends on how fast the camera moves (samplesAt).
"use strict";

const FPS = 30, P = 1800, W = 1920, H = 1080;
let SPEED = 1, DURATION = 0;
const SFX = [], MARKS = [];

// ---- numbers ---------------------------------------------------------------------------------------

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, p) => a + (b - a) * p;
/** How far t is from a to b, 0..1. */
const seg = (t, a, b) => clamp((t - a) / (b - a));
const E = {
	lin: (p) => p,
	io: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
	io5: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2),
	i: (p) => p * p * p,
	i5: (p) => p ** 5,
	o: (p) => 1 - Math.pow(1 - p, 3),
	o5: (p) => 1 - Math.pow(1 - p, 5),
	ox: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
	back: (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
	spring: (p) => (p >= 1 ? 1 : p <= 0 ? 0 : 1 - Math.exp(-6.5 * p) * Math.cos(11 * p)),
};
/** A number that is the same at every render: 0..1 for a whole number. */
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const f2 = (v) => (Math.abs(v) < 0.005 ? "0" : v.toFixed(2));

// ---- rotations (quaternions [w, x, y, z], in CSS's axes) --------------------------------------------

const RAD = Math.PI / 180;
const qAxis = (x, y, z, deg) => { const h = (deg * RAD) / 2, s = Math.sin(h); return [Math.cos(h), x * s, y * s, z * s]; };
const qX = (d) => qAxis(1, 0, 0, d), qY = (d) => qAxis(0, 1, 0, d), qZ = (d) => qAxis(0, 0, 1, d);
const qMul = (a, b) => [
	a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
	a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
	a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
	a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qInv = (q) => [q[0], -q[1], -q[2], -q[3]];
const qRot = (q, v) => { const r = qMul(qMul(q, [0, v[0], v[1], v[2]]), qInv(q)); return [r[1], r[2], r[3]]; };
function qSlerp(a, b, p) {
	let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
	if (dot < 0) { b = b.map((x) => -x); dot = -dot; }
	if (dot > 0.9995) { const r = a.map((x, i) => lerp(x, b[i], p)); const n = Math.hypot(...r); return r.map((x) => x / n); }
	const th = Math.acos(dot), s = Math.sin(th), wa = Math.sin((1 - p) * th) / s, wb = Math.sin(p * th) / s;
	return a.map((x, i) => x * wa + b[i] * wb);
}
const qAngle = (a, b) => 2 * Math.acos(clamp(Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]), 0, 1));
function qCss([w, x, y, z]) {
	const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0, 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, 0, 0, 0, 1];
	return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-6 ? "0" : v.toFixed(6))).join(",")})`;
}

// ---- html --------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const T3 = (x = 0, y = 0, z = 0) => `translate3d(${f2(x)}px,${f2(y)}px,${f2(z)}px)`;
/** Text that rises out of a line, a character after the other; with `out`, it leaves the same way. */
function kin(text, t, { at = 0, stagger = 0.022, dur = 0.55, out = null, y = 105 } = {}) {
	let i = 0;
	return `<span class="kin">${text.split(/(\s+)/).map((word) => (/^\s+$/.test(word) ? word : `<span class="kw">${[...word].map((ch) => {
		const a = at + i * stagger, p = E.o5(seg(t, a, a + dur));
		const q = out == null ? 0 : E.i(seg(t, out + i * 0.012, out + i * 0.012 + 0.28));
		i++;
		return `<i style="transform:translateY(${f2((1 - p) * y - q * y)}%);opacity:${f2(Math.min(p * 3, 1) * (1 - q))}">${esc(ch)}</i>`;
	}).join("")}</span>`)).join("")}</span>`;
}
/** What of `s` is typed at time t, when typing began at `at`. */
const typed = (s, t, at, cps = 34) => s.slice(0, clamp(Math.floor((t - at) * cps), 0, s.length));
const typeEnd = (s, at, cps = 34) => at + s.length / cps;
/** Appears: 0 before `at`, 1 after `dur`, eased. */
const pop = (t, at, dur = 0.4, ease = E.o5) => ease(seg(t, at, at + dur));

// ---- stations ----------------------------------------------------------------------------------------

const STATIONS = [];
/**
 * A set piece: where it stands, which way it faces (`rotateY(yaw) rotateX(pitch) rotateZ(roll)`), from
 * when to when it is drawn, and what draws it. `draw(t, T)` gets the seconds since `from` and the
 * film's time, and returns HTML for a 1920×1080 canvas whose middle is the station's place.
 */
function station(name, o, draw) {
	const st = { name, pos: o.pos, q: qMul(qMul(qY(o.yaw || 0), qX(o.pitch || 0)), qZ(o.roll || 0)), from: o.from, to: o.to, pre: o.pre ?? 1.4, post: o.post ?? 1.4, draw };
	STATIONS.push(st);
	return st;
}
/** A point of a station's canvas (0..1920, 0..1080, and how far in front of it) as a place in the world. */
const world = (st, x = 960, y = 540, z = 0) => { const r = qRot(st.q, [x - 960, y - 540, z]); return [st.pos[0] + r[0], st.pos[1] + r[1], st.pos[2] + r[2]]; };

// ---- the camera ---------------------------------------------------------------------------------------

const shots = [], follows = [], shakes = [], smears = [];
/**
 * A pose that looks at a station: at point (x, y, z) of its canvas, from in front, turned by `yaw`,
 * `pitch` and `roll` around that point (the station then looks rotated by rotateZ(roll) rotateX(pitch)
 * rotateY(yaw) rotateZ(spin)), and `d` closer (negative: further away).
 */
function look(st, o = {}) {
	const rel = qMul(qMul(qMul(qZ(o.roll || 0), qX(o.pitch || 0)), qY(o.yaw || 0)), qZ(o.spin || 0));
	return { p: world(st, o.x ?? 960, o.y ?? 540, o.z ?? 0), q: qMul(rel, qInv(st.q)), d: o.d || 0 };
}
/** From film time t on the camera moves to this pose, taking `dur` seconds. */
function shot(t, dur, pose, ease = E.io) { shots.push({ t, dur: Math.max(0.001, dur), pose, ease }); }
/** Between `from` and `to` the camera leans towards a moving point: fn(T) is a place in the world. */
function follow(from, to, fn, weight = 0.5, ramp = 0.5) { follows.push({ from, to, fn, weight, ramp }); }
/** A knock at film time t: the picture shakes and settles. */
function shake(t, amount = 1, dur = 0.5) { shakes.push({ t, amount, dur }); }
/** Between `from` and `to` every frame is drawn `n` times, for something that moves fast by itself. */
function smear(from, to, n = 8) { smears.push({ from, to, n }); }

function cameraAt(t) {
	const step = (a, k, time) => { const p = k.ease(clamp((time - k.t) / k.dur)); return { p: a.p.map((v, i) => lerp(v, k.pose.p[i], p)), q: qSlerp(a.q, k.pose.q, p), d: lerp(a.d, k.pose.d, p) }; };
	let from = shots[0].pose, v = from;
	for (let i = 0; i < shots.length && shots[i].t <= t; i++) {
		if (i) from = step(from, shots[i - 1], shots[i].t);
		v = step(from, shots[i], t);
	}
	let p = v.p.slice(), q = v.q, d = v.d;
	for (const f of follows) {
		const w = Math.min(seg(t, f.from, f.from + f.ramp), seg(f.to - t, 0, f.ramp));
		if (w > 0) { const g = f.fn(t), k = E.io(w) * f.weight; p = p.map((x, i) => lerp(x, g[i], k)); }
	}
	// A hand holds it: it is never quite still.
	q = qMul(qMul(qX(0.35 * Math.sin(t * 0.61 + 1.3)), qY(0.5 * Math.sin(t * 0.43))), q);
	let sx = 5 * Math.sin(t * 0.37 + 2), sy = 4 * Math.sin(t * 0.53);
	for (const s of shakes) {
		const u = t - s.t;
		if (u < 0 || u > s.dur) continue;
		const a = s.amount * Math.pow(1 - u / s.dur, 2.2);
		sx += a * 9 * Math.sin(u * 61); sy += a * 12 * Math.sin(u * 47 + 1);
		q = qMul(qZ(a * 0.5 * Math.sin(u * 53)), q);
	}
	return { p, q, d, sx, sy };
}
const cameraCss = (c) => `translate3d(${f2(c.sx)}px,${f2(c.sy)}px,${f2(c.d)}px) ${qCss(c.q)} ${T3(-c.p[0], -c.p[1], -c.p[2])}`;

/** How many times the frame at film time t is drawn: more the faster the camera moves. */
function samplesAt(t, max = 16) {
	const h = 0.5 / FPS, a = cameraAt(t - h), b = cameraAt(t + h);
	// A cut is no movement: nothing is smeared across it.
	if (shots.some((k) => k.dur < 0.01 && k.t > t - h && k.t <= t + h)) return 1;
	const zoom = P / Math.max(300, P - (a.d + b.d) / 2);
	const px = (Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) + Math.abs(b.p[2] - a.p[2]) * 0.45) * zoom + qAngle(a.q, b.q) * P * 0.9 + Math.abs(b.d - a.d) * 0.45 + Math.hypot(b.sx - a.sx, b.sy - a.sy);
	// Below a few pixels a frame nothing is drawn twice: two pictures a little apart are a double image, not a blur.
	let n = px < 5 ? 1 : Math.max(4, Math.round(px / 3.2));
	for (const s of smears) if (t >= s.from && t <= s.to) n = Math.max(n, s.n);
	return clamp(n, 1, max);
}

// ---- drawing ------------------------------------------------------------------------------------------

/** Set by a film: what is behind everything, what floats in the world, what the lens does to the picture (what is out of focus), and what lies over it. */
let SKY = () => "", BACKDROP = () => "", HUD = () => "", LENS = () => "";

/** Where a place in the world is in the picture, for a camera; `s` is how large things are there (0: behind the camera). */
function project(w, c) {
	const v = qRot(c.q, [w[0] - c.p[0], w[1] - c.p[1], w[2] - c.p[2]]);
	const z = v[2] + c.d;
	if (z > P - 40) return { x: 0, y: 0, s: 0 };
	const s = P / (P - z);
	return { x: W / 2 + (v[0] + c.sx) * s, y: H / 2 + (v[1] + c.sy) * s, s };
}
/** A line in the picture between two places in the world: drawn over the world, where no plane can cut it. */
function wire(a, b, c, colour = "rgba(93,228,199,.7)", width = 1.5) {
	const p = project(a, c), q = project(b, c);
	if (!p.s || !q.s) return;
	OVER += `<line x1="${f2(p.x)}" y1="${f2(p.y)}" x2="${f2(q.x)}" y2="${f2(q.y)}" stroke="${colour}" stroke-width="${width}"/>`;
}
/** What the stations of a frame drew over the world: SVG, in the picture's own measure. */
let OVER = "";

/** The time what lies over the picture is drawn for, when it is not the moment being drawn (see renderAt). */
let HUD_TIME = null;

function frameHTML(t) {
	const c = cameraAt(t);
	OVER = "";
	let html = BACKDROP(t, c);
	for (const st of STATIONS) {
		if (t < st.from - st.pre || t > st.to + st.post) continue;
		const inner = st.draw(t - st.from, t, c);
		if (inner) html += `<div class="station" style="transform:${T3(...st.pos)} ${qCss(st.q)}"><div class="st" data-st="${st.name}">${inner}</div></div>`;
	}
	return `<div class="sky">${SKY(t, c)}</div><div class="space"><div class="world" style="transform:${cameraCss(c)}">${html}</div></div>${OVER ? `<svg class="over" width="${W}" height="${H}">${OVER}</svg>` : ""}${LENS(t, c)}<div class="hud">${HUD(HUD_TIME ?? t, c)}</div>`;
}

const SHUTTER = 0.72;
/**
 * The moments a frame is made of, in the film's seconds: one when little moves, else several spread over
 * the time the shutter is open. render.mjs draws each and averages the pictures, which is motion blur.
 */
function shutterTimes(seconds, max = 20) {
	const n = samplesAt(seconds * SPEED, max);
	return Array.from({ length: n }, (_, k) => seconds + ((k + 0.5) / n - 0.5) * (SHUTTER / FPS));
}
/**
 * Draws second `seconds` of the film. In a browser a few moments may be stacked for a hint of the blur.
 * With `frame`, what lies over the picture (captions, what is typed) is drawn as it is at that second: the
 * moments of one frame then all carry the same words, and the blur of a moving camera does not smear them.
 */
function renderAt(seconds, stack = 1, frame = null) {
	HUD_TIME = frame == null ? null : frame * SPEED;
	const times = stack > 1 ? shutterTimes(seconds, stack) : [seconds];
	document.getElementById("film").innerHTML = times.map((ts, k) => `<div class="sub" style="opacity:${(1 / (k + 1)).toFixed(5)}">${frameHTML(ts * SPEED)}</div>`).join("");
	// The grain is another one in every frame, and the same one in every render.
	const g = document.getElementById("grainseed");
	if (g) g.setAttribute("seed", String(1 + Math.round(seconds * FPS) % 97));
}

// ---- sound cues (render.mjs writes them down, sound.py makes the sounds) -------------------------------

const cue = (t, k) => SFX.push({ t, k });
let seed = 7;
const dice = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
/** The sound of `s` being typed from film time t on, at the pace of a hand whatever the text's own pace is. */
function keys(t, s, cps = 34) {
	const dur = s.length / cps;
	for (let u = 0.02 + dice() * 0.03; u < dur; ) {
		const ch = s[Math.min(s.length - 1, Math.floor((u / dur) * s.length))];
		cue(t + u, ch === " " ? "key-space" : "key");
		u += Math.max(1 / cps, dice() < 0.12 ? 0.16 + dice() * 0.08 : 0.066 + dice() * 0.06);
	}
}
const mark = (t, name) => MARKS.push([t, name]);

// ---- watching it in a browser ----------------------------------------------------------------------------

/** Opened by hand, the film plays: space stops and starts it, the arrow keys step, a click on the bar jumps. */
function play() {
	if (navigator.webdriver) return;
	const stage = document.getElementById("stage"), bar = document.getElementById("scrub");
	const fitStage = () => { const s = Math.min(innerWidth / W, (innerHeight - 30) / H); stage.style.transform = `scale(${s})`; };
	addEventListener("resize", fitStage); fitStage();
	let now = Number(new URLSearchParams(location.search).get("t") || 0), going = !new URLSearchParams(location.search).has("t"), last = performance.now();
	const tick = (ms) => {
		if (going) now = (now + (ms - last) / 1000) % DURATION;
		last = ms;
		renderAt(now, 3);
		bar.firstElementChild.style.width = `${(now / DURATION) * 100}%`;
		bar.lastElementChild.textContent = `${now.toFixed(2)} s`;
		requestAnimationFrame(tick);
	};
	addEventListener("keydown", (e) => {
		if (e.key === " ") going = !going;
		if (e.key === "ArrowRight") now = Math.min(DURATION - 0.01, now + (e.shiftKey ? 1 : 1 / FPS)), (going = false);
		if (e.key === "ArrowLeft") now = Math.max(0, now - (e.shiftKey ? 1 : 1 / FPS)), (going = false);
	});
	bar.style.display = "block";
	bar.addEventListener("click", (e) => { now = (e.clientX / innerWidth) * DURATION; });
	requestAnimationFrame(tick);
}
