// The page's reading of a pairing link (desktop/src/machines.ts `readPairLink`, which the mobile
// bridge checks before the plugin is asked) replays the cases both native cores replay, so that the
// page never offers a link the core refuses, nor names a service the core does not use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { otherService, readPairLink } from "../../desktop/src/machines.ts";

const file = JSON.parse(readFileSync(new URL("../cases/pair-links.json", import.meta.url), "utf8")) as {
	cases: Array<{ name: string; input: string | null; expect: null | { service: string; host: string; official: boolean; id: string; code: string } }>;
};

for (const c of file.cases) {
	test(`pair-links: ${c.name}`, () => {
		const read = c.input === null ? undefined : readPairLink(c.input);
		if (c.expect === null) return assert.equal(read, undefined);
		assert.ok(read, "read");
		const other = otherService(read);
		assert.deepEqual({ service: read.service, host: other ?? new URL(read.service).host, official: other === undefined, id: read.id, code: read.code }, c.expect);
	});
}
