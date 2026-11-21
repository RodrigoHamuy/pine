// The office (examples/home/views/office.ts), pine's own view, without a window: where the rooms go, what
// the robots do for the work their agents do, winged letters for tasks handed on, capsules for events, what
// a bubble says, the sky by the hour, and where the camera looks. The view is loaded as the frame loads it: "pine/view" is
// pine's src/view-kit.ts, and it is told only what view-state.ts tells it.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { viewStateOf } from "../src/view-state.ts";
import { World } from "../src/view-world.ts";

registerHooks({
	resolve: (spec, ctx, next) => (spec === "pine/view" ? { url: pathToFileURL(path.resolve(import.meta.dirname, "../../src/view-kit.ts")).href, shortCircuit: true } : next(spec, ctx)),
});
const { Office, nowOf, lookOf, skyAt, setClock, toolSay, sayOf, widthOf, ROOM_W } = await import("../../examples/home/views/office.ts");
type Office = InstanceType<typeof Office>;

// A summer noon, whenever the test runs: at night the robots sleep.
setClock(() => new Date(2026, 5, 21, 13, 0));

const VIEW = { w: 520, h: 600 };
const names = Array.from({ length: 24 }, (_, i) => `a${String(i).padStart(2, "0")}`);

let id = 1;
const start = Date.now();
const ev = (ms: number, topic: string, payload: any, source = `agent:${payload.agent}`) => ({ id: id++, ts: start + ms, topic, source, payload, trust: "owner" });
const began = (ms: number, task: number, agent: string, more: any = {}) => ev(ms, `agent/${agent}/started`, { task, agent, session: more.session ?? `_t${task}`, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0, kind: more.kind ?? "prompt", prompt: more.prompt ?? "work" });
const did = (ms: number, task: number, agent: string, what: any) => ev(ms, `agent/${agent}/${what.topic}`, { task, agent, session: `_t${task}`, root: task, depth: 0, ...what });
const ended = (ms: number, task: number, agent: string, more: any = {}) => ev(ms, `agent/${agent}/${more.failed ? "failed" : "done"}`, { task, agent, session: `_t${task}`, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0, status: more.failed ? "failed" : "done" });

const HOLDINGS = new Map([["a01", { servers: ["web"], skills: ["invoices"], sources: [], schedules: ["daily"] }]]);
/** What the house is told of a world, as the panel tells it. */
const told = (world: World) => nowOf(viewStateOf(world, { colorOf: () => "#888888", holdings: HOLDINGS, dark: false }));

function building(n = 24): { world: World; office: Office } {
	const world = new World();
	world.setPlaces(names.slice(0, n).map((a, i) => ({ id: a, main: i === 0, mode: "safe", description: "" })));
	const office = new Office();
	office.layout(told(world), VIEW);
	office.sync(told(world), start);
	return { world, office };
}

/** Runs the house from `from` to `to` milliseconds after the start, a frame each 50. */
function run(world: World, office: Office, from: number, to: number): void {
	for (let ms = from; ms <= to; ms += 50) {
		const s = told(world);
		office.sync(s, start + ms);
		office.step(s, start + ms, VIEW, { follow: true });
	}
}

const contains = (outer: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) => p.x >= outer.x && p.x <= outer.x + outer.w && p.y >= outer.y && p.y <= outer.y + outer.h;
const seen = (o: Office) => ({ x: o.cam.x - VIEW.w / o.cam.z / 2, y: o.cam.y - VIEW.h / o.cam.z / 2, w: VIEW.w / o.cam.z, h: VIEW.h / o.cam.z });

test("main lives under the roof, the others on the floors below it, from the garden up", () => {
	const { office } = building();
	const main = office.rooms.get("a00")!;
	assert.ok(main.main);
	for (const r of office.rooms.values()) if (r !== main) assert.ok(r.y > main.y, `${r.agent} is below the roof`);
	assert.ok(main.w > ROOM_W, "the room under the roof is as wide as the house");
	assert.ok(main.screen, "and has the wall screen with a light for each agent");
	// The first agent after main is on the lowest floor, the last on the highest.
	assert.ok(office.rooms.get("a01")!.y > office.rooms.get("a23")!.y);
	// No two rooms overlap.
	const rooms = [...office.rooms.values()];
	for (const a of rooms) for (const b of rooms) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.agent} and ${b.agent}`);
	// A wide view gets a wider house.
	const wide = new Office();
	const w = new World();
	w.setPlaces(names.map((a, i) => ({ id: a, main: i === 0, mode: "safe", description: "" })));
	wide.layout(told(w), { w: 1400, h: 500 });
	assert.ok(wide.perFloor > office.perFloor, `${wide.perFloor} to a floor against ${office.perFloor}`);
});

test("every agent's robot looks different, and the same every time", () => {
	const looks = names.map((n) => JSON.stringify(lookOf(n)));
	assert.equal(new Set(looks).size, names.length);
	assert.deepEqual(lookOf("main"), lookOf("main"));
});

test("at rest a robot sits at its desk and sleeps at night; at work it paces, reads, works its rack, types, and jumps to ask", () => {
	const { world, office } = building(3);
	run(world, office, 0, 500);
	assert.equal(office.robotOf("a01")!.act, "sit");
	setClock(() => new Date(2026, 5, 21, 2, 0));
	run(world, office, 550, 700);
	assert.equal(office.robotOf("a01")!.act, "sleep", "at night it sleeps at its desk");
	setClock(() => new Date(2026, 5, 21, 13, 0));

	world.take([began(800, 1, "a01")]);
	run(world, office, 800, 3000);
	assert.equal(office.robotOf("a01")!.act, "think", "thinking: it paces the room");
	world.take([did(3100, 1, "a01", { topic: "tool", phase: "start", tool: "read", subject: "/somewhere/notes.md" })]);
	run(world, office, 3100, 3300);
	assert.equal(office.robotOf("a01")!.act, "read", "reading a file: at the shelf");
	world.take([did(3400, 1, "a01", { topic: "tool", phase: "end", tool: "read" }), did(3400, 1, "a01", { topic: "tool", phase: "start", tool: "read", subject: "/home/skills/invoices/SKILL.md" })]);
	run(world, office, 3400, 3600);
	assert.equal(office.robotOf("a01")!.act, "skill", "a skill it has: the starred book");
	assert.equal(sayOf(told(world).work.get(1)!, told(world), start).text, "skill: invoices");
	world.take([did(3700, 1, "a01", { topic: "tool", phase: "end", tool: "read" }), did(3700, 1, "a01", { topic: "tool", phase: "start", tool: "mcp__web__web_search", subject: "what the owner asked" })]);
	run(world, office, 3700, 3900);
	assert.equal(office.robotOf("a01")!.act, "rack", "a tool of an MCP server: at the rack");
	world.take([did(4000, 1, "a01", { topic: "tool", phase: "end", tool: "mcp__web__web_search" }), did(4000, 1, "a01", { topic: "tool", phase: "start", tool: "bash", subject: "ls" })]);
	run(world, office, 4000, 4200);
	assert.equal(office.robotOf("a01")!.act, "type", "a command: at its desk");
	world.take([did(4300, 1, "a01", { topic: "delta", text: "the answer" })]);
	run(world, office, 4300, 4500);
	assert.equal(office.robotOf("a01")!.act, "type", "writing: at the computer");
	world.take([ev(4600, "approval/requested", { id: "q1", agent: "a01", task: 1, root: 1, tool: "send", summary: "send: hello" }, "approvals")]);
	run(world, office, 4600, 5000);
	assert.equal(office.robotOf("a01")!.act, "ask");
	assert.equal(office.youMood?.kind, "asked", "and you, in the hall, are asked");
	assert.ok(office.tags(told(world), start + 5000).some((t: any) => t.k === "say" && t.say.sign === "ask" && t.say.loud), "its bubble says so, loudly");

	world.take([ended(5100, 1, "a01")]);
	run(world, office, 5100, 5300);
	assert.equal(office.robotOf("a01")!.act, "cheer", "done: it is glad for a moment");
	run(world, office, 5300, 9000);
	assert.equal(office.robotOf("a01")!.act, "sit");

	const other = building(3);
	run(other.world, other.office, 0, 100);
	other.world.take([began(200, 2, "a01"), ended(400, 2, "a01", { failed: true })]);
	run(other.world, other.office, 200, 600);
	assert.equal(other.office.robotOf("a01")!.act, "sad", "failed: it is sorry for a moment");
});

test("a task handed on is a winged letter and a line between the rooms; a copy is a small robot that goes when the copy ends", () => {
	const { world, office } = building(3);
	world.take([began(0, 1, "a00")]);
	run(world, office, 0, 1000);
	world.take([began(1100, 2, "a02", { parent: 1, root: 1, depth: 1, kind: "delegate", prompt: "[task from agent a00]\nCount" })]);
	run(world, office, 1100, 1300);
	assert.equal(office.traffic().letters, 1);
	assert.equal(office.robotOf("a00")!.act, "hand", "the one who hands it on holds the letter up");
	assert.deepEqual(office.links(told(world)).map((l: any) => [l.from, l.to]), [["a00", "a02"]], "a line from the room that waits to the room that works");
	run(world, office, 1300, 5000);
	assert.equal(office.traffic().letters, 0, "the letter has landed");
	assert.equal(office.robotOf("a00")!.act, "wait");

	world.take([began(5100, 3, "a00", { parent: 1, root: 1, depth: 1, kind: "subagent", prompt: "look" })]);
	run(world, office, 5100, 5300);
	assert.deepEqual(office.robots().filter((r: any) => r.small).map((r: any) => [r.agent, r.work]), [["a00", 3]]);
	world.take([ended(5400, 3, "a00", { parent: 1, root: 1, depth: 1 })]);
	run(world, office, 5400, 6500);
	assert.equal(office.robots().filter((r: any) => r.small).length, 0);

	// The answer flies back, and the line is gone.
	world.take([ended(6600, 2, "a02", { parent: 1, root: 1, depth: 1 })]);
	run(world, office, 6600, 6700);
	assert.equal(office.traffic().letters, 1);
	assert.equal(office.links(told(world)).length, 0);
});

test("two pieces of an agent's own work are two robots; when the first ends, its own robot takes the second and the other goes", () => {
	const { world, office } = building(3);
	world.take([began(0, 1, "a01", { session: "main" }), began(200, 2, "a01", { session: "side" })]);
	run(world, office, 0, 1000);
	assert.deepEqual(office.robots().map((r: any) => r.work).sort(), [1, 2, undefined, undefined].sort(), "the agent's own robot at the first, another at the second, and the two other agents'");
	world.take([ended(1100, 1, "a01")]);
	run(world, office, 1100, 2500);
	assert.deepEqual(office.robots().filter((r: any) => r.agent === "a01").map((r: any) => r.work), [2], "one robot for the one piece of work that is left");
});

test("an event comes up the tube in a capsule to the room it is for", () => {
	const { world, office } = building(3);
	const camera = ev(0, "source/camera/motion", { text: "at the door" }, "source:camera");
	world.take([camera]);
	office.layout(told(world), VIEW);
	world.take([{ ...began(100, 1, "a02", { kind: "event", prompt: "at the door" }), cause: camera.id }]);
	run(world, office, 100, 200);
	assert.equal(office.traffic().capsules, 1);
	run(world, office, 200, 9000);
	assert.equal(office.traffic().capsules, 0, "it arrived");
});

test("what just happened shows where it happened: a skill at the shelf, a schedule at the clock, a branch on the board, a letter to the dish", () => {
	const { world, office } = building(3);
	run(world, office, 0, 200);
	const s = told(world);
	const now = start + 300;
	office.hear({ k: "skill", work: 1, agent: "a01", skill: "invoices" }, s, now);
	office.hear({ k: "scheduled", name: "daily", agent: "a01" }, s, now);
	office.hear({ k: "branched", agent: "a01", conversation: 2, from: 1, worktree: true }, s, now);
	office.hear({ k: "tool", work: 1, agent: "a01", tool: "mcp__web__web_search", mcp: "web" }, s, now);
	office.hear({ k: "sent", work: 1, agent: "a01", tool: "send" }, s, now);
	const floats = office.tags(s, now).filter((t: any) => t.k === "float").map((t: any) => t.text);
	assert.deepEqual(floats, ["invoices", "daily", "new branch in a worktree"]);
	for (const key of ["skill:a01:invoices", "clock", "clocks:a01", "board:a01", "mcp:a01:web"]) assert.equal(office.hotAt.get(key), now, key);
	assert.equal(office.traffic().letters, 1, "what is sent out flies to the dish");
});

test("a bubble says what a tool does in a view's own words, and the letters are the view's own", () => {
	assert.deepEqual(toolSay("bash"), { sign: "term", text: "running a command", color: toolSay("bash").color });
	assert.equal(toolSay("mcp__browser__browser_navigate", "browser").text, "browser: navigate");
	assert.equal(toolSay("pine_sources").text, "pine: sources");
	assert.equal(toolSay("add_schedule").sign, "clock");
	assert.equal(toolSay("something_new").text, "something new");
	// The words are those a person would use: what it is doing, a sub-agent and not "a copy".
	assert.equal(toolSay("subagent").text, "starting sub-agents");
	assert.equal(toolSay("delegate").text, "delegating a task");
	assert.ok(widthOf("thinking...") > widthOf("thinking"));
	assert.equal(widthOf("i"), 1);
});

test("the sky follows the hour: day at noon, night at midnight, the sun only by day, a morning unlike an evening", () => {
	const noon = skyAt(new Date(2026, 5, 21, 13, 0));
	const midnight = skyAt(new Date(2026, 5, 21, 0, 30));
	const dusk = skyAt(new Date(2026, 5, 21, 20, 40));
	const dawn = skyAt(new Date(2026, 5, 21, 4, 20));
	assert.ok(noon.day > 0.9 && noon.sun);
	assert.ok(midnight.day < 0.1 && !midnight.sun && midnight.stars > 0.8);
	assert.ok(dusk.dusk > noon.dusk && dusk.dusk > midnight.dusk);
	assert.ok(dawn.am && !dusk.am);
	assert.notDeepEqual(dawn.stops, dusk.stops);
	// The night darkens what stands outside, and turns it blue.
	assert.ok(midnight.grade[0] < 0.5 && midnight.grade[2] > midnight.grade[0]);
	assert.deepEqual(noon.grade, [1, 1, 1]);
	// In winter it is dark at six in the evening; in summer it is not. The trees know the season.
	assert.ok(skyAt(new Date(2026, 11, 21, 18, 0)).day < 0.2);
	assert.ok(skyAt(new Date(2026, 5, 21, 18, 0)).day > 0.8);
	assert.deepEqual([0, 3, 6, 9].map((m) => skyAt(new Date(2026, m, 15, 12, 0)).season), ["winter", "spring", "summer", "autumn"]);
});

test("nothing happening shows the whole house; one room at work, the camera goes close; several far apart, out again; and pixels stay whole", () => {
	const { world, office } = building();
	run(world, office, 0, 300);
	const all = office.framed(office.whole(), VIEW);
	assert.equal(office.cam.z, all.z, "at rest it shows all of it");
	assert.ok(Number.isInteger(1 / all.z), `a house too big for whole pixels is shown at a half, a third: ${all.z}`);

	world.take([{ ...began(400, 1, "a07"), source: "agent:a07" }]);
	run(world, office, 400, 14_000);
	assert.ok(office.cam.z > all.z * 1.8, `close: ${office.cam.z} against ${all.z}`);
	assert.ok(Number.isInteger(office.cam.z), `whole pixels: ${office.cam.z}`);
	assert.ok(contains(seen(office), office.centerOf("a07")!));
	assert.ok(!contains(seen(office), office.centerOf("a23")!), "a room far away is not in view");

	const close = office.cam.z;
	world.take([began(14_100, 2, "a00"), began(14_100, 3, "a23")]);
	run(world, office, 14_100, 22_000);
	assert.ok(office.cam.z < close);
	for (const n of ["a00", "a07", "a23"]) assert.ok(contains(seen(office), office.centerOf(n)!), `${n} is in view`);

	world.take([ended(22_100, 1, "a07"), ended(22_100, 2, "a00"), ended(22_100, 3, "a23")]);
	run(world, office, 22_100, 44_000);
	assert.equal(office.cam.z, all.z, "and all of it again once the answers are back");
});
