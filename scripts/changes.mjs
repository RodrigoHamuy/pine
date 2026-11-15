// What each release changed, for "pine update" to say afterwards: the subjects of its commits.
// A release is tagged at the commit it was made from (release.mjs), so the commits from one tag
// down to the next belong to that tag's version, and those above the newest tag to the version
// that is being built.

/**
 * `log` is what `git log --first-parent --format=%D%x09%s` prints, newest first; `version` the
 * one being built. Returns the newest `limit` versions, newest first, each with its commits'
 * subjects as they were written.
 */
export function changesOf(log, version, limit = 40) {
	const out = [];
	let at;
	// In the order of the history: a version is where its tag is, whatever its number.
	const open = (v) => void out.push((at = { version: v, changes: [] }));
	for (const line of log.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab < 0) continue;
		const tag = /(?:^|, )tag: v(\d+\.\d+\.\d+)(?=,|$)/.exec(line.slice(0, tab));
		if (tag) open(tag[1]);
		// Above the newest tag: what the version that is being built adds.
		else if (!at) open(version);
		const subject = line.slice(tab + 1).trim();
		if (subject) at.changes.push(subject);
	}
	return out.filter((x) => x.changes.length).slice(0, limit);
}
