import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PINE_ROOT } from "./config.ts";

// "pine update": bring pine itself up to date, in the way that fits how it was installed, and
// fetch whatever the new version needs (its dependencies, the browser build it drives).

/**
 * How this copy of pine got here.
 * checkout: a git clone, which runs the sources directly. It is updated with git.
 * global:   installed with "npm install -g". It is updated with npm.
 * local:    a dependency inside some project's node_modules. That project decides its version.
 */
export type InstallKind = "checkout" | "global" | "local";

const real = (p: string) => {
	try {
		return fs.realpathSync(p);
	} catch {
		return path.resolve(p);
	}
};

export function installKind(root: string, globalRoot?: string): InstallKind {
	if (fs.existsSync(path.join(root, ".git")) && fs.existsSync(path.join(root, "src", "cli.ts"))) return "checkout";
	if (globalRoot && (real(root) + path.sep).startsWith(real(globalRoot) + path.sep)) return "global";
	return "local";
}

/** Whether version a is higher than version b ("1.10.0" is higher than "1.9.3"). */
export function newer(a: string, b: string): boolean {
	const parse = (v: string) => v.split("-")[0].split(".").map((n) => Number(n) || 0);
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
	return false;
}

export function installed(root = PINE_ROOT): { name: string; version: string; kind: InstallKind; root: string } {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const globalRoot = capture("npm", ["root", "-g"]);
	return { name: pkg.name, version: pkg.version, kind: installKind(root, globalRoot), root };
}

function capture(cmd: string, args: string[], cwd?: string): string | undefined {
	const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	return r.status === 0 ? r.stdout.trim() : undefined;
}

const show = (cmd: string, args: string[], cwd?: string) => spawnSync(cmd, args, { cwd, stdio: "inherit" }).status ?? 1;

const RESTART = "A pine that is running keeps the old version until it is restarted: quit the terminal UI and open it again, or restart the daemon.";

/** Text from a commit's subject, safe to print: one line, without anything a terminal would act on. */
const plain = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();

/** A commit's subject as an owner reads it: "feat: x" is something new, "fix: x" something fixed. */
function worded(subject: string): string {
	const m = /^([a-z]+)(?:\([^)]*\))?!?:\s*(.+)$/.exec(plain(subject));
	if (!m) return plain(subject);
	return `${m[1] === "feat" ? "new" : m[1] === "fix" ? "fixed" : m[1]}: ${m[2]}`;
}

/** The most lines of changes that are printed; the rest is counted. */
const MOST = 25;

/** The list as it is printed: a heading by itself, then the lines, cut after MOST changes with a count of the rest. */
function listed(heading: string, groups: Array<{ title?: string; changes: string[] }>): string {
	const total = groups.reduce((n, g) => n + g.changes.length, 0);
	if (!total) return "";
	const lines: string[] = [];
	let left = MOST;
	for (const g of groups) {
		if (!g.changes.length || left <= 0) continue;
		if (g.title) lines.push(`  ${g.title}`);
		for (const c of g.changes.slice(0, left)) lines.push(`${g.title ? "    " : "  "}- ${c}`);
		left -= g.changes.length;
	}
	return `${heading}\n\n${lines.join("\n")}${total > MOST ? `\n  ... and ${total - MOST} more` : ""}`;
}

/**
 * What the versions after `from` changed, up to `to`: a list for every version, the newest
 * first, a line for every commit. `list` is the package's changes.json (scripts/changes.mjs).
 * Empty when it says nothing about these versions.
 */
export function whatChanged(list: unknown, from: string, to: string): string {
	if (!Array.isArray(list)) return "";
	const groups: Array<{ title: string; changes: string[] }> = [];
	for (const entry of list) {
		const version = typeof entry?.version === "string" ? plain(entry.version) : "";
		if (!version || !newer(version, from) || newer(version, to) || !Array.isArray(entry.changes)) continue;
		const changes = entry.changes.filter((c: unknown): c is string => typeof c === "string" && Boolean(plain(c))).map(worded);
		// A version can stand twice in a list that was built from an odd history: its changes are one list.
		const at = groups.find((g) => g.title === version);
		if (at) at.changes.push(...changes);
		else groups.push({ title: version, changes });
	}
	return listed(`What changed since ${from}:`, groups);
}

/** The same for a checkout, which has commits and no versions: the subjects that the pull brought. */
export function whatCame(subjects: string[]): string {
	return listed("What changed:", [{ changes: subjects.map(plain).filter(Boolean).map(worded) }]);
}

/** What the installed package says its releases changed. */
function changesIn(root: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(path.join(root, "changes.json"), "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * What to say after an update, and whether it worked: the version on disk has to be the one
 * that was asked for. npm can say that a version exists and still install an older one for a
 * few minutes after it was published (its two answers come from different places), and
 * "pine is now <the old version>" must not read like success.
 */
export function outcome(name: string, wanted: string | undefined, now: string, news = ""): { ok: boolean; text: string } {
	if (wanted && newer(wanted, now)) {
		return { ok: false, text: `\nNot updated: pine is still ${now}. npm knows ${wanted} but did not install it; that happens for a few minutes after a version is published. Run "pine update" again in a moment, or install it by its number:\n\n  npm install -g ${name}@${wanted}` };
	}
	// The list stands by itself, between the version and what to do about it, so that it is not read over.
	return { ok: true, text: news ? `\npine is now ${now}.\n\n${news}\n\n${RESTART}` : `\npine is now ${now}. ${RESTART}` };
}

/**
 * Update pine, or with `check` only say whether there is something newer. Returns the exit code.
 * `browser` fetches the browser build of the version that is on disk afterwards.
 */
export async function update(opts: { check: boolean; out: (line: string) => void; browser: boolean }): Promise<number> {
	const { out } = opts;
	const me = installed();
	let wanted: string | undefined;
	/** Where a checkout stood before it was moved forward. */
	let was: string | undefined;

	if (me.kind === "checkout") {
		const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"], me.root) ?? "?";
		if (!capture("git", ["rev-parse", "--abbrev-ref", "@{u}"], me.root)) {
			out(`This is a checkout in ${me.root}, and its branch ${branch} does not follow one on a server, so there is nothing to update from. Set that up with git, or pull by hand.`);
			return 1;
		}
		if (spawnSync("git", ["fetch", "--quiet"], { cwd: me.root, stdio: "inherit" }).status !== 0) {
			out("Could not reach the repository this checkout follows.");
			return 1;
		}
		const behind = Number(capture("git", ["rev-list", "--count", "HEAD..@{u}"], me.root) ?? 0);
		if (!behind) {
			out(`pine ${me.version} (checkout in ${me.root}, branch ${branch}) is up to date.`);
			return 0;
		}
		if (opts.check) {
			out(`${behind} new commit${behind === 1 ? "" : "s"} for this checkout (${me.root}, branch ${branch}). Run "pine update" to get ${behind === 1 ? "it" : "them"}.`);
			return 0;
		}
		out(`Getting ${behind} new commit${behind === 1 ? "" : "s"} ...`);
		was = capture("git", ["rev-parse", "HEAD"], me.root);
		// Only ever a fast-forward: your own commits and changes are never rewritten or thrown away.
		if (show("git", ["pull", "--ff-only"], me.root) !== 0) {
			out("git could not simply move this checkout forward (you have commits or changes of your own in the way). Nothing was changed; sort it out with git and run pine update again.");
			return 1;
		}
		out("Installing what the new version depends on ...");
		if (show("npm", ["install", "--no-audit", "--no-fund"], me.root) !== 0) return 1;
	} else {
		const latest = capture("npm", ["view", me.name, "version"]);
		if (!latest) {
			out(`Could not ask npm for the latest version of ${me.name}. You may be offline.`);
			return 1;
		}
		if (!newer(latest, me.version)) {
			out(`pine ${me.version} is the latest version.`);
			return 0;
		}
		if (me.kind === "local") {
			out(`pine ${latest} is available (this is ${me.version}). This copy is a dependency of the project it is installed in (${me.root}); update it there:\n\n  npm install ${me.name}@latest`);
			return opts.check ? 0 : 1;
		}
		if (opts.check) {
			out(`pine ${latest} is available (this is ${me.version}). Run "pine update" to install it.`);
			return 0;
		}
		out(`Updating pine ${me.version} to ${latest} ...`);
		wanted = latest;
		// By its number, not as "latest": npm then installs this version or says that it cannot.
		if (show("npm", ["install", "-g", `${me.name}@${latest}`, "--no-audit", "--no-fund"]) !== 0) {
			out(`npm could not install ${latest}. Right after a version is published that can take a few minutes: run "pine update" again in a moment. To see why, run it yourself:\n\n  npm install -g ${me.name}@${latest}`);
			return 1;
		}
	}

	// The version on disk decides whether it worked, not what npm said it would do.
	const now = installed(me.root).version;
	// The package that is on disk now says what its releases changed; a checkout has its commits.
	const news = me.kind === "checkout" ? (was ? whatCame((capture("git", ["log", "--first-parent", "--format=%s", `${was}..HEAD`], me.root) ?? "").split("\n")) : "") : whatChanged(changesIn(me.root), me.version, now);
	const done = outcome(me.name, wanted, now, news);
	if (!done.ok) {
		out(done.text);
		return 1;
	}
	// The browser build has to match the new version, so the new version's own installer fetches it.
	if (opts.browser) {
		out("Making sure the browser the web tools drive matches ...");
		const status = show(process.execPath, [path.join(me.root, "bin", "pine.js"), "browser-install"]);
		if (status !== 0) out(`The browser could not be fetched (exit ${status}). Run "pine browser-install" when you are online.`);
	}
	out(done.text);
	return 0;
}
