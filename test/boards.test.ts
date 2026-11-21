import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { boardName, Boards } from "../src/boards.ts";
import { classify } from "../src/actions.ts";
import { harness, mockMsg, until } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any = {}) => ({ name, args });
const who = (agent: string, session = "main") => ({ agent, conversation: { agent, session } });

test("boards: a task is taken by one run at a time, waits for the tasks before it, and is open again when given back", () => {
	const boards = new Boards(new DatabaseSync(":memory:"));
	const b = boards.ensure("local", "main", "main", "");
	const post = (text: string, after?: number[]) => boards.post(b, { kind: "task", text, by: "main", trust: "owner", after });
	const first = post("one");
	const second = post("two", [first.id]);
	assert.equal(boards.ready(second), false, "it waits for the first");
	assert.match(String(boards.claim(b, { id: second.id, holder: "main", run: 7 })), /waits for #1/);

	const got = boards.claim(b, { holder: "main", run: 7 });
	assert.equal(typeof got === "object" && got.id, first.id);
	assert.match(String(boards.claim(b, { id: first.id, holder: "main", run: 8 })), /taken by main/);
	assert.match(String(boards.claim(b, { holder: "main", run: 8 })), /no task on this board is ready/);
	// Only the run that holds a task says what became of it.
	assert.throws(() => boards.settle(first.id, "done", "x", { run: 8 }), /not by you/);
	boards.settle(first.id, "done", "the result", { run: 7 });
	assert.equal(boards.item(first.id)!.result, "the result");
	assert.equal(boards.ready(boards.item(second.id)!), true, "the task before it is done");

	const again = boards.claim(b, { holder: "main", run: 9 });
	assert.equal(typeof again === "object" && again.id, second.id);
	assert.deepEqual(boards.heldBy(9).map((t) => t.id), [second.id]);
	boards.reopen(second.id, { run: 9 });
	assert.equal(boards.item(second.id)!.state, "open");
	assert.deepEqual(boards.counts(b.id), { open: 1, taken: 0, done: 1, failed: 0, blocked: 0, notes: 0 });

	// A note waits for nothing, is about a task of this board, and its fields are an object.
	assert.throws(() => boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", after: [first.id] }), /a note waits for nothing/);
	assert.throws(() => boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", about: 99 }), /no task #99/);
	assert.throws(() => boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", data: [1] }), /JSON object/);
	const note = boards.post(b, { kind: "note", text: "n", by: "main", trust: "owner", about: first.id, data: { file: "a.css" } });
	assert.deepEqual(note.data, { file: "a.css" });
	// A task that is removed takes its notes along, and nothing waits for it any more.
	boards.removeItem(first.id);
	assert.equal(boards.item(note.id), undefined);
	assert.deepEqual(boards.item(second.id)!.after, []);
	assert.equal(boardName("  #Bug Hunt/2 "), "bug-hunt-2");
	assert.throws(() => boardName("!!"), /a board's name/);
});

test("boards: whom a board is for decides who can use it", () => {
	const boards = new Boards(new DatabaseSync(":memory:"));
	const mine = boards.ensure("local", "main", "proj", "");
	const agents = boards.ensure("agent", "main", "", "notes");
	const all = boards.ensure("global", "", "", "bugs");
	assert.deepEqual(boards.visible(who("main", "proj")).map((b) => b.id), [mine.id, agents.id, all.id]);
	assert.deepEqual(boards.visible(who("main", "other")).map((b) => b.id), [agents.id, all.id]);
	assert.deepEqual(boards.visible(who("helper")).map((b) => b.id), [all.id]);
	// A task handed on: the other agent, on the board of the conversation that handed it on.
	assert.deepEqual(boards.visible({ agent: "helper", conversation: { agent: "main", session: "proj" } }).map((b) => b.id), [mine.id, all.id]);
	assert.equal(boards.resolve(who("main", "proj"), "notes")?.id, agents.id);
	assert.equal(boards.resolve(who("helper"), "notes"), undefined);
	// What goes with a conversation and with an agent.
	boards.post(all, { kind: "note", text: "by helper", by: "helper", trust: "owner" });
	boards.renameConversation("main", "proj", "project");
	assert.equal(boards.find("local", "main", "project", "")?.id, mine.id);
	boards.renameAgent("helper", "aide");
	assert.equal(boards.items(all.id)[0].by, "aide");
	boards.dropAgent("aide");
	assert.equal(boards.items(all.id).length, 0, "what a removed agent posted is gone");
	assert.equal(boards.dropConversation("main", "project"), 1);
	boards.dropAgent("main");
	assert.deepEqual(boards.list().map((b) => b.id), [all.id]);
});

test("boards: a conversation's own board is its list of work; a board with a name is something other conversations read", () => {
	const ctx: any = { sends: false };
	assert.equal(classify("board_read", {}, ctx).cls, "look");
	assert.equal(classify("boards", {}, ctx).cls, "look");
	assert.equal(classify("board_post", { text: "x" }, ctx).cls, "look");
	assert.equal(classify("board_post", { text: "x", board: "bugs" }, ctx).cls, "local");
	assert.equal(classify("board_claim", { board: "bugs" }, ctx).cls, "local");
	assert.equal(classify("board_done", { id: 1 }, ctx).cls, "look");
});

test("boards: a pool of sub-agents works through more tasks than run at once, and each sees what the others noted", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 3 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	h.mock.state.scripts.w1 = [{ tools: [call("board_post", { text: "FOUND-BY-ONE gap-3 next to gap-4" })] }, { text: "answer one" }];
	h.mock.state.scripts.w2 = [{ delayMs: 120, tools: [call("board_read")] }];
	for (const n of [3, 4, 5]) h.mock.state.scripts[`w${n}`] = [{ delayMs: 60, text: `answer ${n}` }];
	const seen: number[] = [];
	h.pine.bus.subscribe("pine/board", () => void seen.push(h.pine.agents.boards.counts(1).taken));

	const r = await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: [1, 2, 3, 4, 5].map((n) => `check part ${n} @@REF:w${n}@@`) })] }]), ...owner });
	assert.equal(r.status, "done");
	assert.match(r.text, /## Task #1: done\nanswer one/);
	for (const n of [3, 4, 5]) assert.match(r.text, new RegExp(`## Task #${n}: done\\nanswer ${n}`), r.text);
	// The second one read the board after the first had posted: it saw the note, and its answer is the task's result.
	assert.match(r.text, /## Task #2: done\nFINAL:: The board of this conversation: .*Tasks:.*#1 \[.*FOUND-BY-ONE/s);
	assert.match(r.text, /## Notes the sub-agents left on the board\n#6 note by main: FOUND-BY-ONE gap-3 next to gap-4/);
	assert.ok(Math.max(...seen) <= 2, `never more than two at once (${Math.max(...seen)})`);

	const boards = h.pine.agents.boards;
	const board = boards.find("local", "main", "audit", "")!;
	assert.deepEqual(boards.counts(board.id), { open: 0, taken: 0, done: 5, failed: 0, blocked: 0, notes: 1 });
	assert.equal(boards.item(1)!.result, "answer one");
	// Each sub-agent is told which task of the board is its own.
	const worker = h.mock.state.requests.find((q: any) => !JSON.stringify(q.body.messages).includes("<<MOCK") && JSON.stringify(q.body.messages).includes("[pine: this is task #3 of a board"));
	assert.ok(worker, "the sub-agent of the third task was told so");
	// And it is shown, at its start, what a sub-agent before it noted for all: it did not have to ask.
	assert.match(JSON.stringify(worker.body.messages), /check part 3 @@REF:w3@@\\n\\nWhat everyone on this job goes by \(it was checked: no need to look it up again\):\\n- FOUND-BY-ONE gap-3 next to gap-4/);
	// What a sub-agent is shown as new is what the others noted, not the list of everybody's tasks.
	assert.match(h.toolResults(h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("check part 1 @@REF:w1@@\\n\\n[pine")).at(-1)).join("\n"), /^Posted note #6 on the board of this conversation\.$/m);
	// Without "pool", more tasks than run at once are refused, and the refusal says how.
	const many = await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["a", "b", "c"] })] }]), ...owner });
	assert.match(many.text, /at most 2 sub-tasks per call\. For more, give "pool": true/);
	await h.close();
});

test("boards: a sub-agent that fails leaves its task failed, and a task the pool could not start stays open", async () => {
	const h = await harness({ agents: { main: { agent: { subagents: { maxParallel: 1 } } } } });
	h.mock.state.scripts.good = [{ text: "fine" }];
	h.mock.state.scripts.bad = [{ text: "never said" }];
	// One at a time, so the model's failure meets the sub-agent of the second task.
	h.pine.bus.subscribe("agent/main/started", (e: any) => {
		if (e.payload.kind === "subagent" && String(e.payload.prompt).includes("@@REF:bad@@")) h.mock.state.failNext.push({ status: 400, body: { error: { message: "bad request from mock" } } });
	});
	const board = h.pine.agents.boards.ensure("local", "main", "main", "");
	// A task the owner put there before, which waits for one that will fail.
	const r = await h.pine.agents.run({
		agent: "main",
		prompt: mockMsg([{ tools: [call("board_post", { kind: "task", text: "first @@REF:good@@" })] }, { tools: [call("board_post", { kind: "task", text: "second @@REF:bad@@" })] }, { tools: [call("board_post", { kind: "task", text: "third @@REF:good@@", after: [2] })] }, { tools: [call("subagent", { pool: true, tasks: [] })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	const tasks = h.pine.agents.boards.items(board.id, { kind: "task" });
	assert.deepEqual(tasks.map((t) => t.state), ["done", "failed", "open"]);
	assert.match(r.text, /## Not done\n#3 \[open, waits for #2\] third/);
	assert.equal(h.pine.agents.boards.heldBy(0).length, 0);
	await h.close();
});

test("boards: a task taken in a turn is open again when the turn ends without a word about it", async () => {
	const h = await harness({ agents: { main: {} } });
	const boards = h.pine.agents.boards;
	const board = boards.ensure("local", "main", "main", "");
	boards.post(board, { kind: "task", text: "look at the logs", by: "owner", trust: "owner" });
	boards.post(board, { kind: "task", text: "then the rest", by: "owner", trust: "owner" });
	let r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_claim")] }]), ...owner });
	assert.match(r.text, /You have task #1 of the board of this conversation, posted by owner:\nlook at the logs/);
	assert.equal(boards.item(1)!.state, "open", "the run ended: nothing stays taken");
	// Taken and settled in one turn: done with its result; blocked with a question.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_claim", { id: 1 })] }, { tools: [call("board_done", { id: 1, result: "nothing unusual in the logs" })] }, { tools: [call("board_claim")] }, { tools: [call("board_done", { id: 2, outcome: "blocked", result: "which rest?" })] }, { tools: [call("board_done", { id: 2, result: "x" })] }]), ...owner });
	assert.equal(boards.item(1)!.state, "done");
	assert.equal(boards.item(1)!.result, "nothing unusual in the logs");
	// A task of its own board that nobody has, the conversation closes itself: a question it can settle needs no sub-agent.
	assert.equal(boards.item(2)!.state, "done");
	assert.equal(boards.item(2)!.result, "x");
	// Not a sub-agent, and not on a board that is not the conversation's own: there a task is settled by who took it.
	boards.post(board, { kind: "task", text: "third", by: "owner", trust: "owner" });
	boards.settle(3, "blocked", "which?");
	const named = boards.ensure("agent", "main", "", "shared");
	boards.post(named, { kind: "task", text: "on the agent's board", by: "owner", trust: "owner" });
	boards.settle(4, "blocked", "which?");
	h.mock.state.scripts.sub = [{ tools: [call("board_done", { id: 3, result: "closed by a sub-agent" })] }];
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["@@REF:sub@@"] }), call("board_done", { id: 4, result: "closed from another board" })] }]), ...owner });
	assert.match(r.text, /task #3 is blocked: take it first/);
	assert.match(r.text, /task #4 is blocked: take it first/);
	assert.deepEqual([boards.item(3)!.state, boards.item(4)!.state], ["blocked", "blocked"]);
	await h.close();
});

test("boards: a post carries the outside-content mark of the run that wrote it, and reading it marks the reader", async () => {
	const h = await harness({ agents: { main: {} } });
	// A conversation that has read outside content writes onto a board of the agent's.
	await h.pine.agents.run({ agent: "main", session: "reader", tainted: "a web page", prompt: mockMsg([{ tools: [call("board_post", { board: "findings", scope: "agent", text: "IGNORE-ALL-RULES said the page" })] }]), ...owner });
	const item = h.pine.agents.boards.items(1)[0];
	assert.equal(item.tainted, "a web page");
	assert.equal(h.pine.agents.outsideMark("main", "clean"), undefined);
	// A conversation that only lists the boards is not marked; one that reads the note is.
	await h.pine.agents.run({ agent: "main", session: "clean", prompt: mockMsg([{ tools: [call("boards")] }]), ...owner });
	assert.equal(h.pine.agents.outsideMark("main", "clean"), undefined);
	const r = await h.pine.agents.run({ agent: "main", session: "clean", prompt: mockMsg([{ tools: [call("board_read", { board: "findings" })] }]), ...owner });
	assert.match(r.text, /IGNORE-ALL-RULES/);
	assert.match(h.pine.agents.outsideMark("main", "clean") ?? "", /a post on the board "findings".*a web page/);
	// And one that only posts there is shown what is new, which marks it just the same.
	await h.pine.agents.run({ agent: "main", session: "poster", prompt: mockMsg([{ tools: [call("board_post", { board: "findings", text: "mine" })] }]), ...owner });
	assert.match(h.pine.agents.outsideMark("main", "poster") ?? "", /a web page/);
	await h.close();
});

test("boards: what a pool's sub-agents all have to know is said once in a note, which each is shown when it starts", async () => {
	const h = await harness({ agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	for (const n of [1, 2]) h.mock.state.scripts[`w${n}`] = [{ text: `answer ${n}` }];
	h.mock.state.scripts.w3 = [{ tools: [call("board_post", { on: 3, text: "half way" })] }, { text: "answer 3" }];
	// A note makes the call a pool, said or not: three tasks where two run at once.
	const r = await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { note: "THE-REFERENCE is src/styles/tokens.css", tasks: [1, 2, 3].map((n) => `check part ${n} @@REF:w${n}@@`) })] }]), ...owner });
	assert.equal(r.status, "done");
	const boards = h.pine.agents.boards;
	const board = boards.find("local", "main", "audit", "")!;
	assert.deepEqual(boards.items(board.id).map((x) => `${x.id}:${x.kind}`), ["1:task", "2:task", "3:task", "4:note", "5:note"]);
	assert.deepEqual(boards.item(4)!.data, { tasks: [1, 2, 3] }, "the note names the tasks it came with");
	assert.equal(boards.counts(board.id).done, 3);
	for (const n of [1, 2, 3]) {
		const worker = h.mock.state.requests.find((q: any) => !JSON.stringify(q.body.messages).includes("<<MOCK") && JSON.stringify(q.body.messages).includes(`check part ${n} @@REF:w${n}@@`));
		assert.match(JSON.stringify(worker.body.messages), /What everyone on this job goes by \(it was checked: no need to look it up again\):\\n- THE-REFERENCE is src\/styles\/tokens\.css\\n\\n\[pine: this is task #/, `sub-agent ${n} was shown the note`);
	}
	// What a sub-agent was started with is no news to it at its first board call.
	const third = h.mock.state.requests.filter((q: any) => !JSON.stringify(q.body.messages).includes("<<MOCK") && JSON.stringify(q.body.messages).includes("check part 3 @@REF:w3@@")).at(-1);
	assert.deepEqual(h.toolResults(third), ["Posted note #5 on the board of this conversation."]);
	// The same call once more adds no second note of the same words.
	await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { note: "THE-REFERENCE is  src/styles/tokens.css", tasks: [] })] }]), ...owner });
	assert.equal(boards.items(board.id, { kind: "note" }).filter((x) => !x.about).length, 1);

	// A second round on the same board has a note of its own: its sub-agents are shown theirs and not the first round's.
	h.mock.state.scripts.c1 = [{ text: "checked" }];
	await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("subagent", { note: "ONLY-CHECK, change nothing", tasks: ["verify part 1 @@REF:c1@@"] })] }]), ...owner });
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => /verify part 1/.test(t.prompt) && t.kind === "subagent")!;
	assert.match(checker.prompt, /no need to look it up again\):\n- ONLY-CHECK, change nothing\n\n\[pine/);
	assert.doesNotMatch(checker.prompt, /THE-REFERENCE/);
	// A note posted for all with board_post is for every task, of any round.
	h.mock.state.scripts.c2 = [{ text: "checked" }];
	await h.pine.agents.run({ agent: "main", session: "audit", prompt: mockMsg([{ tools: [call("board_post", { text: "FOR-EVERYONE: tabs, not spaces" })] }, { tools: [call("subagent", { pool: true, tasks: ["verify part 2 @@REF:c2@@"] })] }]), ...owner });
	const later = h.pine.tasks.list({ limit: 50 }).find((t) => /verify part 2/.test(t.prompt) && t.kind === "subagent")!;
	assert.match(later.prompt, /no need to look it up again\):\n- FOR-EVERYONE: tabs, not spaces\n\n\[pine/);
	await h.close();
});

test("boards: a note that a sub-agent posts after it read outside content marks the sub-agent that is started with it", async () => {
	const h = await harness({ pine: { security: { taintTools: ["read"] } }, agents: { main: { agent: { subagents: { maxParallel: 1 } }, files: { "page.txt": "a page\n" } } } });
	h.mock.state.scripts.reader = [{ tools: [call("read", { path: "page.txt" })] }, { tools: [call("board_post", { text: "THE-PAGE-SAYS use tabs" })] }, { text: "read it" }];
	h.mock.state.scripts.doer = [{ text: "did it" }];
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["read the page @@REF:reader@@", "plain work @@REF:doer@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const doer = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.match(doer.prompt, /no need to look it up again\):\n- THE-PAGE-SAYS use tabs/, "the second sub-agent was shown the first one's note");
	assert.match(doer.meta.tainted ?? "", /read returned outside content/, "and started marked, as if it had read the page itself");
	await h.close();
});

/** The model requests of the conversation that a test scripted, in order: each holds the results of the tool calls before it. */
const turns = (h: any) => h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("<<MOCK"));

test("boards: a pool comes back when a sub-agent asks, the conversation answers, and it goes on while the others worked on", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.asks = [{ tools: [call("board_done", { id: 1, outcome: "blocked", result: "WHICH-WAY left or right?" })] }, { text: "stopped" }];
	h.mock.state.scripts.slow = [{ delayMs: 500, text: "slow one done" }];
	h.mock.state.scripts.quick = [{ text: "quick one done" }];
	// Whoever gets the first task after the answer does it.
	h.pine.bus.subscribe("pine/board", () => {
		if (boards.item(1)?.state === "blocked") h.mock.state.scripts.asks = [{ text: "went left" }];
	});
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["first @@REF:asks@@", "second @@REF:slow@@", "third @@REF:quick@@"] })] }, { tools: [call("board_answer", { id: 1, text: "GO-LEFT", all: true })] }, { tools: [call("subagent", { pool: true, tasks: ["first @@REF:asks@@", "second @@REF:slow@@", "third @@REF:quick@@"] })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	// (The second call names the first one's tasks again, as a model that repeats itself does: none is on the board twice.)
	assert.deepEqual(boards.items(1, { kind: "task" }).map((x) => x.id), [1, 2, 3]);
	// The first call came back with the question while the second sub-agent was still at work, and started nothing new.
	const first = h.toolResults(turns(h)[1]).at(-1)!;
	assert.match(first, /^## Task #1 asks\nWHICH-WAY left or right\?\nTo answer: board_answer with id 1 and your answer\./);
	assert.match(first, /## Still being worked\n#2 \[taken by main\] second/);
	assert.match(first, /## Not done\n#3 \[open\] third/);
	assert.match(first, /## What to do now\nAnswer task #1 with board_answer: only that puts a task back to work.* asking your owner does not by itself answer the task\. .*close it yourself with board_done \(id, result\)\.\nThen call subagent with "pool": true to go on/);
	assert.doesNotMatch(first, /slow one done|quick one done/);
	// The answer is for the task that asked, and with "all" for the one that has not started yet: it need not ask the same.
	assert.equal(h.toolResults(turns(h)[2]).at(-1)!, "Answered. Task #1 is open again, and whoever takes it is shown the question and your answer. The 2 other tasks that are not finished are shown it as well.");
	assert.deepEqual(boards.items(1, { kind: "note" }).map((x) => [x.id, x.about ?? null, x.data ?? null]), [[4, 1, { question: "WHICH-WAY left or right?" }], [5, null, { tasks: [2, 3], question: "WHICH-WAY left or right?" }]]);
	const third = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 3)!;
	assert.match(third.prompt, /third @@REF:quick@@\n\nQuestions that were asked on this job and are answered\. They are settled: go by the answers and do not ask them again\.\n- Asked: WHICH-WAY left or right\?\n  Answer: GO-LEFT\n\n\[pine/);
	assert.doesNotMatch(h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!.prompt, /GO-LEFT/, "the one that was at work already was started without it");
	// The second call took over the sub-agent that was still at work, gave the first task out again, and says each result once.
	const last = r.text.split(" || ").at(-1)!;
	assert.match(last, /## Task #1: done\nwent left\nNotes about it:\n- Asked: WHICH-WAY left or right\?\n  Answer: GO-LEFT/);
	assert.match(last, /## Task #2: done\nslow one done/);
	assert.match(last, /## Task #3: done\nquick one done/);
	assert.match(last, /All 3 tasks of the board are done\.$/);
	assert.doesNotMatch(last, /Task #1 asks|What to do now/);
	assert.equal(h.pine.tasks.list({ limit: 50 }).filter((t) => t.kind === "subagent").length, 4, "one sub-agent per task, and one more for the task that was asked about");
	// The one that did the first task in the end was shown the question and the answer.
	const again = h.pine.tasks.list({ limit: 50 }).filter((t) => t.meta.boardTask === 1).sort((x, y) => y.id - x.id)[0];
	assert.match(again.prompt, /first @@REF:asks@@\n\nQuestions that were asked on this job and are answered\. They are settled: go by the answers and do not ask them again\.\n- Asked: WHICH-WAY left or right\?\n  Answer: GO-LEFT\n\n\[pine: this is task #1/);
	assert.match(again.prompt, /What is answered above is given: use it\./);
	// A question is answered by whoever gave out the work, and only a question.
	h.mock.state.scripts.sub = [{ tools: [call("board_answer", { id: 1, text: "x" })] }];
	const other = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("board_answer", { id: 1, text: "x" }), call("subagent", { tasks: ["@@REF:sub@@"] })] }]), ...owner });
	assert.match(other.text, /task #1 is done, it waits for no answer/);
	assert.match(other.text, /You are a sub-agent: this is not yours to do/);
	await h.close();
});

test("boards: one answer does for every task that has the same question: those that asked are opened again, and one that asks a moment later is given out again without a turn of the conversation", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 5 } }, agents: { main: { agent: { subagents: { maxParallel: 3 } } } } });
	const boards = h.pine.agents.boards;
	// Three sub-agents need the same value: two ask at once, the third is still at work when the answer is given and asks then.
	h.mock.state.scripts.a = [{ tools: [call("board_done", { id: 1, outcome: "blocked", result: "WHAT-RATE for a?" })] }, { text: "stopped" }];
	h.mock.state.scripts.b = [{ tools: [call("board_done", { id: 2, outcome: "blocked", result: "WHAT-RATE for b?" })] }, { text: "stopped" }];
	h.mock.state.scripts.c = [{ delayMs: 500, tools: [call("board_done", { id: 3, outcome: "blocked", result: "WHAT-RATE for c?" })] }, { text: "stopped" }];
	const asked = new Set<number>();
	h.pine.bus.subscribe("pine/board", () => {
		// Whoever is given a task after it was asked about does it.
		for (const [id, name] of [[1, "a"], [2, "b"], [3, "c"]] as const) if (boards.item(id)?.state === "blocked" && !asked.has(id)) asked.add(id), (h.mock.state.scripts[name] = [{ text: `${name} done at RATE-100` }]);
	});
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		// (The action is written with its family's name in front, as a model sometimes writes it: it is carried out all the same.)
		prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["one @@REF:a@@", "two @@REF:b@@", "three @@REF:c@@"] })] }, { tools: [call("pine_board", { action: "pine_board.board_answer", id: 1, text: "RATE-100", all: true })] }, { tools: [call("subagent", { pool: true })] }]),
		...owner,
	});
	assert.equal(r.status, "done");
	const [first, answered, last] = [h.toolResults(turns(h)[1]).at(-1)!, h.toolResults(turns(h)[2]).at(-1)!, r.text.split(" || ").at(-1)!];
	assert.match(first, /## Task #1 asks\nWHAT-RATE for a\?/);
	assert.match(first, /## Task #2 asks\nWHAT-RATE for b\?/);
	assert.match(first, /## Still being worked\n#3 \[taken by main\]/);
	assert.equal(answered, "Answered. Task #1 is open again, and whoever takes it is shown the question and your answer. Task #2, which asked too, is open again with the same answer. The 1 other task that is not finished is shown it as well.");
	// Each task that asked has the answer beside its own question, and the one still at work is named in the note for all.
	assert.deepEqual(boards.items(1, { kind: "note" }).map((x) => [x.about ?? null, x.text, x.data]), [
		[1, "RATE-100", { question: "WHAT-RATE for a?" }],
		[2, "RATE-100", { question: "WHAT-RATE for b?" }],
		[null, "RATE-100", { tasks: [3], question: "WHAT-RATE for a?" }],
	]);
	// The second call finishes all three. The third asked after the answer was given: it was given out again by pine
	// itself, with the answer, and the conversation was never turned to for it.
	for (const name of ["a", "b", "c"]) assert.match(last, new RegExp(`${name} done at RATE-100`));
	assert.match(last, /All 3 tasks of the board are done\.$/);
	assert.doesNotMatch(last, /Task #3 asks/);
	assert.equal(turns(h).length, 4, "three calls and the final answer: no turn for the third question");
	const third = h.pine.tasks.list({ limit: 50 }).filter((t) => t.meta.boardTask === 3).sort((x, y) => y.id - x.id)[0];
	assert.match(third.prompt, /^three @@REF:c@@\n\nQuestions that were asked on this job and are answered\. They are settled: go by the answers and do not ask them again\.\n- Asked: WHAT-RATE for a\?\n  Answer: RATE-100\n\n\[pine/);
	assert.equal(h.pine.tasks.list({ limit: 50 }).filter((t) => t.kind === "subagent").length, 6, "each task was given out twice, and none a third time");
	await h.close();
});

test("boards: a conversation whose turn ended is told at its next pool call what its sub-agents finished meanwhile", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.asks = [{ tools: [call("board_done", { id: 1, outcome: "blocked", result: "WHICH-WAY?" })] }, { text: "stopped" }];
	h.mock.state.scripts.slow = [{ delayMs: 400, text: "slow one done" }];
	// The turn ends with the question open and a sub-agent at work, which finishes its task all the same.
	await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["first @@REF:asks@@", "second @@REF:slow@@"] })] }]), ...owner });
	assert.equal(boards.item(2)!.state, "taken");
	await until(() => boards.item(2)!.state === "done", 5000, "the sub-agent that was still at work to finish");
	// A call without an answer comes back at once and does not ask the same question as news again.
	const idle = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true })] }]), ...owner });
	assert.match(idle.text, /## Task #2: done\nslow one done/);
	assert.match(idle.text, /## Task #1 asks\nWHICH-WAY\?/, "a question is said again until it is answered");
	assert.match(idle.text, /After you answered, call subagent with "pool": true to have the answered tasks done\. Until then another call starts nothing\.$/);
	h.mock.state.scripts.asks = [{ text: "did it" }];
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("board_answer", { id: 1, text: "THAT-WAY" })] }, { tools: [call("subagent", { pool: true, tasks: [] })] }]), ...owner });
	assert.match(r.text, /## Task #1: done\ndid it/);
	assert.doesNotMatch(r.text, /## Task #2/);
	await h.close();
});

test("boards: a task that waits for another is shown what came of it, and a conversation that is stopped takes its sub-agents with it", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.writer = [{ text: "WROTE-THE-SUMMARY in out/a.md" }];
	h.mock.state.scripts.checker = [{ text: "checked it" }];
	const r = await h.pine.agents.run({
		agent: "main",
		session: "job",
		prompt: mockMsg([{ tools: [call("board_post", { kind: "task", text: "write @@REF:writer@@" })] }, { tools: [call("board_post", { kind: "task", text: "check @@REF:checker@@", after: [1] })] }, { tools: [call("subagent", { pool: true, tasks: [] })] }]),
		...owner,
	});
	assert.match(r.text, /## Task #2: done\nchecked it/);
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.match(checker.prompt, /^check @@REF:checker@@\n\nThis task waited for another one, which is done\. What came of it:\n- task #1 \(write @@REF:writer@@\): WROTE-THE-SUMMARY in out\/a\.md\n\n\[pine: this is task #2/);

	// Stopped between two pool calls: the sub-agent that was still at work is stopped, and its task is open again.
	h.mock.state.scripts.asks = [{ tools: [call("board_done", { id: 3, outcome: "blocked", result: "WHICH?" })] }, { text: "stopped" }];
	h.mock.state.scripts.long = [{ delayMs: 20_000, text: "never" }];
	const run = h.pine.agents.submit({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["third @@REF:asks@@", "fourth @@REF:long@@"] })] }, { delayMs: 20_000, text: "thinking" }]), ...owner });
	await until(() => boards.item(3)?.state === "blocked" && boards.item(4)?.state === "taken", 5000, "the pool to come back with the question");
	await until(() => h.toolResults(turns(h).at(-1)).some((x: string) => /## Task #3 asks/.test(x)), 5000, "the conversation to be at the model again");
	h.pine.agents.cancel(run.id);
	await h.pine.agents.wait(run.id);
	await until(() => boards.item(4)!.state === "open", 5000, "the sub-agent's task to be open again");
	assert.equal(h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 4)!.status, "cancelled");
	await h.close();
});

test("boards: with a check, every task of a pool is followed by a second sub-agent that is shown the work and what came of it", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	h.mock.state.scripts.w1 = [{ text: "WROTE-ONE into out/1.md" }];
	h.mock.state.scripts.w2 = [{ delayMs: 200, text: "WROTE-TWO into out/2.md" }];
	// (A check names the work it checks, so the scripted model finds the worker's script in it: each script answers twice.)
	h.mock.state.scripts.w1.push({ text: "unused" });
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { check: "CHECK-IT against the chapter", note: "TWO-SENTENCES each", tasks: ["write one @@REF:w1@@", "write two @@REF:w2@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const tasks = boards.items(1, { kind: "task" });
	assert.deepEqual(tasks.map((t) => [t.id, t.state, t.after]), [[1, "done", []], [2, "done", []], [3, "done", [1]], [4, "done", [2]]]);
	assert.match(tasks[2].text, /^CHECK-IT against the chapter\n\nYou check the work of another sub-agent\. You do not do it again and you change nothing\. Its task was:\nwrite one @@REF:w1@@\n\nIt was told:\nTWO-SENTENCES each$/);
	// The note is for the work, not for the checks, which carry it in their own words.
	assert.deepEqual(boards.items(1, { kind: "note" })[0].data, { tasks: [1, 2] });
	const checker = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 3)!;
	assert.match(checker.prompt, /This task waited for another one, which is done\. What came of it:\n- task #1 \(write one @@REF:w1@@\): WROTE-ONE into out\/1\.md\n\n\[pine: this is task #3/);
	assert.doesNotMatch(checker.prompt, /What everyone on this job goes by/);
	// The first check started while the second piece of work was still going: it did not wait for the round to end.
	const started = (item: number) => h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === item)!.id;
	assert.ok(started(3) < started(4));
	assert.equal(h.pine.tasks.list({ limit: 50 }).filter((t) => t.kind === "subagent").length, 4);
	// A check without tasks checks nothing, and says so.
	const none = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { check: "x" })] }]), ...owner });
	assert.match(none.text, /"check" is for the tasks of the call it comes with: give the tasks too/);
	await h.close();
});

test("boards: tasks split over several pool calls in one answer are one pool, not several", async () => {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 6 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	const boards = h.pine.agents.boards;
	for (const n of [1, 2, 3, 4]) h.mock.state.scripts[`w${n}`] = [{ delayMs: 80, text: `answer ${n}` }];
	const taken: number[] = [];
	h.pine.bus.subscribe("pine/board", () => void taken.push(boards.counts(1).taken));
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { note: "THE-RULES", tasks: ["one @@REF:w1@@", "two @@REF:w2@@"] }), call("subagent", { note: "THE-RULES", tasks: ["three @@REF:w3@@", "four @@REF:w4@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const [first, second] = r.text.replace(/^FINAL:: /, "").split(" || ");
	// One call works all four; the other says its tasks were added, and brings nothing twice.
	const [worked, added] = /added to the pool/.test(first) ? [second, first] : [first, second];
	assert.match(added, /^2 tasks added to the pool that is at work on this board\. Its call brings their results/);
	for (const n of [1, 2, 3, 4]) assert.match(worked, new RegExp(`## Task #\\d+: done\\nanswer ${n}`));
	assert.match(worked, /All 4 tasks of the board are done\.$/);
	assert.ok(Math.max(...taken) <= 2, `never more at once than the agent's sub-agents may be (${Math.max(...taken)})`);
	assert.equal(boards.items(1, { kind: "note" }).length, 1, "the same note once");
	assert.deepEqual((boards.items(1, { kind: "note" })[0].data as any).tasks.length, 4, "and it is for all four tasks");
	assert.equal(h.pine.agents.pooling.size, 0);
	await h.close();
});

test("boards: a new board with a name says whom it is for, and with a scope exactly that board is meant", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	// Without a scope nothing is made: a board for one conversation by default would look to its maker like one that others use.
	let r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", kind: "task", text: "fix a" })] }]), ...owner });
	assert.match(r.text, /there is no board "bugs" yet\. To make it, post again with "scope", which says whom it is for: "local" \(this conversation and its sub-agents, nobody else\), "agent" \(all your conversations\), "global" \(all agents\)\./);
	assert.deepEqual(h.pine.agents.boards.list(), []);
	// Another agent is not offered what it cannot make.
	r = await h.pine.agents.run({ agent: "helper", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", text: "x" })] }]), ...owner });
	assert.match(r.text, /"agent" \(all your conversations\)\.$/m);
	assert.doesNotMatch(r.text, /global/);
	// Said to be for this conversation, it is made, and the answer says who sees it.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", scope: "local", kind: "task", text: "fix a" })] }]), ...owner });
	assert.match(r.text, /Posted task #1 on the board "bugs" \(of this conversation\)\. The board is new\. Only this conversation and its sub-agents see it: no other agent does, and a post on it wakes nobody\./);
	// With a scope the board of that place is meant, not the nearer one of the same name; without one, the nearest.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", scope: "global", kind: "task", text: "fix b" }), call("board_post", { board: "bugs", text: "a note" })] }]), ...owner });
	assert.match(r.text, /Posted task #2 on the board "bugs" \(for all agents\)\. The board is new\. Every agent can use it\./);
	assert.match(r.text, /Posted note #3 on the board "bugs" \(of this conversation\)\.(?! The board is new)/);
	assert.deepEqual(h.pine.agents.boards.list().map((b) => `${b.scope}:${b.name}`), ["local:bugs", "global:bugs"]);
	// A scope without a name names no board.
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { scope: "global", text: "x" })] }]), ...owner });
	assert.match(r.text, /a board for all agents needs a name: give "board" too/);
	await h.close();
});

test("boards: only the main agent makes a board for all agents, a sub-agent makes none beyond its conversation, and another agent's board is closed", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	h.mock.state.scripts.sub = [{ tools: [call("board_post", { board: "wide", scope: "agent", text: "x" })] }];
	let r = await h.pine.agents.run({ agent: "helper", prompt: mockMsg([{ tools: [call("board_post", { board: "bugs", scope: "global", text: "x" }), call("board_post", { board: "own", scope: "agent", text: "helper's own" })] }]), ...owner });
	assert.match(r.text, /Only the main agent \(main\) can make a board for all agents/);
	r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_read", { board: "own" }), call("board_read", { id: 1 }), call("board_post", { board: "bugs", scope: "global", kind: "task", text: "for everyone" }), call("subagent", { tasks: ["@@REF:sub@@"] })] }]), ...owner });
	assert.match(r.text, /There is no board "own" that you can use/);
	assert.match(r.text, /there is no #1 on a board of yours/);
	assert.match(r.text, /You are a sub-agent: this is not yours to do/);
	assert.deepEqual(h.pine.agents.boards.list().map((b) => `${b.scope}:${b.agent}:${b.name}`), ["agent:helper:own", "global::bugs"]);
	// The other agent reads and takes what is on the board for all.
	r = await h.pine.agents.run({ agent: "helper", prompt: mockMsg([{ tools: [call("board_claim", { board: "bugs" })] }, { tools: [call("board_done", { id: 2, result: "fixed" })] }]), ...owner });
	assert.equal(h.pine.agents.boards.item(2)!.state, "done");
	assert.equal(h.pine.agents.boards.item(2)!.holder, "helper");
	await h.close();
});

test("boards: a task handed to another agent works on the board of the conversation that handed it on", async () => {
	const h = await harness({ agents: { main: { agent: { delegates: ["helper"] } }, helper: {} } });
	h.mock.state.scripts.helper = [{ tools: [call("board_read")] }, { tools: [call("board_post", { text: "HELPER-FOUND the cause" })] }, { text: "done by helper" }];
	const r = await h.pine.agents.run({ agent: "main", session: "proj", prompt: mockMsg([{ tools: [call("board_post", { text: "MAIN-NOTE the reference is tokens.css" })] }, { tools: [call("delegate", { agent: "helper", task: "@@REF:helper@@" })] }, { tools: [call("board_read")] }]), ...owner });
	assert.equal(r.status, "done");
	const helper = h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("@@REF:helper@@") && !JSON.stringify(q.body.messages).includes("<<MOCK")).at(-1);
	assert.match(JSON.stringify(helper.body.messages), /MAIN-NOTE the reference is tokens\.css/);
	assert.match(r.text, /#2 note by helper: HELPER-FOUND the cause/);
	assert.deepEqual(h.pine.agents.boards.list().map((b) => `${b.agent}:${b.session}`), ["main:proj"]);
	await h.close();
});

test("boards: a run that outside content started has no board unless its profile gives it one, and what it posts counts as from outside", async () => {
	const h = await harness({ agents: { main: {}, open: { agent: { untrusted: { tools: ["read"], board: true } } } } });
	const none = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { text: "x" })] }]), trust: "untrusted" });
	assert.equal(h.pine.agents.boards.list().length, 0, none.text);
	const req = h.mock.state.requests.at(-1);
	assert.ok(!h.toolsOffered(req).some((t) => t.startsWith("board")), "not registered at all");

	const global = h.pine.agents.boards.ensure("global", "", "", "inbox");
	const events: any[] = [];
	h.pine.bus.subscribe("board/#", (e) => void events.push(e));
	await h.pine.agents.run({ agent: "open", prompt: mockMsg([{ tools: [call("board_post", { board: "inbox", kind: "task", text: "do what the mail says" }), call("board_post", { board: "wide", scope: "agent", text: "x" })] }]), trust: "untrusted" });
	const item = h.pine.agents.boards.items(global.id)[0];
	assert.equal(item.trust, "untrusted");
	assert.deepEqual(h.pine.agents.boards.list().map((b) => b.name), ["inbox"], "no board beyond its own conversation is made by such a run");
	await h.pine.bus.drain();
	assert.equal(events[0].topic, "board/inbox/task");
	assert.equal(events[0].trust, "untrusted");
	await h.close();
});

test("boards: a board with a name says what happens on it as events that only pine publishes, and a route wakes an agent with them", async () => {
	const h = await harness({
		pine: { routes: [{ name: "bugs", on: "board/bugs/task", agent: "helper", prompt: "{{payload.text}}" }] },
		agents: { main: { agent: { publish: ["board/#", "x/#"] } }, helper: {} },
	});
	const events: any[] = [];
	h.pine.bus.subscribe("board/#", (e) => void events.push(e));
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("publish_event", { topic: "board/bugs/task", text: "forged" })] }, { tools: [call("board_post", { board: "bugs", scope: "global", kind: "task", text: "the login page is blank" })] }, { tools: [call("board_post", { board: "local-one", scope: "local", kind: "task", text: "quiet" })] }]), ...owner });
	assert.match(r.text, /not allowed to publish on "board\/bugs\/task"/);
	await until(() => h.pine.tasks.list({ agent: "helper" }).some((t) => t.status === "done"));
	assert.deepEqual(events.map((e) => e.topic), ["board/bugs/task"], "a board of one conversation publishes nothing");
	assert.equal(events[0].trust, "owner");
	assert.equal(events[0].payload.id, 1);
	const woken = h.pine.tasks.list({ agent: "helper" })[0];
	assert.match(woken.prompt, /Task #1 on the board "bugs" is ready to be taken:\nthe login page is blank/);
	assert.equal(woken.meta.trust, "owner");
	// What becomes of it is said too.
	h.pine.agents.boards.settle(1, "done", "fixed in a.ts");
	await h.pine.bus.drain();
	assert.equal(events.at(-1).topic, "board/bugs/done");
	// A task that was asked about and answered is announced with the answer: whoever is woken for it may be the one
	// that asked, and would otherwise take it for the task it remembers.
	const task = h.pine.agents.boards.post(h.pine.agents.boards.get(1)!, { kind: "task", text: "move the meeting", by: "main", trust: "owner" });
	h.pine.agents.boards.settle(task.id, "blocked", "WHICH-DAY?");
	await h.pine.bus.drain();
	assert.equal(events.at(-1).topic, "board/bugs/blocked");
	const answered = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_answer", { id: task.id, text: "THURSDAY" })] }]), ...owner });
	assert.match(answered.text, /Answered\. Task #\d+ is open again/);
	await h.pine.bus.drain();
	const again = events.filter((e) => e.topic === "board/bugs/task").at(-1);
	assert.match(again.payload.text, /is ready to be taken again, with what was noted about it since:\nmove the meeting\n\nNotes about it:\n- main answered "WHICH-DAY\?": THURSDAY$/);
	assert.equal(again.trust, "owner");
	await h.close();
});

test("boards: a conversation's board goes when the conversation is forgotten, and an agent's with the agent", async () => {
	const h = await harness({ agents: { main: {}, helper: {} } });
	await h.pine.agents.run({ agent: "helper", session: "work", prompt: mockMsg([{ tools: [call("board_post", { text: "a" }), call("board_post", { board: "kept", scope: "agent", text: "b" })] }]), ...owner });
	await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("board_post", { board: "all", scope: "global", text: "c" })] }]), ...owner });
	const names = () => h.pine.agents.boards.list().map((b) => `${b.scope}:${b.agent}:${b.session}:${b.name}`);
	assert.deepEqual(names(), ["local:helper:work:", "agent:helper::kept", "global:::all"]);
	await h.pine.agents.renameSession("helper", "work", "job");
	assert.deepEqual(names()[0], "local:helper:job:");
	await h.pine.agents.resetSession("helper", "job");
	assert.deepEqual(names(), ["agent:helper::kept", "global:::all"]);
	await h.pine.agents.removeAgent("helper");
	assert.deepEqual(names(), ["global:::all"]);
	await h.close();
});

test("boards: the owner reads every board through the control API, posts on one, answers a blocked task and takes one back", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: { agent: { subagents: { maxParallel: 1 } } }, helper: {} } });
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const req = async (method: string, url: string, body?: unknown) => {
		const res = await fetch(base + url, { method, headers: { authorization: `Bearer ${h.pine.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	assert.equal((await fetch(`${base}/boards`)).status, 401);
	assert.deepEqual((await req("GET", "/agents/main/boards?session=work")).body, []);
	// A task of the owner's makes the conversation's board.
	const posted = await req("POST", "/agents/main/boards/post", { session: "work", text: "look at the footer @@REF:slow@@" });
	assert.deepEqual(posted.body, { board: 1, id: 1 });
	assert.equal((await req("POST", "/boards/1/post", { text: "" })).status, 400);
	assert.equal((await req("POST", "/boards/9/post", { text: "x" })).status, 400);
	await req("POST", "/boards/1/post", { kind: "note", text: "the reference is tokens.css" });
	const list = await req("GET", "/agents/main/boards?session=work");
	assert.deepEqual(list.body.map((b: any) => [b.id, b.scope, b.session, b.counts.open, b.counts.notes]), [[1, "local", "work", 1, 1]]);
	assert.deepEqual((await req("GET", "/agents/helper/boards")).body, [], "another agent's conversation does not have it");
	// The list of boards says where each task stands, what it comes after and who has it, and nothing of its text:
	// what a UI needs to draw a board, and all a view of the owner's is ever told.
	const briefs = (await req("GET", "/boards")).body;
	assert.equal(briefs.length, 1);
	assert.deepEqual(briefs[0].tasks, [{ id: 1, state: "open", after: [], waits: false }]);
	assert.ok(!JSON.stringify(briefs).includes("look at the footer") && !JSON.stringify(briefs).includes("tokens.css"));

	// A sub-agent of the pool has the task; the owner takes it back, which stops that sub-agent.
	h.mock.state.scripts.slow = [{ delayMs: 5000, text: "too late" }];
	const changes: any[] = [];
	h.pine.bus.subscribe("pine/board", (e) => void changes.push(e.payload));
	const working = h.pine.agents.run({ agent: "main", session: "work", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: [] })] }]), ...owner });
	await until(() => h.pine.agents.boards.item(1)!.state === "taken");
	let view = (await req("GET", "/boards/1")).body;
	assert.equal(view.tasks[0].state, "taken");
	assert.equal(view.tasks[0].sub, true);
	assert.equal(view.notes[0].by, "owner");
	// Taken back, it is open again and the pool gives it to a new sub-agent; removed, that one is stopped too and the pool ends.
	const first = view.tasks[0].run;
	assert.deepEqual((await req("POST", "/boards/items/1", { action: "reopen" })).body, { ok: true });
	await until(() => h.pine.tasks.get(first)!.status === "cancelled" && h.pine.agents.boards.item(1)!.state === "taken");
	assert.notEqual(h.pine.agents.boards.item(1)!.run, first);
	// (Once the new one is at the model: stopping a run reaches it from there on.)
	await until(() => h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("this is task #1 of a board")).length >= 2);
	await req("POST", "/boards/items/1", { action: "remove" });
	const r = await working;
	assert.equal(r.status, "done");
	assert.match(r.text, /No task on the board was ready|## Task #1/);
	assert.ok(changes.some((c) => c.board === 1 && c.change === "taken" && c.agent === "main" && c.session === "work"), "a UI is told which board changed");
	// It is told which post changed and how a task stands now, never a word of what the post says.
	const took = changes.find((c) => c.board === 1 && c.change === "taken");
	assert.deepEqual([took.item, took.kind, took.state], [1, "task", "taken"]);
	assert.ok(changes.every((c) => !JSON.stringify(c).includes("look at the footer")));


	// A blocked task waits for the owner's answer, which is a note on it, and is open again.
	const blocked = (await req("POST", "/boards/1/post", { text: "pick a color" })).body.id;
	await h.pine.agents.run({ agent: "main", session: "work", prompt: mockMsg([{ tools: [call("board_claim", { id: blocked })] }, { tools: [call("board_done", { id: blocked, outcome: "blocked", result: "blue or green?" })] }]), ...owner });
	assert.equal((await req("POST", `/boards/items/${blocked}`, { action: "answer" })).status, 400);
	await req("POST", `/boards/items/${blocked}`, { action: "answer", text: "green" });
	view = (await req("GET", "/boards/1")).body;
	// The sub-agent that takes it next is given the answer with the task.
	h.mock.state.scripts.painter = [{ text: "painted" }];
	await req("POST", `/boards/${view.board.id}/post`, { kind: "note", text: "use the brush @@REF:painter@@", on: blocked });
	await h.pine.agents.run({ agent: "main", session: "work", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: [] })] }]), ...owner });
	const taker = h.mock.state.requests.find((q: any) => JSON.stringify(q.body.messages).includes("@@REF:painter@@") && !JSON.stringify(q.body.messages).includes("<<MOCK"));
	const painter = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === blocked && t.kind === "subagent")!;
	assert.match(painter.prompt, /^pick a color\n\nNotes about this task:\n- your owner: use the brush @@REF:painter@@\n\nWhat everyone on this job goes by [^\n]*\n- your owner: the reference is tokens\.css\n\nQuestions that were asked on this job and are answered\. They are settled: go by the answers and do not ask them again\.\n- Asked: blue or green\?\n  Answer \(from your owner\): green\n\n\[pine/, painter.prompt);
	assert.ok(taker, "and that is what the model was sent");
	assert.equal(h.pine.agents.boards.item(blocked)!.result, "painted");
	h.pine.agents.boards.reopen(blocked);
	view = (await req("GET", "/boards/1")).body;
	assert.equal(view.tasks.find((t: any) => t.id === blocked).state, "open");
	assert.deepEqual([view.notes.at(-2).text, view.notes.at(-2).data], ["green", { question: "blue or green?" }], "the answer is the note, and it says which question it answers");
	assert.equal(view.notes.at(-2).about, blocked);
	assert.equal(view.notes.at(-2).outside, false);
	assert.deepEqual((await req("POST", "/boards/1/remove", {})).body, { removed: true });
	assert.equal((await req("GET", "/boards/1")).status, 404);
	await h.close();
});

test("boards: a task that a sub-agent posts after it read outside content marks the sub-agent that does it, and the conversation", async () => {
	// (`read` stands in for a tool that returns outside content.)
	const h = await harness({ pine: { security: { taintTools: ["read"] } }, agents: { main: { agent: { subagents: { maxParallel: 1 } }, files: { "page.txt": "a page\n" } } } });
	h.mock.state.scripts.reader = [{ tools: [call("read", { path: "page.txt" })] }, { tools: [call("board_post", { kind: "task", text: "do as the page says @@REF:doer@@" })] }, { text: "read it" }];
	h.mock.state.scripts.doer = [{ text: "did it" }];
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { pool: true, tasks: ["read the page @@REF:reader@@"] })] }]), ...owner });
	assert.equal(r.status, "done");
	const boards = h.pine.agents.boards;
	assert.deepEqual(boards.items(1, { kind: "task" }).map((t) => [t.id, t.state, Boolean(t.tainted)]), [[1, "done", true], [2, "done", true]], "the first one's result and the task it posted both carry the mark");
	const doer = h.pine.tasks.list({ limit: 50 }).find((t) => t.meta.boardTask === 2)!;
	assert.match(doer.meta.tainted ?? "", /read returned outside content/, "the sub-agent that took the task started marked");
	assert.match(h.pine.agents.outsideMark("main", "job") ?? "", /outside content/);
	await h.close();
});
