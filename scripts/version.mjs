// The version a release gets, worked out from the commits since the last one (semantic versioning).

const parse = (v) => v.split("-")[0].split(".").map(Number);

/** Whether version a is higher than version b. */
export function ahead(a, b) {
	const [x, y] = [parse(a), parse(b)];
	for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
	return false;
}

/**
 * What a set of commit messages calls for:
 *   "BREAKING CHANGE" anywhere, or "!" before the colon of a subject ("feat!: ...")   major
 *   a subject that starts with "feat:" or "feat(scope):"                             minor
 *   anything else                                                                    patch
 */
export function bumpOf(messages) {
	if (/BREAKING CHANGE|^[a-z]+(\([^)]*\))?!:/m.test(messages)) return "major";
	if (/^feat(\([^)]*\))?:/m.test(messages)) return "minor";
	return "patch";
}

/**
 * The version a push to the `next` branch gets: what the next release would be called, with
 * "-next.N" behind it. N counts up from what npm already has for that release, so every push is
 * a version of its own, and they start again at 1 once the release they led up to is out.
 */
export function previewOf(release, versions, channel = "next") {
	const taken = versions.map((v) => (v.startsWith(`${release}-${channel}.`) ? Number(v.slice(release.length + channel.length + 2)) : 0)).filter((n) => Number.isInteger(n) && n > 0);
	return `${release}-${channel}.${Math.max(0, ...taken) + 1}`;
}

/**
 * The next version. `published` is what npm has now (undefined before the first release), `inFile`
 * the version in package.json, `kind` what the commits call for. Below 1.0.0 a breaking change
 * raises the minor number, as semver allows. The version in package.json is used as it is for
 * the first release and whenever it is ahead: that is how a particular version is chosen by hand.
 */
export function nextVersion(published, inFile, kind) {
	if (!published) return { version: inFile, why: "the first release: the version in package.json" };
	let [major, minor, patch] = parse(published);
	if (kind === "major" && major > 0) [major, minor, patch] = [major + 1, 0, 0];
	else if (kind === "major" || kind === "minor") [minor, patch] = [minor + 1, 0];
	else patch++;
	const version = `${major}.${minor}.${patch}`;
	if (ahead(inFile, version)) return { version: inFile, why: "package.json is ahead of what the commits call for" };
	return { version, why: `${kind} over ${published}` };
}
