import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore: a plain script, without types
import { ahead, bumpOf, nextVersion, previewOf } from "../scripts/version.mjs";
// @ts-ignore: a plain script, without types
import { changesOf } from "../scripts/changes.mjs";

test("release: the next version follows from the commits since the last one", () => {
	// What the commit messages call for.
	assert.equal(bumpOf("Update README\n--\nFix the tab bar\n--"), "patch");
	assert.equal(bumpOf("fix: the tab bar\n--\nfeat: sources of your own\n--"), "minor");
	assert.equal(bumpOf("feat(tui): a conversation list\n--"), "minor");
	assert.equal(bumpOf("feat!: sources take options\n--"), "major");
	assert.equal(bumpOf("Rework the config\n\nBREAKING CHANGE: the old keys are gone\n--"), "major");
	assert.equal(bumpOf("a feature: nothing special\n--\ndefeat: no\n--"), "patch", "only a subject that starts with feat counts");

	// The first release takes the version in package.json.
	assert.deepEqual(nextVersion(undefined, "0.1.0", "patch").version, "0.1.0");
	// Afterwards every push raises it, by what the commits say.
	assert.equal(nextVersion("0.1.0", "0.1.0", "patch").version, "0.1.1");
	assert.equal(nextVersion("0.1.9", "0.1.0", "patch").version, "0.1.10");
	assert.equal(nextVersion("0.1.4", "0.1.0", "minor").version, "0.2.0");
	assert.equal(nextVersion("0.4.2", "0.1.0", "major").version, "0.5.0", "below 1.0.0 a breaking change raises the minor number");
	assert.equal(nextVersion("1.4.2", "0.1.0", "minor").version, "1.5.0");
	assert.equal(nextVersion("1.4.2", "0.1.0", "major").version, "2.0.0");
	// A version set by hand in package.json wins while it is ahead, and no longer once it is reached.
	assert.equal(nextVersion("0.3.7", "1.0.0", "patch").version, "1.0.0");
	assert.equal(nextVersion("1.0.0", "1.0.0", "patch").version, "1.0.1");
	assert.equal(ahead("0.10.0", "0.9.9"), true);
	assert.equal(ahead("1.0.0", "1.0.0"), false);
});

test("release: a push to next is a preview of the release it leads up to, with a number of its own", () => {
	// The first one for a release, then one more with every push.
	assert.equal(previewOf("0.4.0", ["0.3.0", "0.3.1"]), "0.4.0-next.1");
	assert.equal(previewOf("0.4.0", ["0.3.1", "0.4.0-next.1", "0.4.0-next.2"]), "0.4.0-next.3");
	assert.equal(previewOf("0.4.0", ["0.4.0-next.9", "0.4.0-next.10", "0.4.0-next.2"]), "0.4.0-next.11", "by number, not by how it sorts as text");
	// Previews of another release, or of another channel, do not count; nor does anything that is not a number.
	assert.equal(previewOf("0.4.1", ["0.4.0-next.7", "0.4.0", "0.4.10-next.3", "0.4.1-beta.5", "0.4.1-next.x", "0.4.1-next.2.1"]), "0.4.1-next.1");
	// What the release would be called is worked out as for main: from the last release and the commits since.
	assert.equal(previewOf(nextVersion("0.3.1", "0.1.0", bumpOf("feat: a list\n--")).version, ["0.3.1"]), "0.4.0-next.1");
});

test("release: the package says what each version changed, from the commits between its tags", () => {
	// What `git log --first-parent --format=%D%x09%s` prints: a release is tagged at the commit it was made from.
	const log = [
		"HEAD -> main\tfix: the tab bar keeps its place",
		"\tfeat: sources of your own",
		"tag: v0.3.0, origin/main\tfeat: a conversation list",
		"feat/list, tag: v0.2.1\tfix: a link is shown with its target",
		"\tUpdate README",
		"tag: v0.2.0\tfeat!: sources take options",
		"tag: nightly\tthe first commit",
		"",
	].join("\n");
	assert.deepEqual(changesOf(log, "0.4.0"), [
		{ version: "0.4.0", changes: ["fix: the tab bar keeps its place", "feat: sources of your own"] },
		{ version: "0.3.0", changes: ["feat: a conversation list"] },
		{ version: "0.2.1", changes: ["fix: a link is shown with its target", "Update README"] },
		{ version: "0.2.0", changes: ["feat!: sources take options", "the first commit"] },
	]);
	// A build of the commit that is already released adds no empty version, and only the newest ones travel.
	assert.deepEqual(changesOf("tag: v0.3.0\tfeat: a conversation list\n", "0.3.1"), [{ version: "0.3.0", changes: ["feat: a conversation list"] }]);
	assert.deepEqual(changesOf(log, "0.4.0", 2).map((x: any) => x.version), ["0.4.0", "0.3.0"]);
	assert.deepEqual(changesOf("", "0.4.0"), []);
});
