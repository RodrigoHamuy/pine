// What a code block of an answer may hold for its Run button to type it into the owner's
// terminal. An answer can repeat what a web page told the agent to write, so the block is run only
// as it is shown: a character that draws nothing or draws something else than it is (a control
// character, an escape sequence, a direction override, a joiner of no width) could make the shell
// run what the owner did not see. Such a block is refused, and the owner is told why; copying it
// stays possible.

/** The languages of a code block that is a command for a shell. */
export const SHELLS = new Set(["bash", "sh", "zsh", "shell", "shellscript", "fish", "ksh"]);

// C0 controls but tab and line feed, DEL and C1, the direction marks and overrides, joiners and
// spaces of no width, the separators of lines and paragraphs, the byte order mark, and the tag
// characters, which draw nothing.
const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF\uFFF9-\uFFFB]|\uDB40[\uDC00-\uDC7F]/;

/** The command a Run button types, or why it does not. A carriage return before a line feed (Windows' line end) is a line end. */
export function runnable(code: string): { ok: true; text: string } | { ok: false; why: string } {
	const text = code.replace(/\r\n/g, "\n").replace(/\n+$/, "");
	if (!text.trim()) return { ok: false, why: "The block is empty." };
	const at = HIDDEN.exec(text);
	if (at) {
		const point = at[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
		return { ok: false, why: `The block holds a character that does not show as itself (U+${point}), so it is not run. Copy it if you want it anyway.` };
	}
	return { ok: true, text };
}
