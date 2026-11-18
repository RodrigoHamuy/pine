// The owner's terminal beside a conversation (electron/terminal.ts) and what an answer's Run button
// may type into it (src/runnable.ts). Without a window: a real pseudo-terminal with /bin/sh, in a
// folder of the test's own.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { shellEnv, startIn, Terminals } from "../electron/terminal.ts";
import { runnable } from "../src/runnable.ts";

function world() {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-terminal-")));
	const out = new Map<string, string>();
	const ended = new Map<string, number>();
	const terms = new Terminals({ data: (id, data) => out.set(id, (out.get(id) ?? "") + data), exit: (id, code) => ended.set(id, code) }, async () => ({ ...process.env, PS1: "$ " }), ["/bin/sh"]);
	const until = async (what: () => boolean, ms = 5000) => {
		const end = Date.now() + ms;
		while (!what()) {
			if (Date.now() > end) throw new Error(`waited in vain; the terminal says: ${JSON.stringify([...out])}`);
			await new Promise((r) => setTimeout(r, 20));
		}
	};
	return { dir, out, ended, terms, until, done: () => (terms.closeAll(), fs.rmSync(dir, { recursive: true, force: true })) };
}

test("terminal: a shell starts in the folder it is given, runs what is typed, and is handed back with what it printed", async () => {
	const w = world();
	try {
		const first = await w.terms.open("main:okapi", w.dir, 80, 24);
		assert.equal(first.fresh, true);
		assert.equal(first.cwd, w.dir);
		w.terms.write("main:okapi", "pwd; echo done-$((40+2))\r");
		await w.until(() => /done-42/.test(w.out.get("main:okapi") ?? ""));
		assert.match(w.out.get("main:okapi")!, new RegExp(w.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		// Opened again (the panel drawn again), it is the same shell, with what it printed so far.
		const again = await w.terms.open("main:okapi", "/", 100, 30);
		assert.equal(again.fresh, false);
		assert.equal(again.cwd, w.dir);
		assert.match(again.kept, /done-42/);
		// Another conversation has a shell of its own.
		assert.equal((await w.terms.open("main:other", w.dir, 80, 24)).fresh, true);
		assert.equal(w.terms.has("main:okapi") && w.terms.has("main:other"), true);
	} finally {
		w.done();
	}
});

test("terminal: a shell that ends says so; one that is closed does not, and its name starts a new one", async () => {
	const w = world();
	try {
		await w.terms.open("a:1", w.dir, 80, 24);
		w.terms.write("a:1", "exit 3\r");
		await w.until(() => w.ended.has("a:1"));
		assert.equal(w.ended.get("a:1"), 3);
		assert.equal(w.terms.has("a:1"), false);
		await w.terms.open("a:2", w.dir, 80, 24);
		w.terms.close("a:2");
		await new Promise((r) => setTimeout(r, 200));
		assert.equal(w.ended.has("a:2"), false);
		assert.equal((await w.terms.open("a:2", w.dir, 80, 24)).fresh, true);
	} finally {
		w.done();
	}
});

test("terminal: a name that is not a conversation's, a folder that is not one, and the app's own variables are refused", async () => {
	const w = world();
	try {
		await assert.rejects(w.terms.open("../x y", w.dir, 80, 24), /not a terminal's name/);
		assert.equal(startIn(path.join(w.dir, "missing")), os.homedir());
		assert.equal(startIn("relative/path"), os.homedir());
		assert.equal(startIn(w.dir), w.dir);
		const env = shellEnv({ PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1", PINE_DESKTOP_DATA: "/x", NODE_OPTIONS: "--inspect", HOME: "/h" });
		assert.deepEqual([env.PATH, env.HOME, env.TERM], ["/usr/bin", "/h", "xterm-256color"]);
		assert.equal("ELECTRON_RUN_AS_NODE" in env || "PINE_DESKTOP_DATA" in env || "NODE_OPTIONS" in env, false);
	} finally {
		w.done();
	}
});

test("runnable: a block is run as it is shown, and one that holds what does not show is refused", () => {
	assert.deepEqual(runnable("npm test\n"), { ok: true, text: "npm test" });
	assert.deepEqual(runnable("cd x\r\nls\n\n"), { ok: true, text: "cd x\nls" });
	assert.deepEqual(runnable("for f in *; do\n\techo $f\ndone"), { ok: true, text: "for f in *; do\n\techo $f\ndone" });
	assert.deepEqual(runnable("echo héllo 🌲"), { ok: true, text: "echo héllo 🌲" });
	assert.equal(runnable("  \n").ok, false);
	// An escape sequence, a lone carriage return (which would run what is before it), a backspace, a
	// direction override, a joiner of no width, a line separator and a tag character.
	for (const hidden of ["\x1b[2K", "\r", "\b", "\u202E", "\u200B", "\u2028", "\u{E0041}", "\x00", "\u0085"]) {
		const r = runnable(`echo safe${hidden}rm -rf ~`);
		assert.equal(r.ok, false, JSON.stringify(hidden));
		assert.match((r as { why: string }).why, /does not show as itself \(U\+[0-9A-F]{4,6}\)/);
	}
});
