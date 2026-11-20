// pine's helpers on Windows are C# programs, built the first time they are needed with the C#
// compiler of .NET Framework 4, which every Windows 10 and 11 carries (csc.exe, C# 5: no string
// interpolation, no expression bodies). As the Swift helpers are on a Mac: built from pine's own
// source, into prebuilt/ beside it, where the Pine app carries them built (src/prebuilt.ts). That
// folder is pine's code, which no agent writes in any mode (rule 1 of AGENTS.md): whoever could
// change a program there could change pine. A helper is started by its path with fixed arguments,
// and decides nothing.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prebuilt } from "./prebuilt.ts";

/** The C# compiler every Windows 10 and 11 carries, or undefined. */
export function csc(): string | undefined {
	const root = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
	return ["Framework64", "Framework"].map((f) => path.join(root, "Microsoft.NET", f, "v4.0.30319", "csc.exe")).find((f) => fs.existsSync(f));
}

/** The folder of .NET Framework's own assemblies, for a helper that references one (System.Speech, UIAutomationClient). */
export function frameworkDir(): string | undefined {
	const c = csc();
	return c ? path.dirname(c) : undefined;
}

/** The name a build of `source` gets: its prefix and the hash of the source, so that a changed source is built anew. */
export const builtName = (source: string, prefix: string) => `${prefix}-${createHash("sha256").update(fs.readFileSync(source)).digest("hex").slice(0, 12)}.exe`;

/**
 * The program built from `source`: the one the Pine app carries, one built before, or one built
 * now. `refs` are assemblies of .NET Framework it uses (by file name, e.g. "System.Speech.dll").
 * `what` says in words what it is for, for the error when it cannot be built.
 */
export function buildCsharp(source: string, prefix: string, what: string, refs: string[] = [], opts: { compiler?: string; dir?: string } = {}): string {
	const name = builtName(source, prefix);
	const carried = prebuilt(source, name);
	if (carried) return carried;
	const folder = opts.dir ?? path.join(path.dirname(source), "prebuilt");
	const file = path.join(folder, name);
	if (fs.existsSync(file)) return file;
	const compiler = opts.compiler ?? csc();
	if (!compiler) throw new Error(`pine could not build its helper for ${what}: this Windows has no C# compiler of .NET Framework 4 (csc.exe). It comes with Windows; "Turn Windows features on or off" lists .NET Framework 4.8 Advanced Services.`);
	fs.mkdirSync(folder, { recursive: true });
	const tmp = `${file}.${process.pid}.tmp.exe`;
	try {
		execFileSync(compiler, ["/nologo", "/optimize+", "/platform:anycpu", ...refs.map((r) => `/reference:${r}`), `/out:${tmp}`, source], { stdio: ["ignore", "pipe", "pipe"], timeout: 120_000, windowsHide: true });
		// Whole or not at all: another conversation may be starting the same program at this moment.
		fs.renameSync(tmp, file);
	} catch (e) {
		fs.rmSync(tmp, { force: true });
		const said = String((e as { stdout?: unknown }).stdout ?? "")
			.split(/\r?\n/)
			.filter((l) => /error/i.test(l))
			.slice(0, 3)
			.join(" | ");
		throw new Error(`pine could not build its helper for ${what} (${said.slice(0, 400) || (e instanceof Error ? e.message.slice(0, 200) : "the compiler gave no reason")}). Tell your owner.`);
	}
	for (const old of fs.readdirSync(folder)) if (old.startsWith(`${prefix}-`) && old !== name && !old.includes(".tmp")) fs.rmSync(path.join(folder, old), { force: true });
	return file;
}
