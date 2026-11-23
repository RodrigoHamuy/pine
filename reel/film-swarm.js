// The film about boards and swarms: two jobs, each started with /swarm in a conversation of the Pine app.
// First a small game, a pelican on a bicycle, built by sub-agents and scored by one that built none of it,
// until the score is 8. Then a security review of the owner's own demo shop on their own machine: one area
// for each sub-agent, a question answered once for all, each finding reproduced, and the report.
//
// Nothing of the app is drawn here. Its window is the real one, in pictures that reel/swarm-shots.mjs took
// while the two swarms ran (reel/assets/swarm), and the film plays them at its own pace. What the film adds
// is the room around the window, the camera, and sheets: a part of the window lifted off it and made large,
// so that a line can be read on a phone. The game beside the window is the code the first swarm left, running.
//
//   node reel/swarm-shots.mjs                    the pictures (once, and after the app changed)
//   node reel/render.mjs --film swarm            -> reel/pine-reel-swarm.mp4
//   node reel/render.mjs --film swarm --at 12,30 -> single frames

const W = 1920, H = 1080;
let SPEED = 1;
const SFX = [], MARKS = [];
const P = SHOTS.pelican, S = SHOTS.shop;
// How many pixels of a picture there are to a point of the window. The world is laid out in those pixels.
const D = P.density;
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (u) => { u = clamp(u); return u * u * u * (u * (6 * u - 15) + 10); };
const lerp = (a, b, u) => a + (b - a) * u;
/** 0 before a, 1 after b, eased between. */
const ramp = (t, a, b) => ease((t - a) / (b - a));
/** 1 between a and b, with a soft start and end. */
const span = (t, a, b, d = 0.35) => Math.min(ramp(t, a, a + d), 1 - ramp(t, b - d, b));

// ---- the pictures --------------------------------------------------------------------------------------------------------

/** How long a sequence of pictures is, in its own milliseconds. */
const len = (c, seq) => c.seqs[seq].at(-1)[1];
/** The picture of a sequence at one of its milliseconds: the last one taken up to then. */
function pictureAt(c, seq, ms) {
	const frames = c.seqs[seq];
	let lo = 0, hi = frames.length - 1;
	while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (frames[mid][1] <= ms) lo = mid; else hi = mid - 1; }
	return frames[lo][0];
}

// ---- the film, second by second ------------------------------------------------------------------------------------------
// Every place is in the window's own points (1240 x 780), as the app laid it out when the pictures were taken.

const ALL = { x: -30, y: -20, w: 1300, h: 820 };
const TYPE = { x: 262, y: 552, w: 446, h: 226 }; // the message box
const TOLD = { x: 262, y: 84, w: 446, h: 200 }; // the job as a message, and what pine says under it
const BOARD = { x: 706, y: 36, w: 536, h: 252 }; // the Board tab: its tabs and first tasks
const BOARD_2 = { x: 706, y: 130, w: 536, h: 252 };
const SCORE_1 = { x: 556, y: 346, w: 688, h: 216 }; // task 4 opened: the critic's first score
const ROUND_2 = { x: 262, y: 500, w: 446, h: 156 }; // the lead's words and the line of round 2
const VIEW = { x: 672, y: 78, w: 566, h: 200 }; // the view: triggers, the agent, its board
const VIEW_CARD = { x: 836, y: 128, w: 392, h: 140 };
const VIEW_LIST = { x: 672, y: 470, w: 566, h: 250 }; // the view's closer look at the board
const SCORE_2 = { x: 556, y: 540, w: 688, h: 216 }; // task 8 opened: the second score
const ANSWER = { x: 266, y: 208, w: 430, h: 150 }; // the lead's answer, its first lines
const CHECKED = { x: 266, y: 452, w: 430, h: 170 }; // the check of the answer, and the swarm done
const ASKED = { x: 712, y: 318, w: 524, h: 160 }; // the task that asks
const NOTES = { x: 716, y: 596, w: 524, h: 150 }; // the lead's answer among the notes
const FOUND = { x: 706, y: 214, w: 536, h: 230 }; // the findings, one opened
const REPRO = { x: 706, y: 470, w: 536, h: 230 }; // the task that reproduces them
const REPORT = { x: 394, y: 92, w: 692, h: 270 }; // the report without a panel beside it
const REPORT_2 = { x: 394, y: 250, w: 692, h: 240 };
const CHECKED_2 = { x: 396, y: 488, w: 500, h: 130 };

const T1 = 2.4; // the first job
const T2 = 31.2; // the second
const T_END = 56.9; // the last card
const END = 59.4;
const DURATION = END;

/** Which pictures play when: [from, to, which swarm, sequence, its milliseconds from, to]. */
const m = (c, name) => c.marks[name];
const PLAY = [
	[0, T1 + 0.5, P, "pel-type", 0, 0],
	[T1 + 0.5, T1 + 3.5, P, "pel-type", 0, m(P, "pel-type:typed")],
	[T1 + 3.5, T1 + 5.6, P, "pel-type", m(P, "pel-type:typed"), len(P, "pel-type")],
	[T1 + 5.6, T1 + 8.8, P, "pel-board", 0, m(P, "pel:built") + 300],
	[T1 + 8.8, T1 + 11.8, P, "pel-board", m(P, "pel:built") + 300, m(P, "pel:scored4") + 600],
	[T1 + 11.8, T1 + 13.5, P, "pel-board", m(P, "pel:scored4") + 600, len(P, "pel-board")],
	[T1 + 13.5, T1 + 15.7, P, "pel-view", 0, m(P, "pel:closer")],
	[T1 + 15.7, T1 + 19.5, P, "pel-view", m(P, "pel:closer"), len(P, "pel-view")],
	[T1 + 19.5, T1 + 20.9, P, "pel-score", 0, len(P, "pel-score") - 1000],
	[T1 + 20.9, T1 + 22.0, P, "pel-score", len(P, "pel-score") - 1000, len(P, "pel-score")],
	[T1 + 22.0, T1 + 24.6, P, "pel-score", len(P, "pel-score"), len(P, "pel-score")],
	[T1 + 24.6, T2 - 0.25, P, "pel-answer", 0, len(P, "pel-answer") + 400],
	[T2 - 0.25, T2 + 0.5, S, "shop-type", 0, 0],
	[T2 + 0.5, T2 + 3.4, S, "shop-type", 0, m(S, "shop-type:typed")],
	[T2 + 3.4, T2 + 4.6, S, "shop-type", m(S, "shop-type:typed"), len(S, "shop-type")],
	[T2 + 4.6, T2 + 7.6, S, "shop-view", 0, len(S, "shop-view")],
	[T2 + 7.6, T2 + 8.8, S, "shop-board", 0, m(S, "shop:asked")],
	[T2 + 8.8, T2 + 10.8, S, "shop-board", m(S, "shop:asked"), m(S, "shop:asked") + 150],
	[T2 + 10.8, T2 + 13.4, S, "shop-board", m(S, "shop:answered") + 300, m(S, "shop:answered") + 2600],
	[T2 + 13.4, T2 + 14.4, S, "shop-board", m(S, "shop:answered") + 2600, m(S, "shop:found")],
	[T2 + 14.4, T2 + 16.0, S, "shop-board", m(S, "shop:found"), len(S, "shop-board")],
	[T2 + 16.0, T2 + 19.0, S, "shop-repro", 0, len(S, "shop-repro")],
	[T2 + 19.0, T2 + 23.6, S, "shop-report", 0, len(S, "shop-report")],
	[T2 + 23.6, END, S, "shop-report", len(S, "shop-report"), len(S, "shop-report")],
];

/** Where the camera looks: [second, place, how far the window is turned (degrees)]. It glides from one to the next. */
const CAM = [
	[0, ALL, -7],
	[T1 - 0.1, ALL, -5],
	[T1 + 0.8, TYPE, -3],
	[T1 + 3.6, TYPE, -1],
	[T1 + 4.4, TOLD, 2],
	[T1 + 5.5, TOLD, 3],
	[T1 + 6.3, BOARD, 4],
	[T1 + 7.4, BOARD, 3],
	[T1 + 8.4, BOARD_2, 2],
	[T1 + 9.2, BOARD_2, 1],
	[T1 + 10.2, SCORE_1, -2],
	[T1 + 11.9, SCORE_1, -3],
	[T1 + 12.5, ROUND_2, 1],
	[T1 + 13.5, ROUND_2, 2],
	[T1 + 14.3, VIEW, 4],
	[T1 + 15.2, VIEW, 3],
	[T1 + 15.9, VIEW_CARD, 1],
	[T1 + 17.0, VIEW_CARD, 0],
	[T1 + 17.8, VIEW_LIST, -2],
	[T1 + 19.4, VIEW_LIST, -3],
	[T1 + 20.2, SCORE_2, -2],
	[T1 + 21.9, SCORE_2, 0],
	[T1 + 22.8, ALL, 5],
	[T1 + 24.5, ALL, 4],
	[T1 + 25.2, ANSWER, 1],
	[T1 + 26.2, ANSWER, 0],
	[T1 + 27.0, CHECKED, -2],
	[T2 - 0.9, CHECKED, -3],
	[T2 - 0.2, ALL, -6],
	[T2 + 0.1, ALL, -4],
	[T2 + 0.8, TYPE, -2],
	[T2 + 3.5, TYPE, 0],
	[T2 + 4.3, TOLD, 2],
	[T2 + 5.0, VIEW, 5],
	[T2 + 6.2, VIEW, 3],
	[T2 + 6.8, VIEW_CARD, 1],
	[T2 + 7.6, VIEW_CARD, 0],
	[T2 + 8.3, BOARD, -2],
	[T2 + 8.8, BOARD, -2],
	[T2 + 9.5, ASKED, -3],
	[T2 + 10.8, ASKED, -3],
	[T2 + 11.5, NOTES, -1],
	[T2 + 13.3, NOTES, 0],
	[T2 + 14.1, FOUND, 2],
	[T2 + 16.0, FOUND, 3],
	[T2 + 16.8, REPRO, 4],
	[T2 + 18.9, REPRO, 3],
	[T2 + 19.7, REPORT, 0],
	[T2 + 21.2, REPORT, -1],
	[T2 + 22.6, REPORT_2, -2],
	[T2 + 23.4, REPORT_2, -2],
	[T2 + 24.2, CHECKED_2, -3],
	[T_END - 0.2, CHECKED_2, -4],
	[T_END + 0.6, ALL, -7],
	[END, ALL, -8],
];

/**
 * Sheets: a part of the window lifted off it and made large. [from, to, the part, where its middle is on the
 * screen, how many times its size].
 */
const LIFTS = [];
/** The game beside the window: [from, to, version, middle on the screen, size, what it says above it]. */
const GAMES = [
	[T1 + 10.0, T1 + 12.5, 1, [350, 420], 0.72, "version 1"],
	[T1 + 20.6, T1 + 24.7, 2, (t) => [lerp(350, 960, ramp(t, T1 + 22.2, T1 + 23.0)), lerp(420, 470, ramp(t, T1 + 22.2, T1 + 23.0))], (t) => lerp(0.8, 1.8, ramp(t, T1 + 22.2, T1 + 23.0)), "version 2"],
];
/** What a shot says, under the picture. */
const CAPS = [
	[T1 + 0.6, T1 + 3.6, "Type <code>/swarm</code> and the job."],
	[T1 + 3.8, T1 + 5.8, "The agent of the conversation leads the swarm."],
	[T1 + 6.0, T1 + 9.6, "The pieces go on the board. Sub-agents build them side by side."],
	[T1 + 9.8, T1 + 12.3, "A critic that built none of it scores the picture: <em>4 of 10</em>."],
	[T1 + 12.4, T1 + 14.1, "Work is left on the board, so pine starts round 2."],
	[T1 + 14.3, T1 + 19.5, "The overview shows who is working on what."],
	[T1 + 19.7, T1 + 21.0, "Then the critic looks again."],
	[T1 + 21.1, T1 + 22.4, "Version 2: <em>8 of 10</em>."],
	[T1 + 22.6, T1 + 24.6, "The game the swarm wrote."],
	[T1 + 25.0, T2 - 0.7, "Then a sub-agent that did none of the work checks the answer."],
	[T2 + 0.6, T2 + 4.4, "A second job: a security review of your own test server."],
	[T2 + 4.8, T2 + 7.6, "One area for each sub-agent."],
	[T2 + 8.2, T2 + 10.7, "One of them asks a question."],
	[T2 + 10.9, T2 + 13.4, "The lead answers on the board, once, for all of them."],
	[T2 + 13.6, T2 + 16.0, "Findings come back as tasks marked done."],
	[T2 + 16.2, T2 + 19.0, "A sub-agent that found none of them reproduces each one."],
	[T2 + 19.4, T2 + 23.6, "The report: findings by severity, with the fix for each."],
	[T2 + 23.9, T_END - 0.3, "Checked, and done."],
];
/** Which of the two jobs this is, at the top. */
const PARTS = [
	[T1 + 0.2, T2 - 0.7, "1 <i>·</i> a game: a pelican on a bicycle"],
	[T2 + 0.2, T_END - 0.3, "2 <i>·</i> a security review of your own test server"],
];
const TITLES = [
	[0, T1 - 0.3, "Boards and swarms", "one job, many sub-agents, an answer that was checked"],
	[T_END + 0.3, END + 1, "pine", "<code>/swarm</code> and what is to be done"],
];

// ---- drawing --------------------------------------------------------------------------------------------------------------

const SHEETS = [];
{
	// The room's shapes: large, soft, in the colours of the wall, each at a depth of its own.
	const wall = $("wall");
	for (const [x, y, r, c, d] of [[240, 260, 520, "rgba(255,255,255,.55)", 0.5], [1700, 180, 420, "rgba(255,255,255,.5)", 0.8], [1500, 980, 640, "rgba(255,244,230,.6)", 0.3], [520, 1040, 380, "rgba(236,246,255,.6)", 0.65]]) {
		const i = document.createElement("i");
		i.style.cssText = `left:${x - r / 2 + 120}px;top:${y - r / 2 + 120}px;width:${r}px;height:${r}px;background:radial-gradient(closest-side, ${c}, rgba(255,255,255,0))`;
		i.dataset.depth = d;
		wall.append(i);
	}
	for (const spec of LIFTS) {
		const l = { spec };
		SHEETS.push(l);
		const el = document.createElement("div");
		el.className = "lift";
		el.innerHTML = '<img alt="">';
		$("lifts").append(el);
		l.el = el;
		const ghost = document.createElement("div");
		ghost.className = "ghost";
		$("win").append(ghost);
		l.ghost = ghost;
	}
}

/** The camera at a second: the place it looks at, and the turn of the window. */
function cameraAt(t) {
	let i = 0;
	while (i < CAM.length - 2 && CAM[i + 1][0] <= t) i++;
	const [t0, a, r0] = CAM[i], [t1, b, r1] = CAM[i + 1];
	const u = ease((t - t0) / (t1 - t0));
	return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), w: lerp(a.w, b.w, u), h: lerp(a.h, b.h, u), turn: lerp(r0, r1, u) };
}

// The picture has the screen above the words: its middle, and how much of it a place may fill.
const MID = { x: 960, y: 462 }, ROOM = { w: 1700, h: 800 };

function renderAt(seconds) {
	const t = clamp(seconds * SPEED, 0, END);
	// The window's picture.
	const play = PLAY.find(([a, b]) => t >= a && t < b) ?? PLAY.at(-1);
	const [a, b, c, seq, from, to] = play;
	const name = pictureAt(c, seq, lerp(from, to, clamp((t - a) / (b - a))));
	const src = `assets/swarm/${name}`;
	if ($("shot").getAttribute("src") !== src) $("shot").setAttribute("src", src);

	// The camera. Between the two jobs the window leaves and comes back with the other one.
	const cam = cameraAt(t);
	const k = Math.min(ROOM.w / cam.w, ROOM.h / cam.h);
	const cx = cam.x + cam.w / 2, cy = cam.y + cam.h / 2;
	const swap = span(t, T2 - 0.55, T2 + 0.35, 0.3), arrive = 1 - ramp(t, 0.5, T1 - 0.2);
	const lift3d = `translate(${MID.x}px, ${MID.y + 60 * arrive}px) rotateX(${2 + 10 * arrive}deg) rotateY(${cam.turn}deg) scale(${(k / D) * (1 - 0.06 * swap - 0.1 * arrive)}) translate(${-cx * D}px, ${-cy * D}px)`;
	$("world").style.transform = lift3d;
	$("world").style.opacity = String((1 - swap) * ramp(t, T1 - 0.45, T1 + 0.15) * (1 - ramp(t, T_END, T_END + 0.6)));
	// The room moves a little against the camera.
	for (const i of $("wall").children) i.style.transform = `translate(${(-cx + 620) * 0.12 * i.dataset.depth - cam.turn * 6 * i.dataset.depth}px, ${(-cy + 390) * 0.1 * i.dataset.depth}px)`;

	// Sheets.
	for (const l of SHEETS) {
		const [t0, t1, part, at, size] = l.spec;
		const on = span(t, t0, t1, 0.45);
		l.el.style.display = l.ghost.style.display = on > 0.001 ? "" : "none";
		if (on <= 0.001) continue;
		const r = typeof part === "function" ? part(t) : part;
		// Where it lies when it is up: its middle at a place on the screen, whatever the camera does.
		const s = lerp(1, size / k, on);
		const x = lerp(r.x, cx + (at[0] - MID.x) / k - (r.w * size) / k / 2, on), y = lerp(r.y, cy + (at[1] - MID.y) / k - (r.h * size) / k / 2, on);
		l.el.style.width = `${r.w * D}px`;
		l.el.style.height = `${r.h * D}px`;
		l.el.style.transform = `translate3d(${x * D}px, ${y * D}px, ${150 * on}px) scale(${s})`;
		l.el.style.opacity = String(clamp(on * 3));
		l.el.style.borderRadius = `${30 / Math.max(1, s * 0.5)}px`;
		const img = l.el.firstChild;
		if (img.getAttribute("src") !== src) img.setAttribute("src", src);
		img.style.left = `${-r.x * D}px`;
		img.style.top = `${-r.y * D}px`;
		l.ghost.style.cssText = `left:${(r.x - 3) * D}px;top:${(r.y - 3) * D}px;width:${(r.w + 6) * D}px;height:${(r.h + 6) * D}px;opacity:${on * 0.9}`;
	}

	// The game.
	const game = GAMES.find(([t0, t1]) => t >= t0 && t < t1);
	$("game").style.display = game ? "" : "none";
	if (game) {
		const [t0, t1, version, at, size, label] = game;
		const on = span(t, t0, t1, 0.45);
		const at1 = typeof at === "function" ? at(t) : at;
		const size1 = typeof size === "function" ? size(t) : size, s1 = (size1 / k) * lerp(0.86, 1, on);
		$("game").style.transform = `translate3d(${(cx + (at1[0] - MID.x) / k - 327 * s1) * D}px, ${(cy + (at1[1] - MID.y) / k - 187 * s1 + ((1 - on) * 30) / k) * D}px, ${220 * on}px) scale(${s1})`;
		$("game").style.opacity = String(clamp(on * 2.5));
		$("game").firstChild.textContent = label;
		const ctx = $("game").lastChild.getContext("2d"), G = version === 1 ? GAME_V1 : GAME_V2, gt = 1.2 + (t - t0);
		ctx.setTransform(3, 0, 0, 3, 0, 0);
		G.frame(ctx, gt, G.auto(gt));
	}

	// Words.
	const cap = CAPS.find(([t0, t1]) => t >= t0 && t < t1);
	$("cap").innerHTML = cap ? `<span>${cap[2]}</span>` : "";
	$("cap").style.opacity = cap ? String(span(t, cap[0], cap[1], 0.25)) : "0";
	$("cap").style.transform = cap ? `translateY(${(1 - ramp(t, cap[0], cap[0] + 0.3)) * 10}px)` : "";
	const part = PARTS.find(([t0, t1]) => t >= t0 && t < t1);
	$("part").innerHTML = part ? part[2] : "";
	$("part").style.opacity = part ? String(span(t, part[0], part[1], 0.3)) : "0";
	const title = TITLES.find(([t0, t1]) => t >= t0 && t < t1);
	$("title").style.display = title ? "" : "none";
	if (title) {
		const on = span(t, title[0] - 0.01, title[1], 0.4) * (title[0] === 0 ? 1 : ramp(t, title[0], title[0] + 0.5));
		$("title").style.opacity = String(title[0] === 0 ? 1 - ramp(t, title[1] - 0.45, title[1]) : on);
		$("title").style.transform = `translateY(${title[0] === 0 ? -14 * ramp(t, title[1] - 0.45, title[1]) : 12 * (1 - on)}px)`;
		$("title").querySelector("h1").innerHTML = title[2];
		$("title").querySelector("p").innerHTML = title[3];
		$("title").querySelector("img").style.display = title[2] === "pine" ? "" : "none";
		$("title").querySelector("h1").style.display = title[2] === "pine" ? "none" : "";
	}
}
const shutterTimes = (seconds) => [seconds];

// ---- in a browser: the film plays; space stops it, the arrow keys step, a click on the bar jumps -------------------------
if (!navigator.webdriver) {
	const stage = $("stage"), bar = $("scrub");
	bar.style.display = "block";
	let at = Number(new URLSearchParams(location.search).get("t") ?? 0), playing = true, last = performance.now();
	const fit = () => { const s = Math.min(innerWidth / W, (innerHeight - 30) / H); stage.style.transform = `scale(${s})`; };
	addEventListener("resize", fit);
	fit();
	addEventListener("keydown", (e) => {
		if (e.code === "Space") playing = !playing;
		if (e.code === "ArrowRight") at = Math.min(DURATION, at + (e.shiftKey ? 1 : 1 / 30));
		if (e.code === "ArrowLeft") at = Math.max(0, at - (e.shiftKey ? 1 : 1 / 30));
	});
	bar.addEventListener("click", (e) => (at = (e.clientX / innerWidth) * DURATION));
	(function tick(now) {
		if (playing) at = (at + (now - last) / 1000) % DURATION;
		last = now;
		renderAt(at);
		bar.firstChild.style.width = `${(at / DURATION) * 100}%`;
		bar.lastChild.textContent = `${at.toFixed(2)} s`;
		requestAnimationFrame(tick);
	})(last);
}
