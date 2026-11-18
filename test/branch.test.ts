import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { sandboxAvailable } from "../src/security.ts";
import { Client } from "../src/tui/client.ts";
import { harness, type Harness, MCP_STUB, mockMsg } from "./support/harness.ts";

const call = (name: string, args: any) => ({ name, args });
/** What the owner wrote in a conversation, oldest first, as a UI would list it. */
const said = (h: Harness, session: string) => h.pine.tasks.list({ agent: "main", session }).filter((t) => t.kind === "prompt").reverse().map((t) => t.prompt.replace(/<<MOCK[\s\S]*?>>/, "").trim());
const idOf = (h: Harness, session: string, start: string) => h.pine.tasks.list({ agent: "main", session }).find((t) => t.prompt.startsWith(start))!.id;
/** What the model was sent as the conversation, in the last request. */
const context = (h: Harness) => JSON.stringify(h.mock.state.requests.at(-1).body.messages.filter((m: any) => m.role !== "system"));

test("branch: a new conversation goes on from a message with what was said up to it, and the original stays as it was", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const say = (session: string, text: string, answer: string) => h.pine.agents.run({ agent: "main", session, trust: "owner", prompt: `${text} ${mockMsg([{ text: answer }])}` });
	await say("s", "ALPHA question", "ALPHA-ANSWER");
	await say("s", "BETA question", "BETA-ANSWER");
	await say("s", "GAMMA question", "GAMMA-ANSWER");

	const r = await h.pine.agents.branchSession("main", "s", idOf(h, "s", "ALPHA"));
	assert.deepEqual([r.session, r.tasks, r.outside], ["s-branch", 1, undefined]);
	assert.deepEqual(said(h, "s-branch"), ["ALPHA question"]);
	assert.deepEqual(said(h, "s"), ["ALPHA question", "BETA question", "GAMMA question"], "the original keeps all of it");
	// The copy shows its work as the original did, and the conversation list says where it came from.
	const copy = h.pine.tasks.list({ agent: "main", session: "s-branch" })[0];
	assert.equal(copy.result, "ALPHA-ANSWER");
	assert.ok(h.pine.agents.transcript(copy.id)!.entries.some((e) => e.text?.includes("ALPHA-ANSWER")));
	assert.deepEqual(h.pine.agents.conversations("main").find((c) => c.session === "s-branch")?.branch, { from: "s", at: idOf(h, "s", "ALPHA") });

	// The model is told the branch's history: the message it was made from, nothing that came after.
	await say("s-branch", "DELTA question", "DELTA-ANSWER");
	assert.match(context(h), /ALPHA-ANSWER/);
	assert.doesNotMatch(context(h), /BETA|GAMMA/);
	await say("s", "EPSILON question", "EPSILON-ANSWER");
	assert.match(context(h), /GAMMA-ANSWER/);
	assert.doesNotMatch(context(h), /DELTA/, "what is said in the branch is not the original's");

	// Without a message: all of it. A second branch gets a name of its own; a name that is taken is refused.
	const all = await h.pine.agents.branchSession("main", "s");
	assert.deepEqual([all.session, all.tasks], ["s-branch-2", 4]);
	assert.equal((await h.pine.agents.branchSession("main", "s", undefined, "Other idea")).session, "Other_idea");
	await assert.rejects(h.pine.agents.branchSession("main", "s", undefined, "s-branch"), /already has a conversation called s-branch/);
	await assert.rejects(h.pine.agents.branchSession("main", "s", 999_999), /not one of yours/);
	await assert.rejects(h.pine.agents.branchSession("main", "nothing"), /nothing to branch/);

	// Renaming the original keeps the link; removing it leaves the branch whole, as a conversation like any other.
	await h.pine.agents.renameSession("main", "s", "renamed");
	assert.equal(h.pine.agents.conversations("main").find((c) => c.session === "s-branch")?.branch?.from, "renamed");
	await h.pine.agents.removeSession("main", "renamed");
	assert.deepEqual(said(h, "s-branch"), ["ALPHA question", "DELTA question"]);
	assert.equal(h.pine.agents.conversations("main").find((c) => c.session === "s-branch")?.branch, undefined);
	await say("s-branch", "ZETA question", "ZETA-ANSWER");
	assert.match(context(h), /ALPHA-ANSWER[\s\S]*DELTA-ANSWER/);

	// No tool for it, and the API wants the owner's token.
	assert.ok(!h.toolsOffered(h.mock.state.requests.at(-1)).some((n: string) => /branch/.test(n)));
	const url = `http://127.0.0.1:${h.pine.http!.port}`;
	assert.equal((await fetch(`${url}/agents/main/branch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: "s-branch" }) })).status, 401);
	assert.equal((await new Client(url, h.pine.token).branch("main", "s-branch", undefined, "via api")).session, "via_api");
	await h.close();
});

test("branch: it holds outside content when the conversation did at that point, and nothing the owner allowed comes along", { skip: !sandboxAvailable() }, async (t) => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.homedir(), ".pine-test-branch-")));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.writeFileSync(path.join(dir, "notes.txt"), "NOTES-1\n");
	const feed = { command: process.execPath, args: [MCP_STUB], env: { MCP_LABEL: "feed" }, taints: true };
	const h = await harness({ agents: { main: { agent: { mcp: { feed } } } } });
	h.pine.bus.subscribe("approval/requested", (e) => void h.pine.approvals.decide((e.payload as any).id, true, "test", true));
	const say = (session: string, text: string, steps: any[]) => h.pine.agents.run({ agent: "main", session, trust: "owner", prompt: `${text} ${mockMsg(steps)}` });
	const look = [{ tools: [call("read", { path: path.join(dir, "notes.txt") })] }];

	await say("s", "CLEAN first", [{ text: "ok" }]);
	await say("s", "READS outside", [{ tools: [call("mcp__feed__echo", { text: "from outside" }), call("request_access", { path: dir, reason: "the notes" })] }, ...look]);
	assert.ok(h.toolResults().at(-1)!.includes("NOTES-1"), h.toolResults().join("\n"));
	await say("s", "LATER", [{ text: "ok" }]);
	assert.ok(h.pine.agents.outsideMark("main", "s"));

	// From before the outside content: clean. From it or after it: marked, before a word is said in the branch.
	const before = await h.pine.agents.branchSession("main", "s", idOf(h, "s", "CLEAN"));
	assert.equal(before.outside, undefined);
	assert.equal(h.pine.agents.outsideMark("main", before.session), undefined);
	for (const at of [idOf(h, "s", "READS"), undefined]) {
		const b = await h.pine.agents.branchSession("main", "s", at);
		assert.ok(b.outside, `branch ${b.session} is marked`);
		assert.equal(h.pine.agents.outsideMark("main", b.session), b.outside);
		// What the owner allowed in the original stays there: the branch asks again.
		await say(b.session, "LOOK", look);
		assert.match(h.toolResults().at(-1)!, /outside the paths this agent may read/);
	}
	// A restart reads the mark from the store, not from memory.
	await h.restart();
	assert.ok(h.pine.agents.outsideMark("main", "s-branch-2"));
	await h.close();
});
