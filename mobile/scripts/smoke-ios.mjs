// The iOS app from end to end, by hand (not in CI, not in npm test), as scripts/smoke.mjs is for
// Android: builds the app and its hosted test for the simulator, starts a simulator of its own
// without a window, and points the app at a machine: an SSH server of this run's own on this Mac's
// loopback (MINA sshd, mobile/core's SmokeMachine.kt), which the simulator reaches at 127.0.0.1,
// running the real `pine service` on a pine home of its own whose model is the scripted mock
// server. Nothing of this Mac's own sshd or settings is touched.
//
//   npm run smoke:ios [-- --shots <dir>] [-- --device <name>] [-- --keep]
//
// The test (ios/App/AppTests/SmokeTests.swift) runs inside the app and drives its page as a person
// would: it reads the phone's key and shares it, adds the machine, trusts its host key and shows
// the agents. It is the test of the web view's hardening in PineViewController.swift and
// PinePlugin.swift, each a named check listed here and failing the run: the page's policy; the
// camera, microphone and motion sensors refused; no file access; the media scheme's rules and
// ranges; no window; no navigation away, an address of the web handed to Safari (noted, not
// opened); the app back from the background still connected; the status bar in a dark and a light
// theme. A second run of the app then checks that the Keychain kept the phone's key. Last, a
// release build of the app, made with Capacitor's own inspector switch on (CAPACITOR_DEBUG=true, as
// a debug build has it), checks that PineViewController turns the web inspector off there.
//
// What only the Mac can do (a screenshot, sending the app to the background) the test asks for
// through files in the run's folder, which this script answers. Screenshots (agents.png,
// bars-dark.png, bars-light.png) go to --shots, the run's folder by default.
//
// Needs Xcode with an iOS simulator runtime, and a JDK (JAVA_HOME, default Android Studio's) for
// the machine.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { startMock } from "../../baseline/tests/mock.mjs";

const { values: opts } = parseArgs({ options: { shots: { type: "string" }, device: { type: "string" }, keep: { type: "boolean" } } });
const mobile = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(mobile, "..");
const javaHome = process.env.JAVA_HOME ?? "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
const env = { ...process.env, JAVA_HOME: javaHome };
const APP = "dev.pmndre.pine";
const DEVICE = opts.device ?? "Pine smoke";
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-ios-smoke-")));
const shots = path.resolve(opts.shots ?? work);
const derived = path.join(mobile, "ios", "DerivedData");
// The release build's own, so that its products and its .xctestrun stay apart from the debug build's.
const derivedRelease = path.join(derived, "release");
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
const simctl = (...args) => execFileSync("xcrun", ["simctl", ...args], { env, maxBuffer: 64 * 1024 * 1024 }).toString();

/** A second of a 440 Hz tone, as a WAV file: the sound the media checks ask the daemon for. */
function tone() {
	const rate = 8000;
	const samples = Buffer.alloc(rate * 2);
	for (let i = 0; i < rate; i++) samples.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), i * 2);
	const head = Buffer.alloc(44);
	head.write("RIFF", 0);
	head.writeUInt32LE(36 + samples.length, 4);
	head.write("WAVEfmt ", 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write("data", 36);
	head.writeUInt32LE(samples.length, 40);
	return Buffer.concat([head, samples]);
}

/** The simulator of the run: one of its own, made once, so that a simulator somebody uses is left alone. */
function device() {
	const all = JSON.parse(simctl("list", "devices", "available", "-j")).devices;
	const ios = Object.keys(all).filter((r) => /SimRuntime\.iOS-/.test(r));
	for (const runtime of ios) {
		const found = all[runtime].find((d) => d.name === DEVICE);
		if (found) return found.udid;
	}
	const runtimes = JSON.parse(simctl("list", "runtimes", "available", "-j")).runtimes.filter((r) => r.platform === "iOS");
	const runtime = runtimes.at(-1);
	if (!runtime) throw new Error("No iOS simulator runtime: add one in Xcode's Settings, Components.");
	// The newest plain iPhone ("iPhone 17"): a phone's width, as the page is drawn for.
	const plain = runtime.supportedDeviceTypes.filter((t) => /^iPhone \d+$/.test(t.name)).sort((a, b) => Number(a.name.slice(7)) - Number(b.name.slice(7)));
	const type = plain.at(-1) ?? runtime.supportedDeviceTypes.find((t) => t.productFamily === "iPhone");
	step(`making the simulator ${DEVICE} (${type.name}, ${runtime.name})`);
	return simctl("create", DEVICE, type.identifier, runtime.identifier).trim();
}

/** Answers what the test asks of the Mac (ask-<n> files in the run's folder), until stopped. */
function answer(udid) {
	let n = 1;
	let stopped = false;
	const loop = (async () => {
		while (!stopped) {
			const ask = path.join(work, `ask-${n}`);
			if (!fs.existsSync(ask)) {
				await sleep(200);
				continue;
			}
			const [command, arg] = fs.readFileSync(ask, "utf8").trim().split(" ");
			if (command === "shot") {
				const file = path.join(shots, arg);
				fs.mkdirSync(shots, { recursive: true });
				simctl("io", udid, "screenshot", file);
				step(`screenshot: ${file}`);
			} else if (command === "background") {
				// Another app in front, as the owner going home would leave it; then the app again.
				simctl("launch", udid, "com.apple.Preferences");
				await sleep(5000);
				simctl("launch", udid, APP);
			}
			fs.writeFileSync(path.join(work, `done-${n}`), "");
			n++;
		}
	})();
	return async () => {
		stopped = true;
		await loop;
	};
}

/** The build for testing of a configuration, signed to run locally (no account): the Keychain is refused to an app with no signature. */
function build(udid, configuration, dir, ...settings) {
	run("xcrun", ["xcodebuild", "build-for-testing", "-quiet", "-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", configuration, "-destination", `id=${udid}`, "-derivedDataPath", dir, "CODE_SIGN_IDENTITY=-", "CODE_SIGN_STYLE=Manual", "DEVELOPMENT_TEAM=", ...settings]);
}

/** The .xctestrun file the last build for testing in `dir` wrote (an older SDK's may lie beside it): what test-without-building runs. */
function xctestrun(dir) {
	const products = path.join(dir, "Build", "Products");
	const found = fs.readdirSync(products).filter((f) => f.endsWith(".xctestrun")).map((f) => path.join(products, f));
	if (!found.length) throw new Error(`no .xctestrun in ${products}: the build for testing made none`);
	return found.sort((x, y) => fs.statSync(y).mtimeMs - fs.statSync(x).mtimeMs)[0];
}

/** Runs one test of SmokeTests in the app on the simulator, from the build of `dir`, and lists its checks. */
async function test(udid, name, dir = derived) {
	const checks = path.join(work, "checks.txt");
	fs.rmSync(checks, { force: true });
	const log = path.join(work, `${name}.log`);
	const out = fs.openSync(log, "w");
	const code = await new Promise((resolve) => {
		const child = spawn(
			"xcrun",
			["xcodebuild", "test-without-building", "-xctestrun", xctestrun(dir), "-destination", `id=${udid}`, `-only-testing:AppTests/SmokeTests/${name}`, "-collect-test-diagnostics", "never"],
			{ cwd: mobile, env: { ...env, TEST_RUNNER_PINE_SMOKE_DIR: work }, stdio: ["ignore", out, out] },
		);
		child.on("exit", resolve);
	});
	fs.closeSync(out);
	const text = fs.readFileSync(log, "utf8");
	for (const line of text.split("\n").filter((l) => /^- /.test(l))) console.log(`  ${line}`);
	const listed = fs.existsSync(checks) ? fs.readFileSync(checks, "utf8").trim().split("\n").filter(Boolean) : [];
	let failed = 0;
	for (const line of listed) {
		const [verdict, what, detail] = line.split("\t");
		if (verdict !== "ok") failed++;
		console.log(`  ${verdict === "ok" ? "ok" : "NOT OK"}  ${what}${detail ? ` (${detail})` : ""}`);
	}
	if (code !== 0 || failed) {
		const why = text.split("\n").filter((l) => /error:|failed|Failing tests|not seen/i.test(l)).slice(0, 20).join("\n");
		throw new Error(`${name}: ${failed} check(s) failed, xcodebuild exited ${code}\n${why}\n(the whole log: ${log}, kept with --keep)`);
	}
	if (!listed.length) throw new Error(`${name}: no check ran (the whole log: ${log}, kept with --keep)`);
}

try {
	// ---- the app ----------------------------------------------------------------------------------
	const udid = device();
	const state = JSON.parse(simctl("list", "devices", "-j")).devices;
	const booted = Object.values(state).flat().find((d) => d.udid === udid)?.state === "Booted";
	if (!booted) {
		step(`starting the simulator ${DEVICE}, without a window`);
		simctl("boot", udid);
		cleanups.push(() => simctl("shutdown", udid));
	}
	simctl("bootstatus", udid, "-b");

	step("building the page, the app and its test for the simulator, in debug and in release");
	run("npm", ["run", "sync:ios"]);
	build(udid, "Debug", derived);
	// Capacitor's switch on, as in a debug build, so that only pine's own line can turn the inspector
	// off; testable, so that the test reaches PineViewController.
	build(udid, "Release", derivedRelease, "CAPACITOR_DEBUG=true", "ENABLE_TESTABILITY=YES");

	// ---- the machine ------------------------------------------------------------------------------
	step("starting the machine: the mock model, a pine home, and an SSH server on this Mac's loopback");
	const mock = await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
	cleanups.push(() => mock.close());
	const home = path.join(work, "far");
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: mock.baseUrl, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent: it administers pine" }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({ description: "Looks things up on the web" }));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");
	// The sound the media checks fetch and play, in scout's workspace (`/agents/scout/image?path=tone.wav`).
	const wav = tone();
	write(path.join(home, "agents", "scout", "workspace", "tone.wav"), wav);
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
	const host = `me@127.0.0.1:${said.port}`;
	step(`machine ${host}, host key ${said.fingerprint}`);
	write(path.join(work, "machine.json"), JSON.stringify({ host, fingerprint: said.fingerprint, keys, toneBytes: String(wav.length) }));

	// ---- the runs ---------------------------------------------------------------------------------
	step("the app on fresh data: no app, no key in the Keychain");
	try {
		simctl("uninstall", udid, APP);
	} catch {
		// not installed yet
	}
	simctl("keychain", udid, "reset");
	const stop = answer(udid);
	cleanups.push(stop);

	step("the app from its first start to the agents, its hardening, its life and its status bar");
	await test(udid, "testFromFirstStartToTheAgents");
	step("the app started again: the Keychain kept the phone's key");
	await test(udid, "testTheKeySurvivesARelaunch");
	step("the release build: no web inspector, even with Capacitor's switch on");
	await test(udid, "testInspectorOffInARelease", derivedRelease);
	step("done: the app reached the pine of the machine and shows its agents");
} catch (e) {
	console.error(`smoke run failed: ${e instanceof Error ? e.message : e}`);
	process.exitCode = 1;
} finally {
	await cleanup();
}
