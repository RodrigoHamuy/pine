// A development process ends with whatever started it. A preview or `npm run dev` started by an
// editor or an agent session is often run through npm, which goes on when its own parent dies: so
// every process above this one is noted at the start, and when any of them is gone (or this one
// was handed to launchd), `gone` is called. Without this a preview whose session had ended ran on
// for hours, with its daemon and its Electron.
import { execFileSync } from "node:child_process";

/** The processes above this one, nearest first, up to (not including) launchd. */
function ancestors() {
	// One look at the whole process table, not one `ps` per level.
	const parentOf = new Map();
	try {
		for (const line of execFileSync("/bin/ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).split("\n")) {
			const [pid, ppid] = line.trim().split(/\s+/).map(Number);
			if (pid) parentOf.set(pid, ppid);
		}
	} catch {
		// no ps: only the parent is watched
	}
	const found = [];
	let pid = process.ppid;
	while (pid > 1 && found.length < 32) {
		found.push(pid);
		pid = parentOf.get(pid) ?? 0;
	}
	return found;
}

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM: it is there, and somebody else's.
		return e?.code === "EPERM";
	}
};

/** Call `gone` once: when a process above this one ends, or on SIGHUP, SIGTERM or SIGINT. */
export function whenParentGone(gone) {
	let called = false;
	const once = () => {
		if (called) return;
		called = true;
		clearInterval(timer);
		gone();
	};
	const parent = process.ppid;
	// Already handed to launchd: whoever started this is gone, and nothing above is left to watch.
	if (parent <= 1) {
		setImmediate(once);
		return;
	}
	const above = process.platform === "win32" ? [parent] : ancestors();
	const timer = setInterval(() => {
		if (process.ppid !== parent || above.some((pid) => !alive(pid))) once();
	}, 1000);
	timer.unref();
	for (const signal of ["SIGHUP", "SIGTERM", "SIGINT"]) process.on(signal, once);
}
