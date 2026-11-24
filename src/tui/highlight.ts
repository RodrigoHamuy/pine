import { createRequire } from "node:module";

// Colors for code in an answer. highlight.js knows the languages and says what each piece of a
// text is (a keyword, a string, a removed line of a diff); here that becomes one of the terminal's
// own sixteen colors, so code follows the terminal's palette like the rest of the UI.

/** What highlight.js calls a piece of code -> the color it gets (an SGR foreground code). */
const COLOR: Record<string, string> = {
	keyword: "35", literal: "35", "selector-tag": "35", "meta-keyword": "35", doctag: "35",
	built_in: "36", type: "36", "builtin-name": "36", attr: "36", attribute: "36", variable: "36", "template-variable": "36", "selector-class": "36", "selector-id": "36", "selector-attr": "36", "selector-pseudo": "36",
	string: "32", regexp: "32", "meta-string": "32", addition: "32",
	number: "33", symbol: "33", bullet: "33", link: "33",
	title: "34", section: "34", name: "34",
	comment: "90", meta: "90", quote: "90",
	deletion: "31",
};

/** Names a code block may carry that highlight.js knows under another name. */
const ALIAS: Record<string, string> = { tsx: "typescript", mts: "typescript", cts: "typescript", jsx: "javascript", mjs: "javascript", cjs: "javascript", jsonc: "json", json5: "json", jsonl: "json", vue: "xml", svelte: "xml", mdx: "markdown", fish: "bash", shellscript: "bash", terminal: "shell", "objective-c": "objectivec", "c++": "cpp", "c#": "csharp", tf: "ini", hcl: "ini", env: "ini", dotenv: "ini" };

const ENTITY: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

let lib: any;
function hljs(): any {
	if (lib === undefined) {
		try {
			lib = createRequire(import.meta.url)("highlight.js");
		} catch {
			lib = null;
		}
	}
	return lib;
}

/** highlight.js's answer (text with <span class="hljs-..."> around the pieces) as colored lines. */
function toLines(html: string): string[] {
	const lines: string[] = [];
	const open: Array<string | undefined> = [];
	const color = () => open.findLast((x) => x !== undefined);
	let line = "";
	for (const m of html.matchAll(/<span class="([^"]*)">|<\/span>|&(?:amp|lt|gt|quot|#x27|#39);|\n|[^<&\n]+|[<&]/g)) {
		const piece = m[0];
		if (m[1] !== undefined) {
			const now = m[1].split(/\s+/).map((name) => COLOR[name.replace(/^hljs-/, "")]).find(Boolean);
			open.push(now);
			if (now) line += `\x1b[${now}m`;
		} else if (piece === "</span>") {
			const was = open.pop();
			if (was) line += `\x1b[${color() ?? "39"}m`;
		} else if (piece === "\n") {
			// A color that runs over the end of a line (a long comment, a string) ends with the line and starts again on the next.
			lines.push(color() ? `${line}\x1b[39m` : line);
			line = color() ? `\x1b[${color()}m` : "";
		} else line += ENTITY[piece] ?? piece;
	}
	lines.push(color() ? `${line}\x1b[39m` : line);
	return lines;
}

/** The language highlight.js knows for the word after a code block's opening fence, if any. */
export function languageOf(lang: string | undefined): string | undefined {
	const word = (lang ?? "").trim().split(/[\s,{:]/)[0].toLowerCase().replace(/^\./, "");
	if (!word) return undefined;
	const name = ALIAS[word] ?? word;
	return hljs()?.getLanguage(name) ? name : undefined;
}

/**
 * A code block as lines, colored when its language is known. A block without a language, or in
 * one highlight.js does not know, comes back as it is: guessing the language colors plain text
 * at random.
 */
export function highlightCode(code: string, lang?: string): string[] {
	const plain = () => code.split("\n");
	if (process.env.NO_COLOR || code.length > 200_000) return plain();
	const language = languageOf(lang);
	if (!language) return plain();
	try {
		return toLines(hljs().highlight(code, { language, ignoreIllegals: true }).value);
	} catch {
		return plain();
	}
}
