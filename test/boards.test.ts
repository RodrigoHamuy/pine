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
	h.mock.state.scripts.w1 = [{ tools: [call("board_post", { text: "FOUND-BY-ONE gap-3 next to gap-4", data: '{"file":"Card.tsx","line":14}' })] }, { text: "answer one" }];
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
	assert.match(r.text, /## Notes the sub-agents left on the board\n#6 note by main: FOUND-BY-ONE gap-3 next to gap-4 \{"file":"Card.tsx","line":14\}/);
	assert.ok(Math.max(...seen) <= 2, `never more than two at once (${Math.max(...seen)})`);

	const boards = h.pine.agents.boards;
	const board = boards.find("local", "main", "audit", "")!;
	assert.deepEqual(boards.counts(board.id), { open: 0, taken: 0, done: 5, failed: 0, blocked: 0, notes: 1 });
	assert.equal(boards.item(1)!.result, "answer one");
	// Each sub-agent is told which task of the board is its own.
	const worker = h.mock.state.requests.find((q: any) => JSON.stringify(q.body.messages).includes("check part 3 @@REF:w3@@\\n\\n[pine: this is task #3 of your conversation's board"));
	assert.ok(worker, "the sub-agent of the third task was told so");
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
	assert.equal(boards.item(2)!.state, "blocked");
	assert.match(r.text, /task #2 is blocked: take it first/);
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
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("publish_event", { topic: "board/bugs/task", text: "forged" })] }, { tools: [call("board_post", { board: "bugs", scope: "global", kind: "task", text: "the login page is blank" })] }, { tools: [call("board_post", { board: "local-one", kind: "task", text: "quiet" })] }]), ...owner });
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
	assert.equal((await req("GET", "/boards")).body.length, 1);

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
	await until(() => h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("this is task #1 of your conversation's board")).length >= 2);
	await req("POST", "/boards/items/1", { action: "remove" });
	const r = await working;
	assert.equal(r.status, "done");
	assert.match(r.text, /No task on the board was ready|## Task #1/);
	assert.ok(changes.some((c) => c.board === 1 && c.change === "taken" && c.agent === "main" && c.session === "work"), "a UI is told which board changed");

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
	assert.match(JSON.stringify(taker.body.messages), /pick a color\\n\\nNotes about this task:\\n- your owner: To \\"blue or green\?\\": green\\n- your owner: use the brush/);
	assert.equal(h.pine.agents.boards.item(blocked)!.result, "painted");
	h.pine.agents.boards.reopen(blocked);
	view = (await req("GET", "/boards/1")).body;
	assert.equal(view.tasks.find((t: any) => t.id === blocked).state, "open");
	assert.match(view.notes.at(-2).text, /To "blue or green\?": green/);
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
