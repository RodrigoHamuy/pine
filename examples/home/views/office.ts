// office: pine as an office building, cut open, seen from the street. A view for the panel of the Pine
// app (docs/references/views.md); it draws what "pine/view" tells it and nothing else.
//
//   an agent            an office with its robot, each robot made from the agent's name; the main agent works
//                       in the penthouse, the others on the floors below, filled from the street up
//   at rest             the robot sits at its desk at the computer, now and then gets a coffee or looks out of
//                       the window; the office is dim
//   at work             the office lights up; the robot reads at its shelf while it thinks, types while it uses
//                       a tool or writes, waits with an hourglass while others work for it, stands and waves
//                       with a red ! while it asks you
//   a copy (sub-agent)  a smaller robot just like it, for as long as the copy works
//   a task handed on    a phone call: both phones ring, the line between them lights up; the answer is a call back
//   events              capsules through pneumatic pipes, from the mailroom in the lobby (your box, a box for
//                       each event source, the clock above the door for schedules) up the shaft to the office
//   its mode            a shield on the wall for a sandbox (safe; a lock under it for manual); nothing for
//                       auto; a red alarm light and hazard tape for bypass
//   held to a mode      a shield on the robot's chest; outside content: an amber sign, and amber eyes
//   the sky             your local time: day, dusk and night, the sun, the moon in tonight's phase
//
// A camera goes where agents work: close for one office, further out for several, the whole building
// when nothing happens. Scroll, drag or pinch to look yourself; the target button follows again.
// Click an office or a robot to see it under the view; double-click to open it.

import { along, type Box, type Cam, defineView, ease, frame, hashOf, inside, lengthOf, mix, type Pt, seeded, shade, union, type ViewAgent, type ViewHost, type ViewInput, type ViewState, type ViewWork } from "pine/view";

// ---- what is there, each frame ----------------------------------------------------------------------------------------

/** The state, with the lookups the drawing needs. */
export interface Now {
	agents: ViewAgent[];
	agent: Map<string, ViewAgent>;
	work: Map<number, ViewWork>;
	running: ViewWork[];
	inputs: ViewInput[];
	input: Map<string, ViewInput>;
	dark: boolean;
	focused: boolean;
}

const ENDED = ["done", "failed", "cancelled"];
const ended = (w: ViewWork) => ENDED.includes(w.doing);

export function nowOf(s: ViewState): Now {
	const running = s.work.filter((w) => !ended(w)).sort((a, b) => a.started - b.started);
	return { agents: s.agents, agent: new Map(s.agents.map((a) => [a.id, a])), work: new Map(s.work.map((w) => [w.id, w])), running, inputs: s.inputs, input: new Map(s.inputs.map((i) => [i.id, i])), dark: s.dark, focused: s.focused !== false };
}

/** The way in a piece of work came through, if it came through one. */
function portOf(w: ViewWork): string | undefined {
	const f = w.from;
	return f.k === "you" ? "you" : f.k === "clock" ? "clock" : f.k === "source" ? `source:${f.name}` : f.k === "outside" ? `outside:${f.name}` : undefined;
}

/** What a piece of work does, in a few words: no text of its own, only what the state says. */
export function doingOf(w: ViewWork): string {
	if (w.asking) return "asks you";
	if (w.doing === "tool") return w.tool ? w.tool.replace(/^mcp__/, "").replace(/__/g, " ") : "a tool";
	if (w.doing === "waiting") return "waits for others";
	return w.doing;
}

/** What a working robot's bubble says. */
export interface Say {
	kind: "think" | "tool" | "mcp" | "write" | "wait" | "ask" | "phone";
	text: string;
}

/** The look of each kind of bubble: its sign and its color. */
export const SAYS: Record<Say["kind"], { sign: string; color: string }> = {
	think: { sign: "💭", color: "#8b5cf6" },
	tool: { sign: "🔧", color: "#d97706" },
	mcp: { sign: "🔌", color: "#0891b2" },
	write: { sign: "✍️", color: "#2563eb" },
	wait: { sign: "⏳", color: "#64748b" },
	ask: { sign: "❗", color: "#dc2626" },
	phone: { sign: "📞", color: "#16a34a" },
};

/** What a piece of work is doing, for its bubble: no words of its own, only what the state says. */
export function sayOf(w: ViewWork, s: Now, now: number): Say {
	if (w.asking) return { kind: "ask", text: "asks you" };
	if (w.doing === "tool" && w.tool === "delegate") return { kind: "phone", text: "handing on" };
	if (w.doing === "tool" && w.mcp) return { kind: "mcp", text: `${w.mcp} · ${(w.tool ?? "").replace(/^mcp__[^_]+__/, "").replace(/_/g, " ")}` };
	if (w.doing === "tool") return { kind: "tool", text: (w.tool ?? "a tool").replace(/_/g, " ") };
	if (w.doing === "writing") return { kind: "write", text: "writing" };
	if (w.doing === "waiting") {
		const on = [...new Set(w.waitingOn.map((id) => s.work.get(id)).filter((x): x is ViewWork => Boolean(x && !ended(x))).map((x) => (x.copy ? "copies" : x.agent)))];
		return { kind: "wait", text: on.length ? `waits for ${on.join(", ")}` : "waits" };
	}
	return { kind: "think", text: `thinking${".".repeat(1 + (Math.floor(now / 400) % 3))}` };
}

// ---- the sky ---------------------------------------------------------------------------------------------------------

export interface Glow {
	x: number;
	y: number;
	r: number;
	color: string;
	a: number;
}

export interface Sky {
	day: number;
	dusk: number;
	sun?: { across: number; up: number };
	moon: { across: number; up: number; phase: number };
	top: string;
	bottom: string;
	stars: number;
	hour: number;
}

/** The clock the sky follows: the owner's own. A test or a demo may set another. */
let clock = () => new Date();
export const setClock = (fn: () => Date) => void (clock = fn);

const NIGHT = { top: "#070b1f", bottom: "#1a2350" };
const DAY = { top: "#4f9fe3", bottom: "#c4e6f8" };
const DUSK = { top: "#3a3f86", bottom: "#f6a16a" };
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = (a: number, b: number, v: number) => {
	const t = clamp((v - a) / (b - a));
	return t * t * (3 - 2 * t);
};

/** The sky at a time. The view knows the time and not where the owner is: the day is as long as at a middle northern latitude. */
export function skyAt(date: Date): Sky {
	const hour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
	const doy = (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / 86_400_000;
	const length = 12 + 4 * Math.sin((2 * Math.PI * (doy - 80)) / 365.25);
	const rise = 12.5 - length / 2;
	const set = 12.5 + length / 2;
	const across = (hour - rise) / length;
	const up = across > 0 && across < 1 ? Math.sin(Math.PI * across) : -Math.min(1, Math.min(Math.abs(hour - rise), Math.abs(hour - set), Math.abs(hour + 24 - rise), Math.abs(hour - 24 - set)) / 1.5);
	const day = smooth(-0.15, 0.2, up);
	const dusk = clamp(1 - Math.abs(up) / 0.5) * 0.85;
	const phase = ((((date.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86_400_000 / 29.530588) % 1) + 1) % 1;
	const intoNight = ((hour - set + 24) % 24) / (24 - length);
	const moon = { across: clamp(intoNight), up: intoNight < 1 ? Math.sin(Math.PI * clamp(intoNight)) : 0, phase };
	const top = mix(mix(NIGHT.top, DAY.top, day), DUSK.top, dusk * 0.5);
	const bottom = mix(mix(NIGHT.bottom, DAY.bottom, day), DUSK.bottom, dusk);
	return { day, dusk, sun: up > -0.05 ? { across: clamp(across), up: Math.max(0, up) } : undefined, moon, top, bottom, stars: clamp(1 - day * 1.6), hour };
}

const STARS = (() => {
	const r = seeded(7);
	return Array.from({ length: 90 }, () => ({ x: r(), y: r(), b: r() }));
})();

export function disc(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
	ctx.fillStyle = color;
	for (let dy = -r; dy <= r; dy++) {
		const half = Math.floor(Math.sqrt(r * r + r - dy * dy));
		ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
	}
}

function cloud(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, shadow: string, seed: number): void {
	const r = seeded(seed);
	const blobs = Array.from({ length: 4 + Math.floor(r() * 3) }, (_, i) => ({ dx: (i - 2) * size * 0.9 + r() * 3, dy: -r() * size * 0.7, rad: size * (0.7 + r() * 0.6) }));
	for (const [c, lift] of [[shadow, 0], [color, 1]] as const) {
		ctx.fillStyle = c;
		for (const b of blobs) {
			const rad = Math.round(b.rad);
			for (let dy = -rad; dy <= 0; dy++) {
				const half = Math.floor(Math.sqrt(rad * rad - dy * dy));
				ctx.fillRect(Math.round(cx + b.dx - half), Math.round(cy + b.dy + dy - lift), half * 2 + 1, 1);
			}
		}
	}
}

/** The sky, down to the horizon: bands of color, stars, the sun or the moon, clouds, birds now and then, a plane. */
function drawSky(ctx: CanvasRenderingContext2D, w: number, h: number, horizon: number, sky: Sky, t: number, glows: Glow[]): void {
	const bands = Math.max(8, Math.floor(horizon / 6));
	for (let i = 0; i < bands; i++) {
		ctx.fillStyle = mix(sky.top, sky.bottom, i / (bands - 1));
		ctx.fillRect(0, Math.floor((i * horizon) / bands), w, Math.ceil(horizon / bands) + 1);
	}
	ctx.fillStyle = sky.bottom;
	ctx.fillRect(0, horizon, w, h - horizon);
	if (sky.stars > 0.02) {
		for (const s of STARS) {
			const twinkle = 0.5 + 0.5 * Math.sin(t / 700 + s.b * 40);
			ctx.globalAlpha = sky.stars * (0.35 + 0.65 * s.b * twinkle);
			ctx.fillStyle = s.b > 0.85 ? "#fff6d8" : "#dfe8ff";
			ctx.fillRect(Math.floor(s.x * w), Math.floor(s.y * horizon * 0.8), 1, 1);
		}
		ctx.globalAlpha = 1;
	}
	const arc = (across: number, up: number) => ({ x: Math.round(w * (0.08 + 0.84 * across)), y: Math.round(horizon - 14 - up * (horizon - 30)) });
	if (sky.sun) {
		const p = arc(sky.sun.across, sky.sun.up);
		disc(ctx, p.x, p.y, 7, mix("#ffd25a", "#ff9a4a", sky.dusk));
		disc(ctx, p.x, p.y, 5, mix("#fff1b0", "#ffc27a", sky.dusk));
		glows.push({ x: p.x, y: p.y, r: 30, color: "#ffd77a", a: 0.5 });
	}
	if (sky.moon.up > 0 && sky.day < 0.7) {
		const p = arc(sky.moon.across, sky.moon.up);
		const r = 5;
		disc(ctx, p.x, p.y, r, "#f3efd8");
		ctx.fillStyle = "#c9c4a8";
		ctx.fillRect(p.x - 2, p.y - 1, 2, 2);
		ctx.fillRect(p.x + 1, p.y + 2, 1, 1);
		// Waxing, it is lit from the right and the shadow moves off to the left; waning, the other way round.
		const ph = sky.moon.phase;
		const off = Math.round(2 * r * (ph < 0.5 ? ph / 0.5 : (1 - ph) / 0.5)) * (ph < 0.5 ? -1 : 1);
		if (Math.abs(ph - 0.5) > 0.03) disc(ctx, p.x + off, p.y, r, mix(sky.top, sky.bottom, p.y / horizon));
		glows.push({ x: p.x, y: p.y, r: 18, color: "#dfe6ff", a: 0.35 * (1 - sky.day) });
	}
	const night = 1 - sky.day;
	const white = mix(mix("#ffffff", "#ffd9c4", sky.dusk), "#3a4468", night * 0.85);
	const under = mix(mix("#d7e6f2", "#e9a98f", sky.dusk), "#2b3355", night * 0.85);
	for (let i = 0; i < 7; i++) {
		const r = seeded(100 + i);
		const speed = 0.002 + r() * 0.004;
		const span = w + 80;
		const x = ((r() * span + t * speed) % span) - 40;
		const y = 12 + r() * horizon * 0.5;
		ctx.globalAlpha = 0.95 - night * 0.35;
		cloud(ctx, x, y, 4 + r() * 4, white, under, 200 + i);
	}
	ctx.globalAlpha = 1;
}

/** Birds now and then by day, a plane high up: drawn every frame over the sky, which is drawn less often. */
function drawFliers(ctx: CanvasRenderingContext2D, w: number, horizon: number, sky: Sky, t: number, glows: Glow[]): void {
	if (sky.day > 0.4) {
		const cycle = 26_000;
		const k = (t % cycle) / 14_000;
		if (k < 1) {
			const r = seeded(Math.floor(t / cycle));
			const dir = r() > 0.5 ? 1 : -1;
			const y0 = 18 + r() * horizon * 0.45;
			ctx.fillStyle = "#2b2f3a";
			for (let b = 0; b < 4 + Math.floor(r() * 3); b++) {
				const bx = Math.round(dir > 0 ? -20 + k * (w + 40) - b * 7 : w + 20 - k * (w + 40) + b * 7);
				const by = Math.round(y0 + Math.abs(b - 2) * 3 + Math.sin(t / 300 + b) * 1.5);
				const flap = Math.floor(t / 180 + b) % 2;
				ctx.fillRect(bx - 2, by - flap, 1, 1);
				ctx.fillRect(bx - 1, by, 1, 1);
				ctx.fillRect(bx, by + 1, 1, 1);
				ctx.fillRect(bx + 1, by, 1, 1);
				ctx.fillRect(bx + 2, by - flap, 1, 1);
			}
		}
	}
	const cycle = 47_000;
	const k = (t % cycle) / 20_000;
	if (k < 1) {
		const r = seeded(Math.floor(t / cycle) + 999);
		const dir = r() > 0.5 ? 1 : -1;
		const y = 8 + Math.round(r() * horizon * 0.25);
		const x = Math.round(dir > 0 ? -15 + k * (w + 30) : w + 15 - k * (w + 30));
		if (sky.day > 0.35) {
			ctx.globalAlpha = 0.7;
			ctx.fillStyle = "#ffffff";
			ctx.fillRect(dir > 0 ? x - 40 : x + 5, y + 1, 36, 1);
			ctx.globalAlpha = 1;
			ctx.fillStyle = "#e8edf3";
			ctx.fillRect(x - 3, y, 8, 2);
			ctx.fillStyle = "#9aa6b5";
			ctx.fillRect(dir > 0 ? x - 3 : x + 4, y - 2, 1, 2);
			ctx.fillRect(x, y + 2, 2, 1);
		} else {
			ctx.fillStyle = "#30364a";
			ctx.fillRect(x - 3, y, 8, 2);
			const on = Math.floor(t / 500) % 2 === 0;
			ctx.fillStyle = on ? "#ff4d4d" : "#ffffff";
			ctx.fillRect(dir > 0 ? x + 4 : x - 3, y, 1, 1);
			glows.push({ x: dir > 0 ? x + 4 : x - 3, y, r: 6, color: on ? "#ff4d4d" : "#ffffff", a: 0.8 });
		}
	}
}

// ---- the robots --------------------------------------------------------------------------------------------------------

export interface Look {
	head: number;
	eyes: number;
	antenna: number;
	body: number;
	feet: number;
	metal: string;
	seed: number;
}

type Pose = "sit" | "stand" | "walk" | "type" | "read" | "phone" | "coffee" | "ask" | "back";

const METALS = ["#eef2f6", "#f3e8d2", "#d9f2e7", "#e7e1f6", "#f6e0e0", "#dde9f7", "#f4f1c9", "#e2e6ea"];
const INK = "#1b2130";
const EYE = "#8ff4ff";

/** The robot of an agent, from its name: different for each, the same every time. */
export function lookOf(id: string): Look {
	const r = seeded(hashOf(id));
	const pick = (n: number) => Math.floor(r() * n);
	return { head: pick(4), eyes: pick(4), antenna: pick(4), body: pick(3), feet: pick(3), metal: METALS[pick(METALS.length)], seed: hashOf(id) };
}

function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
	ctx.fillStyle = color;
	ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: number, color: string): void {
	ctx.fillStyle = color;
	for (let j = 0; j < h; j++) {
		const c = Math.max(0, cut - Math.min(j, h - 1 - j));
		ctx.fillRect(x + c, y + j, w - 2 * c, 1);
	}
}

/** A robot with its feet at (`x`, `y`), `x` its middle; seated, `y` is the seat. Returns the box it takes. */
function drawRobot(ctx: CanvasRenderingContext2D, look: Look, color: string, x: number, y: number, o: { pose: Pose; t: number; small?: boolean; seated?: boolean; eye?: string; shield?: boolean; warn?: boolean; lit?: boolean }): Box {
	const s = o.small;
	const HW = s ? 6 : 10;
	const HH = s ? 5 : 7;
	const BW = s ? 4 : 8;
	const BH = s ? 3 : 5;
	const LEG = s ? 2 : 3;
	const t = o.t + (look.seed % 1000);
	const walking = o.pose === "walk";
	const hover = look.feet === 2;
	const bob = hover ? Math.round(Math.sin(t / 250)) : 0;
	const feetY = Math.round(y) - (hover && !o.seated ? 2 : 0) - bob;
	const bodyBottom = o.seated ? feetY : feetY - LEG;
	const bodyTop = bodyBottom - BH;
	const headBottom = bodyTop - 1;
	const headTop = headBottom - HH;
	const cx = Math.round(x);
	const hx = cx - HW / 2;
	const bx = cx - BW / 2;
	const metal = look.metal;
	const trim = shade(metal, -0.25);
	const back = o.pose === "back";
	if (!o.seated) {
		if (look.feet === 0) {
			const step = walking ? Math.floor(t / 140) % 2 : 0;
			rect(ctx, bx + 1, bodyBottom, 1, LEG - (step ? 1 : 0), INK);
			rect(ctx, bx + BW - 2, bodyBottom, 1, LEG - (step ? 0 : 1), INK);
			rect(ctx, bx, feetY - 1, 2, 1, INK);
			rect(ctx, bx + BW - 2, feetY - 1, 2, 1, INK);
		} else if (look.feet === 1) {
			rect(ctx, cx - 1, bodyBottom, 2, 1, INK);
			rect(ctx, cx - 2, bodyBottom + 1, 4, LEG - 1, INK);
			rect(ctx, cx - 1 + (walking ? Math.floor(t / 90) % 2 : 0), bodyBottom + 1, 1, 1, trim);
		} else rect(ctx, cx - BW / 2 + 1, feetY + 1, BW - 2, 1, shade(color, 0.4));
	}
	const armY = bodyTop + 1;
	const left = bx - 1;
	const right = bx + BW;
	const tap = Math.floor(t / 110) % 2;
	if (o.pose === "type") {
		rect(ctx, left, armY, 1, BH - 1 - tap, INK);
		rect(ctx, right, armY, 1, BH - 2 + tap, INK);
	} else if (o.pose !== "read" && o.pose !== "coffee" && o.pose !== "phone" && o.pose !== "ask") {
		rect(ctx, left, armY + (walking ? tap : 0), 1, BH - 1, INK);
		rect(ctx, right, armY + (walking ? 1 - tap : 0), 1, BH - 1, INK);
	}
	rect(ctx, bx - 1, bodyTop - 1, BW + 2, BH + 2, INK);
	if (look.body === 0) rect(ctx, bx, bodyTop, BW, BH, color);
	else if (look.body === 1) rounded(ctx, bx, bodyTop, BW, BH, 1, color);
	else {
		rect(ctx, bx, bodyTop, BW, BH - 1, color);
		rect(ctx, bx + 1, bodyTop + BH - 1, BW - 2, 1, color);
	}
	rect(ctx, bx, bodyTop, BW, 1, shade(color, 0.3));
	if (!s && !back) {
		if (o.shield) {
			rect(ctx, cx - 2, bodyTop + 1, 4, 2, "#3aa7f0");
			rect(ctx, cx - 1, bodyTop + 3, 2, 1, "#3aa7f0");
			rect(ctx, cx - 1, bodyTop + 1, 2, 1, "#bfe7ff");
		} else rect(ctx, cx - 1, bodyTop + 2, 2, 1, o.lit ? shade(color, 0.7) : shade(color, -0.3));
	}
	rect(ctx, cx - 1, headBottom, 2, 1, INK);
	const cut = look.head === 0 ? 2 : look.head === 1 ? 1 : 0;
	if (look.head === 2) {
		const d = s ? 2 : 3;
		rounded(ctx, hx - 1, headTop - 1, HW + 2, HH + 2, 1, INK);
		ctx.fillStyle = metal;
		for (let j = 0; j < HH; j++) {
			const c = Math.max(0, d - j);
			ctx.fillRect(hx + c, headTop + j, HW - 2 * c, 1);
		}
		ctx.fillStyle = INK;
		for (let j = 0; j < d; j++) {
			ctx.fillRect(hx + d - j - 1, headTop + j, 1, 1);
			ctx.fillRect(hx + HW - d + j, headTop + j, 1, 1);
		}
	} else {
		rounded(ctx, hx - 1, headTop - 1, HW + 2, HH + 2, cut, INK);
		rounded(ctx, hx, headTop, HW, HH, Math.max(0, cut - 1), metal);
		if (look.head === 3) {
			rect(ctx, hx - 2, headTop + 2, 1, HH - 4, INK);
			rect(ctx, hx + HW + 1, headTop + 2, 1, HH - 4, INK);
		}
	}
	rect(ctx, hx, headBottom - 1, HW, 1, trim);
	const tip = o.lit && Math.floor(t / 400) % 2 === 0 ? shade(color, 0.5) : trim;
	if (look.antenna === 1) {
		rect(ctx, cx, headTop - (s ? 2 : 3), 1, s ? 2 : 3, INK);
		rect(ctx, cx - (s ? 0 : 1), headTop - (s ? 3 : 5), s ? 1 : 2, s ? 1 : 2, tip);
	} else if (look.antenna === 2) {
		rect(ctx, hx + 1, headTop - 2, 1, 2, INK);
		rect(ctx, hx + HW - 2, headTop - 2, 1, 2, INK);
		rect(ctx, hx + 1, headTop - 3, 1, 1, tip);
		rect(ctx, hx + HW - 2, headTop - 3, 1, 1, tip);
	} else if (look.antenna === 3 && !s) {
		rect(ctx, cx, headTop - 1, 1, 1, INK);
		rect(ctx, cx + 1, headTop - 2, 1, 1, INK);
		rect(ctx, cx, headTop - 3, 1, 1, INK);
		rect(ctx, cx + 1, headTop - 4, 1, 1, tip);
	}
	const eye = o.eye ?? EYE;
	if (back) {
		rect(ctx, hx + 2, headTop + 2, HW - 4, 1, trim);
		rect(ctx, hx + 2, headTop + 4, HW - 4, 1, trim);
	} else {
		const fx = hx + (s ? 1 : 2);
		const fy = headTop + (s ? 1 : 2);
		const fw = HW - (s ? 2 : 4);
		const fh = HH - (s ? 2 : 4);
		const blink = t % 4200 < 140;
		if (look.eyes !== 3) rect(ctx, fx, fy, fw, fh, "#1a2232");
		if (s) {
			rect(ctx, fx + 1, fy + 1, 1, blink ? 0 : 1, eye);
			rect(ctx, fx + fw - 2, fy + 1, 1, blink ? 0 : 1, eye);
		} else if (look.eyes === 0) {
			rect(ctx, fx + 1, fy + 1, 1, blink ? 1 : 2, eye);
			rect(ctx, fx + fw - 2, fy + 1, 1, blink ? 1 : 2, eye);
		} else if (look.eyes === 1) {
			rect(ctx, fx + 1, fy + 1, fw - 2, 1, shade(eye, -0.45));
			rect(ctx, fx + 1 + (Math.floor(t / 250) % (fw - 2)), fy + 1, 1, 1, eye);
		} else if (look.eyes === 2) {
			rect(ctx, fx + fw / 2 - 1, fy, 2, 3, blink ? "#1a2232" : eye);
			if (!blink) rect(ctx, fx + fw / 2 - 1 + (Math.floor(t / 900) % 2), fy + 1, 1, 1, "#1a2232");
		} else {
			for (const ex of [fx + 1, fx + fw - 4]) {
				rect(ctx, ex, fy + 2, 1, 1, o.eye ?? INK);
				rect(ctx, ex + 1, fy + 1, 1, 1, o.eye ?? INK);
				rect(ctx, ex + 2, fy + 2, 1, 1, o.eye ?? INK);
			}
		}
	}
	if (o.pose === "read") {
		const flip = Math.floor(t / 700) % 3 === 0;
		rect(ctx, cx - (s ? 2 : 4), bodyTop + 1, s ? 4 : 8, s ? 3 : 4, INK);
		rect(ctx, cx - (s ? 1 : 3), bodyTop + 2, s ? 2 : 6, s ? 1 : 2, "#f7f2e4");
		rect(ctx, cx, bodyTop + 2, 1, s ? 1 : 2, flip ? "#d8cfb8" : INK);
		rect(ctx, left, bodyTop + 2, 1, 2, INK);
		rect(ctx, right, bodyTop + 2, 1, 2, INK);
	} else if (o.pose === "coffee") {
		rect(ctx, left, armY, 1, BH - 1, INK);
		rect(ctx, right, armY, 1, 2, INK);
		rect(ctx, right + 1, armY - 1, 2, 3, "#ffffff");
		rect(ctx, right + 1, armY - 1, 2, 1, "#6b3f22");
		rect(ctx, right + 1 + (Math.floor(t / 300) % 2), armY - 3 - (Math.floor(t / 300) % 2), 1, 1, "#c9d3de");
	} else if (o.pose === "phone") {
		rect(ctx, left, armY, 1, BH - 1, INK);
		rect(ctx, right, headBottom - 2, 1, 4, INK);
		rect(ctx, right, headTop + 1, 2, HH - 1, "#2b2b33");
	} else if (o.pose === "ask") {
		const wave = Math.floor(t / 200) % 2;
		rect(ctx, left - 1, headTop + 1 + wave, 1, 4, INK);
		rect(ctx, right + 1, headTop + 2 - wave, 1, 4, INK);
	}
	if (o.warn) {
		const wx = hx + HW + 1;
		const wy = headTop - 3;
		rect(ctx, wx + 2, wy, 1, 1, "#ffb21f");
		rect(ctx, wx + 1, wy + 1, 3, 1, "#ffb21f");
		rect(ctx, wx, wy + 2, 5, 1, "#ffb21f");
		rect(ctx, wx + 2, wy + 1, 1, 1, INK);
	}
	return { x: hx - 2, y: headTop - 4, w: HW + 4, h: feetY - headTop + 5 };
}

// ---- the building ------------------------------------------------------------------------------------------------------

export type Hit = { k: "agent"; id: string } | { k: "work"; id: number } | { k: "port"; id: string } | undefined;

export const ROOM_W = 76;
const ROOM_H = 42;
const SLAB = 4;
const PENT_H = 50;
const WALL = 4;
const SHAFT = 12;
const LOBBY_H = 48;
const STREET_H = 40;
const SKY_H = 78;
const ROOF_H = 14;
const SIDE = 64;
const WALK = 0.022;
const CAPSULE = 0.11;
const CALL_MS = 2800;
const LINGER = 2500;
export const Z_MAX = 6;
const MIN = { w: ROOM_W * 1.5, h: ROOM_H * 1.7 };

export interface Room {
	agent: string;
	main: boolean;
	x: number;
	y: number;
	w: number;
	h: number;
	floorY: number;
	desk: number;
	seat: Pt;
	shelf: number;
	coffee: number;
	windows: Box[];
	outlet: Pt;
	phone: Pt;
	look: Look;
	/** The books on its shelf, each x, y, width, height and color, and whether it has a plant: worked out once. */
	books: Array<[number, number, number, number, string]>;
	plant: boolean;
}

interface Port {
	id: string;
	kind: ViewInput["kind"];
	name: string;
	box: Box;
	mouth: Pt;
}

type Act = "sit" | "type" | "phone" | "wait" | "read" | "coffee" | "window" | "ask" | "stand";

interface Worker {
	key: string;
	agent: string;
	work?: number;
	small: boolean;
	extra: boolean;
	x: number;
	act: Act;
	walking: boolean;
	until: number;
	idle: Act;
	mug: number;
	born: number;
	goneAt?: number;
	rand: () => number;
	box?: Box;
}

interface Capsule {
	path: Pt[];
	at: number;
	ms: number;
	color: string;
	to?: string;
}

interface Walker {
	x: number;
	dir: 1 | -1;
	speed: number;
	shirt: string;
	pants: string;
	skin: string;
	hair: string;
	dog?: string;
}

interface Car {
	x: number;
	dir: 1 | -1;
	speed: number;
	kind: "car" | "cab" | "van" | "bus";
	color: string;
}

const SHIRTS = ["#e05a47", "#3d7dd8", "#f2b134", "#4caf7a", "#9b59b6", "#ec7fa9", "#2c3e50", "#f0f0f0", "#1abc9c"];
const SKINS = ["#f1c7a5", "#d9a47c", "#a86f4c", "#6e4430", "#f6dcc4"];
const HAIRS = ["#2b1d14", "#5b3a24", "#c99a4b", "#111111", "#8a8a8a", "#b5532c"];
const CARS = ["#d1495b", "#2e86de", "#f5f6fa", "#2d3436", "#20bf6b", "#8854d0", "#a5b1c2"];
const DOGS = ["#8b5a2b", "#f0e2c8", "#2b2b2b", "#c58b4c"];
const blink = (t: number, ms: number) => Math.floor(t / ms) % 2 === 0;

export class Office {
	rooms = new Map<string, Room>();
	ports = new Map<string, Port>();
	workers = new Map<string, Worker>();
	width = 300;
	height = 300;
	perFloor = 1;
	cam: Cam = { x: 150, y: 150, z: 1 };
	aim: Box = { x: 0, y: 0, w: 300, h: 300 };
	glows: Glow[] = [];
	sky: Sky = skyAt(new Date());
	private key = "";
	private inner = { x: 0, w: 0 };
	private shaftX = 0;
	private lobbyTop = 0;
	private ground = 0;
	private pentTop = 0;
	private mailroom: Box = { x: 0, y: 0, w: 0, h: 0 };
	private vacant: Box[] = [];
	private capsules: Capsule[] = [];
	private calls: Array<{ from: string; to: string; at: number }> = [];
	private pops: Array<{ x: number; y: number; at: number; color: string }> = [];
	private walkers: Walker[] = [];
	private cars: Car[] = [];
	private nextWalker = 0;
	private nextCar = [0, 0];
	private seen = new Set<string>();
	private asking = new Set<number>();
	private hot: Array<{ box: Box; until: number }> = [];
	private aimedAt = 0;
	private last = 0;
	private fresh = true;
	private skyCanvas?: HTMLCanvasElement | OffscreenCanvas;
	private skyAt = 0;
	private skyKey = "";
	private skyGlows: Glow[] = [];
	/** Whether the camera has arrived where it goes: while it moves, it is drawn often. */
	private settled = true;

	/** Builds the building for the agents there are, about as wide for its height as the view. Returns whether it changed. */
	layout(s: Now, view: { w: number; h: number }): boolean {
		const agents = s.agents;
		const main = agents.find((a) => a.main) ?? agents[0];
		const others = agents.filter((a) => a !== main);
		const ports = s.inputs;
		const aspect = view.w > 0 && view.h > 0 ? view.w / view.h : 0.8;
		let perFloor = 1;
		let best = Infinity;
		for (let p = 1; p <= 5; p++) {
			const floors = Math.ceil(others.length / p);
			const w = SIDE * 2 + WALL * 2 + SHAFT + p * ROOM_W;
			const h = SKY_H + ROOF_H + PENT_H + floors * ROOM_H + LOBBY_H + STREET_H;
			const off = Math.abs(Math.log(w / h / aspect));
			if (off < best - 0.05) (best = off), (perFloor = p);
		}
		perFloor = Math.max(perFloor, Math.min(2, others.length || 1), Math.ceil((ports.length + 1) / 6));
		// Floors as full as they can be: four offices on two floors are two and two, not three and one.
		const floors = Math.ceil(others.length / perFloor);
		if (floors > 0) perFloor = Math.max(Math.ceil(others.length / floors), Math.ceil((ports.length + 1) / 6));
		const innerW = perFloor * ROOM_W;
		const width = SIDE * 2 + WALL * 2 + SHAFT + innerW;
		const pentTop = SKY_H + ROOF_H;
		const lobbyTop = pentTop + PENT_H + floors * ROOM_H;
		const ground = lobbyTop + LOBBY_H;
		const key = `${perFloor}|${agents.map((a) => `${a.id}:${a.main}`).join(",")}|${ports.map((p) => p.id).join(",")}`;
		if (key === this.key) return false;
		this.key = key;
		this.perFloor = perFloor;
		this.width = width;
		this.height = ground + STREET_H;
		this.pentTop = pentTop;
		this.lobbyTop = lobbyTop;
		this.ground = ground;
		this.inner = { x: SIDE + WALL, w: innerW };
		this.shaftX = SIDE + WALL + innerW + SHAFT / 2;
		this.rooms.clear();
		if (main) this.rooms.set(main.id, this.room(main.id, true, this.inner.x, pentTop, innerW, PENT_H - SLAB));
		others.forEach((a, i) => {
			const floor = Math.floor(i / perFloor);
			this.rooms.set(a.id, this.room(a.id, false, this.inner.x + (i % perFloor) * ROOM_W, lobbyTop - (floor + 1) * ROOM_H, ROOM_W, ROOM_H - SLAB));
		});
		this.vacant = [];
		for (let i = others.length; i < floors * perFloor; i++) this.vacant.push({ x: this.inner.x + (i % perFloor) * ROOM_W, y: lobbyTop - (Math.floor(i / perFloor) + 1) * ROOM_H, w: ROOM_W, h: ROOM_H - SLAB });
		this.ports.clear();
		const boxes = ports.filter((p) => p.kind !== "clock");
		const mw = Math.min(innerW - 40, Math.max(48, Math.ceil(boxes.length / 2) * 12 + 8));
		this.mailroom = { x: this.inner.x + 2, y: lobbyTop + 10, w: mw, h: LOBBY_H - 12 };
		let n = 0;
		for (const p of ports) {
			if (p.kind === "clock") {
				const cx = this.inner.x + Math.round(innerW * 0.62);
				this.ports.set(p.id, { id: p.id, kind: p.kind, name: p.name, box: { x: cx - 6, y: lobbyTop + 6, w: 13, h: 13 }, mouth: { x: cx, y: lobbyTop + 6 } });
				continue;
			}
			const bx = this.mailroom.x + 4 + Math.floor(n / 2) * 12;
			const by = lobbyTop + 16 + (n % 2) * 13;
			this.ports.set(p.id, { id: p.id, kind: p.kind, name: p.name, box: { x: bx, y: by, w: 10, h: 9 }, mouth: { x: bx + 5, y: by } });
			n++;
		}
		for (const w of this.workers.values()) {
			const room = this.rooms.get(w.agent);
			if (!room) this.workers.delete(w.key);
			else w.x = this.spot(room, w, w.act);
		}
		this.capsules = [];
		return true;
	}

	private room(agent: string, main: boolean, x: number, y: number, w: number, h: number): Room {
		const floorY = y + h;
		const desk = x + w - 36;
		const from = x + 20;
		const to = desk - 4;
		// The penthouse has a few wide panes; an office one or two of its own.
		const ww = main ? 30 : 16;
		const gap = main ? 10 : 4;
		const count = Math.max(1, Math.min(main ? 6 : 4, Math.floor((to - from + gap) / (ww + gap))));
		const start = from + Math.floor((to - from - (count * ww + (count - 1) * gap)) / 2);
		const windows = Array.from({ length: count }, (_, i) => ({ x: start + i * (ww + gap), y: y + 5, w: ww, h: Math.min(main ? 22 : 18, h - 18) }));
		const look = lookOf(agent);
		const r = seeded(look.seed);
		const books: Room["books"] = [];
		for (let k = 0; k < 3; k++) {
			const sy = floorY - 25 + k * 8;
			let bx = x + 4;
			while (bx < x + 15) {
				const bw = r() < 0.7 ? 1 : 2;
				const bh = 4 + Math.floor(r() * 3);
				books.push([bx, sy + 7 - bh, bw, bh, SHIRTS[Math.floor(r() * SHIRTS.length)]]);
				bx += bw + (r() < 0.2 ? 1 : 0);
			}
		}
		return { agent, main, x, y, w, h, floorY, desk, seat: { x: desk + 8, y: floorY - 7 }, shelf: x + 3, coffee: x + w - 11, windows, outlet: { x: desk + 3, y: y + 8 }, phone: { x: desk + 2, y: floorY - 11 }, look, books, plant: r() < 0.8 || main };
	}

	whole(): Box {
		return { x: 0, y: 0, w: this.width, h: this.height };
	}

	private spot(room: Room, w: Worker, act: Act): number {
		const k = w.extra || w.small ? (hashOf(w.key) % 3) * 6 : 0;
		switch (act) {
			case "read":
				return room.shelf + 17 + k;
			case "coffee":
				return room.coffee - 3;
			case "window":
				return room.windows[hashOf(w.key) % room.windows.length].x + 8;
			case "ask":
				return w.extra || w.small ? room.windows[0].x + 4 + k : room.desk - 6;
			case "stand":
				return room.windows[0].x + 2 + k;
			default:
				return w.extra || w.small ? room.windows[0].x + 2 + k : room.seat.x;
		}
	}

	private pipe(port: Port, room: Room): Pt[] {
		const manifold = this.lobbyTop + 3;
		return [port.mouth, { x: port.mouth.x, y: manifold }, { x: this.shaftX, y: manifold }, { x: this.shaftX, y: room.y + 2 }, { x: room.outlet.x, y: room.y + 2 }, room.outlet];
	}

	/** Robots for work, capsules for what came in, calls for what was handed on. */
	sync(s: Now, now: number): void {
		const first = this.fresh;
		this.fresh = false;
		const primary = new Map<string, ViewWork>();
		for (const w of s.running) if (!w.copy && !primary.has(w.agent)) primary.set(w.agent, w);
		for (const room of this.rooms.values()) {
			const key = `a:${room.agent}`;
			let w = this.workers.get(key);
			if (!w) {
				const rand = seeded(hashOf(key));
				w = { key, agent: room.agent, small: false, extra: false, x: room.seat.x, act: "sit", walking: false, until: now + 4000 + rand() * 20000, idle: "sit", mug: 0, born: now, rand };
				this.workers.set(key, w);
			}
			w.work = primary.get(room.agent)?.id;
		}
		for (const j of s.running) {
			if (primary.get(j.agent)?.id === j.id) continue;
			const key = `j:${j.id}`;
			const room = this.rooms.get(j.agent);
			if (this.workers.has(key) || !room) continue;
			const parent = this.workers.get(`a:${j.agent}`);
			this.workers.set(key, { key, agent: j.agent, work: j.id, small: j.copy, extra: !j.copy, x: parent?.x ?? room.seat.x, act: "stand", walking: false, until: 0, idle: "stand", mug: 0, born: now, rand: seeded(j.id) });
			if (!first) this.pops.push({ x: parent?.x ?? room.seat.x, y: room.floorY - 8, at: now, color: "#ffffff" });
		}
		for (const w of this.workers.values()) {
			if (!w.key.startsWith("j:") || w.goneAt !== undefined) continue;
			const j = w.work !== undefined ? s.work.get(w.work) : undefined;
			if (!j || ended(j)) w.goneAt = now;
		}
		const you = this.ports.get("you");
		for (const j of s.work.values()) {
			const room = this.rooms.get(j.agent);
			if (!room) continue;
			const recent = now - j.started < 8000;
			const parent = j.parent !== undefined ? s.work.get(j.parent) : undefined;
			const handed = parent && parent.agent !== j.agent && this.rooms.has(parent.agent);
			if (!this.seen.has(`s${j.id}`)) {
				this.seen.add(`s${j.id}`);
				if (!first && recent && !j.copy) {
					if (handed) this.calls.push({ from: parent.agent, to: j.agent, at: now });
					else {
						const id = portOf(j);
						const port = id ? this.ports.get(id) : undefined;
						if (port) this.send(this.pipe(port, room), now, port.kind === "you" ? "#4ade80" : port.kind === "clock" ? "#c084fc" : port.kind === "outside" ? "#f59e0b" : "#4ea3ff", room.agent);
					}
				}
			}
			// A question goes down to your box.
			if (j.asking && !this.asking.has(j.id)) {
				this.asking.add(j.id);
				if (!first && you) this.send(this.pipe(you, room).reverse(), now, "#ff5a5f");
			} else if (!j.asking) this.asking.delete(j.id);
			if (ended(j) && !this.seen.has(`e${j.id}`)) {
				this.seen.add(`e${j.id}`);
				if (first || j.finished === undefined || now - j.finished > 8000 || j.copy) continue;
				if (handed) this.calls.push({ from: j.agent, to: parent.agent, at: now });
				else if (j.depth === 0 && j.from.k === "you" && you) this.send(this.pipe(you, room).reverse(), now, "#4ade80");
			}
		}
	}

	private send(path: Pt[], now: number, color: string, to?: string): void {
		this.capsules.push({ path, at: now, ms: Math.max(600, lengthOf(path) / CAPSULE), color, to });
	}

	/** Moves everything on by the time since the last frame, and the camera towards what happens. */
	step(s: Now, now: number, view: { w: number; h: number }, o: { focus?: Hit; follow: boolean }): void {
		const dt = this.last ? Math.min(100, now - this.last) : 0;
		this.last = now;
		this.sky = skyAt(clock());
		this.calls = this.calls.filter((c) => now - c.at < CALL_MS);
		for (const c of this.capsules) if (now - c.at >= c.ms) this.pops.push({ ...c.path[c.path.length - 1], at: now, color: c.color });
		this.capsules = this.capsules.filter((c) => now - c.at < c.ms);
		this.pops = this.pops.filter((p) => now - p.at < 600);
		for (const w of this.workers.values()) {
			if (w.goneAt !== undefined && now - w.goneAt > 500) {
				const room = this.rooms.get(w.agent);
				if (room) this.pops.push({ x: w.x, y: room.floorY - 8, at: now, color: "#ffffff" });
				this.workers.delete(w.key);
				continue;
			}
			this.move(s, w, now, dt);
		}
		this.street(now, dt);
		const add = (box: Box | undefined) => box && this.hot.push({ box, until: now + LINGER });
		const roomBox = (a: string) => {
			const r = this.rooms.get(a);
			return r && { x: r.x, y: r.y - 8, w: r.w, h: r.h + 8 };
		};
		for (const j of s.running) add(roomBox(j.agent));
		for (const c of this.capsules) {
			const p = along(c.path, (now - c.at) / c.ms);
			add({ x: p.x - 8, y: p.y - 8, w: 16, h: 16 });
			if (c.to) add(roomBox(c.to));
		}
		for (const c of this.calls) add(roomBox(c.from)), add(roomBox(c.to));
		for (const i of s.inputs) if (i.last !== undefined && now - i.last < 1500) add(this.ports.get(i.id)?.box);
		this.hot = this.hot.filter((h) => h.until > now);
		if (now - this.aimedAt > 400 || o.focus) {
			this.aimedAt = now;
			this.aim = this.aimFor(s, o.focus);
		}
		if (o.follow) {
			const target = this.framed(this.aim, view);
			this.cam = ease(this.cam, target, dt);
			this.settled = this.cam.x === target.x && this.cam.y === target.y && this.cam.z === target.z;
		} else this.settled = true;
	}

	/**
	 * How long to wait between frames: thirty a second while something travels fast (a capsule, a call,
	 * the camera on its way), fifteen while a robot walks or agents work in their offices, ten at rest,
	 * when only the street and the sky move, and four while the app's window is not in front. What draws
	 * less costs the battery less.
	 */
	pace(s: Now): number {
		if (!s.focused) return 250;
		if (this.capsules.length || this.calls.length || this.pops.length || !this.settled) return 33;
		if ([...this.workers.values()].some((w) => w.walking || w.goneAt !== undefined)) return 66;
		return s.running.length ? 66 : 100;
	}

	/** What the camera should show: what is chosen, else what happened lately, else all of it. */
	aimFor(s: Now, focus?: Hit): Box {
		const boxes: Box[] = [];
		const roomBox = (a: string) => {
			const r = this.rooms.get(a);
			if (r) boxes.push({ x: r.x, y: r.y - 8, w: r.w, h: r.h + 8 });
		};
		if (focus?.k === "agent") roomBox(focus.id);
		else if (focus?.k === "work") {
			const j = s.work.get(focus.id);
			if (j) roomBox(j.agent);
		} else for (const h of this.hot) boxes.push(h.box);
		return boxes.length ? union(boxes) : this.whole();
	}

	framed(box: Box, view: { w: number; h: number }): Cam {
		return frame(box, view, this.whole(), { zMax: Z_MAX, min: MIN });
	}

	private move(s: Now, w: Worker, now: number, dt: number): void {
		const room = this.rooms.get(w.agent);
		if (!room) return;
		const j = w.work !== undefined ? s.work.get(w.work) : undefined;
		const busy = j && !ended(j);
		let act: Act;
		if (!w.small && !w.extra && this.calls.some((c) => c.from === w.agent || c.to === w.agent)) act = "phone";
		else if (busy) {
			act = j.asking ? "ask" : j.doing === "thinking" ? "read" : j.doing === "waiting" ? "wait" : j.doing === "tool" && j.tool === "delegate" ? "phone" : "type";
			if ((w.small || w.extra) && act === "wait") act = "stand";
			if ((w.small || w.extra) && act === "phone") act = "type";
		} else {
			// At rest: mostly at the desk, now and then a coffee or a look out of the window.
			if (now > w.until) {
				const r = w.rand();
				const was = w.idle;
				w.idle = was !== "sit" ? "sit" : r < 0.5 ? "coffee" : r < 0.85 ? "window" : "sit";
				w.until = now + (w.idle === "sit" ? 14_000 + w.rand() * 22_000 : 4000 + w.rand() * 4000);
				if (was === "coffee") w.mug = now + 9000;
			}
			act = w.idle;
		}
		const to = this.spot(room, w, act);
		const d = to - w.x;
		w.walking = Math.abs(d) > 0.5;
		if (w.walking) w.x += Math.sign(d) * Math.min(Math.abs(d), dt * WALK * (w.small ? 1.4 : 1));
		else w.x = to;
		w.act = act;
	}

	private street(now: number, dt: number): void {
		const night = 1 - this.sky.day;
		const r = Math.random;
		if (now > this.nextWalker) {
			const dir = r() < 0.5 ? 1 : -1;
			this.walkers.push({ x: dir > 0 ? -6 : this.width + 6, dir, speed: 0.012 + r() * 0.01, shirt: SHIRTS[Math.floor(r() * SHIRTS.length)], pants: r() < 0.5 ? "#2c3e66" : "#3b3b3b", skin: SKINS[Math.floor(r() * SKINS.length)], hair: HAIRS[Math.floor(r() * HAIRS.length)], dog: r() < 0.3 ? DOGS[Math.floor(r() * DOGS.length)] : undefined });
			this.nextWalker = now + (2500 + r() * 5000) * (1 + night * 2);
		}
		for (const lane of [0, 1]) {
			if (now <= this.nextCar[lane]) continue;
			const dir = lane === 0 ? -1 : 1;
			const kind = r() < 0.25 ? "cab" : r() < 0.12 ? "bus" : r() < 0.2 ? "van" : "car";
			this.cars.push({ x: dir > 0 ? -34 : this.width + 34, dir, speed: kind === "bus" ? 0.035 : 0.045 + r() * 0.03, kind, color: CARS[Math.floor(r() * CARS.length)] });
			this.nextCar[lane] = now + (2500 + r() * 6000) * (1 + night);
		}
		for (const p of this.walkers) p.x += p.dir * p.speed * dt;
		for (const c of this.cars) c.x += c.dir * c.speed * dt;
		this.walkers = this.walkers.filter((p) => p.x > -20 && p.x < this.width + 20);
		this.cars = this.cars.filter((c) => c.x > -40 && c.x < this.width + 40);
	}

	hit(p: Pt): Hit {
		for (const w of [...this.workers.values()].reverse()) if (w.box && inside(p, w.box)) return w.work !== undefined ? { k: "work", id: w.work } : { k: "agent", id: w.agent };
		for (const room of this.rooms.values()) if (inside(p, { x: room.x, y: room.y - 6, w: room.w, h: room.h + 6 })) return { k: "agent", id: room.agent };
		for (const port of this.ports.values()) if (inside(p, { x: port.box.x - 2, y: port.box.y - 2, w: port.box.w + 4, h: port.box.h + 4 })) return { k: "port", id: port.id };
		return undefined;
	}

	centerOf(agent: string): Pt | undefined {
		const r = this.rooms.get(agent);
		return r && { x: r.x + r.w / 2, y: r.y + r.h / 2 };
	}

	robotOf(agent: string): { x: number; act: string; walking: boolean } | undefined {
		const w = this.workers.get(`a:${agent}`);
		return w && { x: w.x, act: w.act, walking: w.walking };
	}

	robots(): Array<{ agent: string; work?: number; small: boolean }> {
		return [...this.workers.values()].filter((w) => w.goneAt === undefined).map((w) => ({ agent: w.agent, work: w.work, small: w.small }));
	}

	traffic(): { capsules: number; calls: number } {
		return { capsules: this.capsules.length, calls: this.calls.length };
	}

	/** The mailboxes' names, to write under them. */
	labels(): Array<{ text: string; x: number; y: number }> {
		return [...this.ports.values()].filter((p) => p.kind !== "clock").map((p) => ({ text: p.name, x: p.box.x + p.box.w / 2, y: p.box.y + p.box.h + 1 }));
	}

	/**
	 * What to write over each robot, at the top of its head: the agent's name over its own robot, and
	 * while it works a bubble with what it does, each kind its own sign and color.
	 */
	tags(s: Now, now: number): Array<{ x: number; y: number; name?: string; say?: Say; small: boolean }> {
		const out: Array<{ x: number; y: number; name?: string; say?: Say; small: boolean }> = [];
		for (const w of this.workers.values()) {
			if (!w.box || w.goneAt !== undefined) continue;
			const j = w.work !== undefined ? s.work.get(w.work) : undefined;
			const call = !w.small && !w.extra ? this.calls.find((c) => c.from === w.agent || c.to === w.agent) : undefined;
			const say = call ? { kind: "phone" as const, text: call.from === w.agent ? call.to : call.from } : j && !ended(j) ? sayOf(j, s, now) : undefined;
			out.push({ x: w.box.x + w.box.w / 2, y: w.box.y, name: w.key === `a:${w.agent}` ? w.agent : undefined, say, small: w.small });
		}
		return out;
	}

	// ---- drawing --------------------------------------------------------------------------------------------------------

	draw(ctx: CanvasRenderingContext2D, s: Now, now: number, o: { selected?: Hit; hover?: Hit; makeCanvas: (w: number, h: number) => HTMLCanvasElement | OffscreenCanvas }): void {
		this.glows = [];
		const sky = this.sky;
		const night = 1 - sky.day;
		if (!this.skyCanvas || this.skyCanvas.width !== this.width || this.skyCanvas.height !== this.ground) this.skyCanvas = o.makeCanvas(this.width, this.ground);
		const sctx = this.skyCanvas.getContext("2d") as CanvasRenderingContext2D;
		// The sky changes slowly: drawn four times a second, its lights kept for the frames between.
		if (now - this.skyAt > 250 || this.skyKey !== this.key) {
			this.skyAt = now;
			this.skyKey = this.key;
			this.skyGlows = [];
			drawSky(sctx, this.width, this.ground, this.ground, sky, now, this.skyGlows);
			this.skyline(sctx, now);
		}
		this.glows.push(...this.skyGlows);
		ctx.drawImage(this.skyCanvas as CanvasImageSource, 0, 0);
		drawFliers(ctx, this.width, this.ground, sky, now, this.glows);
		const wallC = mix(mix("#c9b9a6", "#d9a58a", sky.dusk * 0.4), "#2a2f45", night * 0.75);
		const slabC = mix("#8e8577", "#1d2133", night * 0.7);
		const x0 = SIDE;
		const x1 = SIDE + WALL * 2 + SHAFT + this.inner.w;
		const top = this.pentTop - ROOF_H;
		rect(ctx, x0, top + ROOF_H - 2, x1 - x0, this.ground - top - ROOF_H + 2, wallC);
		this.roof(ctx, x0, x1, top, now, night);
		rect(ctx, this.shaftX - SHAFT / 2, this.pentTop, SHAFT, this.ground - this.pentTop, shade(wallC, -0.12));
		rect(ctx, this.shaftX - 2, this.pentTop + 2, 4, this.lobbyTop + 4 - this.pentTop, "#7b8794");
		rect(ctx, this.shaftX - 1, this.pentTop + 2, 1, this.lobbyTop + 4 - this.pentTop, "#a9b4c0");
		for (let y = this.pentTop + 8; y < this.lobbyTop; y += 14) rect(ctx, this.shaftX - 3, y, 6, 2, "#5d6875");
		const working = new Map<string, ViewWork[]>();
		for (const j of s.running) working.set(j.agent, [...(working.get(j.agent) ?? []), j]);
		for (const room of this.rooms.values()) {
			this.drawRoom(ctx, s, room, working.get(room.agent) ?? [], now, o);
			rect(ctx, room.x - 1, room.y + room.h, room.w + 2, SLAB, slabC);
		}
		for (const v of this.vacant) {
			rect(ctx, v.x, v.y, v.w, v.h, mix("#ddd6c8", "#2a2d40", night * 0.7));
			const win = { x: v.x + v.w / 2 - 8, y: v.y + 5, w: 16, h: 16 };
			ctx.drawImage(this.skyCanvas as CanvasImageSource, win.x, win.y, win.w, win.h, win.x, win.y, win.w, win.h);
			rect(ctx, win.x - 1, win.y + win.h, win.w + 2, 2, "#5d6470");
			rect(ctx, win.x + win.w / 2, win.y, 1, win.h, "#5d6470");
			rect(ctx, v.x + 6, v.y + v.h - 8, 8, 8, "#b39b7a");
			ctx.globalAlpha = 0.15 + night * 0.4;
			rect(ctx, v.x, v.y, v.w, v.h, "#0a1030");
			ctx.globalAlpha = 1;
			rect(ctx, v.x - 1, v.y + v.h, v.w + 2, SLAB, slabC);
		}
		this.lobby(ctx, s, now, night, slabC);
		for (const c of this.capsules) {
			const p = along(c.path, (now - c.at) / c.ms);
			rect(ctx, p.x - 2, p.y - 1, 4, 3, "#20242e");
			rect(ctx, p.x - 1, p.y, 2, 1, c.color);
			this.glows.push({ x: p.x, y: p.y, r: 8, color: c.color, a: 0.9 });
		}
		for (const p of this.pops) {
			const k = (now - p.at) / 600;
			ctx.globalAlpha = 1 - k;
			for (let i = 0; i < 8; i++) {
				const a = (i / 8) * Math.PI * 2;
				rect(ctx, p.x + Math.cos(a) * (1 + k * 7), p.y + Math.sin(a) * (1 + k * 7), 1, 1, p.color);
			}
			ctx.globalAlpha = 1;
		}
		// Phone calls: the line between the two phones lights up, a pulse runs along it.
		for (const c of this.calls) {
			const a = this.rooms.get(c.from);
			const b = this.rooms.get(c.to);
			if (!a || !b) continue;
			const k = (now - c.at) / CALL_MS;
			const way = [a.phone, { x: a.phone.x, y: a.y + 3 }, { x: this.shaftX - 3, y: a.y + 3 }, { x: this.shaftX - 3, y: b.y + 3 }, { x: b.phone.x, y: b.y + 3 }, b.phone];
			const len = lengthOf(way);
			ctx.globalAlpha = Math.min(1, (1 - k) * 3);
			for (let d = 0; d < len; d += 3) {
				const q = along(way, d / len);
				rect(ctx, q.x, q.y, 1, 1, "#7cf29a");
			}
			const head = along(way, (k * 2.2) % 1);
			rect(ctx, head.x - 1, head.y - 1, 3, 3, "#d6ffe0");
			this.glows.push({ x: head.x, y: head.y, r: 7, color: "#7cf29a", a: 0.9 });
			ctx.globalAlpha = 1;
		}
		this.drawStreet(ctx, now, night);
	}

	private skyline(ctx: CanvasRenderingContext2D, now: number): void {
		const night = 1 - this.sky.day;
		const far = mix(mix("#9fb4c9", "#c99a9a", this.sky.dusk * 0.5), "#141a33", night);
		const r = seeded(31);
		let x = 0;
		while (x < this.width) {
			const w = 10 + Math.floor(r() * 18);
			const h = 14 + Math.floor(r() * 40);
			rect(ctx, x, this.ground - h, w - 1, h, far);
			if (night > 0.4) for (let wy = this.ground - h + 3; wy < this.ground - 3; wy += 4) for (let wx = x + 2; wx < x + w - 3; wx += 3) if (r() < 0.25 + 0.05 * Math.sin(now / 9000 + wx)) rect(ctx, wx, wy, 1, 1, "#ffd98a");
			x += w;
		}
	}

	private roof(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number, now: number, night: number): void {
		const y = top + ROOF_H - 4;
		rect(ctx, x0 - 2, y, x1 - x0 + 4, 4, mix("#6f6457", "#151829", night * 0.7));
		rect(ctx, x0 - 2, y - 2, x1 - x0 + 4, 2, mix("#988a78", "#252a40", night * 0.7));
		const tx = x0 + 8;
		rect(ctx, tx, y - 10, 12, 8, mix("#8a6a4a", "#2b2230", night * 0.6));
		rect(ctx, tx - 1, y - 11, 14, 2, mix("#5c4632", "#1d1724", night * 0.6));
		rect(ctx, tx + 2, y - 2, 1, 2, "#3b3b3b");
		rect(ctx, tx + 9, y - 2, 1, 2, "#3b3b3b");
		const ax = x1 - 12;
		rect(ctx, ax, y - 30, 1, 28, "#4b5563");
		rect(ctx, ax - 3, y - 20, 7, 1, "#4b5563");
		rect(ctx, ax - 2, y - 12, 5, 1, "#4b5563");
		const on = blink(now, 900);
		rect(ctx, ax - 1, y - 32, 3, 2, on ? "#ff4d4d" : "#7a2a2a");
		if (on) this.glows.push({ x: ax, y: y - 31, r: 9, color: "#ff4d4d", a: 0.5 + night * 0.4 });
		// The name on the roof, lit at night.
		const sx = Math.round((x0 + x1) / 2) - 9;
		const lit = night > 0.35;
		const letters = ["ooo.o.o..o.ooo", "o.o.o.oo.o.o..", "ooo.o.o.oo.oo.", "o...o.o..o.o..", "o...o.o..o.ooo"];
		ctx.fillStyle = lit ? "#7dffb0" : "#4e5a52";
		letters.forEach((row, j) => [...row].forEach((ch, i) => ch === "o" && ctx.fillRect(sx + i + 2, y - 9 + j, 1, 1)));
		rect(ctx, sx, y - 3, 18, 1, "#4b5563");
		if (lit) this.glows.push({ x: sx + 9, y: y - 7, r: 14, color: "#7dffb0", a: 0.5 });
	}

	private drawRoom(ctx: CanvasRenderingContext2D, s: Now, room: Room, jobs: ViewWork[], now: number, o: { selected?: Hit; hover?: Hit }): void {
		const { x, y, w, h, floorY } = room;
		const night = 1 - this.sky.day;
		const agent = s.agent.get(room.agent);
		const color = agent?.color ?? "#888888";
		const mode = agent?.mode ?? "safe";
		const busy = jobs.length > 0;
		const asks = jobs.some((j) => j.asking);
		const wallIn = mix("#f1ead9", mix(color, "#ffffff", 0.82), 0.5);
		rect(ctx, x, y, w, h, wallIn);
		rect(ctx, x, floorY - 12, w, 1, mix(color, "#ffffff", 0.35));
		rect(ctx, x, floorY - 11, w, 11, mix(wallIn, color, 0.12));
		rect(ctx, x, floorY - 1, w, 1, shade(wallIn, -0.3));
		for (const win of room.windows) {
			ctx.drawImage(this.skyCanvas as CanvasImageSource, win.x, win.y, win.w, win.h, win.x, win.y, win.w, win.h);
			ctx.globalAlpha = 0.12;
			rect(ctx, win.x, win.y, win.w, win.h, "#cfe8ff");
			ctx.globalAlpha = 1;
			rect(ctx, win.x - 1, win.y - 1, win.w + 2, 1, "#5d6470");
			rect(ctx, win.x - 1, win.y + win.h, win.w + 2, 2, "#5d6470");
			rect(ctx, win.x - 1, win.y, 1, win.h, "#5d6470");
			rect(ctx, win.x + win.w, win.y, 1, win.h, "#5d6470");
			rect(ctx, win.x + win.w / 2, win.y, 1, win.h, "#5d6470");
		}
		// The shelf, its books in many colors: the library it reads in.
		const sh = room.shelf;
		rect(ctx, sh, floorY - 26, 14, 26, "#7a4e2d");
		for (let k = 0; k < 3; k++) rect(ctx, sh + 1, floorY - 25 + k * 8, 12, 7, "#4a2e19");
		for (const [bx, by, bw, bh, bc] of room.books) rect(ctx, bx, by, bw, bh, bc);
		if (room.plant) {
			const lw = room.windows[room.windows.length - 1];
			const px = lw.x + lw.w + 1;
			rect(ctx, px, floorY - 4, 4, 4, "#b5653a");
			rect(ctx, px - 1, floorY - 9, 2, 5, "#3f9b4f");
			rect(ctx, px + 1, floorY - 11, 2, 7, "#4fb35f");
			rect(ctx, px + 3, floorY - 8, 2, 4, "#3f9b4f");
		}
		const cf = room.coffee;
		rect(ctx, cf, floorY - 9, 9, 9, "#9aa3ad");
		rect(ctx, cf + 1, floorY - 8, 7, 7, "#b7bfc8");
		rect(ctx, cf + 1, floorY - 17, 6, 8, "#3a3f47");
		rect(ctx, cf + 2, floorY - 16, 4, 2, "#e85d3f");
		rect(ctx, cf + 3, floorY - 12, 2, 2, "#f5f5f5");
		// The mode: a shield on the wall for a sandbox, a lock for manual; the alarm for bypass.
		const px = room.windows[0].x - 7;
		if (mode !== "auto" && mode !== "bypass") {
			rect(ctx, px, y + 6, 5, 4, "#2f86d6");
			rect(ctx, px + 1, y + 10, 3, 1, "#2f86d6");
			rect(ctx, px + 2, y + 11, 1, 1, "#2f86d6");
			rect(ctx, px + 2, y + 7, 1, 2, "#d7ecff");
			if (mode === "manual") {
				rect(ctx, px, y + 14, 5, 4, "#c99a2e");
				rect(ctx, px + 1, y + 12, 3, 2, "#3b3b3b");
				rect(ctx, px + 2, y + 13, 1, 1, wallIn);
			}
		}
		if (mode === "bypass") {
			for (let i = 0; i < w; i++) rect(ctx, x + i, floorY - 2, 1, 1, Math.floor(i / 3) % 2 ? "#f2b705" : "#222222");
			const ax = x + w / 2 + 6;
			const on = blink(now, 350);
			rect(ctx, ax - 2, y, 5, 2, "#555555");
			rect(ctx, ax - 1, y + 2, 3, 2, on ? "#ff3b3b" : "#7a1f1f");
			if (on) this.glows.push({ x: ax, y: y + 3, r: 12, color: "#ff3b3b", a: 0.7 });
		}
		const lx = x + Math.round(w / 2) - 2;
		rect(ctx, lx + 2, y, 1, 3, "#444444");
		rect(ctx, lx, y + 3, 5, 2, busy ? "#ffe9a8" : "#8d8f96");
		rect(ctx, room.outlet.x - 1, y, 3, room.outlet.y - y, "#7b8794");
		rect(ctx, room.outlet.x - 2, room.outlet.y - 1, 5, 2, "#5d6875");
		// The robots behind the desk first, then the desk, then the ones in front of it.
		const ws = [...this.workers.values()].filter((k) => k.agent === room.agent);
		const seated = (k: Worker) => !k.small && !k.extra && !k.walking && (k.act === "sit" || k.act === "type" || k.act === "phone" || k.act === "wait");
		for (const k of ws) if (seated(k)) this.drawWorker(ctx, s, room, k, now, color);
		const dx = room.desk;
		const dt = floorY - 10;
		rect(ctx, dx + 11, dt - 9, 11, 8, "#22262e");
		rect(ctx, dx + 12, dt - 8, 9, 6, asks ? (blink(now, 300) ? "#ffb21f" : "#3a2a10") : busy ? "#1e3a5f" : night > 0.5 ? "#1b2a3d" : "#2a3d55");
		if (busy && !asks) {
			const lines = Math.floor(now / 160);
			for (let i = 0; i < 4; i++) rect(ctx, dx + 13, dt - 7 + i * 1.5, 2 + ((lines + i * 3) % 6), 1, i % 2 ? shade(color, 0.5) : "#9be7ff");
		} else if (!busy) rect(ctx, dx + 13 + (Math.floor(now / 700) % 6), dt - 4, 1, 1, "#9be7ff");
		rect(ctx, dx + 15, dt - 1, 3, 1, "#22262e");
		this.glows.push({ x: dx + 16, y: dt - 5, r: 9, color: asks ? "#ffb21f" : "#7cc8ff", a: busy ? 0.55 : 0.25 });
		rect(ctx, dx, dt, 24, 2, "#8b5e3c");
		rect(ctx, dx + 1, dt + 2, 22, 8, "#6e472b");
		rect(ctx, dx + 2, dt + 3, 20, 1, "#5a3a22");
		rect(ctx, dx + 5, dt - 1, 6, 1, "#d8dde3");
		const ringing = this.calls.some((c) => c.from === room.agent || c.to === room.agent);
		const own = this.workers.get(`a:${room.agent}`);
		const holding = own?.act === "phone" && !own.walking;
		rect(ctx, room.phone.x - 1, dt - 2, 4, 2, "#2b2b33");
		if (!holding) rect(ctx, room.phone.x - 1 + (ringing && blink(now, 90) ? 1 : 0), dt - 3, 4, 1, "#e5484d");
		if (ringing && blink(now, 250)) {
			rect(ctx, room.phone.x - 3, dt - 6, 1, 2, "#7cf29a");
			rect(ctx, room.phone.x + 4, dt - 6, 1, 2, "#7cf29a");
		}
		for (const k of ws) if (!seated(k)) this.drawWorker(ctx, s, room, k, now, color);
		// The light: on while anybody in it works, off at rest (dim by day, dark at night).
		if (!busy) {
			ctx.globalAlpha = 0.24 + night * 0.42;
			rect(ctx, x, y, w, h, "#0a1030");
			ctx.globalAlpha = 1;
		} else {
			const warm = asks ? "#ffc35a" : "#ffe7a0";
			ctx.globalAlpha = 0.1;
			rect(ctx, x, y, w, h, warm);
			// The lamp's cone, down to the floor.
			ctx.globalAlpha = 0.16 + night * 0.1;
			const top = y + 5;
			for (let yy = top; yy < floorY; yy++) {
				const half = 3 + ((yy - top) / (floorY - top)) * 20;
				rect(ctx, lx + 2 - half, yy, half * 2, 1, warm);
			}
			ctx.globalAlpha = 1;
			this.glows.push({ x: lx + 2, y: y + 6, r: 30, color: asks ? "#ffb21f" : "#ffe3a0", a: 0.9 });
		}
		const chosen = (o.selected?.k === "agent" && o.selected.id === room.agent) || (o.selected?.k === "work" && s.work.get(o.selected.id)?.agent === room.agent);
		const hovered = o.hover?.k === "agent" && o.hover.id === room.agent;
		if (chosen || hovered) {
			const c = chosen ? "#ffffff" : "#c9d6e6";
			for (let i = 0; i < 2 * (w + h); i += 2) {
				if ((i + Math.floor(now / 150)) % 4 > 1) continue;
				const p = i < w ? { x: x + i, y } : i < w + h ? { x: x + w - 1, y: y + i - w } : i < 2 * w + h ? { x: x + w - 1 - (i - w - h), y: y + h - 1 } : { x, y: y + h - 1 - (i - 2 * w - h) };
				rect(ctx, p.x, p.y, 1, 1, c);
			}
		}
	}

	private drawWorker(ctx: CanvasRenderingContext2D, s: Now, room: Room, w: Worker, now: number, color: string): void {
		const j = w.work !== undefined ? s.work.get(w.work) : undefined;
		const busy = j && !ended(j);
		const sit = !w.small && !w.extra && !w.walking && (w.act === "sit" || w.act === "type" || w.act === "phone" || w.act === "wait");
		let pose: Pose = w.walking ? "walk" : w.act === "sit" ? (busy ? "sit" : "type") : w.act === "wait" ? "sit" : w.act === "window" ? "back" : w.act === "stand" ? (busy ? "type" : "stand") : w.act;
		if (!busy && !w.walking && ((w.act === "sit" && w.mug > now) || w.act === "coffee")) pose = "coffee";
		ctx.globalAlpha = w.goneAt !== undefined ? Math.max(0, 1 - (now - w.goneAt) / 500) : Math.min(1, (now - w.born) / 300);
		w.box = drawRobot(ctx, room.look, color, w.x, sit ? room.seat.y : room.floorY - 1, {
			pose,
			t: now,
			small: w.small,
			seated: sit,
			lit: Boolean(busy),
			eye: j?.asking ? (blink(now, 200) ? "#ff5a5f" : "#ffd0d0") : j?.outside ? "#ffb21f" : undefined,
			shield: Boolean(j?.held),
			warn: Boolean(j?.outside),
		});
		ctx.globalAlpha = 1;
		if (busy) this.glows.push({ x: w.x, y: (sit ? room.seat.y : room.floorY) - (w.small ? 8 : 14), r: w.small ? 5 : 8, color: j.asking ? "#ff5a5f" : color, a: 0.35 });
	}

	private lobby(ctx: CanvasRenderingContext2D, s: Now, now: number, night: number, slabC: string): void {
		const x = this.inner.x;
		const y = this.lobbyTop;
		const w = this.inner.w;
		rect(ctx, x, y, w, LOBBY_H, mix("#efe6d4", "#3a3a52", night * 0.55));
		for (let i = 0; i < w; i += 4) rect(ctx, x + i, this.ground - 3, 3, 3, (i / 4) % 2 ? "#b9ad98" : "#d4c9b4");
		rect(ctx, x + 2, y + 2, this.shaftX - x, 3, "#7b8794");
		rect(ctx, x + 2, y + 2, this.shaftX - x, 1, "#a9b4c0");
		const m = this.mailroom;
		rect(ctx, m.x, m.y, m.w, m.h - 3, "#a3876a");
		rect(ctx, m.x + 1, m.y + 1, m.w - 2, m.h - 5, "#8a6f55");
		for (const port of this.ports.values()) {
			if (port.kind === "clock") continue;
			const last = s.input.get(port.id)?.last;
			const fresh = (last !== undefined && now - last < 3000) || this.capsules.some((c) => c.path[c.path.length - 1] === port.mouth && now - c.at > c.ms - 200);
			const b = port.box;
			const body = port.kind === "you" ? "#c84a3c" : port.kind === "outside" ? "#c9892e" : "#3f6fb5";
			rect(ctx, port.mouth.x - 1, y + 4, 2, b.y - y - 4, "#7b8794");
			rect(ctx, b.x, b.y, b.w, b.h, body);
			rect(ctx, b.x + 1, b.y + 1, b.w - 2, 2, "#20242e");
			rect(ctx, b.x + 1, b.y + b.h - 2, b.w - 2, 1, shade(body, -0.3));
			rect(ctx, b.x + b.w, fresh ? b.y - 3 : b.y + 2, 1, 4, "#f5d547");
			if (fresh) {
				rect(ctx, b.x + b.w + 1, b.y - 3, 2, 2, "#f5d547");
				this.glows.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: 10, color: "#ffe680", a: 0.6 });
			}
		}
		// The clock above the door: the owner's own time.
		const cx = x + Math.round(w * 0.62);
		const cy = y + 12;
		disc(ctx, cx, cy, 6, "#3b3b3b");
		disc(ctx, cx, cy, 5, "#fbf7ec");
		const d = clock();
		const hand = (frac: number, len: number) => {
			const a = frac * Math.PI * 2 - Math.PI / 2;
			for (let i = 0; i <= len; i++) rect(ctx, cx + Math.cos(a) * i, cy + Math.sin(a) * i, 1, 1, "#222222");
		};
		hand((d.getHours() % 12) / 12 + d.getMinutes() / 720, 2);
		hand(d.getMinutes() / 60, 4);
		const clockPort = [...this.ports.values()].find((p) => p.kind === "clock");
		if (clockPort) {
			rect(ctx, cx, y + 4, 1, 2, "#7b8794");
			const last = s.input.get(clockPort.id)?.last;
			if (last !== undefined && now - last < 3000) this.glows.push({ x: cx, y: cy, r: 12, color: "#c084fc", a: 0.7 });
		}
		const doorX = cx - 8;
		rect(ctx, doorX - 1, this.ground - 25, 18, 22, "#4b5563");
		rect(ctx, doorX, this.ground - 24, 16, 21, mix("#bfe3f5", "#24304a", night * 0.7));
		rect(ctx, doorX + 7, this.ground - 24, 2, 21, "#4b5563");
		rect(ctx, doorX + 5, this.ground - 14, 1, 3, "#d0d5db");
		rect(ctx, doorX + 10, this.ground - 14, 1, 3, "#d0d5db");
		const rx = doorX + 24;
		if (rx + 26 < x + w) {
			rect(ctx, rx, this.ground - 12, 20, 9, "#6e472b");
			rect(ctx, rx, this.ground - 13, 20, 1, "#8b5e3c");
			rect(ctx, rx + 22, this.ground - 6, 4, 3, "#b5653a");
			rect(ctx, rx + 21, this.ground - 12, 2, 6, "#3f9b4f");
			rect(ctx, rx + 24, this.ground - 14, 2, 8, "#4fb35f");
		}
		for (let lx = x + 10; lx < x + w - 6; lx += 28) {
			rect(ctx, lx, y + 5, 4, 1, "#ffe9a8");
			this.glows.push({ x: lx + 2, y: y + 7, r: 14, color: "#ffe3a0", a: 0.15 + night * 0.35 });
		}
		rect(ctx, x - 1, this.ground - 1, w + SHAFT + 2, 1, slabC);
	}

	private drawStreet(ctx: CanvasRenderingContext2D, now: number, night: number): void {
		const g = this.ground;
		const W = this.width;
		rect(ctx, 0, g, W, 7, mix("#c7c2b8", "#3a3d4c", night * 0.7));
		for (let x = 0; x < W; x += 8) rect(ctx, x, g, 1, 7, mix("#b3ada2", "#33364a", night * 0.7));
		rect(ctx, 0, g + 7, W, 1, "#8d8a83");
		rect(ctx, 0, g + 8, W, 20, mix("#4a4d55", "#1c1e27", night * 0.6));
		for (let x = Math.floor((now / 60) % 12) - 12; x < W; x += 12) rect(ctx, x, g + 18, 6, 1, "#e8d36a");
		rect(ctx, 0, g + 28, W, 1, "#8d8a83");
		rect(ctx, 0, g + 29, W, this.height - g - 29, mix("#c7c2b8", "#3a3d4c", night * 0.7));
		for (let x = 20; x < W; x += 70) {
			rect(ctx, x, g - 22, 1, 25, "#3d4350");
			rect(ctx, x, g - 22, 5, 1, "#3d4350");
			rect(ctx, x + 4, g - 21, 3, 2, night > 0.4 ? "#ffe9a8" : "#9aa3ad");
			if (night > 0.4) {
				this.glows.push({ x: x + 5, y: g - 19, r: 20, color: "#ffd98a", a: 0.6 * night });
				ctx.globalAlpha = 0.12 * night;
				rect(ctx, x - 6, g, 22, 7, "#ffe9a8");
				ctx.globalAlpha = 1;
			}
		}
		for (const c of this.cars) this.car(ctx, c, c.dir < 0 ? g + 10 : g + 19, night);
		for (const p of this.walkers) this.person(ctx, p, g + 6, now);
	}

	private car(ctx: CanvasRenderingContext2D, c: Car, y: number, night: number): void {
		const len = c.kind === "bus" ? 32 : c.kind === "van" ? 22 : 18;
		const x = Math.round(c.x - len / 2);
		const body = c.kind === "cab" ? "#f4c20d" : c.kind === "bus" ? "#e8743b" : c.color;
		const glass = night > 0.5 ? "#2b3550" : "#9fd3f0";
		const hh = c.kind === "bus" ? 10 : c.kind === "van" ? 9 : 7;
		rect(ctx, x, y + 8 - hh, len, hh - 2, body);
		rect(ctx, x, y + 3, len, 1, shade(body, -0.25));
		if (c.kind === "car" || c.kind === "cab") {
			rect(ctx, x + 4, y + 5 - hh, len - 8, 3, body);
			rect(ctx, x + 5, y + 6 - hh, len / 2 - 6, 2, glass);
			rect(ctx, x + len / 2 + 1, y + 6 - hh, len / 2 - 6, 2, glass);
			if (c.kind === "cab") rect(ctx, x + len / 2 - 2, y + 3 - hh, 4, 2, "#222222");
		} else for (let wx = x + 2; wx < x + len - 3; wx += 5) rect(ctx, wx, y + 9 - hh, 3, 3, glass);
		rect(ctx, x + 3, y + 5, 3, 3, "#1a1a1a");
		rect(ctx, x + len - 6, y + 5, 3, 3, "#1a1a1a");
		const front = c.dir > 0 ? x + len - 1 : x;
		const backX = c.dir > 0 ? x : x + len - 1;
		rect(ctx, front, y + 2, 1, 2, night > 0.4 ? "#fff6c8" : "#e8e8e8");
		rect(ctx, backX, y + 2, 1, 2, "#dd3333");
		if (night > 0.4) {
			this.glows.push({ x: front + c.dir * 6, y: y + 3, r: 12, color: "#fff2b0", a: 0.55 * night });
			this.glows.push({ x: backX, y: y + 3, r: 5, color: "#ff3b3b", a: 0.5 * night });
		}
	}

	private person(ctx: CanvasRenderingContext2D, p: Walker, feet: number, now: number): void {
		const x = Math.round(p.x);
		const step = Math.floor(now / 160 + x) % 2;
		rect(ctx, x - 1, feet - 12, 3, 1, p.hair);
		rect(ctx, x - 1, feet - 11, 3, 2, p.skin);
		rect(ctx, x - 1, feet - 9, 3, 4, p.shirt);
		rect(ctx, x + (step ? -2 : 2), feet - 8, 1, 3, p.skin);
		rect(ctx, x - 1, feet - 5, 1, 3 + step, p.pants);
		rect(ctx, x + 1, feet - 5, 1, 4 - step, p.pants);
		if (!p.dog) return;
		// The dog walks ahead, on its leash.
		const dx = x + p.dir * 8;
		const wag = Math.floor(now / 120) % 2;
		rect(ctx, dx - 3, feet - 4, 6, 2, p.dog);
		rect(ctx, dx + (p.dir > 0 ? 2 : -4), feet - 6, 2, 2, p.dog);
		rect(ctx, dx + (p.dir > 0 ? 3 : -4), feet - 6, 1, 1, "#111111");
		rect(ctx, dx + (p.dir > 0 ? -4 : 3), feet - 5 - wag, 1, 2, p.dog);
		rect(ctx, dx - 2 + step, feet - 2, 1, 2, shade(p.dog, -0.3));
		rect(ctx, dx + 1 - step, feet - 2, 1, 2, shade(p.dog, -0.3));
		for (let i = 0; i < 6; i++) rect(ctx, x + p.dir + p.dir * i, feet - 7 + Math.floor(i / 3), 1, 1, "#5b4636");
	}
}

// ---- the view: the building in the panel, through its camera ---------------------------------------------------------

const STYLE = `
.office-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.office-canvas.over { cursor: pointer; }
.office-tip { position: absolute; z-index: 2; pointer-events: none; transform: translateX(-50%); max-width: 16rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 3px 8px; border-radius: 6px; font: 12px system-ui, sans-serif; background: rgba(15,23,42,.92); color: #f1f5f9; box-shadow: 0 2px 8px rgba(0,0,0,.3); }
.office-bar { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; z-index: 2; }
.office-bar button { width: 28px; height: 28px; border-radius: 7px; border: 1px solid rgba(148,163,184,.5); background: rgba(255,255,255,.85); color: #0f172a; font: 15px system-ui, sans-serif; line-height: 1; cursor: pointer; }
.office-bar button[aria-pressed="true"] { background: #0f172a; color: #ffffff; }
.office-words { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
`;

/** A soft light of a color, made once and drawn at any size: cheaper than a gradient each frame. */
const GLOWS = new Map<string, HTMLCanvasElement>();
function glowOf(color: string): HTMLCanvasElement {
	let c = GLOWS.get(color);
	if (c) return c;
	c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
	const g = c.getContext("2d")!;
	const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grad.addColorStop(0, color);
	grad.addColorStop(1, "transparent");
	g.fillStyle = grad;
	g.fillRect(0, 0, 64, 64);
	GLOWS.set(color, c);
	return c;
}

/** A text cut to what fits in `max` pixels. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
	if (ctx.measureText(text).width <= max) return text;
	let t = text;
	while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
	return `${t}…`;
}

const label = (cls: string, text: string) => Object.assign(document.createElement("button"), { className: cls, textContent: text });

export default defineView((host: ViewHost) => {
	const root = host.root;
	const style = document.createElement("style");
	style.textContent = STYLE;
	const canvas = document.createElement("canvas");
	canvas.className = "office-canvas";
	canvas.setAttribute("aria-label", "The office building: an office for each agent, its robot at work");
	const tip = document.createElement("div");
	tip.className = "office-tip";
	tip.hidden = true;
	const bar = document.createElement("div");
	bar.className = "office-bar";
	const followButton = label("", "⌖");
	followButton.title = "Follow what happens: the camera goes where agents work. Scroll, drag or pinch to look yourself";
	followButton.setAttribute("aria-label", "Follow what happens");
	const allButton = label("", "⛶");
	allButton.title = "Show all of it";
	allButton.setAttribute("aria-label", "Show all of it");
	bar.append(followButton, allButton);
	// What the drawing shows, in words: for a screen reader, and for whoever cannot tell the pixels apart.
	const words = document.createElement("ul");
	words.className = "office-words";
	words.dataset.slot = "office-words";
	root.append(style, canvas, tip, bar, words);

	const office = new Office();
	const off = document.createElement("canvas");
	const octx = off.getContext("2d")!;
	const ctx = canvas.getContext("2d")!;
	const makeCanvas = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });
	let size = { w: root.clientWidth, h: root.clientHeight };
	let follow = true;
	let hover: Hit;
	let drag: { x: number; y: number; moved: boolean } | undefined;
	let dragged = false;
	const setFollow = (on: boolean) => {
		follow = on;
		followButton.setAttribute("aria-pressed", String(on));
	};
	setFollow(true);
	const ro = new ResizeObserver(() => (size = { w: root.clientWidth, h: root.clientHeight }));
	ro.observe(root);

	const toOffice = (e: MouseEvent) => {
		const r = canvas.getBoundingClientRect();
		const { x, y, z } = office.cam;
		return { x: (e.clientX - r.left - size.w / 2) / z + x, y: (e.clientY - r.top - size.h / 2) / z + y };
	};
	const targetOf = (h: Hit) => (h?.k === "agent" ? { agent: h.id } : h?.k === "work" ? { work: h.id } : undefined);

	canvas.addEventListener("pointerdown", (e) => {
		drag = { x: e.clientX, y: e.clientY, moved: false };
		canvas.setPointerCapture(e.pointerId);
	});
	canvas.addEventListener("pointermove", (e) => {
		if (drag && (drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3)) {
			const cam = office.cam;
			office.cam = { ...cam, x: cam.x - (e.clientX - drag.x) / cam.z, y: cam.y - (e.clientY - drag.y) / cam.z };
			drag = { x: e.clientX, y: e.clientY, moved: true };
			setFollow(false);
			return;
		}
		hover = office.hit(toOffice(e));
		canvas.classList.toggle("over", Boolean(hover));
		const s = nowOf(host.state());
		const w = hover?.k === "work" ? s.work.get(hover.id) : undefined;
		const a = hover?.k === "agent" ? s.agent.get(hover.id) : undefined;
		const p = hover?.k === "port" ? s.input.get(hover.id) : undefined;
		const text = w ? `${w.agent} · ${w.copy ? "a copy · " : ""}${doingOf(w)}` : a ? `${a.id} · ${a.mode} · ${s.running.filter((x) => x.agent === a.id).length ? "at work" : "at rest"}` : p ? (p.kind === "you" ? "Your box: what you ask comes in here" : `${p.name}${p.type ? ` (${p.type})` : ""}: ${p.count} event${p.count === 1 ? "" : "s"}`) : "";
		tip.hidden = !text;
		tip.textContent = text;
		const r = canvas.getBoundingClientRect();
		tip.style.left = `${Math.min(Math.max(90, e.clientX - r.left), size.w - 90)}px`;
		tip.style.top = `${Math.max(4, e.clientY - r.top - 34)}px`;
	});
	canvas.addEventListener("pointerup", () => {
		dragged = Boolean(drag?.moved);
		drag = undefined;
	});
	canvas.addEventListener("pointerleave", () => ((hover = undefined), (tip.hidden = true)));
	canvas.addEventListener("click", (e) => {
		if (dragged) return;
		const h = office.hit(toOffice(e));
		if (h?.k !== "port") host.select(targetOf(h));
	});
	canvas.addEventListener("dblclick", (e) => {
		const t = targetOf(office.hit(toOffice(e)));
		if (t) host.open(t);
		else setFollow(true);
	});
	canvas.addEventListener(
		"wheel",
		(e) => {
			e.preventDefault();
			const cam = office.cam;
			if (e.ctrlKey || e.metaKey) {
				const r = canvas.getBoundingClientRect();
				const px = e.clientX - r.left - size.w / 2;
				const py = e.clientY - r.top - size.h / 2;
				const z = Math.max(0.5, Math.min(Z_MAX * 1.5, cam.z * Math.exp(-e.deltaY * 0.01)));
				office.cam = { x: cam.x + px / cam.z - px / z, y: cam.y + py / cam.z - py / z, z };
			} else office.cam = { ...cam, x: cam.x + e.deltaX / cam.z, y: cam.y + e.deltaY / cam.z };
			setFollow(false);
		},
		{ passive: false },
	);
	followButton.addEventListener("click", () => setFollow(!follow));
	allButton.addEventListener("click", () => {
		setFollow(false);
		office.cam = office.framed(office.whole(), size);
	});

	// The words follow the state, not every frame.
	const say = (s: Now) => {
		words.replaceChildren(
			...s.agents.map((a) => {
				const li = document.createElement("li");
				li.dataset.agent = a.id;
				const mine = s.running.filter((w) => w.agent === a.id);
				li.textContent = `${a.id}, ${a.mode} mode${a.main ? ", the main agent, in the penthouse" : ""}: ${mine.length ? `${mine.length} at work` : "at rest"}`;
				const ul = document.createElement("ul");
				for (const w of mine) {
					const item = document.createElement("li");
					item.dataset.work = String(w.id);
					item.textContent = `${w.copy ? "a copy, " : ""}from ${w.from.k === "agent" ? w.from.id : w.from.k === "source" ? w.from.name : w.from.k}, ${doingOf(w)}${w.held && w.mode ? `, held to ${w.mode} mode` : ""}${w.outside ? ", read outside content" : ""}`;
					ul.append(item);
				}
				li.append(ul);
				return li;
			}),
		);
	};
	say(nowOf(host.state()));
	const stopWords = host.on("state", (s) => say(nowOf(s)));

	let id = 0;
	let last = 0;
	// The time between frames, as the office says (`pace`); short for a moment after the pointer moved.
	let wait = 33;
	let touched = 0;
	canvas.addEventListener("pointermove", () => (touched = Date.now()));
	canvas.addEventListener("wheel", () => (touched = Date.now()));
	// One frame, then sleep until the next is due: the page is not woken up at the screen's rate for nothing.
	let timer = 0;
	const tick = (t: number) => {
		try {
			draw(t);
		} finally {
			// The next frame when it is due, counted from this one.
			timer = window.setTimeout(() => (id = requestAnimationFrame(tick)), Math.max(0, wait - (performance.now() - t)));
		}
	};
	const draw = (t: number) => {
		if (!size.w || !size.h) return;
		last = t;
		const now = Date.now();
		const state = host.state();
		const s = nowOf(state);
		const sel = state.selected;
		const focus: Hit = sel ? ("agent" in sel ? { k: "agent", id: sel.agent } : { k: "work", id: sel.work }) : undefined;
		office.layout(s, size);
		if (off.width !== office.width || off.height !== office.height) {
			off.width = office.width;
			off.height = office.height;
		}
		office.sync(s, now);
		office.step(s, now, size, { focus, follow });
		office.draw(octx, s, now, { selected: focus, hover, makeCanvas });
		wait = now - touched < 1000 ? 33 : office.pace(s);
		const dpr = window.devicePixelRatio || 1;
		if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
			canvas.width = Math.round(size.w * dpr);
			canvas.height = Math.round(size.h * dpr);
		}
		const { x, y, z } = office.cam;
		const sx = (px: number) => (px - x) * z + size.w / 2;
		const sy = (py: number) => (py - y) * z + size.h / 2;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.fillStyle = office.sky.top;
		ctx.fillRect(0, 0, size.w, size.h);
		ctx.imageSmoothingEnabled = false;
		ctx.setTransform(z * dpr, 0, 0, z * dpr, (size.w / 2 - x * z) * dpr, (size.h / 2 - y * z) * dpr);
		ctx.drawImage(off, 0, 0);
		// What shines: a soft light over the pixels; it adds up at night.
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		const night = office.sky.day < 0.5;
		ctx.globalCompositeOperation = night ? "lighter" : "source-over";
		for (const g of office.glows) {
			const gx = sx(g.x);
			const gy = sy(g.y);
			const r = g.r * z;
			const a = Math.min(1, g.a * (night ? 0.6 : 0.25));
			if (a < 0.02 || gx < -r || gy < -r || gx > size.w + r || gy > size.h + r) continue;
			ctx.globalAlpha = a;
			ctx.drawImage(glowOf(g.color), gx - r, gy - r, r * 2, r * 2);
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = "source-over";
		// The mailboxes' names, and over each robot its name and what it does, in the screen's pixels: sharp at every zoom.
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		const back = s.dark ? "rgba(11,18,32,0.86)" : "rgba(255,255,255,0.94)";
		const fore = s.dark ? "#e8eef7" : "#0f172a";
		if (z >= 4) {
			ctx.font = "500 10px system-ui, sans-serif";
			for (const l of office.labels()) {
				const text = fit(ctx, l.text, 20 * z);
				const tw = ctx.measureText(text).width;
				ctx.fillStyle = back;
				ctx.beginPath();
				ctx.roundRect(sx(l.x) - tw / 2 - 4, sy(l.y), tw + 8, 13, 3);
				ctx.fill();
				ctx.fillStyle = fore;
				ctx.fillText(text, sx(l.x), sy(l.y) + 7);
			}
		}
		const tags = office.tags(s, now);
		// From afar a bubble is its sign alone; close enough to read, it says what in words too.
		const words = z >= 2.5;
		for (const tag of tags) {
			const hx = sx(tag.x);
			let top = sy(tag.y) - 3;
			if (tag.name) {
				ctx.font = "600 10px system-ui, sans-serif";
				const text = fit(ctx, tag.name, Math.max(40, 60 * z));
				const tw = ctx.measureText(text).width;
				top -= 14;
				ctx.fillStyle = back;
				ctx.beginPath();
				ctx.roundRect(hx - tw / 2 - 4, top, tw + 8, 13, 6);
				ctx.fill();
				ctx.fillStyle = s.agent.get(tag.name)?.color ?? fore;
				ctx.fillRect(hx - tw / 2 - 1, top + 11, tw + 2, 1);
				ctx.fillStyle = fore;
				ctx.fillText(text, hx, top + 6.5);
			}
			if (!tag.say) continue;
			const look = SAYS[tag.say.kind];
			ctx.font = "500 11px system-ui, sans-serif";
			const text = words && !tag.small ? fit(ctx, tag.say.text, 150) : "";
			const tw = text ? ctx.measureText(text).width + 4 : 0;
			const bw = 22 + tw;
			const bh = 20;
			const by = top - bh - 6;
			const bx = Math.min(Math.max(hx - bw / 2, 2), size.w - bw - 2);
			ctx.fillStyle = back;
			ctx.strokeStyle = look.color;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			ctx.roundRect(bx, by, bw, bh, 7);
			ctx.fill();
			ctx.stroke();
			// The tail, down to the robot.
			ctx.beginPath();
			ctx.moveTo(hx - 4, by + bh - 0.5);
			ctx.lineTo(hx, by + bh + 5);
			ctx.lineTo(hx + 4, by + bh - 0.5);
			ctx.fill();
			ctx.beginPath();
			ctx.moveTo(hx - 4, by + bh);
			ctx.lineTo(hx, by + bh + 5);
			ctx.lineTo(hx + 4, by + bh);
			ctx.stroke();
			ctx.textAlign = "left";
			ctx.font = "12px system-ui, sans-serif";
			ctx.fillText(look.sign, bx + 4, by + bh / 2 + 1);
			if (text) {
				ctx.font = "500 11px system-ui, sans-serif";
				ctx.fillStyle = look.color;
				ctx.fillText(text, bx + 20, by + bh / 2 + 0.5);
			}
			ctx.textAlign = "center";
		}
	};
	id = requestAnimationFrame(tick);
	return () => {
		cancelAnimationFrame(id);
		window.clearTimeout(timer);
		ro.disconnect();
		stopWords();
		root.replaceChildren();
	};
});
