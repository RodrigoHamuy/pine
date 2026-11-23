import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { checkServerLimit } from "../src/admin.ts";
import { loadConfig, MAX_SERVER_RUNS } from "../src/config.ts";
import { harness, mockMsg } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });

/** The most runs that were at the model at one time, from what pine says started and ended. */
function watch(h: Awaited<ReturnType<typeof harness>>) {
	let now = 0;
	let most = 0;
	h.pine.bus.subscribe("agent/+/started", () => void (most = Math.max(most, ++now)));
	h.pine.bus.subscribe("agent/+/done", () => void now--);
	h.pine.bus.subscribe("agent/+/failed", () => void now--);
	return () => most;
}

test("limits: a model server with a number of runs of its own takes that many at a time, in a queue of its own; the others wait their turn", async () => {
	// Three messages at once, each a while at the model: with pine's own limit they run side by side.
	const slow = () => mockMsg([{ delayMs: 150, text: "done" }]);
	const free = await harness({ pine: { limits: { maxConcurrentRuns: 8 } }, agents: { main: {} } });
	const side = watch(free);
	await Promise.all(["a", "b", "c"].map((session) => free.pine.agents.run({ agent: "main", session, prompt: slow(), ...owner })));
	assert.equal(side(), 3);
	assert.equal(free.pine.agents.limiterOf("mock/m"), free.pine.agents.limiter, "without a number of its own a server is in the queue for all");
	await free.close();

	// The same with the server held to one: one after the other, and pine says how its queue stands.
	const h = await harness({ pine: { limits: { maxConcurrentRuns: 8, servers: { mock: 1 } } }, agents: { main: {} } });
	const most = watch(h);
	const all = Promise.all(["a", "b", "c"].map((session) => h.pine.agents.run({ agent: "main", session, prompt: slow(), ...owner })));
	await new Promise((r) => setTimeout(r, 60));
	assert.deepEqual(h.pine.agents.status().servers, { mock: { active: 1, waiting: 2, max: 1 } });
	assert.deepEqual((await all).map((r) => r.status), ["done", "done", "done"]);
	assert.equal(most(), 1);
	assert.notEqual(h.pine.agents.limiterOf("mock/m"), h.pine.agents.limiter);
	assert.equal(h.pine.agents.limiterOf("elsewhere/m"), h.pine.agents.limiter, "another server is not held to it");
	assert.equal(h.pine.agents.limiter.stats.active, 0, "and the queue for all was not used");

	// An agent that hands work to sub-agents gives its place up while it waits, so a server that takes one run at a
	// time still gets a job with sub-agents done: they run one after the other.
	h.mock.state.scripts.piece = [{ delayMs: 60, text: "piece done" }];
	const again = watch(h);
	const r = await h.pine.agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["one @@REF:piece@@", "two @@REF:piece@@", "three @@REF:piece@@"] })] }, { text: "ALL-THREE-IN" }]), ...owner });
	assert.deepEqual([r.status, r.text], ["done", "ALL-THREE-IN"]);
	assert.ok(again() >= 2, "the conversation and a sub-agent are both under way, and only one of them is at the model");
	assert.deepEqual(h.pine.agents.status().servers, { mock: { active: 0, waiting: 0, max: 1 } });
	await h.close();
});

test("limits: the owner sets a model server's number of runs through the control API, it holds from the next run on, and it goes with the server", async () => {
	const h = await harness({ pine: { http: { port: 0 } }, agents: { main: {} } });
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const api = async (method: string, at: string, body?: unknown) => {
		const res = await fetch(`${base}${at}`, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	const file = () => JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8"));
	const listed = async () => (await api("GET", "/models/servers")).body.find((x: any) => x.name === "mock");
	assert.deepEqual([(await listed()).limit, (await listed()).runs], [undefined, 8]);
	// Set: written into pine.json, said with the server, and in force.
	assert.deepEqual((await api("POST", "/models/servers/limit", { name: "mock", limit: 2 })).body, { name: "mock", limit: 2, runs: 8 });
	assert.deepEqual([file().limits.servers, (await listed()).limit, h.pine.agents.limiterOf("mock/m").max], [{ mock: 2 }, 2, 2]);
	assert.deepEqual(loadConfig(h.home).limits.servers, { mock: 2 });
	// Changed, and it holds without a restart.
	await api("POST", "/models/servers/limit", { name: "mock", limit: 1 });
	assert.equal(h.pine.agents.limiterOf("mock/m").max, 1);
	// What is no number that can be one, and a server there is none of, are refused, and nothing is written.
	for (const limit of [0, -1, 1.5, MAX_SERVER_RUNS + 1, "many"]) assert.equal((await api("POST", "/models/servers/limit", { name: "mock", limit })).status, 400, String(limit));
	const none = await api("POST", "/models/servers/limit", { name: "nowhere", limit: 2 });
	assert.deepEqual([none.status, /there is no model server or provider "nowhere"/.test(none.body.error)], [400, true]);
	assert.equal((await api("POST", "/models/servers/limit", { name: "../pine", limit: 2 })).status, 400);
	assert.deepEqual(file().limits.servers, { mock: 1 });
	assert.equal((await fetch(`${base}/models/servers/limit`, { method: "POST", body: "{}" })).status, 401);
	// Nothing: the limit is off, the key is gone from the file, and the server is back in the queue for all.
	assert.deepEqual((await api("POST", "/models/servers/limit", { name: "mock", limit: null })).body, { name: "mock", runs: 8 });
	assert.deepEqual([file().limits?.servers, h.pine.agents.limiterOf("mock/m") === h.pine.agents.limiter], [undefined, true]);
	await h.close();

	// The check of a model's own number: only a model the server has.
	assert.deepEqual(checkServerLimit(["local", "local/qwen3", "local/gemma:4b"], "local", 1, "gemma:4b"), { name: "local", model: "gemma:4b", limit: 1 });
	assert.deepEqual(checkServerLimit(["local", "local/qwen3"], "local", null, "qwen3"), { name: "local", model: "qwen3" });
	assert.throws(() => checkServerLimit(["local", "local/qwen3"], "local", 1, "other"), /"local" has no model "other"\. Its models: qwen3/);
	// The check by itself, as a tool of the main agent's would use it.
	assert.deepEqual(checkServerLimit(["local"], " local ", "3"), { name: "local", limit: 3 });
	assert.deepEqual(checkServerLimit(["local"], "local", ""), { name: "local" });
	assert.throws(() => checkServerLimit(["local"], "local", 0), /a whole number from 1 to 64, or nothing for pine's own limit/);
});

test("limits: a pine.json that gives a server something that is no number of runs is refused with what it has to be", async () => {
	const h = await harness({ agents: { main: {} } });
	const file = path.join(h.home, "pine.json");
	const json = JSON.parse(fs.readFileSync(file, "utf8"));
	const withServers = (servers: unknown) => fs.writeFileSync(file, JSON.stringify({ ...json, limits: { ...(json.limits ?? {}), servers } }));
	withServers({ local: 2, "lm-studio": 1 });
	assert.deepEqual(loadConfig(h.home).limits.servers, { local: 2, "lm-studio": 1 });
	for (const wrong of [{ local: 0 }, { local: 2.5 }, { "bad name!": 3 }, ["local"], "2"]) {
		withServers(wrong);
		assert.throws(() => loadConfig(h.home), /limits\.servers gives a model server or provider \(by its name\) the number of runs it takes at a time, a whole number from 1 to 64/, JSON.stringify(wrong));
	}
	await h.close();
});

test("limits: a model has a number of runs of its own, before its server's: one endpoint serves models that are set up differently", async () => {
	const h = await harness({ models: [{ id: "small" }], pine: { http: { port: 0 }, limits: { maxConcurrentRuns: 8, servers: { mock: 3 }, models: { "mock/small": 1 } } }, agents: { main: {} } });
	const { agents } = h.pine;
	// The model with a number of its own has a queue of its own; the server's other models share the server's; the rest is pine's.
	assert.deepEqual([agents.limiterOf("mock/small").max, agents.limiterOf("mock/m").max, agents.limiterOf("mock/m") === agents.limiterOf("mock/other"), agents.limiterOf("mock/small") === agents.limiterOf("mock/m")], [1, 3, true, false]);
	assert.equal(agents.limiterOf("elsewhere/small"), agents.limiter);
	// Sub-agents on that model run one after the other, while the conversation's own model takes three at a time.
	// (Three at 80 ms each: side by side they would be through in little more than 80.)
	h.mock.state.scripts.piece = [{ delayMs: 80, text: "piece done" }];
	const t0 = Date.now();
	const r = await agents.run({ agent: "main", session: "job", prompt: mockMsg([{ tools: [call("subagent", { tasks: ["one @@REF:piece@@", "two @@REF:piece@@", "three @@REF:piece@@"], model: "small" })] }, { text: "IN" }]), ...owner });
	assert.equal(r.text, "IN");
	assert.ok(Date.now() - t0 >= 240, `one after the other: ${Date.now() - t0} ms`);
	assert.ok(h.pine.tasks.list({ limit: 20 }).filter((t) => t.kind === "subagent").every((t) => t.meta.model === "mock/small"));
	assert.deepEqual(agents.status().models, { "mock/small": { active: 0, waiting: 0, max: 1 } });
	// Through the control API: set for a model, said with the model, taken off again; a model the server has not is refused.
	const base = `http://127.0.0.1:${h.pine.http!.port}`;
	const api = async (method: string, at: string, body?: unknown) => {
		const res = await fetch(`${base}${at}`, { method, headers: { authorization: `Bearer ${h.pine.token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
		return { status: res.status, body: (await res.json()) as any };
	};
	const file = () => JSON.parse(fs.readFileSync(path.join(h.home, "pine.json"), "utf8")).limits;
	const listed = async () => (await api("GET", "/models/servers")).body.find((x: any) => x.name === "mock");
	assert.deepEqual([(await listed()).limit, (await listed()).models.map((m: any) => [m.id, m.limit])], [3, [["m", undefined], ["small", 1]]]);
	assert.deepEqual((await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: 2 })).body, { name: "mock", model: "m", limit: 2, runs: 8 });
	assert.deepEqual([file().models, agents.limiterOf("mock/m").max], [{ "mock/small": 1, "mock/m": 2 }, 2]);
	assert.equal((await api("POST", "/models/servers/limit", { name: "mock", model: "nothing", limit: 2 })).status, 400);
	await api("POST", "/models/servers/limit", { name: "mock", model: "m", limit: null });
	assert.deepEqual([file().models, agents.limiterOf("mock/m").max], [{ "mock/small": 1 }, 3]);
	await h.close();
});
