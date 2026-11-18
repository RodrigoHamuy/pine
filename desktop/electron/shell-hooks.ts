// How the terminal knows when a command has ended, and how: hooks in the owner's shell that print
// a mark the screen does not show (OSC 133, as other terminals use it). `C` when a command starts,
// `D;<exit code>` when it has ended, `A` when the shell shows its prompt and waits.
//
// The shell reads the owner's own startup files first, as it would in Terminal.app, and then the
// hooks. For zsh, ZDOTDIR points at a folder of the app's whose files read the owner's (from where
// ZDOTDIR pointed before, else the home folder) and put ZDOTDIR back at the end. For bash, the
// app's file is the startup file (--rcfile) and reads the owner's login files itself. Any other
// shell runs as it is, without marks: what runs there is not reported.
import fs from "node:fs";
import path from "node:path";

/** Read an owner's file of the same name, with ZDOTDIR as it was for them, then the app's again. */
const zshSource = (name: string) => `__pine_zdotdir="$ZDOTDIR"
ZDOTDIR="$PINE_USER_ZDOTDIR"
if [ -z "$PINE_PLAIN" ] && [ -f "$ZDOTDIR/${name}" ]; then . "$ZDOTDIR/${name}"; fi
PINE_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$__pine_zdotdir"
`;

const ZSH: Record<string, string> = {
	".zshenv": zshSource(".zshenv"),
	".zprofile": zshSource(".zprofile"),
	// The system's zshrc (read before this one) put the history where ZDOTDIR pointed: the app's folder. It belongs to the owner.
	".zshrc": `if [ "$HISTFILE" = "$ZDOTDIR/.zsh_history" ]; then HISTFILE="$PINE_USER_ZDOTDIR/.zsh_history"; fi
${zshSource(".zshrc")}
__pine_ran=
__pine_preexec() { __pine_ran=1; printf '\\033]133;C\\007'; }
__pine_precmd() {
	local c=$?
	if [ -n "$__pine_ran" ]; then printf '\\033]133;D;%s\\007' "$c"; fi
	__pine_ran=
	printf '\\033]133;A\\007'
}
# First, so that the exit code is the command's and not another hook's.
precmd_functions=(__pine_precmd $precmd_functions)
preexec_functions+=(__pine_preexec)
`,
	".zlogin": `${zshSource(".zlogin")}
if [ -n "$PINE_ZDOTDIR_WAS" ]; then ZDOTDIR="$PINE_USER_ZDOTDIR"; else unset ZDOTDIR; fi
unset PINE_USER_ZDOTDIR PINE_ZDOTDIR_WAS PINE_PLAIN __pine_zdotdir
`,
};

const BASH = `# As a login shell would: the system's profile and the first of the owner's login files.
if [ -z "$PINE_PLAIN" ]; then
	[ -f /etc/profile ] && . /etc/profile
	for __pine_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
		if [ -f "$__pine_f" ]; then . "$__pine_f"; break; fi
	done
	unset __pine_f
fi
unset PINE_PLAIN
__pine_ran=
__pine_at_prompt=
__pine_prompt() {
	if [ -n "$__pine_ran" ]; then printf '\\033]133;D;%s\\007' "$__pine_status"; fi
	__pine_ran=
	__pine_at_prompt=1
	printf '\\033]133;A\\007'
}
# The first command read after a prompt has started. (Without preexec in bash, the DEBUG trap stands in.)
__pine_debug() {
	[ -n "$__pine_at_prompt" ] || return 0
	[ -n "$COMP_LINE" ] && return 0
	__pine_at_prompt=
	__pine_ran=1
	printf '\\033]133;C\\007'
}
trap '__pine_debug' DEBUG
# The exit code is taken first, before the owner's own prompt commands run.
PROMPT_COMMAND="__pine_status=\\$?; \${PROMPT_COMMAND:+\$PROMPT_COMMAND; }__pine_prompt"
`;

export interface Launch {
	file: string;
	args: string[];
	env: Record<string, string>;
	/** Whether the shell reports when a command has ended. */
	marks: boolean;
}

/**
 * The shell as it is started: with the hooks where it is zsh or bash. `plain` leaves the owner's
 * startup files out (tests, which must not load the developer's profile).
 */
export function withHooks(file: string, args: string[], env: Record<string, string>, dir: string, plain = false): Launch {
	const name = path.basename(file);
	const extra: Record<string, string> = plain ? { PINE_PLAIN: "1" } : {};
	try {
		if (name === "zsh") {
			const zdot = path.join(dir, "zsh");
			fs.mkdirSync(zdot, { recursive: true });
			for (const [f, text] of Object.entries(ZSH)) fs.writeFileSync(path.join(zdot, f), text);
			const was = env.ZDOTDIR;
			return { file, args, env: { ...env, ...extra, PINE_USER_ZDOTDIR: was || env.HOME || "", ...(was ? { PINE_ZDOTDIR_WAS: "1" } : {}), ZDOTDIR: zdot }, marks: true };
		}
		if (name === "bash") {
			fs.mkdirSync(dir, { recursive: true });
			const rc = path.join(dir, "pine.bash");
			fs.writeFileSync(rc, BASH);
			// --rcfile is read by an interactive shell that is not a login shell; the file does what a login would.
			return { file, args: [...args.filter((a) => a !== "-l" && a !== "--login"), "--rcfile", rc, "-i"], env: { ...env, ...extra }, marks: true };
		}
	} catch {
		// a folder that cannot be written: the shell runs without marks
	}
	return { file, args, env, marks: false };
}

/** A mark in what a shell printed. */
export interface Mark {
	kind: "A" | "C" | "D";
	code?: number;
}

const MARK = /\x1b\]133;([ACD])(?:;([^\x07\x1b]*))?(?:\x07|\x1b\\)/g;

/**
 * Cuts what a shell prints into text and marks, in order. A mark can be cut in two by the way
 * output arrives: the start of one that has not ended yet is kept for the next piece.
 */
export class MarkReader {
	private carry = "";
	read(data: string): Array<string | Mark> {
		let text = this.carry + data;
		this.carry = "";
		// An unfinished mark at the end (never more than a few bytes) waits for the rest.
		const open = text.endsWith("\x1b") ? text.length - 1 : text.lastIndexOf("\x1b]");
		if (open >= 0 && text.length - open < 64 && !/\x07|\x1b\\/.test(text.slice(open + 1))) {
			this.carry = text.slice(open);
			text = text.slice(0, open);
		}
		const out: Array<string | Mark> = [];
		let at = 0;
		for (const m of text.matchAll(MARK)) {
			if (m.index! > at) out.push(text.slice(at, m.index));
			const code = m[2] !== undefined && /^\d{1,3}$/.test(m[2]) ? Number(m[2]) : undefined;
			out.push({ kind: m[1] as Mark["kind"], code });
			at = m.index! + m[0].length;
		}
		if (at < text.length) out.push(text.slice(at));
		return out;
	}
}
