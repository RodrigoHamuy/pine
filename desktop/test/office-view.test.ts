// The office (examples/home/views/office.ts), pine's own view, without a window: where the offices go, what
// the robots do for the work their agents do, phone calls for tasks handed on, capsules for events, the
// sky by the hour, and where the camera looks. The view is loaded as the frame loads it: "pine/view" is
// pine's src/view-kit.ts, and it is told only what view-state.ts tells it.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { frame } from "../../src/view-kit.ts";
import { viewStateOf } from "../src/view-state.ts";
import { World } from "../src/view-world.ts";

registerHooks({
	resolve: (spec, ctx, next) => (spec === "pine/view" ? { url: pathToFileURL(path.resolve(import.meta.dirname, "../../src/view-kit.ts")).href, shortCircuit: true } : next(spec, ctx)),
});
const { Office, nowOf, lookOf, skyAt, ROOM_W, Z_MAX } = await import("../../examples/home/views/office.ts");
type Office = InstanceType<typeof Office>;

const VIEW = { w: 520, h: 600 };
const names = Array.from({ length: 24 }, (_, i) => `a${String(i).padStart(2, "0")}`);

let id = 1;
const start = Date.now();
const ev = (ms: number, topic: string, payload: any, source = `agent:${payload.agent}`) => ({ id: id++, ts: start + ms, topic, source, payload, trust: "owner" });
const began = (ms: number, task: number, agent: string, more: any = {}) => ev(ms, `agent/${agent}/started`, { task, agent, session: `_t${task}`, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0, kind: more.kind ?? "prompt", prompt: more.prompt ?? "work" });
const did = (ms: number, task: number, agent: string, what: any) => ev(ms, `agent/${agent}/${what.topic}`, { task, agent, session: `_t${task}`, root: task, depth: 0, ...what });
const ended = (ms: number, task: number, agent: string, more: any = {}) => ev(ms, `agent/${agent}/done`, { task, agent, session: `_t${task}`, root: more.root ?? task, parent: more.parent, depth: more.depth ?? 0, status: "done" });

/** What the office is told of a world, as the panel tells it. */
const told = (world: World) => nowOf(viewStateOf(world, { colorOf: () => "#888888", holdings: new Map(), dark: false }));

function building(n = 24): { world: World; office: Office } {
	const world = new World();
	world.setPlaces(names.slice(0, n).map((a, i) => ({ id: a, main: i === 0, mode: "safe", description: "" })));
	const office = new Office();
	office.layout(told(world), VIEW);
	office.sync(told(world), start);
	return { world, office };
}

/** Runs the building from `from` to `to` milliseconds after the start, a frame each 50. */
function run(world: World, office: Office, from: number, to: number): void {
	for (let ms = from; ms <= to; ms += 50) {
		const s = told(world);
		office.sync(s, start + ms);
		office.step(s, start + ms, VIEW, { follow: true });
	}
}

const contains = (outer: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) => p.x >= outer.x && p.x <= outer.x + outer.w && p.y >= outer.y && p.y <= outer.y + outer.h;
const seen = (o: Office) => ({ x: o.cam.x - VIEW.w / o.cam.z / 2, y: o.cam.y - VIEW.h / o.cam.z / 2, w: VIEW.w / o.cam.z, h: VIEW.h / o.cam.z });

test("main works in the penthouse at the top, the others on the floors below it, from the street up", () => {
	const { office } = building();
	const main = office.rooms.get("a00")!;
	assert.ok(main.main);
	for (const r of office.rooms.values()) if (r !== main) assert.ok(r.y > main.y, `${r.agent} is below the penthouse`);
	assert.ok(main.w > ROOM_W, "the penthouse is wider than an office");
	// The first agent after main is on the lowest floor, the last on the highest.
	assert.ok(office.rooms.get("a01")!.y > office.rooms.get("a23")!.y);
	// No two offices overlap.
	const rooms = [...office.rooms.values()];
	for (const a of rooms) for (const b of rooms) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.agent} and ${b.agent}`);
	// A wide view gets a wider building.
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

test("at rest a robot sits at its desk; at work it reads while it thinks, types while it writes, and stands to ask", () => {
	const { world, office } = building(3);
	run(world, office, 0, 500);
	assert.equal(office.robotOf("a01")!.act, "sit");
	world.take([began(600, 1, "a01")]);
	run(world, office, 600, 6000);
	assert.equal(office.robotOf("a01")!.act, "read", "thinking: at the shelf");
	world.take([did(6100, 1, "a01", { topic: "delta", text: "the answer" })]);
	run(world, office, 6100, 12_000);
	assert.equal(office.robotOf("a01")!.act, "type", "writing: at the computer");
	world.take([ev(12_100, "approval/requested", { id: "q1", agent: "a01", task: 1, root: 1, tool: "send", summary: "send: hello" }, "approvals")]);
	run(world, office, 12_100, 14_000);
	assert.equal(office.robotOf("a01")!.act, "ask");
});

test("a task handed on is a phone call; a copy is a small robot that goes when the copy ends", () => {
	const { world, office } = building(3);
	world.take([began(0, 1, "a00")]);
	run(world, office, 0, 1000);
	world.take([began(1100, 2, "a02", { parent: 1, root: 1, depth: 1, kind: "delegate", prompt: "[task from agent a00]\nCount" })]);
	run(world, office, 1100, 1300);
	assert.equal(office.traffic().calls, 1);
	assert.equal(office.robotOf("a00")!.act, "phone");
	assert.equal(office.robotOf("a02")!.act, "phone", "the other one picks up");
	run(world, office, 1300, 5000);
	assert.equal(office.traffic().calls, 0, "the call ends");

	world.take([began(5100, 3, "a00", { parent: 1, root: 1, depth: 1, kind: "subagent", prompt: "look" })]);
	run(world, office, 5100, 5300);
	assert.deepEqual(office.robots().filter((r) => r.small).map((r) => [r.agent, r.work]), [["a00", 3]]);
	world.take([ended(5400, 3, "a00", { parent: 1, root: 1, depth: 1 })]);
	run(world, office, 5400, 6500);
	assert.equal(office.robots().filter((r) => r.small).length, 0);

	// The answer goes back by phone too.
	world.take([ended(6600, 2, "a02", { parent: 1, root: 1, depth: 1 })]);
	run(world, office, 6600, 6700);
	assert.equal(office.traffic().calls, 1);
});

test("an event comes up the pipes in a capsule to the office it is for", () => {
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

test("the sky follows the hour: day at noon, night at midnight, the sun only by day", () => {
	const noon = skyAt(new Date(2026, 5, 21, 13, 0));
	const midnight = skyAt(new Date(2026, 5, 21, 0, 30));
	const dusk = skyAt(new Date(2026, 5, 21, 20, 40));
	assert.ok(noon.day > 0.9 && noon.sun);
	assert.ok(midnight.day < 0.1 && !midnight.sun && midnight.stars > 0.8);
	assert.ok(dusk.dusk > noon.dusk && dusk.dusk > midnight.dusk);
	// In winter it is dark at six in the evening; in summer it is not.
	assert.ok(skyAt(new Date(2026, 11, 21, 18, 0)).day < 0.2);
	assert.ok(skyAt(new Date(2026, 5, 21, 18, 0)).day > 0.8);
});

test("nothing happening shows the whole building; one office at work, the camera goes close; several far apart, out again", () => {
	const { world, office } = building();
	run(world, office, 0, 300);
	const all = frame(office.whole(), VIEW, office.whole(), { zMax: Z_MAX, min: { w: 1, h: 1 } });
	assert.equal(office.cam.z, all.z, "at rest it shows all of it");

	world.take([{ ...began(400, 1, "a07"), source: "agent:a07" }]);
	run(world, office, 400, 9000);
	assert.ok(office.cam.z > all.z * 1.8, `close: ${office.cam.z} against ${all.z}`);
	assert.ok(contains(seen(office), office.centerOf("a07")!));
	assert.ok(!contains(seen(office), office.centerOf("a23")!), "an office far away is not in view");

	const close = office.cam.z;
	world.take([began(9100, 2, "a00"), began(9100, 3, "a23")]);
	run(world, office, 9100, 18_000);
	assert.ok(office.cam.z < close);
	for (const n of ["a00", "a07", "a23"]) assert.ok(contains(seen(office), office.centerOf(n)!), `${n} is in view`);

	world.take([ended(18_100, 1, "a07"), ended(18_100, 2, "a00"), ended(18_100, 3, "a23")]);
	run(world, office, 18_100, 40_000);
	assert.equal(office.cam.z, all.z, "and all of it again once the answers are back");
});
