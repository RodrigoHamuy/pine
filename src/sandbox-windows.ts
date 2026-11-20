// The sandbox on Windows: an AppContainer, which pine's helper pine-box.exe starts a command in
// (src/pine-box.cs). An AppContainer reads what Windows lets every app read (the system, Program
// Files) and nothing of the owner's files unless a file or folder names it; it writes only where
// it was given the right; it has no network without a capability, and never this computer's own
// loopback. So the rules are said to Windows as permissions on the folders a command may use,
// which pine-box adds, and notes in a ledger in pine's data so that they can be taken back.
//
// What a mount cannot do on Linux, an AppContainer cannot either: forbid making a file that does
// not exist yet. A run that has read outside content is held to the same `Guard` as on Linux, and
// to the same two refusals (`follow`, `background`).
//
// pine-box is built from its source with the C# compiler of .NET Framework 4, which every
// Windows 10 and 11 has, into prebuilt/ beside its source, where the Pine app carries it built
// (src/prebuilt.ts).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prebuilt } from "./prebuilt.ts";

export const BOX_SOURCE = path.join(import.meta.dirname, "pine-box.cs");

let program: string | null | undefined;
let why = "";

/** The C# compiler every Windows 10 and 11 carries. */
export function csc(): string | undefined {
	const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
	return ["Framework64", "Framework"].map((f) => path.join(root, "Microsoft.NET", f, "v4.0.30319", "csc.exe")).find((f) => fs.existsSync(f));
}

/** pine-box, built from this source; undefined (with `boxMissing()` saying why) where it cannot be had. */
export function boxProgram(): string | undefined {
	if (program !== undefined) return program ?? undefined;
	program = null;
	const name = `pine-box-${createHash("sha256").update(fs.readFileSync(BOX_SOURCE)).digest("hex").slice(0, 12)}.exe`;
	const carried = prebuilt(BOX_SOURCE, name);
	if (carried) return (program = carried);
	// Built beside its source, where the Pine app carries it built: pine's own code, which no agent
	// writes in any mode (rule 1 of AGENTS.md). Whoever could change the program there could change pine.
	const folder = path.join(path.dirname(BOX_SOURCE), "prebuilt");
	const file = path.join(folder, name);
	if (fs.existsSync(file)) return (program = file);
	const compiler = csc();
	if (!compiler) return void (why = "this Windows has no C# compiler of .NET Framework 4 (csc.exe), which pine builds its sandbox helper with");
	fs.mkdirSync(folder, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp.exe`;
	try {
		execFileSync(compiler, ["/nologo", "/optimize+", "/platform:anycpu", `/out:${tmp}`, BOX_SOURCE], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, windowsHide: true });
		fs.renameSync(tmp, file);
	} catch (e) {
		fs.rmSync(tmp, { force: true });
		const said = String((e as { stdout?: unknown }).stdout ?? "").split(/\r?\n/).filter((l) => /error/i.test(l)).slice(0, 3).join(" | ");
		return void (why = `pine could not build its sandbox helper (${said.slice(0, 400) || (e instanceof Error ? e.message.slice(0, 200) : "no reason given")})`);
	}
	for (const old of fs.readdirSync(folder)) if (old.startsWith("pine-box-") && old !== name && !old.includes(".tmp")) fs.rmSync(path.join(folder, old), { force: true });
	return (program = file);
}

export const boxMissing = () => why;

/** An AppContainer's name: 64 characters at most, letters, digits, dots and dashes. One per agent and kind of call. */
export function containerName(home: string, agent: string, kind: string): string {
	const of = createHash("sha256").update(path.resolve(home)).digest("hex").slice(0, 8);
	return `pine.${of}.${agent.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 32)}.${kind}`;
}

export interface Box {
	name: string;
	read: string[];
	write: string[];
	/** Files that `write` would open and that must not change (instruction files after outside content). */
	deny?: string[];
	network: boolean;
	/** Where every permission pine-box adds is noted. */
	ledger: string;
}

/** What to put in front of a command so that it runs in this AppContainer. */
export function boxArgs(box: Box): string[] {
	const exe = boxProgram();
	if (!exe) throw new Error(`there is no sandbox on this computer: ${why}`);
	const exists = (p: string) => fs.existsSync(p);
	return [
		exe,
		"box",
		"--name",
		box.name,
		...(box.network ? ["--net"] : []),
		"--ledger",
		box.ledger,
		...box.read.filter(exists).flatMap((p) => ["--read", p]),
		...box.write.filter(exists).flatMap((p) => ["--write", p]),
		...(box.deny ?? []).filter(exists).flatMap((p) => ["--deny", p]),
		"--",
	];
}

/** Take back every permission the ledger names (a removed agent leaves none on the owner's files). */
export function ungrant(ledger: string): void {
	const exe = boxProgram();
	if (!exe || !fs.existsSync(ledger)) return;
	try {
		execFileSync(exe, ["ungrant", "--ledger", ledger], { stdio: "ignore", timeout: 60_000, windowsHide: true });
	} catch {
		// what could not be taken back stays in the ledger for the next try
	}
}
