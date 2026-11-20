// Views: scripts of the owner's in <home>/views that draw pine in the panel of the Pine app (`office.ts`
// is the view "office"). `ui.view` in pine.json says which one the panel shows; the first there is when
// it names none, and none at all when it says "off" or the folder holds no view: then the app shows no
// button for the panel. A home gets each of pine's own views once (`seedOwn`): all of them the first time
// pine starts without the folder (and from `pine init`, which copies examples/home), and one that pine
// comes with later at the next start. Apart from that the folder is the owner's.
//
// The daemon never runs a view. It reads the file, takes its TypeScript types away (Node's own
// `stripTypeScriptTypes`, which changes text and executes nothing) and hands the text to the app, which
// runs it in a frame of its own: sandboxed, without the app's bridge, without the network, told only
// the shape of pine (src/view-kit.ts). The folder lies in pine's home, which no agent writes.
//
// What a view imports, "pine/view", is src/view-kit.ts. pine keeps a copy of it in the folder
// (views/.pine/view.ts) and a tsconfig.json that points the owner's editor at it.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { stripTypeScriptTypes } from "node:module";
import { PINE_ROOT } from "./config.ts";

/** A view's name is its file's name: lowercase letters, digits, ".", "-" and "_". */
export const VIEW_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
/** Larger than any view should be: a file this size is something else. */
const MAX_BYTES = 1_000_000;

export const viewsDir = (home: string) => path.join(home, "views");
const bundled = () => path.join(PINE_ROOT, "examples", "home", "views");
/** The module views import, as it ships: the TypeScript itself, in the checkout and in the package. */
const KIT = () => path.join(PINE_ROOT, "src", "view-kit.ts");
/** How to write a view, in the folder itself: what a coding agent opened there reads first. */
const GUIDE = "AGENTS.md";

const TSCONFIG = `{
	// For your editor: views import "pine/view", which pine keeps in .pine/view.ts.
	"compilerOptions": {
		"target": "ES2023",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"lib": ["ES2023", "DOM"],
		"strict": true,
		"noEmit": true,
		"allowImportingTsExtensions": true,
		"verbatimModuleSyntax": true,
		"paths": { "pine/view": ["./.pine/view.ts"] }
	},
	"include": ["*.ts", ".pine/view.ts"]
}
`;

/**
 * The guide to writing a view, AGENTS.md in the views folder. It is put there when there is none, and again
 * when what it describes has changed: pine's own guide, or the module views import. In between it is the
 * owner's: a file of theirs that was there before pine's, or a change they made to pine's, is left alone.
 * When the guide is written anew over such a file, theirs is kept beside it as AGENTS.before.md.
 * `.pine/guide.json` says which guide pine last had (`for`) and the text it last wrote (`wrote`), as hashes.
 * No agent of pine's reads the guide.
 */
function seedGuide(dir: string, kit: string): void {
	const from = path.join(bundled(), GUIDE);
	if (!fs.existsSync(from)) return;
	const now = fs.readFileSync(from, "utf8");
	const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
	const version = hash(`${now}\n${kit}`);
	const file = path.join(dir, GUIDE);
	const stampFile = path.join(dir, ".pine", "guide.json");
	let stamp: { for?: string; wrote?: string } = {};
	try {
		stamp = JSON.parse(fs.readFileSync(stampFile, "utf8"));
	} catch {}
	const there = fs.existsSync(file) && fs.lstatSync(file).isFile() ? fs.readFileSync(file, "utf8") : undefined;
	const put = () => {
		fs.rmSync(file, { force: true });
		fs.writeFileSync(file, now, { mode: 0o600 });
		stamp.wrote = hash(now);
	};
	if (there === undefined) put();
	// The owner's own file, there before pine ever wrote one: it is left alone until the guide changes.
	else if (stamp.for !== undefined && stamp.for !== version && there !== now) {
		if (hash(there) !== stamp.wrote) fs.writeFileSync(path.join(dir, "AGENTS.before.md"), there, { mode: 0o600 });
		put();
	}
	if (stamp.for !== version || !fs.existsSync(stampFile)) {
		stamp.for = version;
		fs.writeFileSync(stampFile, `${JSON.stringify(stamp)}\n`, { mode: 0o600 });
	}
}

/**
 * pine's own views, each given to a home once. `.pine/seeded.json` lists the files this home was given. A
 * view pine comes with that is not on the list is copied in and put on it; one the owner took out is on the
 * list and stays out, and a file of the owner's with the same name is never written over. A folder from
 * before the list was kept was given `office`, the one view pine had then.
 */
function seedOwn(dir: string, fresh: boolean): void {
	const file = path.join(dir, ".pine", "seeded.json");
	let given: string[] | undefined;
	try {
		const v: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		if (Array.isArray(v) && v.every((x) => typeof x === "string")) given = v;
	} catch {}
	const had = given !== undefined;
	given ??= fresh ? [] : ["office.ts"];
	const own = fs.existsSync(bundled()) ? fs.readdirSync(bundled()).filter((n) => /\.(ts|js)$/.test(n)).sort() : [];
	const add = own.filter((n) => !given.includes(n));
	for (const name of add) {
		try {
			// Refuses when anything has that name already, a link included.
			fs.copyFileSync(path.join(bundled(), name), path.join(dir, name), fs.constants.COPYFILE_EXCL);
			fs.chmodSync(path.join(dir, name), 0o600);
		} catch {}
	}
	if (add.length || !had) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, `${JSON.stringify([...given, ...add])}\n`, { mode: 0o600 });
	}
}

export type ViewEntry = { id: string; file: string } | { id: string; file: string; problem: string };

/**
 * The first start of a home without a views folder: pine's own views go into it. At every start, a view
 * pine has that this home was never given is added (`seedOwn`), the
 * module views import is brought up to date in .pine/, a tsconfig.json is put there if none is, and the
 * guide to writing a view (AGENTS.md, for the owner or a coding agent opened in the folder) if there is
 * none or what it describes has changed (`seedGuide`).
 */
export function seedViews(home: string): void {
	const dir = viewsDir(home);
	const fresh = !fs.existsSync(dir);
	if (fresh) fs.mkdirSync(dir, { recursive: true });
	seedOwn(dir, fresh);
	const kit = path.join(dir, ".pine", "view.ts");
	const text = fs.readFileSync(KIT(), "utf8");
	if (!fs.existsSync(kit) || fs.readFileSync(kit, "utf8") !== text) {
		fs.mkdirSync(path.dirname(kit), { recursive: true });
		fs.writeFileSync(kit, text, { mode: 0o600 });
	}
	const tsconfig = path.join(dir, "tsconfig.json");
	if (!fs.existsSync(tsconfig)) fs.writeFileSync(tsconfig, TSCONFIG, { mode: 0o600 });
	seedGuide(dir, text);
}

/** Every view in the home's folder, by name: a file pine cannot hand on is listed with what is wrong with it. */
export function listViews(home: string): ViewEntry[] {
	const dir = viewsDir(home);
	const out: ViewEntry[] = [];
	for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
		const m = /^(.+)\.(ts|js)$/.exec(name);
		if (!m || name.startsWith(".") || name.endsWith(".d.ts")) continue;
		const id = m[1];
		const file = path.join(dir, name);
		if (!VIEW_ID.test(id)) {
			out.push({ id, file, problem: 'a view\'s file name is lowercase letters, digits, ".", "-" and "_", ending in .ts or .js' });
			continue;
		}
		try {
			const stat = fs.lstatSync(file);
			if (!stat.isFile()) out.push({ id, file, problem: "not a file" });
			else if (stat.size > MAX_BYTES) out.push({ id, file, problem: "too large for a view" });
			else out.push({ id, file });
		} catch (e) {
			out.push({ id, file, problem: (e as Error).message });
		}
	}
	// One name, one view: a .ts before a .js of the same name.
	return out.filter((v, i) => out.findIndex((w) => w.id === v.id) === i);
}

/** The view the panel shows: the one pine.json names, the first there is when it names none, none for "off". */
export function viewInForce(chosen: string | undefined, list: ViewEntry[]): string | undefined {
	if (chosen === "off") return undefined;
	const usable = list.filter((v) => !("problem" in v));
	return (usable.find((v) => v.id === chosen) ?? usable[0])?.id;
}

/** A view's code as the app runs it: JavaScript, its types taken away. Only a view the folder lists. */
export function viewCode(home: string, id: string): { id: string; code: string } | { id: string; problem: string } {
	const v = listViews(home).find((x) => x.id === id);
	if (!v) return { id, problem: `there is no view "${id}" in ${viewsDir(home)}` };
	if ("problem" in v) return { id, problem: v.problem };
	const text = fs.readFileSync(v.file, "utf8");
	if (!v.file.endsWith(".ts")) return { id, code: text };
	try {
		return { id, code: stripTypeScriptTypes(text, { mode: "strip" }) };
	} catch (e) {
		return { id, problem: `its TypeScript cannot be read: ${(e as Error).message.split("\n")[0]}. A view uses types that can be erased: no enum, no namespace, no parameter properties` };
	}
}
