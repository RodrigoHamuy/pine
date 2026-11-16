import assert from "node:assert/strict";
import { test } from "node:test";
import { EVERYDAY_TYPES, SOURCE_TYPES } from "../src/config.ts";
import { audit } from "../src/security.ts";
import { harness, mockMsg, until } from "./support/harness.ts";

const owner = { trust: "owner" as const };
const call = (name: string, args: any) => ({ name, args });

test("source types: every one loads and describes itself in a line a tool description can carry", async () => {
	const h = await harness({ agents: { main: {} } });
	const types = h.pine.sources.typeList();
	assert.deepEqual(types.map((t) => t.name), SOURCE_TYPES, h.logs.filter((l) => /could not be loaded/.test(l)).join("\n"));
	for (const t of types) {
		// A type that is only named is named in every request of an agent that declares each tool by itself: its line stays short.
		const most = EVERYDAY_TYPES.includes(t.name) ? 300 : 200;
		assert.ok(t.summary.length >= 20 && t.summary.length <= most, `${t.name}: its summary has ${t.summary.length} characters, ${most} at most`);
		assert.ok(!/\.$/.test(t.summary), `${t.name}: the summary ends without a full stop, it is followed by one`);
		for (const [key, p] of Object.entries<any>(t.options.properties ?? {})) assert.ok(typeof p.description === "string" && p.description.length > 5, `${t.name}.${key} has no description`);
		assert.equal(t.options.additionalProperties, false, `${t.name} takes options it does not know`);
	}
	await h.close();
});

test("source types: the everyday ones are spelled out to an agent, the others are named and looked up", async () => {
	const h = await harness({ agents: { main: {} } });
	// (Where every tool is declared by itself, what an agent reads about one is in a request: make one first.)
	await h.pine.agents.run({ agent: "main", prompt: "hello", ...owner });
	const about = JSON.parse(await h.about("add_source"));
	const text = typeof about === "string" ? about : JSON.stringify(about);
	// Spelled out: the type with every option.
	assert.match(text, /- folder: a folder: reports every new or changed file in it\..*Options: dir \(required\): the folder to watch/);
	// Named: what it is for, and where its options are found. Not its options.
	const more = text.slice(text.indexOf("More types"));
	assert.ok(more.length > 100, text.slice(-600));
	for (const name of SOURCE_TYPES.filter((t) => !EVERYDAY_TYPES.includes(t))) assert.match(more, new RegExp(`- ${name}: `), `${name} is not named`);
	assert.ok(!more.includes("Options:"), "a type that is only named does not bring its options along");
	assert.ok(text.length < 16_000, `the description of add_source has ${text.length} characters`);

	// Looked up: a part of the manual made from the type's own schema, and the answer to a call that leaves an option out.
	const r = await h.pine.agents.run({ agent: "main", prompt: mockMsg([{ tools: [call("manual", { search: "source type feed" }), call("manual", { read: "source-type#modbus" }), call("add_source", { name: "news", type: "feed", description: "x" })] }]), ...owner });
	assert.equal(r.status, "done");
	const out = h.toolResults();
	assert.match(out[0], /source-type#feed/);
	assert.match(out[1], /`modbus`: [\s\S]*Options: host \(required\)[\s\S]*Set one up with add_source \(type: "modbus"\)/);
	assert.match(out[2], /these options do not fit a feed source: url is missing\. It takes: url \(required\): /);
	await h.close();
});

test("source types: a report about a message is shown whole, with who wrote it and where", async () => {
	const h = await harness({
		pine: { sources: { scans: { type: "folder", dir: "./scans" } } },
		files: { "scans/.keep": "" },
		agents: { main: { agent: { subscribe: [{ source: "scans", throttle: "10ms" }] } } },
	});
	// What a watcher reports has a text, and the text is not all of it.
	h.pine.bus.publish("source/scans/message", { text: "call me", userName: "Anna", channelName: "ops" }, { source: "source:scans", trust: "untrusted" });
	await until(() => h.pine.tasks.list({}).some((t: any) => t.kind === "event" && t.status === "done"), 6000, "the agent to be woken");
	const woken = h.mock.state.requests.at(-1).body.messages.filter((m: any) => m.role === "user").at(-1);
	const text = typeof woken.content === "string" ? woken.content : woken.content.map((p: any) => p.text ?? "").join("\n");
	assert.match(text, /Event source\/scans\/message:\n\{\n  "text": "call me",\n  "userName": "Anna",\n  "channelName": "ops"\n\}/);
	await h.close();
});

test("source types: a listener that anyone on the network can write to is named by the audit", async () => {
	const h = await harness({ pine: { sources: { router: { type: "syslog", port: 5514 }, nas: { type: "syslog", port: 5515, allow: ["192.168.1.5"] } } }, agents: { main: {} } });
	const found = audit(h.pine.cfg).join("\n");
	assert.match(found, /the syslog source "router" has no list of senders \("allow"\); anyone who can reach the port can make it report/);
	assert.ok(!/syslog source "nas"/.test(found));
	await h.close();
});
