// `pine` for a terminal, from the app: a link in a folder of the shell's PATH to the launcher the
// app carries (Contents/Resources/bin/pine, which runs the app's pine on the app's Node). With
// it a Mac that only ever got the app has the `pine` command too.
//
// What is set up here is a link and nothing else, and only ever this app's own: a `pine` that
// somebody installed by itself (npm, a checkout) is left where it is and said to be there.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Command {
	/** "here": the shell's `pine` is this app's. "other": it is another pine. "none": the shell has none. "unavailable": this app cannot offer one. */
	state: "none" | "here" | "other" | "unavailable";
	/** Where the shell's `pine` is, or for "none" where the link would go. */
	at?: string;
	/** For "none": putting it there takes the owner's password (the system asks). */
	password?: boolean;
	/** For "unavailable", or after something that did not work: why, in a sentence for the owner. */
	why?: string;
}

/** A link that a Pine app made, whether or not that app is still there. */
const OURS = /\.app\/Contents\/Resources\/bin\/pine$/;
/** Where the link goes when no folder of the PATH can be written: on every Mac's PATH, and the system's to write. */
const SHARED = "/usr/local/bin";

const real = (p: string) => {
	try {
		return fs.realpathSync(p);
	} catch {
		return undefined;
	}
};
const linkOf = (p: string) => {
	try {
		return fs.lstatSync(p).isSymbolicLink() ? fs.readlinkSync(p) : undefined;
	} catch {
		return undefined;
	}
};
const writable = (dir: string) => {
	try {
		fs.accessSync(dir, fs.constants.W_OK | fs.constants.X_OK);
		return fs.statSync(dir).isDirectory();
	} catch {
		return false;
	}
};
const dirsOf = (env: NodeJS.ProcessEnv) => [...new Set(String(env.PATH ?? "").split(path.delimiter).filter((d) => path.isAbsolute(d)))];

/** The launcher this app carries, or why it has none to offer. */
export function launcher(resources: string | undefined): { file?: string; why?: string } {
	const file = resources ? path.join(resources, "bin", "pine") : undefined;
	// An app without a pine inside (a checkout, a build with --no-pine) has no command to offer, and says nothing about one.
	if (!file || !fs.existsSync(file)) return {};
	// Opened from a disk image or straight from Downloads, macOS runs the app from a place that changes with every start.
	if (file.startsWith("/Volumes/") || file.includes("/AppTranslocation/")) return { why: "Move Pine into your Applications folder and open it from there. Where it is now, macOS runs it from a place that changes, and a command could not find it again." };
	return { file };
}

/** Where a new link would go: a folder of the PATH that is the owner's to write, their own first; otherwise the shared one, with a password. */
export function place(env: NodeJS.ProcessEnv, home = os.homedir()): { dir: string; password: boolean } {
	const dirs = dirsOf(env);
	const own = [path.join(home, ".local", "bin"), path.join(home, "bin"), SHARED, "/opt/homebrew/bin"];
	const dir = own.find((d) => dirs.includes(d) && writable(d));
	return dir ? { dir, password: false } : { dir: SHARED, password: true };
}

/** What `pine` is in the owner's shell, as seen from this app. */
export function look(resources: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir()): Command {
	const { file, why } = launcher(resources);
	if (!file) return { state: "unavailable", why };
	for (const dir of dirsOf(env)) {
		const at = path.join(dir, "pine");
		const to = real(at);
		// Nothing there, or a link of an app that has moved away: not a pine.
		if (!to) continue;
		if (to === real(file)) return { state: "here", at };
		try {
			fs.accessSync(at, fs.constants.X_OK);
			return { state: "other", at };
		} catch {
			// not a program
		}
	}
	const { dir, password } = place(env, home);
	return { state: "none", at: path.join(dir, "pine"), password };
}

/** What is so, in words for the owner: for the settings page and the menu alike. */
export function said(c: Command): string {
	const first = c.why ? `${c.why} ` : "";
	if (c.state === "here") return `${first}pine in a terminal is the pine of this app (${c.at}).`;
	if (c.state === "other") return `${first}pine in a terminal is another pine (${c.at}), installed by itself. This app leaves it alone and runs its own.`;
	if (c.state === "none") return `${first}Not set up. Pine can put a pine command into ${path.dirname(c.at ?? SHARED)}, so that a terminal has the pine of this app.${c.password ? " macOS asks for your password." : ""}`;
	return c.why ?? "";
}

const run = (file: string, args: string[]) =>
	new Promise<{ code: number; err: string }>((resolve) => {
		execFile(file, args, { timeout: 120_000 }, (err, _out, stderr) => resolve({ code: err ? 1 : 0, err: String(stderr) }));
	});

/**
 * A shell command with the owner's password, which the system asks for in a window of its own.
 * The paths go in as arguments and are quoted by AppleScript: none of them is ever part of the script.
 */
export const asOwner = (words: string, script: string, args: string[]) => ["-e", "on run argv", "-e", `do shell script ${script} with prompt ${JSON.stringify(words)} with administrator privileges`, "-e", "end run", "--", ...args];

async function withPassword(words: string, script: string, args: string[]): Promise<string | undefined> {
	const done = await run("/usr/bin/osascript", asOwner(words, script, args));
	if (done.code === 0) return undefined;
	return /-128|cancel/i.test(done.err) ? "Nothing was changed: the password was not given." : `macOS did not do it (${done.err.trim().slice(0, 200) || "it gave no reason"}).`;
}

/** Put the link into place. Hands back what the shell has afterwards, with `why` when it did not work. */
export async function install(resources: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir()): Promise<Command> {
	const now = look(resources, env, home);
	if (now.state !== "none" || !now.at) return now;
	const file = launcher(resources).file!;
	// A link of an app that has moved away may stand where the new one goes; anything else there is not this app's to replace.
	const there = linkOf(now.at);
	if (there === undefined && fs.existsSync(now.at)) return { ...now, why: `${now.at} is something else, and Pine does not replace it.` };
	if (there !== undefined && !OURS.test(there)) return { ...now, why: `${now.at} is a link to ${there}, and Pine does not replace it.` };
	let why: string | undefined;
	if (now.password) {
		why = await withPassword("Pine wants to put the pine command into /usr/local/bin, so that it works in a terminal.", `"/bin/mkdir -p ${SHARED} && /bin/ln -sfn " & quoted form of (item 1 of argv) & " ${SHARED}/pine"`, [file]);
	} else {
		try {
			if (there !== undefined) fs.unlinkSync(now.at);
			fs.symlinkSync(file, now.at);
		} catch (e) {
			why = `The link could not be made (${e instanceof Error ? e.message : String(e)}).`;
		}
	}
	return { ...look(resources, env, home), ...(why ? { why } : {}) };
}

/** Take the link away again. Only a link to this app's launcher is ever removed. */
export async function remove(resources: string | undefined, env: NodeJS.ProcessEnv, home = os.homedir()): Promise<Command> {
	const now = look(resources, env, home);
	if (now.state !== "here" || !now.at) return now;
	if (linkOf(now.at) === undefined) return { ...now, why: `${now.at} is not a link, and Pine did not make it.` };
	let why: string | undefined;
	if (writable(path.dirname(now.at))) {
		try {
			fs.unlinkSync(now.at);
		} catch (e) {
			why = `The link could not be removed (${e instanceof Error ? e.message : String(e)}).`;
		}
	} else why = await withPassword("Pine wants to remove the pine command it put into place.", `"/bin/rm -f " & quoted form of (item 1 of argv)`, [now.at]);
	return { ...look(resources, env, home), ...(why ? { why } : {}) };
}
