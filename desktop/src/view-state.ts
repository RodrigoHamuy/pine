// What a view of the owner's is told about pine (src/view-kit.ts): the page's picture of it (view-world.ts)
// with everything that could be private taken out. This is the one place that decides it, field by field,
// by building the view's state anew from an allow-list, never by copying the page's and deleting things.
//
// A view is told: the agents by name, color and mode, and the names of their MCP servers, skills,
// sources and schedules; each piece of work's agent, where it came from (you, the clock, a source or
// another agent, by name), what it does, the name of the tool it is in, whether it asks you, the mode
// it runs in and whether its conversation read outside content; the ways in by name and type.
// Never: a prompt, a task's text, an answer, an error's text, a tool's arguments or subject (a path, a
// command), a question's text, a conversation's name, a folder, a model, a secret, or what an event said.
import type { ViewAgent, ViewHappening, ViewInput, ViewState, ViewTarget, ViewWork } from "../../src/view-kit.ts";
import { ENDED, type From, type Job, type World } from "./view-world.ts";

/** What an agent has, as the daemon's detail of it says (`holdings`): only the names are taken. */
export interface Holdings {
	servers: string[];
	skills: string[];
	sources: string[];
	schedules: string[];
}

const NARROW_TO_WIDE = ["manual", "plan", "safe", "auto", "bypass"];
const stricter = (a: string, b: string) => NARROW_TO_WIDE.indexOf(a) >= 0 && NARROW_TO_WIDE.indexOf(a) < NARROW_TO_WIDE.indexOf(b);
const names = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
/** A tool's name as it is, if it looks like one: letters, digits, "_" and "-". */
const toolName = (t: string | undefined) => (t && /^[A-Za-z0-9_-]{1,80}$/.test(t) ? t : undefined);
/** The MCP server of a tool an MCP server provides (`mcp__<server>__<tool>`). */
const mcpOf = (t: string | undefined) => /^mcp__([A-Za-z0-9_-]+?)__/.exec(t ?? "")?.[1];

function from(f: From): ViewWork["from"] {
	switch (f.k) {
		case "you":
			return { k: "you" };
		case "clock":
			return f.name ? { k: "clock", name: f.name } : { k: "clock" };
		case "source":
			return { k: "source", name: f.name };
		case "outside":
			return { k: "outside", name: f.name };
		case "agent":
			return { k: "agent", id: f.id };
		case "copy":
			return { k: "copy", id: f.id };
		case "pine":
			return { k: "pine" };
	}
}

function work(world: World, j: Job): ViewWork {
	const mode = world.modeOf(j);
	const own = world.places.get(j.agent)?.mode;
	const tool = j.doing === "tool" ? toolName(j.tool) : undefined;
	const page = (t: number) => t - world.skew;
	return {
		id: j.id,
		agent: j.agent,
		copy: j.kind === "subagent",
		...(j.parent !== undefined ? { parent: j.parent } : {}),
		depth: j.depth,
		from: from(j.from),
		doing: j.doing,
		...(tool ? { tool } : {}),
		...(mcpOf(tool) ? { mcp: mcpOf(tool) } : {}),
		waitingOn: [...j.waitingOn],
		started: page(j.started),
		...(j.finished !== undefined ? { finished: page(j.finished) } : {}),
		tools: j.tools,
		asking: Boolean(j.ask) && !ENDED.includes(j.doing),
		...(mode ? { mode } : {}),
		held: Boolean(mode && own && stricter(mode, own)),
		outside: Boolean(world.outside(j)),
	};
}

/** pine as a view sees it. */
export function viewStateOf(world: World, o: { colorOf: (agent: string) => string; holdings: Map<string, Holdings>; selected?: ViewTarget; dark: boolean; focused?: boolean }): ViewState {
	const agents: ViewAgent[] = world.agents().map((a) => {
		const h = o.holdings.get(a.id);
		return { id: a.id, main: a.main, color: o.colorOf(a.id), mode: a.mode, mcp: names(h?.servers), skills: names(h?.skills), sources: names(h?.sources), schedules: names(h?.schedules) };
	});
	const inputs: ViewInput[] = world.inputs().map((s) => ({ id: s.id, kind: s.kind, name: s.name, ...(s.type ? { type: s.type } : {}), count: s.count, ...(s.last !== undefined ? { last: s.last - world.skew } : {}) }));
	const selected = o.selected && ("agent" in o.selected ? { agent: o.selected.agent } : { work: o.selected.work });
	return { at: Date.now(), agents, work: [...world.jobs.values()].map((j) => work(world, j)), inputs, ...(selected ? { selected } : {}), dark: o.dark, focused: o.focused !== false };
}

/** What a batch of the daemon's events means to a view, once the world has taken it: who started, ended, used what. */
export function happeningsOf(batch: Array<{ topic: string; payload: any }>, world: World, holdings: Map<string, Holdings>): ViewHappening[] {
	const out: ViewHappening[] = [];
	for (const e of batch) {
		const p = e.payload ?? {};
		const [ns, who, kind] = e.topic.split("/");
		if (ns === "source" && who) out.push({ k: "event", input: `source:${who}` });
		else if (ns === "schedule") out.push({ k: "event", input: "clock" });
		else if (e.topic === "approval/requested" && typeof p.task === "number") out.push({ k: "asked", work: p.task, agent: String(p.agent ?? "") });
		else if (e.topic === "approval/decided") out.push({ k: "decided", allowed: p.allow === true });
		if (ns !== "agent" || typeof p.task !== "number") continue;
		const j = world.jobs.get(p.task);
		if (!j) continue;
		const parent = j.parent !== undefined ? world.jobs.get(j.parent) : undefined;
		if (kind === "started") {
			out.push({ k: "started", work: j.id, agent: j.agent });
			if (j.kind === "subagent") out.push({ k: "copied", work: j.id, agent: j.agent });
			else if (parent && parent.agent !== j.agent) out.push({ k: "handed", work: j.id, from: parent.agent, to: j.agent });
		} else if (kind === "done" || kind === "failed") {
			out.push({ k: "ended", work: j.id, agent: j.agent, failed: j.doing === "failed" });
			if (parent && parent.agent !== j.agent && j.kind !== "subagent") out.push({ k: "answered", work: j.id, from: j.agent, to: parent.agent });
		} else if (kind === "tool" && p.phase === "start") {
			const tool = toolName(String(p.tool ?? ""));
			if (!tool) continue;
			// A skill is read from its SKILL.md: named only when it is one the agent has, so a path never leaks.
			const skill = tool === "read" ? /\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/.exec(String(p.subject ?? ""))?.[1] : undefined;
			if (skill && holdings.get(j.agent)?.skills.includes(skill)) out.push({ k: "skill", work: j.id, agent: j.agent, skill });
			else out.push({ k: "tool", work: j.id, agent: j.agent, tool, ...(mcpOf(tool) ? { mcp: mcpOf(tool) } : {}) });
			if (tool === "send" || tool === "publish_event") out.push({ k: "sent", work: j.id, agent: j.agent, tool });
		}
	}
	return out;
}

/** Whether something a view asks the panel to show or open is one the panel knows: a target from the frame is checked, not trusted. */
export function knownTarget(world: World, t: unknown): ViewTarget | undefined {
	if (!t || typeof t !== "object") return undefined;
	const x = t as Record<string, unknown>;
	if (typeof x.agent === "string" && world.places.has(x.agent)) return { agent: x.agent };
	if (typeof x.work === "number" && world.jobs.has(x.work)) return { work: x.work };
	return undefined;
}
