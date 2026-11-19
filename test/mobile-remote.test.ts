// The mobile app's native plugin (mobile/core) runs the same command on the other machine as the
// Pine app on a Mac: it reads it from a file of its own, which has to be what src/remote.ts builds.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { remoteCommand } from "../src/remote.ts";

const file = path.join(import.meta.dirname, "..", "mobile", "core", "src", "main", "resources", "pine", "mobile", "core", "remote-command.txt");

test("mobile: the plugin's remote command is the one src/remote.ts builds", () => {
	assert.equal(fs.readFileSync(file, "utf8"), remoteCommand(), `write the output of remoteCommand() into ${path.relative(process.cwd(), file)}, without a line break at the end`);
});
