// Draws the reel frame by frame in a headless browser and hands the frames to ffmpeg.
//
//   node reel/render.mjs                    the whole film -> reel/pine-reel.mp4
//   node reel/render.mjs --at 3.2,12,40     single frames  -> reel/frames/<seconds>.png
//   node reel/render.mjs --from 20 --to 30  a part of it   -> reel/pine-reel-part.mp4
//   node reel/render.mjs --at 1 --sound     only the sound -> reel/sfx.wav
//   node reel/render.mjs --story scans      another script: story-scans.js -> reel/pine-reel-scans.mp4
//   node reel/render.mjs --film code        a film of the other kind, one take through a 3D world: film-code.js
//                                           on film.html -> reel/pine-reel-code.mp4
//   node reel/render.mjs --film view        a film with a page of its own (film-view.html): the app's view, with
//                                           pine's own office view running in it -> reel/pine-reel-view.mp4
//   node reel/render.mjs --film code --music song.mp3   a piece of music under the film's own sounds;
//                                           --music-from 5.3 starts it that many seconds into the piece
//   node reel/render.mjs --film code --music song.mp3 --remix   only the sound again, under the film as it is
//   node reel/render.mjs --scale 1          1920×1080 instead of 3840×2160
//   node reel/render.mjs --story front --webp   also reel/pine-reel-front.webp: the film as a picture that
//                                           moves, 1280 wide and without sound, for a README (needs img2webp)
// The whole film also gets its sound: one small sound per key and click, made by sound.py.
import { spawn } from "node:child_process";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import path from "node:path";
import { chromium } from "../node_modules/playwright-core/index.mjs";

const dir = import.meta.dirname;
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const FPS = Number(arg("fps") ?? 30);
// Pixels per point of the 1920×1080 page: 2 renders 3840×2160.
const SCALE = Number(arg("scale") ?? 2);

// A film is drawn in 3D with blurs, which the browser's own drawing program takes seconds a frame for; on a
// Mac the graphics chip does it in a tenth of one. The chip draws a page's layers behind the page's back,
// and a picture taken too early lacks some: the browser is told to finish every layer before it shows a frame.
const browser = await chromium.launch({ args: arg("film") && process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--run-all-compositor-stages-before-draw", "--disable-checker-imaging"] : [] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: SCALE });
page.on("pageerror", (e) => { console.error("page error:", e.message); process.exitCode = 1; });
const story = arg("story");
// A film that is one take through a 3D world is another page with an engine of its own (film.html, film.js).
const film = arg("film");
const name = film ? `pine-reel-${film}` : story ? `pine-reel-${story}` : "pine-reel";
// A film may have a page of its own (film-<name>.html) instead of the 3D one.
const own = film && fs.existsSync(path.join(dir, `film-${film}.html`));
// The film about the view runs pine's own office view: it is handed over as text, its types taken away, with the
// module it imports, the way the app hands a view to its frame.
if (film === "view") {
	const strip = (file) => stripTypeScriptTypes(fs.readFileSync(path.join(dir, "..", file), "utf8"), { mode: "strip" });
	fs.writeFileSync(path.join(dir, "view-code.js"), `window.KIT_SRC = ${JSON.stringify(strip("src/view-kit.ts"))};\nwindow.OFFICE_SRC = ${JSON.stringify(strip("examples/home/views/office.ts"))};\n`);
}
await page.goto(own ? `file://${path.join(dir, `film-${film}.html`)}` : film ? `file://${path.join(dir, "film.html")}?film=${film}` : `file://${path.join(dir, "reel.html")}${story ? `?story=${story}` : ""}`);
// Everything a frame may show is loaded before the first one is drawn.
// The frames of the scanner clip, when they are there (assets/scan/001.jpg on).
const scanDir = path.join(dir, "assets", "scan");
const scan = fs.existsSync(scanDir) ? fs.readdirSync(scanDir).filter((n) => n.endsWith(".jpg")).sort().map((n) => `scan/${n}`) : [];
// The camera clips of story-watchdog.js (assets/cam/<clip>/001.jpg on) and the stills it shows.
const camDir = path.join(dir, "assets", "cam");
if (fs.existsSync(camDir)) for (const d of fs.readdirSync(camDir)) {
	const p = path.join(camDir, d);
	if (fs.statSync(p).isDirectory()) scan.push(...fs.readdirSync(p).filter((n) => n.endsWith(".jpg")).sort().map((n) => `cam/${d}/${n}`));
	else if (d.endsWith(".jpg")) scan.push(`cam/${d}`);
}
await page.evaluate(async (scan) => {
	await document.fonts.load('24px "JBM"');
	await document.fonts.load('700 24px "JBM"');
	await document.fonts.ready;
	// A page that has to get something ready first says so.
	if (typeof READY !== "undefined") await READY;
	const names = ["meme.jpg", "cones.jpg", "kevin.jpg", "../bill/water-bill-page1.png", "../bill/water-bill-page2.png", "logo.svg", "wallpaper.jpg", ...Array.from({ length: 40 }, (_, i) => `spag-${String(i).padStart(2, "0")}.jpg`), ...scan];
	window.keep = await Promise.all(names.map((n) => new Promise((done) => { const im = new Image(); im.onload = im.onerror = () => done(im); im.src = `assets/${n}`; })));
}, scan);
const duration = await page.evaluate(() => DURATION);
// When each key and each click happens, in film time; the sounds are made from that list.
const writeCues = async () => {
	const cues = await page.evaluate(() => SFX.map((s) => ({ t: s.t / SPEED, k: s.k, ...(s.f ? { f: s.f } : {}) })).sort((a, b) => a.t - b.t));
	fs.writeFileSync(path.join(dir, "sfx.json"), JSON.stringify({ duration, cues }));
};
// `frame` is the second of the film's frame a moment belongs to, for a film whose frames are made of several.
const draw = async (t, frame = t) => {
	await page.evaluate(async ([time, frame]) => { renderAt(time, 1, frame); await Promise.all([...document.images].map((im) => im.decode().catch(() => {}))); }, [t, frame]);
};
/**
 * The picture of second t, as a PNG. A film says of which moments a frame is made (shutterTimes): where
 * something moves fast there are several, each is drawn, and ffmpeg averages them. That is motion blur.
 */
const picture = async (t, type = "png") => {
	const times = film ? await page.evaluate((time) => shutterTimes(time), t) : [t];
	if (times.length === 1) { await draw(times[0]); return page.screenshot(type === "png" ? { type } : { type, quality: 98 }); }
	const n = times.length;
	const mix = spawn("ffmpeg", ["-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-i", "-", "-vf", `tmix=frames=${n},select='eq(n\\,${n - 1})',format=${type === "png" ? "rgb24" : "yuvj444p"}`, "-frames:v", "1", ...(type === "png" ? ["-c:v", "png"] : ["-c:v", "mjpeg", "-q:v", "1"]), "-f", "image2pipe", "-"], { stdio: ["pipe", "pipe", "inherit"] });
	const out = [];
	mix.stdout.on("data", (d) => out.push(d));
	const ended = new Promise((r) => mix.on("close", r));
	for (const ts of times) { await draw(ts, t); mix.stdin.write(await page.screenshot({ type: "jpeg", quality: 97 })); }
	mix.stdin.end();
	await ended;
	return Buffer.concat(out);
};

/**
 * What ffmpeg is told about the sound, after the film (input 0) and its own sounds (input 1). With --music
 * the piece lies under them from the first frame, fades in, and fades out with the film; the keys and
 * clicks are made louder, so that they are still heard over it.
 */
const sound = (seconds) => {
	const music = arg("music");
	if (!music) return ["-map", "0:v", "-map", "1:a"];
	const from = Number(arg("music-from") ?? 0), end = seconds.toFixed(2);
	return ["-i", path.resolve(music), "-filter_complex", `[1:a]volume=10dB[s];[2:a]atrim=${from}:${(from + seconds).toFixed(2)},asetpts=PTS-STARTPTS,afade=t=in:d=0.4,afade=t=out:st=${(seconds - 2.6).toFixed(2)}:d=2.6,volume=-5dB[m];[s][m]amix=inputs=2:normalize=0:duration=longest,atrim=0:${end}[a]`, "-map", "0:v", "-map", "[a]"];
};
// --remix: the film as it was rendered, with its sound made again (after a change of the music).
if (process.argv.includes("--remix")) {
	const out = path.join(dir, `${name}.mp4`), tmp = path.join(dir, `${name}-remix.mp4`);
	await new Promise((done, fail) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-i", out, "-i", path.join(dir, "sfx.wav"), ...sound(duration), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", tmp], { stdio: "inherit" }).on("close", (code) => (code ? fail(new Error(`ffmpeg ended with ${code}`)) : done())));
	fs.renameSync(tmp, out);
	console.log(`${out}  sound made again${arg("music") ? `, over ${arg("music")}` : ""}`);
	await browser.close();
	process.exit(0);
}

if (arg("at")) {
	fs.mkdirSync(path.join(dir, "frames"), { recursive: true });
	for (const s of arg("at").split(",")) {
		fs.writeFileSync(path.join(dir, "frames", `${Number(s).toFixed(2).padStart(6, "0")}.png`), await picture(Number(s)));
	}
	console.log((await page.evaluate(() => MARKS.map(([t, name]) => `${(t / SPEED).toFixed(1).padStart(5)}  ${name}`))).join("\n"));
	console.log(`duration ${duration.toFixed(2)} s`);
	// With --sound, only the sound is made, to listen to it without drawing the film.
	if (process.argv.includes("--sound")) {
		await writeCues();
		await new Promise((done) => spawn("python3", [path.join(dir, "sound.py"), path.join(dir, "sfx.json"), path.join(dir, "sfx.wav")], { stdio: "inherit" }).on("close", done));
	}
} else {
	const from = Number(arg("from") ?? 0), to = Math.min(duration, Number(arg("to") ?? duration));
	const out = path.join(dir, arg("from") || arg("to") ? `${name}-part.mp4` : `${name}.mp4`);
	// A film's frames are handed over as JPEG: a 4K PNG takes a second to make, and the film keeps no more colour than a JPEG does.
	const kind = film ? "jpeg" : "png";
	const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", film ? "mjpeg" : "png", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
	const frames = Math.round((to - from) * FPS);
	for (let i = 0; i < frames; i++) {
		const png = await picture(from + i / FPS, kind);
		if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
		if (i % 150 === 0) console.log(`${(from + i / FPS).toFixed(1)} / ${to.toFixed(1)} s`);
	}
	ffmpeg.stdin.end();
	await new Promise((r) => ffmpeg.on("close", r));
	if (!arg("from") && !arg("to") && !process.argv.includes("--silent")) {
		await writeCues();
		const run = (cmd, args) => new Promise((done, fail) => spawn(cmd, args, { stdio: "inherit" }).on("close", (code) => (code ? fail(new Error(`${cmd} ended with ${code}`)) : done())));
		await run("python3", [path.join(dir, "sound.py"), path.join(dir, "sfx.json"), path.join(dir, "sfx.wav")]);
		const silent = path.join(dir, `${name}-silent.mp4`);
		fs.renameSync(out, silent);
		await run("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", path.join(dir, "sfx.wav"), ...sound(duration), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out]);
		fs.rmSync(silent);
	}
	if (process.argv.includes("--webp")) {
		// An animated WebP and not a GIF: every colour instead of 256, and a fraction of the size.
		// img2webp takes pictures, so the film is cut into them first: 15 a second, 67 ms each, and wide
		// enough for a README on a screen with small pixels. A whole picture at least every two seconds
		// (-kmax), so that what a fade leaves behind on a dark ground goes. Narrower or at a lower quality
		// it is a third of the size, and soft, with blocks in every dark area: tried, and taken back.
		const run = (cmd, args) => new Promise((done, fail) => spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] }).on("error", fail).on("close", (code) => (code ? fail(new Error(`${cmd} ended with ${code}`)) : done())));
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pine-reel-"));
		await run("ffmpeg", ["-y", "-loglevel", "error", "-i", out, "-vf", "fps=15,scale=1280:-1:flags=lanczos", path.join(tmp, "%04d.png")]);
		const webp = out.replace(/\.mp4$/, ".webp");
		await run("img2webp", ["-loop", "0", "-lossy", "-q", "70", "-m", "6", "-sharp_yuv", "-d", "67", "-kmin", "15", "-kmax", "30", ...fs.readdirSync(tmp).sort().map((n) => path.join(tmp, n)), "-o", webp]);
		fs.rmSync(tmp, { recursive: true, force: true });
		console.log(`${webp}  ${(fs.statSync(webp).size / 1e6).toFixed(1)} MB`);
	}
	console.log(`${out}  ${(to - from).toFixed(1)} s, ${frames} frames`);
}
await browser.close();
