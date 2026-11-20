// The bird's-eye view's picture of pine: who works on what, where each piece of work came from, and
// what just went from where to where. It is made from the daemon's live events alone (and a look at
// the recent tasks when the view opens), so it holds nothing the event log does not, and draws
// nothing a lens makes up. Every lens draws this one world; none keeps a picture of its own.
//
// Plain data and no React, no store: the tests build a world from events in Node.

/** Where a piece of work came from: the one thing every lens shows first. */
export type From =
	| { k: "you" } // the owner: a message in a conversation, or an event the owner published
	| { k: "clock"; name?: string } // a schedule
	| { k: "source"; name: string } // an event source
	| { k: "outside"; name: string } // an event that came in another way: a webhook, a route, another program
	| { k: "agent"; id: string } // handed on by another agent (`delegate`), or that agent's answer coming back
	| { k: "copy"; id: string } // a sub-agent: a copy of the agent, started by its conversation
	| { k: "pine" }; // pine itself: a background command that ended, a goal's next round

/** What a piece of work is doing right now. */
export type Doing = "thinking" | "tool" | "writing" | "waiting" | "asking" | "done" | "failed" | "cancelled";

export const ENDED: Doing[] = ["done", "failed", "cancelled"];

export interface Job {
	id: number;
	agent: string;
	session: string;
	kind: string;
	root: number;
	parent?: number;
	depth: number;
	label: string;
	from: From;
	doing: Doing;
	/** The tool it is in, while it is in one. */
	tool?: string;
	subject?: string;
	/** The agents it is waiting for (delegations and copies it started that have not ended). */
	waitingOn: number[];
	started: number;
	finished?: number;
	tools: number;
	/** What the owner is asked on its behalf, while it waits for the answer. */
	ask?: { id: string; tool: string; summary: string };
	error?: string;
}

/** Something work comes in from: the owner, the clock, an event source, another way in. */
export interface Station {
	/** The node id: "you", "clock", "source:<name>", "outside:<name>". */
	id: string;
	kind: "you" | "clock" | "source" | "outside";
	name: string;
	/** The type of an event source ("mail", "folder", ...), where the view was told. */
	type?: string;
	last?: number;
	count: number;
}

/** A moment of travel, for a lens to animate: an event to an agent, a task handed on, an answer going back. */
export interface Pulse {
	id: number;
	at: number;
	/** Node ids: a station's, or "agent:<id>". */
	from: string;
	to: string;
	kind: "event" | "hand" | "copy" | "answer" | "ask" | "said";
	job?: number;
}

/** A line of what happened, newest last: the plain-words record beside every lens. */
export interface Line {
	at: number;
	text: string;
	agent?: string;
	job?: number;
	tone?: "ask" | "bad" | "good";
}

/** A conversation as the daemon reports it (`/status`): whether it read outside content, the mode it works in now. */
export interface Room {
	agent: string;
	session: string;
	busy: boolean;
	outside?: string;
	mode: string;
	trust: string;
}

export interface Place {
	id: string;
	main: boolean;
	color?: string;
	mode: string;
	description: string;
}

/** The node id of where a piece of work came from. */
export function nodeOf(from: From, agent: string): string {
	switch (from.k) {
		case "you":
			return "you";
		case "clock":
			return "clock";
		case "source":
			return `source:${from.name}`;
		case "outside":
			return `outside:${from.name}`;
		case "agent":
			return `agent:${from.id}`;
		case "copy":
			return `agent:${from.id}`;
		case "pine":
			return `agent:${agent}`;
	}
}

/** Where a piece of work came from, in a few words. */
export function fromText(from: From): string {
	switch (from.k) {
		case "you":
			return "you";
		case "clock":
			return from.name ? `the schedule ${from.name}` : "a schedule";
		case "source":
			return `the source ${from.name}`;
		case "outside":
			return from.name;
		case "agent":
			return from.id;
		case "copy":
			return `a copy of ${from.id}`;
		case "pine":
			return "pine";
	}
}

const KEEP_MS = 30 * 60_000;
const KEEP_JOBS = 400;
const KEEP_PULSE_MS = 4000;
const KEEP_LINES = 80;

const label = (s: string, n = 90) => {
	const one = s.replace(/<<MOCK[\s\S]*?>>|@@REF:[^@]*@@/g, "").replace(/\s+/g, " ").trim();
	return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/**
 * The world as the events say it is. `take` a batch, read the fields. `v` counts up with every change,
 * so a view draws again when it moves (`subscribe`).
 */
export class World {
	places = new Map<string, Place>();
	jobs = new Map<number, Job>();
	stations = new Map<string, Station>();
	rooms = new Map<string, Room>();
	pulses: Pulse[] = [];
	/** The same moments of travel, kept as long as ended work is: what the timeline draws as arrows. */
	trail: Pulse[] = [];
	lines: Line[] = [];
	/** What each event that may start work came from, by its id: a started task names its cause. */
	private causes = new Map<number, From>();
	private pulseIds = 1;
	v = 0;
	private listeners = new Set<() => void>();
	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => void this.listeners.delete(fn);
	};
	version = () => this.v;
	/** The clock of the world: the time of the last event, so that a world built from old events is not "now". */
	now = 0;
	/** How far the daemon's clock is ahead of the page's, as of the last batch: a pulse's time, on the page's clock, is `at - skew`. */
	skew = 0;

	constructor() {
		this.stations.set("you", { id: "you", kind: "you", name: "you", count: 0 });
	}

	/** Forgets everything: another pine, or a story that starts over. */
	reset(): void {
		this.jobs.clear();
		this.stations = new Map([["you", { id: "you", kind: "you", name: "you", count: 0 }]]);
		this.rooms.clear();
		this.causes.clear();
		this.pulses = [];
		this.trail = [];
		this.lines = [];
		this.now = 0;
		this.skew = 0;
		this.touch();
	}

	touch(): void {
		this.v++;
		for (const fn of this.listeners) fn();
	}

	/** The agents there are, as the page knows them. Agents that are gone leave with their work. */
	setPlaces(list: Array<{ id: string; main: boolean; color?: string; mode: string; description: string }>): void {
		const ids = new Set(list.map((a) => a.id));
		this.places = new Map(list.map((a) => [a.id, { id: a.id, main: a.main, color: a.color, mode: a.mode, description: a.description }]));
		for (const [id, j] of this.jobs) if (!ids.has(j.agent)) this.jobs.delete(id);
		this.touch();
	}

	/** The event sources there are, also those that have reported nothing yet. */
	setSources(list: Array<{ name: string; type: string; last?: { ts: number }; events: number }>): void {
		for (const s of list) {
			const id = `source:${s.name}`;
			const was = this.stations.get(id);
			this.stations.set(id, { id, kind: "source", name: s.name, type: s.type, last: Math.max(was?.last ?? 0, s.last?.ts ?? 0) || undefined, count: Math.max(was?.count ?? 0, s.events) });
		}
		this.touch();
	}

	/** The conversations the daemon has open, with the mode each works in and whether it read outside content. */
	setRooms(list: Room[]): void {
		this.rooms = new Map(list.map((r) => [`${r.agent}:${r.session}`, r]));
		this.touch();
	}

	/** What the owner is asked right now, as `/approvals` says when the view opens. */
	setAsks(list: Array<{ id: string; task: number; tool: string; summary: string }>): void {
		for (const a of list) {
			const j = this.jobs.get(a.task);
			if (j && !ENDED.includes(j.doing)) (j.ask = { id: a.id, tool: a.tool, summary: label(a.summary, 160) }), (j.doing = "asking");
		}
		this.touch();
	}

	/**
	 * Recent tasks, as `/tasks` lists them, newest first: the work that was there before the view
	 * opened. What the live events already said about a task is kept.
	 */
	seed(tasks: Array<{ id: number; agent: string; session: string; kind: string; prompt: string; status: string; created: number; started?: number; finished?: number; parent?: number; depth: number; error?: string; event?: number; meta: { label?: string; chain?: string[]; root?: number; stats?: { tools: string[] } } }>): void {
		for (const t of [...tasks].sort((a, b) => a.id - b.id)) {
			if (this.jobs.has(t.id) || t.status === "pending") continue;
			const parent = t.parent !== undefined ? this.jobs.get(t.parent) : undefined;
			const doing: Doing = t.status === "running" ? "thinking" : t.status === "failed" ? "failed" : t.status === "cancelled" ? "cancelled" : "done";
			this.jobs.set(t.id, {
				id: t.id,
				agent: t.agent,
				session: t.session,
				kind: t.kind,
				root: t.meta.root ?? parent?.root ?? t.id,
				parent: t.parent,
				depth: t.depth,
				label: label(t.meta.label || t.prompt.replace(/^\[task from agent [^\]]+\]\s*/, "")),
				from: this.fromOf(t.kind, t.agent, t.prompt, t.parent, t.event, t.depth, t.meta.chain),
				doing,
				waitingOn: [],
				started: t.started ?? t.created,
				finished: doing === "thinking" ? undefined : (t.finished ?? t.started ?? t.created),
				tools: t.meta.stats?.tools.length ?? 0,
				error: t.error,
			});
			this.now = Math.max(this.now, t.finished ?? t.started ?? t.created);
		}
		for (const j of this.jobs.values()) {
			const p = j.parent !== undefined ? this.jobs.get(j.parent) : undefined;
			if (p && !ENDED.includes(j.doing) && !p.waitingOn.includes(j.id)) p.waitingOn.push(j.id), !ENDED.includes(p.doing) && (p.doing = "waiting");
		}
		this.prune();
		this.touch();
	}

	private fromOf(kind: string, agent: string, prompt: string, parent?: number, cause?: number, depth = 0, chain?: string[]): From {
		if (kind === "subagent") return { k: "copy", id: agent };
		if (kind === "delegate") {
			const p = parent !== undefined ? this.jobs.get(parent) : undefined;
			const named = /^\[task from agent ([^\]\s]+)\]/.exec(prompt)?.[1];
			const id = p?.agent ?? chain?.at(-1) ?? named;
			return id ? { k: "agent", id } : { k: "pine" };
		}
		if (kind === "notify") {
			const answer = /^\[answer to task #\d+ that you handed to agent ([^\]\s]+)\]/.exec(prompt)?.[1];
			return answer ? { k: "agent", id: answer } : { k: "pine" };
		}
		if (kind === "event") return (cause !== undefined ? this.causes.get(cause) : undefined) ?? { k: "outside", name: "an event" };
		return depth === 0 ? { k: "you" } : { k: "pine" };
	}

	private pulse(from: string, to: string, kind: Pulse["kind"], at: number, job?: number): void {
		if (from === to && kind !== "copy") return;
		const pulse = { id: this.pulseIds++, at, from, to, kind, job };
		this.pulses.push(pulse);
		this.trail.push(pulse);
	}

	private say(at: number, text: string, more: Omit<Line, "at" | "text"> = {}): void {
		this.lines.push({ at, text, ...more });
		if (this.lines.length > KEEP_LINES) this.lines.splice(0, this.lines.length - KEEP_LINES);
	}

	/** Takes in a batch of the daemon's events. Returns whether anything changed. */
	take(batch: Array<{ id: number; ts: number; topic: string; source: string; payload: any; trust: string; cause?: number }>): boolean {
		let changed = false;
		for (const e of batch) changed = this.one(e) || changed;
		const last = batch.at(-1);
		if (last) this.skew = last.ts - Date.now();
		if (changed) this.prune(), this.touch();
		return changed;
	}

	private station(id: string, kind: Station["kind"], name: string, at: number): Station {
		let s = this.stations.get(id);
		if (!s) this.stations.set(id, (s = { id, kind, name, count: 0 }));
		s.count++;
		s.last = at;
		return s;
	}

	private one(e: { id: number; ts: number; topic: string; source: string; payload: any; trust: string; cause?: number }): boolean {
		const p = e.payload ?? {};
		const at = e.ts;
		this.now = Math.max(this.now, at);
		const [ns, who, kind] = e.topic.split("/");

		if (ns === "approval") {
			const j = this.jobs.get(p.task);
			if (e.topic === "approval/requested") {
				if (j) {
					j.ask = { id: p.id, tool: String(p.tool ?? ""), summary: label(String(p.summary ?? ""), 160) };
					j.doing = "asking";
				}
				this.pulse(`agent:${p.agent}`, "you", "ask", at, p.task);
				this.say(at, `${p.agent} asks you: ${label(String(p.summary ?? p.tool ?? ""), 70)}`, { agent: p.agent, job: p.task, tone: "ask" });
				return true;
			}
			if (e.topic === "approval/decided") {
				for (const x of this.jobs.values()) {
					if (x.ask?.id !== p.id) continue;
					x.ask = undefined;
					if (x.doing === "asking") x.doing = x.waitingOn.length ? "waiting" : "thinking";
					this.say(at, `you ${p.allow ? "allowed" : "refused"} ${x.agent}'s ${x.tool ?? "request"}`, { agent: x.agent, job: x.id, tone: p.allow ? "good" : "bad" });
				}
				return true;
			}
			return false;
		}

		// What may start work: remember where it came from, by the event's id.
		if (ns !== "agent" && ns !== "pine" && ns !== "state") {
			let from: From | undefined;
			if (e.source.startsWith("source:")) {
				const name = e.source.slice(7);
				this.station(`source:${name}`, "source", name, at);
				from = { k: "source", name };
			} else if (e.source === "timer") {
				this.station("clock", "clock", "clock", at);
				from = { k: "clock", name: typeof p.name === "string" ? p.name : undefined };
			} else if (e.trust === "owner" && e.source === "http") {
				this.station("you", "you", "you", at);
				from = { k: "you" };
			} else if (!e.source.startsWith("agent:") && e.source !== "router") {
				this.station(`outside:${e.source}`, "outside", e.source, at);
				from = { k: "outside", name: e.source };
			} else if (e.source === "router" && e.cause !== undefined) {
				from = this.causes.get(e.cause);
			} else if (e.source.startsWith("agent:")) {
				from = { k: "agent", id: e.source.slice(6) };
			}
			if (from) this.causes.set(e.id, from);
			if (this.causes.size > 2000) this.causes.delete(this.causes.keys().next().value!);
			return Boolean(from);
		}
		if (ns !== "agent" || typeof p.task !== "number") return false;
		const agent = String(p.agent ?? who);

		if (kind === "started") {
			const parent = p.parent !== undefined ? this.jobs.get(p.parent) : undefined;
			const from = this.fromOf(String(p.kind), agent, String(p.prompt ?? ""), p.parent, e.cause, p.depth ?? 0);
			const job: Job = {
				id: p.task,
				agent,
				session: String(p.session ?? ""),
				kind: String(p.kind ?? "prompt"),
				root: p.root ?? p.task,
				parent: p.parent,
				depth: p.depth ?? 0,
				label: label(p.label || String(p.prompt ?? "").replace(/^\[(task from agent|answer to task)[^\]]*\]\s*/, "")),
				from,
				doing: "thinking",
				waitingOn: [],
				started: at,
				tools: 0,
			};
			this.jobs.set(job.id, job);
			if (parent) {
				if (!parent.waitingOn.includes(job.id)) parent.waitingOn.push(job.id);
				if (!ENDED.includes(parent.doing) && parent.doing !== "asking") parent.doing = "waiting";
			}
			const to = `agent:${agent}`;
			const kindOf: Pulse["kind"] = from.k === "agent" ? "hand" : from.k === "copy" ? "copy" : "event";
			this.pulse(nodeOf(from, agent), to, kindOf, at, job.id);
			if (from.k === "source" && e.cause !== undefined) this.say(at, `${from.name} woke ${agent}`, { agent, job: job.id });
			else if (from.k === "agent" && job.kind === "delegate") this.say(at, `${from.id} handed ${agent} a task: ${job.label}`, { agent, job: job.id });
			else if (from.k === "agent") this.say(at, `${from.id}'s answer reached ${agent}`, { agent, job: job.id, tone: "good" });
			else if (from.k === "copy") this.say(at, `${agent} started a copy: ${job.label}`, { agent, job: job.id });
			else if (from.k === "you") this.say(at, `you asked ${agent}: ${job.label}`, { agent, job: job.id });
			else if (from.k === "clock") this.say(at, `${from.name ? `the schedule ${from.name}` : "a schedule"} woke ${agent}`, { agent, job: job.id });
			else this.say(at, `${fromText(from)} woke ${agent}`, { agent, job: job.id });
			return true;
		}

		const job = this.jobs.get(p.task);
		if (!job) return false;
		if (kind === "steered") {
			this.pulse("you", `agent:${agent}`, "said", at, job.id);
			return true;
		}
		if (ENDED.includes(job.doing)) return false;
		if (kind === "thinking") {
			if (job.doing === "thinking" || job.doing === "asking" || job.doing === "waiting") return false;
			job.doing = "thinking";
			job.tool = undefined;
			return true;
		}
		if (kind === "delta" || kind === "message") {
			if (job.doing === "writing" || job.doing === "asking") return false;
			job.doing = "writing";
			job.tool = undefined;
			return true;
		}
		if (kind === "tool") {
			if (p.phase === "start") {
				job.tools++;
				job.tool = String(p.tool ?? "");
				job.subject = p.subject ? label(String(p.subject), 80) : undefined;
				if (job.doing !== "asking") job.doing = /(^|_)(delegate|subagent)$/.test(job.tool) ? "waiting" : "tool";
			} else if (job.doing !== "asking") {
				job.doing = job.waitingOn.some((c) => !ENDED.includes(this.jobs.get(c)?.doing ?? "done")) ? "waiting" : "thinking";
				job.tool = undefined;
				job.subject = undefined;
			}
			return true;
		}
		if (kind === "done" || kind === "failed") {
			job.doing = kind === "done" ? (p.status === "cancelled" ? "cancelled" : "done") : p.status === "cancelled" ? "cancelled" : "failed";
			job.finished = at;
			job.ask = undefined;
			job.tool = undefined;
			job.error = p.error ? label(String(p.error), 160) : undefined;
			const parent = job.parent !== undefined ? this.jobs.get(job.parent) : undefined;
			if (parent && !ENDED.includes(parent.doing)) {
				const open = parent.waitingOn.some((c) => !ENDED.includes(this.jobs.get(c)?.doing ?? "done"));
				if (!open && parent.doing === "waiting") parent.doing = "thinking";
			}
			// The answer goes back to where the work came from: the agent that waits, or the owner.
			const back = parent ? `agent:${parent.agent}` : job.from.k === "you" || job.depth === 0 ? (job.from.k === "you" ? "you" : nodeOf(job.from, agent)) : `agent:${agent}`;
			this.pulse(`agent:${agent}`, back, "answer", at, job.id);
			if (job.doing === "failed") this.say(at, `${agent} could not finish: ${job.error ?? job.label}`, { agent, job: job.id, tone: "bad" });
			else if (parent && parent.agent !== agent) this.say(at, `${agent} answered ${parent.agent}`, { agent, job: job.id, tone: "good" });
			else if (job.depth === 0) this.say(at, `${agent} is done: ${job.label}`, { agent, job: job.id, tone: "good" });
			return true;
		}
		return false;
	}

	/** Forgets what is old: ended work after half an hour, pulses after a few seconds. */
	prune(now = this.now): void {
		this.pulses = this.pulses.filter((x) => now - x.at < KEEP_PULSE_MS);
		this.trail = this.trail.filter((x) => now - x.at < KEEP_MS).slice(-1000);
		const ended = [...this.jobs.values()].filter((j) => j.finished !== undefined).sort((a, b) => a.finished! - b.finished!);
		for (const j of ended) if (now - j.finished! > KEEP_MS) this.jobs.delete(j.id);
		const over = this.jobs.size - KEEP_JOBS;
		if (over > 0) for (const j of ended.slice(0, over)) this.jobs.delete(j.id);
	}

	// ---- what the lenses ask -------------------------------------------------------------------------

	/** The agents, the main one first, then by name. */
	agents(): Place[] {
		return [...this.places.values()].sort((a, b) => Number(b.main) - Number(a.main) || a.id.localeCompare(b.id));
	}

	/** The work of an agent that has not ended, oldest first. */
	working(agent?: string): Job[] {
		return [...this.jobs.values()].filter((j) => !ENDED.includes(j.doing) && (agent === undefined || j.agent === agent)).sort((a, b) => a.started - b.started);
	}

	/** Everything the owner is asked right now. */
	asks(): Job[] {
		return this.working().filter((j) => j.ask);
	}

	/** The stations work came in from, the owner first, then the clock, then the sources. */
	inputs(): Station[] {
		const order = { you: 0, clock: 1, source: 2, outside: 3 };
		return [...this.stations.values()].sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
	}

	/** Whether the conversation a piece of work runs in has read outside content, as the daemon last said. */
	outside(job: Job): string | undefined {
		return this.rooms.get(`${job.agent}:${job.session}`)?.outside;
	}

	/** The mode a piece of work runs in now, as the daemon last said (a task handed on from a stricter mode is held to it). */
	modeOf(job: Job): string | undefined {
		return this.rooms.get(`${job.agent}:${job.session}`)?.mode;
	}

	/** The pulses still under way at `now`, with how far along each is (0 to 1) over `ms`. */
	travelling(now: number, ms = 1400): Array<Pulse & { t: number }> {
		return this.pulses.filter((x) => x.to && now - x.at >= 0 && now - x.at < ms).map((x) => ({ ...x, t: (now - x.at) / ms }));
	}
}

/** A color for an agent that has none of its own, the same every time: so that two agents are told apart here too. */
export function colorFor(place: { id: string; color?: string } | undefined, palette: readonly string[]): string {
	if (place?.color && /^#[0-9a-f]{6}$/i.test(place.color)) return place.color;
	let h = 0;
	for (const c of place?.id ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
	return palette[h % palette.length];
}
