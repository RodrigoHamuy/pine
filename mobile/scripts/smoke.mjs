// The Android app from end to end, by hand (not in CI, not in npm test): builds a debug APK, starts
// an emulator without a window, installs and opens the app, and points it at a machine: an SSH
// server of this run's own on this computer's loopback (MINA sshd, mobile/core's
// SmokeMachine.kt), which the emulator reaches at 10.0.2.2, running the real `pine service` on a
// pine home of its own whose model is the scripted mock server. Nothing of this computer's own
// sshd or settings is touched. Run it before a release that changes the mobile app.
//
//   npm run smoke [-- --shot <file.png>] [-- --avd <name>] [-- --keep]
//
// The app is driven as a person would, through adb (uiautomator for what is on screen, input for
// taps and keys): it reads the phone's key from the page and shares it (the system's chooser comes
// up), adds the machine, trusts its host key and shows the agents.
//
// It is the test of the WebView's hardening in PinePlugin.kt, which no other suite reaches: through
// the debug build's WebView inspector, each of these is a named check that fails the run.
//   - the policy: Capacitor's bridge runs under the page's policy, an inline script does not;
//   - permission denial (onPermissionRequest, onGeolocationPermissionsShowPrompt): no camera,
//     microphone or location;
//   - no window (onCreateWindow, setSupportMultipleWindows(false)): window.open, with and without
//     a user's gesture, makes no new page and leaves the page where it is;
//   - no file access (allowFileAccess): a file: address cannot be fetched or navigated to;
//   - the navigation rules (shouldOverrideUrlLoading): file: and intent: lead nowhere, an address of
//     the web opens outside the app;
//   - media are answered by the plugin.
// Then the app's life: the back button closes the open sheet, then leaves the app; the app comes back
// from the background (after back, and after HOME) still connected to the machine. Last, the system
// bars: the theme's colour under them, in pine's dark theme and in a light one (bars-dark.png and
// bars-light.png beside the screenshot).
// An emulator it started is stopped at the end, and so are its servers.
//
// Needs ANDROID_HOME (default ~/Library/Android/sdk) with an emulator and a system image, and a
// JDK (JAVA_HOME, default Android Studio's).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { startMock } from "../../baseline/tests/mock.mjs";

const { values: opts } = parseArgs({ options: { shot: { type: "string" }, avd: { type: "string" }, keep: { type: "boolean" } } });
const mobile = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(mobile, "..");
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Library/Android/sdk");
const javaHome = process.env.JAVA_HOME ?? "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: javaHome };
const ADB = path.join(sdk, "platform-tools", "adb");
const APP = "dev.pmndre.pine";
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-mobile-smoke-")));
const shot = path.resolve(opts.shot ?? path.join(work, "agents.png"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (text) => console.log(`- ${text}`);
const write = (file, content) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, content));

const cleanups = [];
async function cleanup() {
	for (const fn of cleanups.reverse()) await Promise.resolve().then(fn).catch(() => {});
	if (!opts.keep) fs.rmSync(work, { recursive: true, force: true });
}
process.on("SIGINT", () => void cleanup().then(() => process.exit(130)));

const run = (cmd, args, cwd = mobile) => execFileSync(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).toString();
const adb = (...args) => execFileSync(ADB, args, { env, maxBuffer: 64 * 1024 * 1024 }).toString();

try {
	// ---- the app ----------------------------------------------------------------------------------
	step("building the page and the debug APK");
	run("npm", ["run", "sync"]);
	run(path.join(mobile, "android", "gradlew"), ["assembleDebug", "--console=plain", "-q"], path.join(mobile, "android"));
	const apk = path.join(mobile, "android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");

	// ---- the machine ------------------------------------------------------------------------------
	step("starting the machine: the mock model, a pine home, and an SSH server on this computer's loopback");
	const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	cleanups.push(() => mock.close());
	const home = path.join(work, "far");
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent: it administers pine" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({ description: "Looks things up on the web" }));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");
	const keys = path.join(work, "authorized_keys");
	const classpath = run(path.join(mobile, "core", "gradlew"), ["-q", "smokeClasspath", "--console=plain"], path.join(mobile, "core")).trim().split("\n").at(-1);
	const machine = spawn(path.join(javaHome, "bin", "java"), ["-cp", classpath, "pine.mobile.core.SmokeMachineKt", keys, home, process.execPath, path.join(repo, "bin", "pine.js")], { env, stdio: ["pipe", "pipe", "inherit"] });
	cleanups.push(() => machine.stdin.end());
	const said = {};
	const lines = readline.createInterface({ input: machine.stdout });
	await new Promise((resolve, reject) => {
		lines.on("line", (line) => {
			const [k, v] = line.split(" ");
			said[k] = v;
			if (said.port && said.fingerprint) resolve();
		});
		machine.on("exit", (code) => reject(new Error(`the SSH server ended (${code})`)));
	});
	const host = `me@10.0.2.2:${said.port}`;
	step(`machine ${host}, host key ${said.fingerprint}`);

	// ---- the emulator -----------------------------------------------------------------------------
	const running = () => adb("devices").split("\n").some((l) => /^emulator-\d+\s+device/.test(l));
	if (!running()) {
		const avd = opts.avd ?? execFileSync(path.join(sdk, "emulator", "emulator"), ["-list-avds"], { env }).toString().trim().split("\n")[0];
		if (!avd) throw new Error("No emulator to start: make one in Android Studio's Device Manager (an image with Google APIs).");
		step(`starting the emulator ${avd}, without a window`);
		const emu = spawn(path.join(sdk, "emulator", "emulator"), ["-avd", avd, "-no-window", "-no-audio", "-no-boot-anim", "-no-snapshot-save"], { env, stdio: "ignore", detached: true });
		emu.unref();
		cleanups.push(() => adb("emu", "kill"));
	} else step("using the emulator that runs");
	// (The device comes and goes while it boots: a question it cannot answer yet is asked again.)
	const booted = () => {
		try {
			return execFileSync(ADB, ["shell", "getprop", "sys.boot_completed"], { env, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() === "1";
		} catch {
			return false;
		}
	};
	for (let i = 0; !booted(); i++) {
		if (i > 180) throw new Error("the emulator did not finish starting in three minutes");
		await sleep(1000);
	}

	// ---- what is on screen ------------------------------------------------------------------------
	/** The nodes on screen: text, description, class and the middle of their bounds. */
	// (A system starved of time answers no dump now and then: that is an empty screen, asked again.)
	const screen = () => {
		let xml;
		try {
			execFileSync(ADB, ["shell", "uiautomator", "dump", "/sdcard/pine-ui.xml"], { env, stdio: ["ignore", "pipe", "ignore"] });
			xml = adb("exec-out", "cat", "/sdcard/pine-ui.xml");
		} catch {
			return [];
		}
		const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, "\n").replace(/&amp;/g, "&");
		return [...xml.matchAll(/<node ([^>]*?)\/?>/g)].map(([, attrs]) => {
			const a = Object.fromEntries([...attrs.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
			const [x1, y1, x2, y2] = (a.bounds.match(/\d+/g) ?? []).map(Number);
			return { text: a.text ?? "", desc: a["content-desc"] ?? "", cls: a.class ?? "", x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2), visible: y2 > y1 && x2 > x1 };
		});
	};
	const label = (n) => `${n.text} ${n.desc}`.trim();
	/**
	 * An emulator that starts cold on a busy computer puts up "<app> isn't responding" for its own
	 * apps (System UI, the keyboard, Play services). Such a dialog of another app is answered with
	 * Wait and the run goes on; one of this app's fails the run.
	 */
	const dismissed = new Set();
	const answerAnr = (nodes) => {
		const dialog = nodes.find((n) => / isn't responding$/.test(n.text));
		if (!dialog) return false;
		const who = dialog.text.replace(/ isn't responding$/, "");
		if (who === "Pine") throw new Error(`the app is not responding (ANR): ${nodes.map(label).filter(Boolean).join(" | ")}`);
		const wait = nodes.find((n) => n.visible && n.text === "Wait");
		if (!wait) return false;
		if (!dismissed.has(who)) console.log(`  (the system says "${dialog.text}": Wait)`);
		dismissed.add(who);
		tap(wait);
		return true;
	};
	const waitFor = async (what, pick, seconds = 90) => {
		let last = [];
		for (const until = Date.now() + seconds * 1000; Date.now() < until; await sleep(1000)) {
			last = screen();
			if (answerAnr(last)) continue;
			const found = pick(last);
			if (found) return found;
		}
		throw new Error(`not seen: ${what}. On screen: ${last.map(label).filter(Boolean).join(" | ").slice(0, 2000)}`);
	};
	const node = (re) => (nodes) => nodes.find((n) => n.visible && re.test(label(n)));
	const tap = (n) => adb("shell", "input", "tap", String(n.x), String(n.y));
	/** The activity in front ("package/class"), and its package. */
	const frontActivity = () => adb("shell", "dumpsys", "activity", "activities").match(/topResumedActivity=\S+ \S+ (\S+)/)?.[1];
	const front = () => frontActivity()?.split("/")[0];
	/** The page past the Gate, on the machine's pine. */
	const connected = (ns) => !ns.some((n) => /Choose a machine|is not reached|Connecting to/.test(label(n))) && ns.some((n) => /main/.test(label(n))) && ns;
	const sidebarButton = node(/^(Show the sidebar|Toggle Sidebar)$/);
	const agentsShown = (ns) => ns.some((n) => n.visible && /^main: /.test(label(n))) && ns.some((n) => n.visible && /^scout: /.test(label(n))) && ns;

	// sys.boot_completed comes well before a cold system is done starting its own apps: the launcher
	// in front and three answered dumps in a row without a dialog say it is.
	step("waiting for the system to settle");
	adb("shell", "input", "keyevent", "KEYCODE_HOME");
	for (let calm = 0, until = Date.now() + 240_000; calm < 3; await sleep(2000)) {
		if (Date.now() > until) throw new Error(`the emulator did not settle in four minutes. On screen: ${screen().map(label).filter(Boolean).join(" | ")}`);
		const ns = screen();
		calm = ns.length && !answerAnr(ns) && /launcher/i.test(frontActivity() ?? "") ? calm + 1 : 0;
	}

	step("installing and opening the app, on fresh data");
	adb("install", "-r", apk);
	adb("shell", "pm", "clear", APP);
	adb("logcat", "-c");
	adb("shell", "am", "start", "-W", "-n", `${APP}/.MainActivity`);

	step("the first start: the page asks for a machine and shows the phone's key");
	await waitFor("the Gate's Choose a machine", node(/^Choose a machine$/));
	const key = await waitFor("the phone's key", node(/^ssh-ed25519 \S+ pine-android$/));
	write(keys, `${label(key)}\n`);

	step("Share hands the key to the system's chooser, and back returns to the app");
	tap(await waitFor("Share", node(/^Share$/)));
	await waitFor("the system's chooser in front", () => /chooser|resolver/i.test(frontActivity() ?? "") || undefined, 15);
	adb("shell", "input", "keyevent", "KEYCODE_BACK");
	await waitFor("the app in front again", () => front() === APP || undefined, 15);

	step(`adding ${host}`);
	const field = (ns) => ns.find((n) => n.visible && n.cls === "android.widget.EditText");
	tap(await waitFor("the Host field", field));
	// The keyboard takes a moment to come up: what is typed before it is lost. Typed again until the field holds it.
	for (let i = 0; ; i++) {
		await sleep(1000);
		adb("shell", "input", "keyevent", "KEYCODE_MOVE_END", ...Array(40).fill("KEYCODE_DEL"));
		adb("shell", "input", "text", host);
		await sleep(500);
		if (field(screen())?.text === host) break;
		if (i === 4) throw new Error(`the Host field does not take ${host}`);
	}
	tap(await waitFor("Add", node(/^Add$/)));
	tap(await waitFor("Use", node(/^Use$/)));

	step("the host key is put to the owner, with the machine's fingerprint");
	const asked = await waitFor("the host key's fingerprint", node(/does not know .* fingerprint is SHA256:/));
	if (!label(asked).includes(said.fingerprint)) throw new Error(`the page shows another fingerprint than the machine's: ${label(asked)}`);
	tap(await waitFor("Trust this key", node(/^Trust this key$/)));

	step("connected: the agents of that pine");
	await waitFor("the page past the Gate", connected, 120);
	const open = sidebarButton(screen());
	if (open) tap(open);
	await waitFor("the agents in the side bar", agentsShown);
	await sleep(500);
	fs.mkdirSync(path.dirname(shot), { recursive: true });
	fs.writeFileSync(shot, execFileSync(ADB, ["exec-out", "screencap", "-p"], { env, maxBuffer: 64 * 1024 * 1024 }));
	step(`screenshot: ${shot}`);
	if (open) {
		adb("shell", "input", "keyevent", "KEYCODE_BACK");
		await waitFor("the side bar closed", (ns) => !agentsShown(ns) && ns, 15);
	}

	// ---- the page's hardening, through the debug build's WebView inspector ------------------------
	step("checking the page's hardening through the WebView inspector");
	const pid = adb("shell", "pidof", APP).trim();
	const port = 9300 + Math.floor(Math.random() * 500);
	adb("forward", `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
	cleanups.push(() => adb("forward", "--remove", `tcp:${port}`));
	const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
	const target = targets.find((t) => t.type === "page" && t.url.startsWith("https://localhost/"));
	if (!target) throw new Error(`no page of the app to inspect: ${JSON.stringify(targets)}`);
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)));
	cleanups.push(() => ws.close());
	let id = 0;
	const evaluate = (expression, { gesture = false } = {}) =>
		new Promise((resolve, reject) => {
			const mine = ++id;
			const on = (e) => {
				const m = JSON.parse(e.data);
				if (m.id !== mine) return;
				ws.removeEventListener("message", on);
				if (m.result?.exceptionDetails) reject(new Error(m.result.exceptionDetails.text));
				else resolve(m.result?.result?.value);
			};
			ws.addEventListener("message", on);
			ws.send(JSON.stringify({ id: mine, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true, userGesture: gesture } }));
		});
	const here = "location.origin + location.pathname";
	const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).filter((t) => t.type === "page").length;
	const pagesBefore = await pages();
	const checks = {
		// The policy.
		"Capacitor's bridge runs under the page's policy": [await evaluate("typeof window.Capacitor === 'object' && window.Capacitor.isNativePlatform()"), true],
		"the policy is the page's own (script-src 'self')": [await evaluate("/script-src 'self'(;|$)/.test(document.querySelector('meta[http-equiv=Content-Security-Policy]')?.content ?? '')"), true],
		"an inline script added to the page does not run": [await evaluate("new Promise((r) => { const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.append(s); setTimeout(() => r(window.__inline === 1), 300); })"), false],
		// Permission denial.
		"permission denial: the camera is not given": [await evaluate("navigator.mediaDevices.getUserMedia({ video: true }).then(() => 'given', (e) => e.name)"), "NotAllowedError"],
		"permission denial: the microphone is not given": [await evaluate("navigator.mediaDevices.getUserMedia({ audio: true }).then(() => 'given', (e) => e.name)"), "NotAllowedError"],
		"permission denial: the location is not given": [await evaluate("new Promise((r) => navigator.geolocation.getCurrentPosition(() => r('given'), (e) => r('refused ' + e.code)))"), "refused 1"],
		// No file access.
		"no file access: a file: address cannot be fetched": [await evaluate("fetch('file:///system/etc/hosts').then(() => 'read', () => 'refused')"), "refused"],
		// Media.
		"media are answered by the plugin under the daemon's rules": [await evaluate("fetch('/_pine_media/not/a/media/path').then((r) => r.status)"), 404],
	};
	// No window: onCreateWindow and setSupportMultipleWindows(false), with and without a user's gesture.
	checks["no window: window.open without a gesture gives nothing"] = [await evaluate("[window.open('https://example.com/'), window.open('file:///sdcard/')].every((w) => w === null)"), true];
	await evaluate("window.open('file:///sdcard/'); 1", { gesture: true });
	await sleep(1500);
	checks["no window: window.open with a gesture makes no new page"] = [await pages(), pagesBefore];
	checks["no window: window.open with a gesture leaves the page where it is"] = [await evaluate(here), "https://localhost/"];
	// The navigation rules.
	await evaluate("location.href = 'intent://x#Intent;scheme=market;end'; 1");
	await sleep(1500);
	await evaluate("location.href = 'file:///sdcard/'; 1");
	await sleep(1500);
	checks["navigation: the page goes nowhere (file:, intent:)"] = [await evaluate(here), "https://localhost/"];
	checks["navigation: the app stays in front"] = [front(), APP];
	await evaluate("location.href = 'https://example.com/'; 1");
	await sleep(3000);
	checks["navigation: an address of the web opens outside the app, not in it"] = [front() !== APP && (await evaluate("location.origin")) === "https://localhost", true];
	adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
	let failed = 0;
	for (const [what, [got, want]] of Object.entries(checks)) {
		const ok = JSON.stringify(got) === JSON.stringify(want);
		if (!ok) failed++;
		console.log(`  ${ok ? "ok" : "NOT OK"}  ${what}${ok ? "" : ` (got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)})`}`);
	}
	if (failed) throw new Error(`${failed} hardening check(s) failed`);

	// ---- the app's life: the back button, the background ------------------------------------------
	step("the back button closes the open sheet, then leaves the app");
	await waitFor("the app in front again", (ns) => front() === APP && connected(ns), 30);
	const sidebar = sidebarButton(screen());
	if (!sidebar) throw new Error("no side bar button to open a sheet with: run the smoke test on a phone's screen, not a tablet's");
	tap(sidebar);
	await waitFor("the side bar open", agentsShown);
	adb("shell", "input", "keyevent", "KEYCODE_BACK");
	await waitFor("the side bar closed by back", (ns) => !agentsShown(ns) && ns, 15);
	if (front() !== APP) throw new Error(`back with a sheet open left the app (in front: ${frontActivity()})`);
	adb("shell", "input", "keyevent", "KEYCODE_BACK");
	await waitFor("the app gone to the background by back", () => (front() !== APP && front() !== undefined) || undefined, 15);

	step("back from the background, still on the machine");
	adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
	await waitFor("the app in front and connected after back", (ns) => front() === APP && connected(ns), 60);
	adb("shell", "input", "keyevent", "KEYCODE_HOME");
	await waitFor("the app paused by HOME", () => front() !== APP || undefined, 15);
	await sleep(5000);
	adb("shell", "am", "start", "-n", `${APP}/.MainActivity`);
	await waitFor("the app in front and connected after HOME", (ns) => front() === APP && connected(ns), 60);
	tap(await waitFor("the side bar button", sidebarButton));
	await waitFor("the agents after resume", agentsShown);
	// ---- the system bars: the theme's colour, light icons on a dark theme -----------------------------
	step("the status and navigation bars take the theme's colour, in a dark theme and in a light one");
	/** The colour at a point of the screen, as #rrggbb: screencap's raw RGBA follows a header of its own. */
	const screenColours = () => {
		const raw = execFileSync(ADB, ["exec-out", "screencap"], { env, maxBuffer: 64 * 1024 * 1024 });
		const w = raw.readUInt32LE(0);
		const h = raw.readUInt32LE(4);
		const head = raw.length - w * h * 4;
		const at = (x, y) => `#${[0, 1, 2].map((i) => raw[head + (y * w + x) * 4 + i].toString(16).padStart(2, "0")).join("")}`;
		// Near the left edge, clear of the clock and the icons: the bar's own colour.
		return { status: at(4, 4), navigation: at(4, h - 4) };
	};
	const themeBg = async (id) => {
		const r = await evaluate("window.pine.call('GET', '/themes')");
		const bg = r?.data?.themes?.find((t) => t.id === id)?.colors?.bg;
		if (!bg) throw new Error(`the machine's pine has no theme ${id}: ${JSON.stringify(r?.data?.themes?.map((t) => t.id))}`);
		return bg.slice(0, 7).toLowerCase();
	};
	const barsIn = async (id, file) => {
		const want = await themeBg(id);
		let got;
		await waitFor(`the bars in ${want} (${id})`, () => ((got = screenColours()), got.status === want && got.navigation === want) || undefined, 30);
		await sleep(500);
		fs.writeFileSync(path.join(path.dirname(shot), file), execFileSync(ADB, ["exec-out", "screencap", "-p"], { env, maxBuffer: 64 * 1024 * 1024 }));
		step(`screenshot: ${path.join(path.dirname(shot), file)}`);
	};
	await barsIn((await evaluate("window.pine.call('GET', '/themes')")).data.theme, "bars-dark.png");
	const light = "github-light";
	const set = await evaluate(`window.pine.call('POST', '/settings', { key: 'ui.theme', value: '${light}' })`);
	if (!set?.ok) throw new Error(`the theme could not be set: ${JSON.stringify(set)}`);
	// The page draws a theme it is told at its start: started again, it asks pine.
	await evaluate("location.reload(); 1");
	await waitFor("the page connected again", (ns) => front() === APP && connected(ns), 60);
	await barsIn(light, "bars-light.png");

	// A dialog of this app's that came and went between two looks is still in the system's log.
	const anr = adb("logcat", "-d", "-b", "main,system").split("\n").find((l) => l.includes(`ANR in ${APP}`));
	if (anr) throw new Error(`the app was not responding (ANR) during the run: ${anr.trim()}`);
	step("done: the app reached the pine of the machine and shows its agents");
} catch (e) {
	console.error(`smoke run failed: ${e instanceof Error ? e.message : e}`);
	process.exitCode = 1;
} finally {
	await cleanup();
}
