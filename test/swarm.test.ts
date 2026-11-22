import assert from "node:assert/strict";
import { after, test } from "node:test";
import { verdictOf } from "../src/boards.ts";
import { checkTask, continuePrompts, MAX_CHECKS, startPrompt } from "../src/swarm.ts";
import { PineTui } from "../src/tui/app.ts";
import { Client } from "../src/tui/client.ts";
import { harness, type Harness, rawTextOf, sleep, until } from "./support/harness.ts";
import { FakeTerminal, KEY } from "./support/terminal.ts";

const owner = { trust: "owner" as const };
const apps: PineTui[] = [];
after(async () => {
	for (const app of apps) await app.stop().catch(() => {});
});
const call = (name: string, args: any) => ({ name, args });
const swarmOf = (h: Harness, session = "main") => h.pine.agents.swarms.get("main", session);
const quiet = (h: Harness) => !h.pine.tasks.list({ limit: 300 }).some((t) => t.status === "pending" || t.status === "running");
/** The swarm is no longer at work, and nothing is running. */
const settled = (h: Harness, session = "main") => until(() => swarmOf(h, session)?.status !== "active" && quiet(h), 10_000, "the swarm to stop");
/** The lead's turns, oldest first. */
const turns = (h: Harness, session = "main") => h.pine.tasks.list({ agent: "main", session, limit: 300 }).filter((t) => t.parent === undefined).reverse();
/** What the lead does when pine has put the check of its answer on the board: has it done, and says so. */
const checked = [{ tools: [call("subagent", { pool: true })] }, { text: "Checked: it passed." }];

/**
 * A swarm whose lead is scripted by round: the job names the script "lead", and what the model answers
 * depends on which round the swarm is in. The check pine posts quotes the job, so the sub-agent that does
 * it finds the same name: it is told apart by how its task begins, and answers what `checker` says.
 */
async function swarm(rounds: (round: number) => any[], o: { checker?: (n: number) => string; pine?: Record<string, unknown>; agents?: Record<string, any> } = {}) {
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 4 }, ...(o.pine ?? {}) }, agents: { main: { agent: { subagents: { maxParallel: 2 } } }, ...(o.agents ?? {}) } });
	let checks = 0;
	Object.defineProperty(h.mock.state.scripts, "lead", {
		get: () => {
			const messages = h.mock.state.requests.at(-1)?.body.messages ?? [];
			const last = rawTextOf([...messages].reverse().find((m: any) => m.role === "user")?.content ?? "");
			if (/Check the answer below before the one who asked for it relies on it/.test(last)) return [{ text: (checks++, o.checker?.(checks) ?? "PASS") }];
			return rounds(swarmOf(h)?.round ?? 1);
		},
	});
	const events: any[] = [];
	h.pine.bus.subscribe("agent/main/swarm", (e) => void events.push(e.payload));
	return { h, events, job: "sort out the archive @@REF:lead@@", checks: () => checks };
}

test("swarm: the lead hands the job out and answers, pine has that answer checked by a sub-agent that did none of the work, and a check that passes ends it", async () => {
	const { h, events, job, checks } = await swarm((round) => (round === 1 ? [{ tools: [call("subagent", { tasks: ["piece one @@REF:one@@", "piece two @@REF:two@@"], note: "THE-RULES" })] }, { text: "LEAD-ANSWER both pieces are done, SECRET-WORD" }] : checked));
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.two = [{ text: "TWO-DONE" }];
	const set = h.pine.agents.swarms.set("main", "main", job);
	assert.deepEqual([set.status, set.round, set.until, set.since], ["active", 1, 8, 0]);
	await settled(h);

	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks], ["done", 2, 1]);
	assert.equal(s.note, "done after 2 rounds: 2 tasks, and the answer was checked");
	assert.deepEqual(events.map((e) => e.event), ["set", "continue", "done"]);
	assert.equal(events[1].note, "the answer is checked by a sub-agent that did none of the work");
	assert.equal(checks(), 1);
	// The first turn: the job in the owner's words and pine's frame, which says what a swarm's lead does.
	const [first, second] = turns(h);
	assert.equal(turns(h).length, 2);
	assert.equal(first.prompt, startPrompt(job));
	assert.ok(first.prompt.startsWith(`${job}\n\n[pine: your owner started a swarm`));
	for (const word of ['"tasks"', '"stages"', '"note"', '"check"', 'No "verify"', "board_answer", "Do none of the pieces yourself", "this answer is what gets checked"]) assert.ok(first.prompt.includes(word), word);
	assert.equal(first.result, "LEAD-ANSWER both pieces are done, SECRET-WORD");
	// What calls the lead again is pine's own text with the job and the number of the check: no word of what the lead answered or a sub-agent found.
	assert.deepEqual([second.kind, second.meta.label], ["notify", "swarm: round 2 of 8"]);
	assert.equal(second.prompt, continuePrompts.check(job, 4, false));
	assert.match(second.prompt, /^\[pine: before the swarm is done, your answer is checked\. Task #4 on the board is that check: /);
	assert.ok(second.prompt.endsWith(`The job, in your owner's words:\n${job}`));
	for (const word of ["LEAD-ANSWER", "SECRET-WORD", "ONE-DONE", "TWO-DONE"]) assert.ok(!second.prompt.includes(word), word);
	// The check is a task of the board, for a sub-agent: it holds the job and the answer in full, and says how it ends.
	const check = h.pine.agents.boards.item(4)!;
	assert.deepEqual([check.state, check.data, check.by, verdictOf(check.result)], ["done", { check: "job", answer: true }, "main", "pass"]);
	assert.equal(check.text, checkTask(job, "LEAD-ANSWER both pieces are done, SECRET-WORD"));
	assert.match(check.text, /end your answer with one word on a line of its own: PASS when the answer is right and complete, FAIL when it is not/);
	const checker = h.pine.tasks.list({ limit: 100 }).find((t) => t.meta.boardTask === 4)!;
	assert.deepEqual([checker.kind, checker.parent], ["subagent", second.id]);
	assert.match(checker.prompt, /\[pine: this is task #4 of a board, and it is a check\. .* the last line of your answer is one word and nothing else: PASS or FAIL\.\]$/);
	// A long answer goes to the check whole: cut in the middle, the check would call what was left out missing.
	const long = `START ${"a row of the list. ".repeat(500)}END`;
	assert.ok(checkTask(job, long).includes(long), `${long.length} characters`);
	await h.close();
});

test("swarm: tasks that are not done call the lead again, and a check the lead had made inside its call does not stand in for the check of its answer", async () => {
	const { h, events, job, checks } = await swarm((round) =>
		round === 1
			? // Posts the work and ends its turn without having it done.
				[{ tools: [call("board_post", { type: "task", text: "piece one @@REF:one@@" })] }, { text: "FIRST-ANSWER the plan is on the board" }]
			: round === 2
				? [{ tools: [call("subagent", { pool: true, verify: "RECOUNT the piece @@REF:v@@" })] }, { text: "SECOND-ANSWER the piece is done" }]
				: checked,
	);
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.v = [{ text: "PASS" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);

	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks], ["done", 3, 1]);
	assert.deepEqual(events.map((e) => e.event), ["set", "continue", "continue", "done"]);
	assert.equal(events[1].note, "1 task is not done: round 2 of 8 starts");
	assert.equal(events[2].note, "the answer is checked by a sub-agent that did none of the work");
	assert.equal(checks(), 1);
	const [first, second, third] = turns(h);
	assert.match(second.prompt, /^\[pine: the swarm is not finished\. Not done on the board: #1\. Call subagent with "pool": true/);
	assert.ok(second.prompt.endsWith(`The job, in your owner's words:\n${job}`));
	assert.equal(first.result, "FIRST-ANSWER the plan is on the board");
	// The lead's own check of the pieces passed in round 2, and pine still had the answer of that round checked.
	const [piece, own, mine] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.deepEqual([piece.data, own.data, verdictOf(own.result), mine.data], [undefined, { check: "job" }, "pass", { check: "job", answer: true }]);
	assert.equal(mine.text, checkTask(job, "SECOND-ANSWER the piece is done"));
	assert.equal(third.prompt, continuePrompts.check(job, mine.id, false));
	await h.close();
});

test("swarm: the check of the answer is the last thing done: tasks the lead adds while it waits are done before it, and the swarm ends with it", async () => {
	// Round 1: one piece. Round 2 (pine's check is on the board): the lead adds a task of its own beside "pool": true.
	const { h, job, checks } = await swarm((round) => (round === 1 ? [{ tools: [call("subagent", { tasks: ["piece @@REF:one@@"] })] }, { text: "handed out" }] : [{ tools: [call("subagent", { pool: true, tasks: ["look once more @@REF:slow@@"] })] }, { text: "DONE-AFTER-BOTH" }]));
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.slow = [{ delayMs: 250, text: "LOOKED-AGAIN" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	const [piece, check, added] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.deepEqual([piece.data?.check, check.data?.check, added.data?.check], [undefined, "job", undefined]);
	assert.deepEqual(check.after, [added.id], "the check waits for what was added after it");
	assert.ok(check.updated >= added.updated, "and was done after it");
	// So the answer counts as checked, and pine asks for no second check.
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round, swarmOf(h)!.checks, checks()], ["done", 2, 1, 1]);
	await h.close();
});

test("swarm: a lead that does a small job itself has its answer checked all the same; a check that fails is followed by one more, and then the swarm ends and says so", async () => {
	const { h, events, job, checks } = await swarm((round) => (round === 1 ? [{ text: "DID-IT-MYSELF: the total is 12" }] : [{ tools: [call("subagent", { pool: true })] }, { text: `ANSWER-OF-ROUND-${round}: the total is 13` }]), { checker: () => "The total is wrong.\n\nFAIL" });
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	const s = swarmOf(h)!;
	assert.deepEqual([s.status, s.round, s.checks], ["done", 3, MAX_CHECKS]);
	assert.equal(s.note, "ended after 3 rounds: main did it without handing anything out, and the last check of the answer still found something wrong, see the answer");
	assert.equal(checks(), MAX_CHECKS);
	assert.deepEqual(events.map((e) => e.note.replace(/:.*/, "")), ["started", "the answer is checked by a sub-agent that did none of the work", "the check failed", "ended after 3 rounds"]);
	const all = turns(h);
	assert.equal(all[1].prompt, continuePrompts.check(job, 1, false));
	assert.match(all[2].prompt, /^\[pine: your answer is checked once more, since the check before this one failed\. Task #2 on the board is that check: /);
	// Each check is of the answer of the turn before it.
	const [one, two] = h.pine.agents.boards.items(1, { kind: "task" });
	assert.equal(one.text, checkTask(job, "DID-IT-MYSELF: the total is 12"));
	assert.equal(two.text, checkTask(job, "ANSWER-OF-ROUND-2: the total is 13"));
	// The lead is told what to do with a verdict: a PASS needs one line, a FAIL the whole answer again.
	assert.match(all[1].prompt, /If it ends with PASS: your answer stands, and your owner has it on the screen\. Reply with one line that says it was checked and passed, and nothing else: no part of the answer again, not its closing lines either\. If it ends with FAIL: .* Then give your owner the whole answer again, as it now stands/);
	await h.close();

	// One that passes after the lead did the job alone: done in two rounds, and the note says how.
	const alone = await swarm((round) => (round === 1 ? [{ text: "DID-IT-MYSELF" }] : checked));
	alone.h.pine.agents.swarms.set("main", "main", alone.job);
	await settled(alone.h);
	assert.deepEqual([swarmOf(alone.h)!.status, swarmOf(alone.h)!.round, swarmOf(alone.h)!.note], ["done", 2, "done after 2 rounds: main did it without handing anything out, and the answer was checked"]);
	await alone.h.close();
});

test("swarm: a lead that asks its owner while work is left waits for the answer and goes on with it; a limit of rounds stops it with work left", async () => {
	const { h, events, job } = await swarm((round) => (round === 1 ? [{ tools: [call("board_post", { type: "task", text: "piece @@REF:one@@" })] }, { text: "Which rate do I use?" }] : checked));
	h.mock.state.scripts.one = [{ text: "ONE-DONE" }];
	h.mock.state.scripts.answer = [{ tools: [call("subagent", { pool: true })] }, { text: "DONE-WITH-THE-RATE" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round], ["waiting", 1]);
	assert.match(swarmOf(h)!.note, /main asks you something: answer it, and the swarm goes on/);
	// The owner's answer is a turn of the swarm's: the board is looked at after it, and the answer it led to is checked.
	const r = await h.pine.agents.run({ agent: "main", session: "main", prompt: "0.9, as always @@REF:answer@@", ...owner });
	assert.equal(r.text, "DONE-WITH-THE-RATE");
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round], ["done", 3]);
	assert.deepEqual(events.map((e) => e.event), ["set", "waiting", "resumed", "continue", "done"]);
	assert.equal(h.pine.agents.boards.items(1, { kind: "task" }).at(-1)!.text, checkTask(job, "DONE-WITH-THE-RATE"));
	await h.close();

	// A lead that never has its tasks done is called at most limits.swarmRounds times. /swarm resume gives it as many again.
	const stuck = await swarm((round) => [{ tools: [call("board_post", { type: "task", text: `piece ${round}` })] }, { text: "posted another one" }], { pine: { limits: { maxConcurrentRuns: 4, swarmRounds: 2 } } });
	stuck.h.pine.agents.swarms.set("main", "main", stuck.job);
	await settled(stuck.h);
	assert.deepEqual([swarmOf(stuck.h)!.status, swarmOf(stuck.h)!.round], ["limit", 2]);
	assert.match(swarmOf(stuck.h)!.note, /stopped after 2 rounds, which is the limit \(limits\.swarmRounds\), with work left\. \/swarm resume gives it 2 more/);
	const again = stuck.h.pine.agents.swarms.resume("main", "main");
	assert.deepEqual([again.status, again.round, again.until], ["active", 3, 4]);
	await settled(stuck.h);
	assert.deepEqual([swarmOf(stuck.h)!.status, swarmOf(stuck.h)!.round], ["limit", 4]);
	await stuck.h.close();
});

test("swarm: work the lead hands to another agent is a task on the board that this agent's answer settles, and a few sub-agents go over the board too", async () => {
	const { h, job } = await swarm((round) => (round === 1 ? [{ tools: [call("delegate", { agent: "helper", task: "look up the rate @@REF:rate@@", wait: false }), call("subagent", { tasks: ["count the rows @@REF:rows@@"] })] }, { text: "LEAD-ANSWER" }] : checked), { agents: { helper: {} } });
	h.mock.state.scripts.rate = [{ text: "The rate is 0.9. Shall I look up last year's too?" }];
	h.mock.state.scripts.rows = [{ text: "12 rows" }];
	h.pine.agents.swarms.set("main", "main", job);
	await settled(h);
	assert.deepEqual([swarmOf(h)!.status, swarmOf(h)!.round, swarmOf(h)!.note], ["done", 2, "done after 2 rounds: 2 tasks, and the answer was checked"]);
	const tasks = h.pine.agents.boards.items(1, { kind: "task" });
	const handed = tasks.find((t) => t.data?.agent === "helper")!;
	// The other agent's answer is the task's result, also when it ends with a question: that goes back to who handed it the task.
	assert.deepEqual([handed.text, handed.state, handed.holder, handed.result], ["look up the rate @@REF:rate@@", "done", "helper", "The rate is 0.9. Shall I look up last year's too?"]);
	const run = h.pine.tasks.list({ agent: "helper", limit: 10 })[0];
	assert.deepEqual([run.kind, run.meta.boardTask, run.prompt], ["delegate", handed.id, "[task from agent main]\nlook up the rate @@REF:rate@@"]);
	// The lead waited for it although it said not to: a swarm is looked at when its lead ends a turn, and the work has to be in by then.
	assert.match(JSON.stringify(h.toolResults(h.mock.state.requests.filter((q: any) => JSON.stringify(q.body.messages).includes("started a swarm")).at(-1))), /\[helper\] The rate is 0\.9\./);
	// One sub-agent, no "pool": in a swarm it is a task on the board all the same.
	assert.deepEqual(tasks.filter((t) => t.data?.agent === undefined).map((t) => [t.state, t.data?.check]), [["done", undefined], ["done", "job"]]);
	// Outside a swarm, handing work on puts nothing on a board.
	h.mock.state.scripts.plain = [{ tools: [call("delegate", { agent: "helper", task: "again @@REF:rate@@" })] }, { text: "ok" }];
	await h.pine.agents.run({ agent: "main", session: "other", prompt: "do @@REF:plain@@", ...owner });
	assert.equal(h.pine.agents.boards.find("local", "main", "other", ""), undefined);
	await h.close();
});

test("swarm: only the owner starts one, through the control API; it is paused, resumed and cleared there, and goes with its conversation", async () => {
	const h = await harness({ pine: { http: { port: 0 }, limits: { maxConcurrentRuns: 4 } }, agents: { main: {}, solo: { agent: { subagents: { enabled: false } } } } });
	const { swarms } = h.pine.agents;
	h.mock.state.scripts.lead = [{ delayMs: 20_000, text: "never" }];
	// No tool reaches it: nothing an agent is declared starts or changes a swarm.
	await h.pine.agents.run({ agent: "main", session: "look", prompt: "hello", ...owner });
	assert.deepEqual(h.toolsOffered(h.mock.state.requests.at(-1)).filter((t: string) => /swarm/i.test(t)), []);
	// What is refused: a conversation of outside content, one that does not stay, an agent without sub-agents, no job, a conversation with a goal.
	assert.throws(() => swarms.set("main", "inbox~u", "x"), /holds what came from outside/);
	assert.throws(() => swarms.set("main", "new", "x"), /needs a conversation that stays/);
	assert.throws(() => swarms.set("solo", "main", "x"), /has no sub-agents/);
	assert.throws(() => swarms.set("main", "main", "  "), /needs a job/);
	assert.throws(() => swarms.set("main", "main", "x".repeat(4001)), /at most 4000 characters/);
	assert.equal(swarms.get("main", "inbox~u"), undefined);

	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const token = h.pine.token;
	const api = async (method: string, path: string, body?: unknown) => {
		const res = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	assert.deepEqual((await api("GET", "/agents/main/swarm?session=job")).body, {});
	const started = await api("POST", "/agents/main/swarm", { session: "job", objective: "the job @@REF:lead@@" });
	assert.deepEqual([started.status, started.body.swarm.status, started.body.swarm.round], [200, "active", 1]);
	assert.equal((await api("GET", "/agents/main/swarm?session=job")).body.swarm.objective, "the job @@REF:lead@@");
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job", action: "nonsense" })).status, 400);
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job" })).status, 400);
	assert.equal((await api("POST", "/agents/nobody/swarm", { session: "job", objective: "x" })).status, 404);
	assert.equal((await fetch(`${base}/agents/main/swarm`, { method: "POST", body: "{}" })).status, 401);
	// Paused: the round that runs is the owner's to stop; no further one starts. Stopped: the swarm waits, like a goal.
	const paused = await api("POST", "/agents/main/swarm", { session: "job", action: "pause" });
	assert.deepEqual([paused.body.swarm.status, paused.body.swarm.note], ["paused", "paused by you. /swarm resume goes on"]);
	const running = h.pine.tasks.list({ agent: "main", session: "job", limit: 10 }).find((t) => t.status === "running")!;
	h.pine.agents.cancel(running.id);
	await h.pine.agents.wait(running.id);
	assert.equal(swarms.get("main", "job")!.status, "paused");
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job", action: "clear" })).body.cleared, true);
	assert.equal(swarms.get("main", "job"), undefined);
	assert.equal((await api("POST", "/agents/main/swarm", { session: "job", action: "clear" })).body.cleared, false);

	// A swarm that is at work when pine stops waits for the owner's word after the restart; a conversation that is reset loses it.
	swarms.set("main", "keep", "the job @@REF:lead@@");
	await until(() => h.pine.tasks.list({ agent: "main", session: "keep", limit: 10 }).some((t) => t.status === "running"), 5000, "the lead to start");
	await h.restart();
	assert.deepEqual([h.pine.agents.swarms.get("main", "keep")!.status, h.pine.agents.swarms.get("main", "keep")!.note], ["paused", "paused: pine was stopped while it was working. /swarm resume goes on"]);
	await h.pine.agents.resetSession("main", "keep");
	assert.equal(h.pine.agents.swarms.get("main", "keep"), undefined);
	await h.close();
});

test("swarm: /swarm in the terminal UI starts one, shows what pine does about it, and pauses, resumes and clears it", async () => {
	const h = await harness({ pine: { main: "main", http: { port: 0 }, limits: { maxConcurrentRuns: 4 } }, agents: { main: { agent: { subagents: { maxParallel: 2 } } } } });
	// Round 1 posts a task and ends; round 2 has it done and answers; round 3 has the check of that answer done.
	Object.defineProperty(h.mock.state.scripts, "lead", {
		get: () => {
			const messages = h.mock.state.requests.at(-1)?.body.messages ?? [];
			if (/Check the answer below before the one who asked/.test(rawTextOf([...messages].reverse().find((m: any) => m.role === "user")?.content ?? ""))) return [{ text: "PASS" }];
			const round = swarmOf(h)?.round ?? 1;
			return round === 1 ? [{ tools: [call("board_post", { type: "task", text: "piece @@REF:one@@" })] }, { delayMs: 250, text: "POSTED-IT" }] : round === 2 ? [{ tools: [call("subagent", { pool: true })] }, { text: "ALL-SHELVES-SORTED" }] : checked;
		},
	});
	h.mock.state.scripts.one = [{ delayMs: 300, text: "ONE-DONE" }];
	const client = new Client(`http://127.0.0.1:${h.pine.http!.port}`, h.pine.token);
	const term = new FakeTerminal(130, 40);
	const app = new PineTui({ client, terminal: term, mode: "test" });
	apps.push(app);
	await app.start();
	const text = () => app.screen().join("\n");
	const sees = (what: string | RegExp, ms = 6000) => until(() => (typeof what === "string" ? text().includes(what) : what.test(text())), ms, `the screen to show ${what}\n--- screen ---\n${text()}`);
	const send = async (line: string) => {
		term.type(line);
		term.type([KEY.enter]);
		await sleep(15);
	};
	await send("/swarm");
	await sees("this conversation has no swarm");
	await send("/swarm tidy the archive @@REF:lead@@");
	await sees("swarm started: main leads it");
	await sees(/swarm · round 1 of 8 · (working|thinking)/);
	await sees("swarm 1 task is not done: round 2 of 8 starts");
	await sees("ALL-SHELVES-SORTED");
	await sees("swarm the answer is checked by a sub-agent that did none of the work");
	await sees("swarm done after 3 rounds: 1 task, and the answer was checked");
	await sees("Checked: it passed.");
	// The job was typed here, so it is shown once and as the owner's; what pine told the lead in a round is not shown as a message.
	assert.ok(!text().includes("[elsewhere]") && !text().includes("[notify]") && !text().includes("the swarm is not finished") && !text().includes("your owner started a swarm") && !text().includes("your answer is checked"), text());
	await send("/swarm pause");
	await sees("the swarm is not at work");
	await send("/swarm clear");
	await sees("swarm cleared");
	assert.equal(swarmOf(h), undefined);
	await h.close();
});
