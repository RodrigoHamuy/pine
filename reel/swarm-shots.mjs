// Takes the pictures of the desktop app that film-swarm.js shows: the real app (desktop/), without a
// screen, on a pine home of its own with the scripted model server of pine's tests. Two swarms are
// run in it, each in a conversation in a folder of its own: one builds a small game (a pelican on a
// bicycle) until a critic that built none of it scores the picture 8 of 10, one reviews the security
// of a demo shop on the owner's own machine. Every change of the window is one picture, so the film
// can play them at its own pace.
//
//   node reel/swarm-shots.mjs            -> reel/assets/swarm/p0001.jpg ... and s0001.jpg ..., shots-pelican.js and
//                                           shots-shop.js that list them, and game.js: the game the first swarm
//                                           wrote, for the film
//   node reel/swarm-shots.mjs pelican    only that swarm (or: shop). Each runs in an app and on a home of its
//                                           own, so that the tasks on its board are numbered from 1
//   node reel/swarm-shots.mjs --keep     leaves the home and the folders it made, to look at them
//
// It needs a Mac and desktop/ installed (`npm install` there). The home and the folders the app shows
// lie under /Users/Shared while it runs; they are removed at the end. Nothing here is real: the game
// is written by a script, not by a model, the shop is made up, and no server is asked anything.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "../node_modules/playwright-core/index.mjs";
import { startMock, textOf } from "../baseline/tests/mock.mjs";
import { launchApp } from "../desktop/test/support/app.ts";

const dir = import.meta.dirname;
const out = path.join(dir, "assets", "swarm");
const keep = process.argv.includes("--keep");
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
// Without a name: one run of this script for each swarm, one after the other.
if (!only.length) {
	for (const name of ["pelican", "shop"]) {
		const run = spawnSync(process.execPath, [import.meta.filename, name, ...process.argv.slice(2)], { stdio: "inherit" });
		if (run.status) process.exit(run.status);
	}
	process.exit(0);
}
const which = only[0];
const wants = (name) => name === which;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const from = (...p) => fs.readFileSync(path.join(dir, "swarm", ...p), "utf8");

// The window: its size in points, and how many pixels a point is in the pictures (the film goes close).
const SIZE = { width: 1240, height: 780 }, DENSITY = 3;

// ---- the made-up world ----------------------------------------------------------------------------

const BASE = "/Users/Shared";
const made = [];
process.on("exit", () => { if (!keep) for (const p of made) fs.rmSync(p, { recursive: true, force: true }); });
/** A folder under /Users/Shared that is this script's own: one that is there already is somebody's, and is left alone. */
function own(name) {
	const p = path.join(BASE, name);
	if (fs.existsSync(p)) throw new Error(`${p} exists already. This script makes and removes it; move it away first.`);
	fs.mkdirSync(p, { recursive: true });
	made.push(p);
	return p;
}
const home = own(".pine");
const dev = own("dev");
const pelican = path.join(dev, "pelican-ride");
const shop = path.join(dev, "demo-shop");

// The game, as the film draws it: both versions, each a Game object of its own.
const PIECES = ["world", "bicycle", "pelican", "game"];
const gameOf = (v) => `(() => { const Game = {};\n${PIECES.map((f) => from("pelican", v, "src", `${f}.js`)).join("\n")}\nreturn Game; })()`;
fs.mkdirSync(out, { recursive: true });
write(path.join(out, "game.js"), `// Written by reel/swarm-shots.mjs: the game of reel/swarm/pelican, as the first swarm leaves it (V2) and as the critic first saw it (V1).\nconst GAME_V1 = ${gameOf("v1")};\nconst GAME_V2 = ${gameOf("v2")};\n`);

// The folder the game is built in: empty but for a line of what it is to become, and the tool the critic
// takes its picture with. (That tool hands over a picture this script drew of the version's own code.)
write(path.join(pelican, "README.md"), "# pelican-ride\n\nA small game for the browser: a pelican rides a bicycle and jumps for fish.\n");
write(path.join(pelican, "tools", "snap.mjs"), 'import fs from "node:fs";\nconst v = process.argv[2] ?? "1";\nfs.mkdirSync("shots", { recursive: true });\nfs.copyFileSync(new URL(`./.drawn/v${v}.png`, import.meta.url), `shots/v${v}.png`);\nconsole.log(`shots/v${v}.png`);\n');
{
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 });
	await page.setContent('<body style="margin:0"><canvas id=c width=1280 height=720 style="width:640px;height:360px"></canvas>');
	fs.mkdirSync(path.join(pelican, "tools", ".drawn"), { recursive: true });
	for (const v of ["v1", "v2"]) {
		await page.evaluate(([src, t]) => { const G = (0, eval)(src); const ctx = document.getElementById("c").getContext("2d"); ctx.setTransform(2, 0, 0, 2, 0, 0); G.frame(ctx, t, G.auto(t)); }, [gameOf(v), 3.7]);
		await page.screenshot({ path: path.join(pelican, "tools", ".drawn", `${v}.png`) });
	}
	await browser.close();
}
// The shop: a few files that were written quickly, which is what the review finds.
for (const f of ["README.md", "package.json", "server.js", "config.js", "db.js", "routes/login.js", "routes/session.js", "routes/search.js", "routes/upload.js"]) write(path.join(shop, f), from("shop", f));

// ---- what the owner types ---------------------------------------------------------------------------

const JOBS = {
	pelican: "/swarm Build a small game: a pelican riding a bicycle. After every version, have a sub-agent that built none of it score the picture from 1 to 10 and list its weaknesses. Do not stop before it scores 8.",
	shop: "/swarm Review the security of my demo shop on localhost:8080. It is my own test server, and its code is in this folder. Split the review by area, have every finding reproduced by a sub-agent that did not find it, and give me a short report: findings by severity, with the fix for each. Test account: demo / demo.",
};

// ---- the model: pine's scripted one, told which script a message means -------------------------------

const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g, promptTokens: (body) => 9000 + 700 * (body.messages?.length ?? 0) });
/** What the script waits for: the film's next step is taken when the window shows what it should. */
const gate = {};
const open = (name) => () => Boolean(gate[name]);
const S = mock.state.scripts;
const slow = { chunkDelayMs: 55 };

// 1. The game.
const NOTE_GAME = "One page, index.html, with a 640 x 360 canvas and no libraries. All drawing hangs on one global object, Game: Game.world(ctx, t, s) draws sky and road (t seconds, s how far the rider has come), Game.bicycle(ctx, x, y, s) draws the bicycle and returns where the pedals are, Game.pelican(ctx, x, y, t, pedals, up) draws the rider. Flat shapes in clear colours, nothing loaded from the web.";
const BUILD = [
	"Draw the pelican: src/pelican.js. It sits on the saddle and rides.",
	"Draw the bicycle: src/bicycle.js. Two wheels, a frame, a crank with pedals.",
	"Draw the world and put the game together: src/world.js, src/game.js and index.html. Space makes the rider jump for fish.",
];
const CRITIC = (v) => `You built none of this. Take a picture of version ${v} (node tools/snap.mjs ${v}, then look at shots/v${v}.png), score it from 1 to 10 as somebody who sees it for the first time, and list its weaknesses.`;
const FIXES = [
	"Fix the pelican (src/pelican.js): a pouch under the beak, and a foot on each pedal.",
	"Fix the bicycle and the world (src/bicycle.js, src/world.js): wheels and crank that turn, clouds and hills that pass.",
];
S.pel_lead1 = [
	{ delayMs: 700, tools: [{ name: "read", args: { path: "README.md" } }] },
	{ delayMs: 900, tools: [{ name: "subagent", args: { stages: [BUILD, [CRITIC(1)]], note: NOTE_GAME } }] },
	{ delayMs: 900, tools: [{ name: "board_post", args: { type: "task", text: FIXES[0] } }, { name: "board_post", args: { type: "task", text: FIXES[1] } }] },
	{ delayMs: 500, tools: [{ name: "board_post", args: { type: "task", text: CRITIC(2), after: [6, 7] } }] },
	{ ...slow, delayMs: 400, text: "Version 1 scored **4 of 10**. Two fixes are on the board, and then the critic looks again." },
];
S.pel_lead2 = [
	{ delayMs: 600, until: open("round2"), tools: [{ name: "subagent", args: { pool: true } }] },
	{ ...slow, delayMs: 900, until: open("answer"), text: "**Pelican Ride is done: version 2 scored 8 of 10.**\n\n- Open `index.html` to play. Space makes the pelican jump for the fish.\n- Version 1 scored 4: no pouch under the beak, wheels that did not turn, feet above the pedals, an empty sky.\n- Fixed in `src/pelican.js`, `src/bicycle.js` and `src/world.js`, then scored again by a sub-agent that built none of it.\n- Still open: the fish are hard to see where they pass a cloud." },
];
S.pel_check = [
	{ delayMs: 900, tools: [{ name: "read", args: { path: "index.html" } }] },
	{ delayMs: 900, tools: [{ name: "read", args: { path: "src/game.js" } }] },
	{ delayMs: 900, text: "index.html loads the four files in src/, and all four are there.\nThe second score on the board is 8 of 10, as the answer says.\n\nPASS" },
];
S.pel_bird = [
	{ delayMs: 1400, until: open("board"), tools: [{ name: "write", args: { path: "src/pelican.js", content: from("pelican", "v1", "src", "pelican.js") } }] },
	{ delayMs: 2300, text: "Wrote src/pelican.js: a white bird on the saddle, with a beak and two legs." },
];
S.pel_bike = [
	{ delayMs: 1100, until: open("board"), tools: [{ name: "write", args: { path: "src/bicycle.js", content: from("pelican", "v1", "src", "bicycle.js") } }] },
	{ delayMs: 1500, text: "Wrote src/bicycle.js: two wheels, a red frame and a crank. It returns where the pedals are." },
];
S.pel_world = [
	{ delayMs: 1300, until: open("board"), tools: [{ name: "write", args: { path: "src/world.js", content: from("pelican", "v1", "src", "world.js") } }, { name: "write", args: { path: "src/game.js", content: from("pelican", "v1", "src", "game.js") } }] },
	{ delayMs: 1200, tools: [{ name: "write", args: { path: "index.html", content: from("pelican", "v1", "index.html") } }] },
	{ delayMs: 1900, text: "Wrote src/world.js, src/game.js and index.html. The game runs: space makes the rider jump, and a fish caught in the air counts." },
];
S.pel_critic1 = [
	{ delayMs: 1000, tools: [{ name: "bash", args: { command: "node tools/snap.mjs 1" } }] },
	{ delayMs: 900, tools: [{ name: "read", args: { path: "shots/v1.png" } }] },
	{ delayMs: 1600, text: "4 of 10.\n- It reads as a goose: there is no pouch under the beak.\n- The wheels do not turn, and the feet hang above the pedals.\n- Nothing moves behind the rider: a flat sky, no clouds, no hills." },
];
S.pel_fix_bird = [
	{ delayMs: 1500, until: open("view"), tools: [{ name: "read", args: { path: "src/pelican.js" } }] },
	{ delayMs: 2200, tools: [{ name: "write", args: { path: "src/pelican.js", content: from("pelican", "v2", "src", "pelican.js") } }] },
	{ delayMs: 2400, text: "The beak has a pouch now, the neck is an S, and each foot follows its pedal." },
];
S.pel_fix_bike = [
	{ delayMs: 1200, until: open("view"), tools: [{ name: "read", args: { path: "src/bicycle.js" } }] },
	{ delayMs: 1900, tools: [{ name: "write", args: { path: "src/bicycle.js", content: from("pelican", "v2", "src", "bicycle.js") } }] },
	{ delayMs: 1700, tools: [{ name: "write", args: { path: "src/world.js", content: from("pelican", "v2", "src", "world.js") } }, { name: "write", args: { path: "src/game.js", content: from("pelican", "v2", "src", "game.js") } }] },
	{ delayMs: 1800, text: "Spokes and crank turn with the road, and the sky has a sun, clouds that drift and two rows of hills." },
];
S.pel_critic2 = [
	{ delayMs: 1000, until: open("score"), tools: [{ name: "bash", args: { command: "node tools/snap.mjs 2" } }] },
	{ delayMs: 900, tools: [{ name: "read", args: { path: "shots/v2.png" } }] },
	{ delayMs: 1800, text: "8 of 10.\n- It reads as a pelican at a glance: the pouch does it.\n- Wheels, crank and feet move together.\n- Still weak: the fish are hard to see where they pass a cloud." },
];

// 2. The review.
const NOTE_SHOP = "Only this machine: the shop at http://localhost:8080 and its code in this folder. Read, and ask the shop only what a visitor could; change no data and no file. For each weakness say where it is (file and line), how serious it is (high, medium or low) and the fix.";
const AREAS = [
	"Sign-in: routes/login.js.",
	"Session handling: routes/session.js and the cookie in config.js.",
	"Input handling: routes/search.js.",
	"File upload: routes/upload.js.",
	"Headers and configuration: server.js and config.js.",
];
const REPRODUCE = "You found none of these. Reproduce each finding on the board against the code in this folder, and say for each whether it is there as described.";
const ANSWER = "Yes: sign in as demo / demo, the test account the owner gave. Stay on localhost:8080 and change no data.";
const REPORT = "**5 findings in demo-shop, each reproduced by a sub-agent that did not find it.**\n\n| Severity | Finding | Fix |\n|---|---|---|\n| High | Search puts what was typed straight into its SQL (`routes/search.js:5`) | Pass it as a parameter of the query |\n| High | An upload is kept under the name it came with, whatever it is (`routes/upload.js:7`) | Accept pictures only, and store them under a name the shop makes |\n| Medium | Sign-in answers wrong passwords without a limit (`routes/login.js:5`) | Slow down after 5 wrong tries for an account |\n| Medium | The session id stays the same after sign-in, in a cookie scripts can read (`routes/session.js:8`) | A new id at sign-in; `HttpOnly` and `SameSite=Lax` |\n| Low | Errors show their stack trace, and no security headers are sent (`server.js:16`) | Turn `debug` off; add a content security policy and `nosniff` |\n\nNothing in the shop was changed.";
S.shop_lead = [
	{ delayMs: 700, tools: [{ name: "read", args: { path: "README.md" } }] },
	{ delayMs: 900, tools: [{ name: "subagent", args: { tasks: AREAS, note: NOTE_SHOP } }] },
	{ delayMs: 1200, until: open("asked"), tools: [{ name: "board_answer", args: { id: 4, text: ANSWER, all: true } }] },
	{ delayMs: 700, tools: [{ name: "subagent", args: { pool: true } }] },
	{ delayMs: 900, until: open("found"), tools: [{ name: "subagent", args: { tasks: [REPRODUCE] } }] },
	{ ...slow, chunkDelayMs: 30, delayMs: 900, until: open("report"), text: REPORT },
];
S.shop_check = [
	{ delayMs: 900, tools: [{ name: "read", args: { path: "routes/search.js" } }] },
	{ delayMs: 800, tools: [{ name: "read", args: { path: "routes/upload.js" } }] },
	{ delayMs: 900, text: "The report has all five areas that were asked for, by severity, each with a fix.\nThe lines it names say what it says they do.\n\nPASS" },
];
const looked = (file, ms, more, found) => [
	{ delayMs: ms, until: open("areas"), tools: [{ name: "read", args: { path: file } }] },
	{ delayMs: more, tools: [{ name: "read", args: { path: "config.js" } }] },
	{ delayMs: more + 300, text: found },
];
S.shop_login = looked("routes/login.js", 1300, 2100, "Medium. routes/login.js:5 answers every attempt at once, however many wrong ones came before. Fix: slow down after 5 wrong tries for an account.");
S.shop_session = looked("routes/session.js", 1500, 2600, "Medium. routes/session.js:8 keeps the id a visitor came with after sign-in, and config.js sets the cookie without HttpOnly and SameSite. Fix: a new id at sign-in, and both flags.");
S.shop_search = looked("routes/search.js", 1100, 1900, "High. routes/search.js:5 builds its SQL from what was typed, and the page shows the text as it came. Fix: pass it as a parameter of the query, and escape it in the page.");
S.shop_headers = looked("server.js", 1700, 3000, "Low. server.js:16 sends errors with their stack trace, and no security headers are set. Fix: debug off, a content security policy and nosniff.");
// The one that asks: an upload needs somebody signed in. Given out again after the answer, it finishes.
Object.defineProperty(S, "shop_upload", {
	get: () => {
		const said = JSON.stringify(mock.state.requests.at(-1)?.body.messages.filter((m) => m.role === "user").at(-1) ?? "");
		const id = Number(/this is task #(\d+)/.exec(said)?.[1] ?? 4);
		if (said.includes("sign in as demo")) return [
			{ delayMs: 1200, tools: [{ name: "read", args: { path: "routes/upload.js" } }] },
			{ delayMs: 2000, text: "High. routes/upload.js:7 keeps a file under the name it came with and never looks at what it is. Fix: accept pictures only, and store them under a name the shop makes." },
		];
		return [
			{ delayMs: 1000, until: open("areas"), tools: [{ name: "read", args: { path: "routes/upload.js" } }] },
			{ delayMs: 1400, tools: [{ name: "board_done", args: { id, outcome: "blocked", result: "Uploading needs somebody signed in. May I sign in with the test account?" } }] },
			{ text: "Asked." },
		];
	},
});
S.shop_repro = [
	{ delayMs: 900, until: open("repro"), tools: [{ name: "board_read", args: {} }] },
	{ delayMs: 1100, tools: [{ name: "read", args: { path: "routes/search.js" } }, { name: "read", args: { path: "routes/upload.js" } }] },
	{ delayMs: 1100, tools: [{ name: "read", args: { path: "routes/login.js" } }, { name: "read", args: { path: "routes/session.js" } }, { name: "read", args: { path: "server.js" } }] },
	{ delayMs: 1500, text: "All 5 are there as described: search (high), upload (high), sign-in (medium), session (medium), errors and headers (low)." },
];

/** Which script a request is for, by what its last message says: the first that matches. The message itself stays as it came. */
const MEANS = [
	[/Check the answer below[\s\S]*pelican riding a bicycle/, "pel_check"],
	[/Check the answer below[\s\S]*demo shop/, "shop_check"],
	[/pelican riding a bicycle[\s\S]*\[pine: your owner started a swarm/, "pel_lead1"],
	[/\[pine: the swarm[\s\S]*pelican riding a bicycle/, "pel_lead2"],
	[/demo shop[\s\S]*\[pine: your owner started a swarm/, "shop_lead"],
	[/Take a picture of version 2/, "pel_critic2"],
	[/Take a picture of version 1/, "pel_critic1"],
	[/Fix the pelican \(/, "pel_fix_bird"],
	[/Fix the bicycle and the world/, "pel_fix_bike"],
	[/Draw the pelican:/, "pel_bird"],
	[/Draw the bicycle:/, "pel_bike"],
	[/Draw the world and put/, "pel_world"],
	[/Reproduce each finding/, "shop_repro"],
	[/File upload: routes/, "shop_upload"],
	[/Sign-in: routes/, "shop_login"],
	[/Session handling: routes/, "shop_session"],
	[/Input handling: routes/, "shop_search"],
	[/Headers and configuration: server/, "shop_headers"],
];
const asked = [];
const proxy = http.createServer((req, res) => {
	const chunks = [];
	req.on("data", (c) => chunks.push(c));
	req.on("end", () => {
		let body = Buffer.concat(chunks);
		try {
			const json = JSON.parse(body.toString("utf8"));
			// A picture a tool read comes back as a message of its own; the script goes by what was asked before it.
			json.messages = (json.messages ?? []).filter((m) => !(m.role === "user" && /^Attached image\(s\) from tool result/.test(textOf(m.content))));
			body = Buffer.from(JSON.stringify(json));
			const last = [...json.messages].reverse().find((m) => m.role === "user");
			if (last) {
				const said = textOf(last.content).replace(/<pine-note>[\s\S]*?<\/pine-note>\s*/g, "");
				const ref = MEANS.find(([re]) => re.test(said))?.[1];
				asked.push(`${ref ?? "?"}: ${said.slice(0, 160).replace(/\s+/g, " ")}`);
				if (ref) {
					if (typeof last.content === "string") last.content += ` @@REF:${ref}@@`;
					else last.content.push({ type: "text", text: ` @@REF:${ref}@@` });
					body = Buffer.from(JSON.stringify(json));
				}
			}
		} catch {}
		const to = new URL(mock.baseUrl);
		const fwd = http.request({ host: to.hostname, port: to.port, path: req.url, method: req.method, headers: { ...req.headers, host: to.host, "content-length": body.length } }, (back) => {
			res.writeHead(back.statusCode ?? 502, back.headers);
			back.pipe(res);
		});
		fwd.on("error", () => res.destroy());
		fwd.end(body);
	});
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const modelUrl = `http://127.0.0.1:${proxy.address().port}${new URL(mock.baseUrl).pathname}`;

// ---- pine's home -------------------------------------------------------------------------------------

write(path.join(home, "models.json"), JSON.stringify({ providers: { local: { name: "Local", baseUrl: modelUrl, api: "openai-completions", apiKey: "sk-none", models: [{ id: "flashnext", name: "flashnext", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "local/flashnext", mode: "auto", introduce: false }, security: { askAccess: false } }, null, 2));
write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "Your main agent" }));
write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are main.\n");
fs.mkdirSync(path.join(home, "browsers"), { recursive: true });
write(path.join(home, "desktop-data", "prefs.json"), JSON.stringify({ updates: false, bounds: SIZE }));

// ---- the app, and the pictures -----------------------------------------------------------------------

for (const f of fs.readdirSync(out)) if (f.startsWith(`${which[0]}0`) || f.startsWith(`look-${which}`) || /^\d+\.jpg$|^failed/.test(f)) fs.rmSync(path.join(out, f));
const app = await launchApp({ ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(home, "browsers"), PINE_HOME: home, PINE_DESKTOP_DATA: path.join(home, "desktop-data"), PINE_SKIP_DOWNLOADS: "1", PINE_DESKTOP_DEV_URL: "", PINE_DESKTOP_RELEASES: "" });
const page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message)));
// The window's size, and more pixels to a point than the screen has: the film goes close to the pictures.
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setDeviceMetricsOverride", { ...SIZE, deviceScaleFactor: DENSITY, mobile: false });

const seqs = {}, boxes = {}, marks = {};
let count = 0;
/** One picture into a sequence, with when it was taken; a picture that shows nothing new is left out. */
async function frame(seq) {
	const s = (seqs[seq] ??= { frames: [], t0: Date.now(), last: "" });
	const at = Date.now() - s.t0;
	// Ten pictures a second at most: a dot that pulses makes every one of them new.
	if (at - (s.frames.at(-1)?.[1] ?? -1000) < 100) await sleep(100 - (at - s.frames.at(-1)[1]));
	const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
	const sum = crypto.createHash("sha1").update(data).digest("hex");
	if (sum === s.last) return;
	s.last = sum;
	const name = `${which[0]}${String(++count).padStart(4, "0")}.jpg`;
	fs.writeFileSync(path.join(out, name), Buffer.from(data, "base64"));
	s.frames.push([name, at]);
}
/** Pictures for as long as something takes, and a little after it. */
async function during(seq, doing, after = 500) {
	let over = false, failed;
	const done = Promise.resolve(doing).catch((e) => (failed = e)).finally(() => (over = true));
	while (!over) await toEnd(), await frame(seq);
	await done;
	if (failed) throw failed;
	for (const until = Date.now() + after; Date.now() < until; ) await toEnd(), await frame(seq);
}
/** A moment the film can ask for: when it was, on the clock of its sequence. */
const mark = (seq, name) => void (marks[name] = Date.now() - (seqs[seq] ??= { frames: [], t0: Date.now(), last: "" }).t0);
/** A single picture to look at, outside the film. */
const look = (name) => page.screenshot({ path: path.join(out, `look-${name}.png`) });
/** The conversation scrolled to its end, as somebody does who watches an answer come. */
const toEnd = () => page.evaluate(() => { for (const e of document.querySelectorAll("[data-slot*=message-scroller]")) if (e.scrollHeight > e.clientHeight + 4) e.scrollTop = e.scrollHeight; }).catch(() => {});
/** Where something is in the window, for the film's camera and pointer. */
async function where(name, selector) {
	const b = await page.locator(selector).first().boundingBox().catch(() => null);
	if (b) boxes[name] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
	else console.log(`(not on screen: ${name}, ${selector})`);
}
const sees = (selector, timeout = 40_000) => page.waitForSelector(selector, { timeout });
const said = (re, timeout = 60_000) => page.waitForFunction((src) => new RegExp(src).test(document.body.textContent ?? ""), re.source, { timeout });
const menu = (command) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send("pine:menu", c), command);
const panel = "[data-slot=code-panel]";
const tab = (name) => page.locator(`${panel} [data-slot=tabs-trigger]`, { hasText: name });
const task = (text, state) => page.locator(`${panel} [data-task]${state ? `[data-state=${state}]` : ""}`, { hasText: text }).first().waitFor({ timeout: 60_000 });
const composer = "[data-slot=composer] textarea";
const call = (method, url, body) => page.evaluate(([m, u, b]) => window.pine.call(m, u, b), [method, url, body]);
/** Waits until a task stands as it should, asked of pine itself: the Board tab is not always on screen. */
async function settled(text, state = "done", timeout = 90_000) {
	for (const end = Date.now() + timeout; Date.now() < end; await sleep(150)) {
		const listed = (await call("GET", "/boards")).data;
		for (const b of Array.isArray(listed) ? listed : listed.boards) {
			const view = (await call("GET", `/boards/${b.id}`)).data;
			if (view.tasks.some((t) => t.text.includes(text) && t.state === state)) return;
		}
	}
	throw new Error(`no task "${text}" became ${state}`);
}
/** A press on a tab of the panel. (Sent to the tab itself: the window has no screen, and its title bar's drag area takes a pointer that is moved there.) */
const press = (locator) => locator.first().evaluate((el) => { for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) el.dispatchEvent(new (type.startsWith("pointer") ? PointerEvent : MouseEvent)(type, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse" })); el.focus?.(); });
/** A task on the Board tab opened, so that what came of it is shown under it, and brought into sight. */
async function unfold(id) {
	const row = page.locator(`${panel} [data-task="${id}"]`);
	await page.locator(`${panel} [data-task="${id}"][data-state=done]`).waitFor({ timeout: 20_000 });
	await sleep(250);
	await press(row.locator("[data-slot=item-title]"));
	await sleep(150);
	await row.evaluate((el) => el.scrollIntoView({ block: "end", behavior: "smooth" }));
}

/** A conversation in a folder, as the owner opens one. */
async function openFolder(folder) {
	await menu(`folder:${folder}`);
	// (With several agents the app would ask whose folder it is. Here there is one.)
	await page.locator("[data-slot=tab][data-active] [data-slot=tab-name]", { hasText: path.basename(folder) }).waitFor({ timeout: 20_000 });
	await sleep(500);
}
/** The job typed into the message box, key by key, and sent. */
async function typed(seq, text) {
	await page.click(composer);
	await frame(seq);
	await during(seq, page.type(composer, text, { delay: 14 }), 300);
	mark(seq, `${seq}:typed`);
	await during(seq, page.keyboard.press("Enter").then(() => sees("text=/swarm · started/")), 300);
	mark(seq, `${seq}:started`);
}

try {
	await sees("[data-slot=empty] h1", 60_000);
	const dialog = await page.waitForSelector("[data-slot=dialog-footer] button >> text=Not now", { timeout: 5000 }).catch(() => undefined);
	if (dialog) await dialog.click();
	await sleep(500);

	if (wants("pelican")) {
		await openFolder(pelican);
		await menu("code-agent");
		await sees(`${panel} [data-slot=tabs-trigger] >> text=Agent`);
		await sleep(600);
		await look("pelican-empty");
		await typed("pel-type", JOBS.pelican);
		// The board comes with the first tasks: the owner opens it, and the three pieces are written side by side.
		const built = said(/Version 1 scored/);
		built.catch(() => {});
		await during("pel-type", tab("Board").waitFor({ timeout: 30_000 }), 200);
		await where("board-tab", `${panel} [data-slot=tabs-trigger]:has-text("Board")`);
		await during("pel-board", press(tab("Board")), 300);
		gate.board = true;
		await during("pel-board", task("Draw the world", "done"), 200);
		mark("pel-board", "pel:built");
		await during("pel-board", settled("Take a picture of version 1"), 300);
		await during("pel-board", unfold(4), 700);
		mark("pel-board", "pel:scored4");
		await where("pel-t4", `${panel} [data-task="4"]`);
		await during("pel-board", built, 600);
		await look("pelican-round1");
		// Round 2: pine calls the lead again for what is not done. The view shows who works.
		await during("pel-board", said(/round 2 of 8/), 400);
		await menu("code");
		await menu("view");
		await sleep(1200);
		await look("pelican-view-open");
		gate.round2 = true;
		await sleep(600);
		gate.view = true;
		await during("pel-view", sleep(2200), 0);
		await look("pelican-view-work");
		// A closer look, as the view gives one: a click on the lead's card, then on the board.
		await where("view", "#view-panel");
		mark("pel-view", "pel:closer");
		await during("pel-view", page.mouse.click(1158, 212), 2200);
		await look("pelican-view-board");
		await during("pel-view", settled("Fix the bicycle"), 300);
		mark("pel-view", "pel:fixed");
		await look("pelican-view");
		await sleep(1200);
		await look("pelican-view-after");
		await menu("view");
		await menu("code");
		await sleep(700);
		gate.score = true;
		await during("pel-score", settled("Take a picture of version 2"), 300);
		await during("pel-score", unfold(8), 900);
		await where("pel-t8", `${panel} [data-task="8"]`);
		await look("pelican-score");
		gate.answer = true;
		await during("pel-answer", said(/swarm · done after/), 1500);
		await look("pelican-done");
		// The picture the critic scored, in the Files tab.
		await press(tab("Files"));
		await sleep(700);
		await look("pelican-files");
	}

	if (wants("shop")) {
		await openFolder(shop);
		if (!(await page.$(panel))) await menu("code-agent");
		await sleep(600);
		await look("shop-empty");
		await typed("shop-type", JOBS.shop);
		const report = said(/swarm · done after/, 120_000);
		report.catch(() => {});
		await during("shop-type", tab("Board").waitFor({ timeout: 30_000 }), 200);
		if (!(await page.$(`${panel} [data-task]`))) await during("shop-type", press(tab("Board")), 300);
		// First the view: five areas, four sub-agents at a time.
		await menu("code");
		await menu("view");
		await sleep(900);
		gate.areas = true;
		await during("shop-view", sleep(2600), 0);
		await look("shop-view");
		await menu("view");
		await menu("code");
		await sleep(500);
		// One of them asks; the lead answers on the board, for all.
		await during("shop-board", task("File upload", "blocked"), 900);
		mark("shop-board", "shop:asked");
		await look("shop-asked");
		await where("shop-t4", `${panel} [data-task="4"]`);
		gate.asked = true;
		await during("shop-board", page.locator(`${panel} [data-task="4"]:not([data-state=blocked])`).waitFor({ timeout: 30_000 }), 0);
		mark("shop-board", "shop:answered");
		await during("shop-board", task("Headers and configuration", "done"), 300);
		await during("shop-board", task("File upload", "done"), 500);
		mark("shop-board", "shop:found");
		await during("shop-board", unfold(3), 900);
		await where("shop-t3", `${panel} [data-task="3"]`);
		await look("shop-found");
		gate.found = true;
		await sleep(300);
		// The task for it comes onto the board, at its end.
		const last = page.locator(`${panel} [data-task]:has-text("Reproduce each finding")`);
		await during("shop-repro", last.waitFor({ timeout: 30_000 }), 0);
		await last.evaluate((el) => el.scrollIntoView({ block: "end", behavior: "smooth" }));
		await during("shop-repro", sleep(600), 0);
		await where("shop-t9", `${panel} [data-task]:has-text("Reproduce each finding")`);
		gate.repro = true;
		await during("shop-repro", task("Reproduce each finding", "done"), 800);
		await look("shop-repro");
		// The report is read in a conversation as wide as the window lets it be.
		await menu("code");
		await sleep(700);
		gate.report = true;
		await during("shop-report", report, 1500);
		await look("shop-done");
	}

	for (const [name, selector] of [["side", "#sidebar-panel"], ["panel", "#code-panel"], ["composer", "[data-slot=composer]"], ["main", "main"], ["tabs", "[data-slot=tab]"]]) await where(name, selector);
	const list = Object.fromEntries(Object.entries(seqs).map(([k, s]) => [k, s.frames]));
	fs.writeFileSync(path.join(out, `shots-${which}.js`), `// Written by reel/swarm-shots.mjs: the pictures of the desktop app, in the order they were taken, each with\n// the millisecond of its sequence it was taken at; where parts of the window are; and when things happened.\n(globalThis.SHOTS ??= {}).${which} = ${JSON.stringify({ size: SIZE, density: DENSITY, boxes, marks, job: JOBS[which], seqs: list })};\n`);
	console.log(`${count} pictures in ${out}`, Object.fromEntries(Object.entries(list).map(([k, v]) => [k, `${v.length} in ${((v.at(-1)?.[1] ?? 0) / 1000).toFixed(1)} s`])), marks, boxes);
	if (errors.length) console.log("errors in the page:", errors);
} catch (e) {
	await page.screenshot({ path: path.join(out, "failed.png") }).catch(() => {});
	console.error(e);
	console.error("the model was asked:\n" + asked.slice(-14).join("\n"));
	process.exitCode = 1;
} finally {
	if (process.argv.includes("--asked")) console.log(asked.join("\n"));
	await app.close().catch(() => {});
	await mock.close?.().catch(() => {});
	proxy.close();
	if (keep) console.log("kept:", made.join(", "));
}
