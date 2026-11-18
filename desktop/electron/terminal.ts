// The owner's terminal beside a conversation: a shell of their own, on a pseudo-terminal, in the
// conversation's folder. It is the owner's hand, as a terminal app of theirs would be: no
// sandbox, the owner's login shell and environment. Nothing an agent says reaches it by itself;
// what is typed comes from the page's keyboard, and a code block of an answer only by the owner's
// click on its Run button (src/runnable.ts says what such a block may hold).
//
// One shell for each conversation, kept here while the app runs, so that the panel can be closed
// and opened again, or the page drawn again, without losing what the shell printed: the end of it
// is kept (`KEEP`) and handed back when the page opens the terminal again.
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { IPty } from "node-pty";

/** How much of what a shell printed is kept for a page that opens it again. */
const KEEP = 256 * 1024;
/** A terminal's name: the conversation's key (agent:session), as the page knows it. */
const ID = /^[A-Za-z0-9._~:-]{1,200}$/;
/** Variables of the app's own process that a shell of the owner's has no business with. */
const NOT_THEIRS = /^(ELECTRON_|PINE_DESKTOP_|CHROME_|NODE_OPTIONS$|__CF|XPC_SERVICE_NAME$)/;

export interface TerminalEvents {
	data: (id: string, data: string) => void;
	exit: (id: string, code: number) => void;
}

interface Shell {
	pty: IPty;
	/** The end of what it printed. */
	kept: string;
	cwd: string;
}

type Pty = typeof import("node-pty");
let loaded: Pty | Error | undefined;

/**
 * node-pty, loaded when the first terminal opens: a system without its prebuilt binary gets a
 * sentence, not a crash of the app. Its helper (`spawn-helper`) has to be executable, which
 * npm leaves undone when install scripts are not allowed to run: done here where it was missed.
 */
function ptyModule(): Pty {
	if (loaded instanceof Error) throw loaded;
	if (loaded) return loaded;
	try {
		const require = createRequire(import.meta.url);
		loaded = require("node-pty") as Pty;
		const helper = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper").replace("app.asar", "app.asar.unpacked");
		try {
			if (fs.existsSync(helper) && !(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755);
		} catch {
			// a packed app has it executable already
		}
		return loaded;
	} catch (e) {
		loaded = new Error(`The terminal cannot start on this system: ${e instanceof Error ? e.message : e}`);
		throw loaded;
	}
}

/** Where a shell starts: the folder the page names if it is one, else the owner's home folder. */
export function startIn(cwd: unknown): string {
	if (typeof cwd === "string" && path.isAbsolute(cwd)) {
		try {
			if (fs.statSync(cwd).isDirectory()) return cwd;
		} catch {
			// gone since
		}
	}
	return os.homedir();
}

/** The environment of the owner's shell: their login environment, without the app's own variables. */
export function shellEnv(base: NodeJS.ProcessEnv): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [k, v] of Object.entries(base)) if (v !== undefined && !NOT_THEIRS.test(k)) env[k] = v;
	env.TERM = "xterm-256color";
	env.COLORTERM = "truecolor";
	env.TERM_PROGRAM = "Pine";
	env.LANG ||= "en_US.UTF-8";
	return env;
}

const size = (n: unknown, least: number, most: number) => Math.max(least, Math.min(most, Math.floor(Number(n)) || least));

export class Terminals {
	private shells = new Map<string, Shell>();
	private events: TerminalEvents;
	/** The environment shells start with (the owner's login environment). */
	private env: () => Promise<NodeJS.ProcessEnv>;
	/** The shell to run; the owner's own ($SHELL, as a login shell) when not given. */
	private shell?: string[];
	constructor(events: TerminalEvents, env: () => Promise<NodeJS.ProcessEnv>, shell?: string[]) {
		this.events = events;
		this.env = env;
		this.shell = shell;
	}

	/**
	 * The terminal of a conversation: the one that runs, or a new one in `cwd`. What it printed so far
	 * comes back, for the page to draw before what follows.
	 */
	async open(id: string, cwd: unknown, cols: unknown, rows: unknown): Promise<{ kept: string; cwd: string; fresh: boolean }> {
		if (!ID.test(id)) throw new Error("not a terminal's name");
		const have = this.shells.get(id);
		if (have) {
			this.resize(id, cols, rows);
			return { kept: have.kept, cwd: have.cwd, fresh: false };
		}
		const pty = ptyModule();
		const env = shellEnv(await this.env());
		const [file, ...args] = this.shell ?? [env.SHELL && fs.existsSync(env.SHELL) ? env.SHELL : process.platform === "win32" ? "powershell.exe" : "/bin/zsh", ...(process.platform === "win32" ? [] : ["-l"])];
		const dir = startIn(cwd);
		// Another call may have opened it while the environment was being asked for.
		const raced = this.shells.get(id);
		if (raced) return { kept: raced.kept, cwd: raced.cwd, fresh: false };
		const proc = pty.spawn(file, args, { name: "xterm-256color", cols: size(cols, 2, 1000), rows: size(rows, 1, 500), cwd: dir, env });
		const shell: Shell = { pty: proc, kept: "", cwd: dir };
		this.shells.set(id, shell);
		proc.onData((data) => {
			shell.kept = (shell.kept + data).slice(-KEEP);
			this.events.data(id, data);
		});
		// Said only of a shell that ended by itself: one that was closed has a successor, or nobody, to tell.
		proc.onExit(({ exitCode }) => {
			if (this.shells.get(id) !== shell) return;
			this.shells.delete(id);
			this.events.exit(id, exitCode);
		});
		return { kept: "", cwd: dir, fresh: true };
	}

	/** What was typed, or pasted, into a terminal. */
	write(id: string, data: unknown): void {
		if (typeof data === "string" && data) this.shells.get(id)?.pty.write(data);
	}

	resize(id: string, cols: unknown, rows: unknown): void {
		const shell = this.shells.get(id);
		if (!shell) return;
		try {
			shell.pty.resize(size(cols, 2, 1000), size(rows, 1, 500));
		} catch {
			// it ended a moment ago
		}
	}

	has(id: string): boolean {
		return this.shells.has(id);
	}

	/** The shell ends, and with it what it started in the foreground. */
	close(id: string): void {
		const shell = this.shells.get(id);
		if (!shell) return;
		this.shells.delete(id);
		try {
			shell.pty.kill();
		} catch {
			// already gone
		}
	}

	closeAll(): void {
		for (const id of [...this.shells.keys()]) this.close(id);
	}
}
