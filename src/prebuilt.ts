// A helper of pine's own (voice.swift, computer.swift, system.swift) is built on the Mac it runs
// on, the first time it is needed, and that takes Apple's command line developer tools. The Pine
// app carries the helpers built, so that a Mac without those tools has them too.
//
// A built helper lies beside its source, in `prebuilt/`, under the name the build would give it.
// That name holds the hash of the source: a program there was made from this source, or it is not
// found and the helper is built as before. The folder is pine's own code, which no agent writes
// (rule 1 of AGENTS.md): whoever could put a program there could change the source beside it.
import fs from "node:fs";
import path from "node:path";

/** The program that was built from `source` and travels with pine, if this pine carries one. */
export function prebuilt(source: string, name: string): string | undefined {
	const file = path.join(path.dirname(source), "prebuilt", name);
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return file;
	} catch {
		return undefined;
	}
}
