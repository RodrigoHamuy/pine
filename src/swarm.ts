import type { AgentManager } from "./agents.ts";
import { asksAtEnd, type BoardItem, verdictOf } from "./boards.ts";
import type { Task } from "./types.ts";
import { errText, type Logger } from "./util.ts";

/**
 * A swarm: the owner gives a conversation a job with /swarm, and its agent leads it instead of
 * doing it: it hands the job out to sub-agents on the conversation's board, answers what they ask,
 * and puts the result together. What makes it more than a prompt is looked at here, by the daemon,
 * each time the lead ends a turn:
 *
 * - Tasks on the board that are not done: the lead is called again. A swarm does not end with
 *   work lying open because the lead forgot it.
 * - Everything done and the lead has answered: pine puts a check of that answer on the board, for a
 *   sub-agent that did none of the work, and the lead is called again to have it done and to act on
 *   what it found. What is checked is the answer the owner reads, against the request and against
 *   what was left: a check inside the lead's own call looked at the pieces before the answer was
 *   written, and a slip made while putting them together would pass it. A check that failed is
 *   followed by another one after the lead's fix.
 *
 * No model is asked whether the job is done: the board says so.
 *
 * Who may do what, as for a goal (src/goals.ts):
 * - Only the owner starts, pauses, resumes or clears a swarm, through the control API. No tool
 *   reaches it: an agent cannot make itself a swarm or give itself more rounds.
 * - It belongs to the owner's side of a conversation. A run started from outside ("~u") has none.
 * - What calls the lead again is the owner's objective and fixed text of pine's with numbers of
 *   tasks: never a word of the lead's answer or of a sub-agent's result. The check pine posts
 *   holds the lead's answer, as a task on the board with the mark of the run that wrote it, which
 *   is how any task the lead writes itself reaches a sub-agent.
 */

export type SwarmStatus = "active" | "waiting" | "done" | "paused" | "limit";

export interface Swarm {
	agent: string;
	/** The conversation, by its session key. */
	session: string;
	/** The job, in the owner's words. */
	objective: string;
	status: SwarmStatus;
	/** The lead's turn it is in, or ended in. The first is the owner's own message with the job. */
	round: number;
	/** The round after which it stops by itself. */
	until: number;
	set: number;
	/** The lead's turn that pine started and that waits or runs. */
	task?: number;
	/** The newest post of the conversation's board when the swarm began: what came after is the swarm's. */
	since: number;
	/** Checks of the lead's answer that pine put on the board. */
	checks: number;
	/** What happened last, in pine's words. */
	note: string;
}

/** How often pine has the lead's answer checked: once, and once more after a check that failed. */
export const MAX_CHECKS = 2;

/** What goes after the owner's job in the first message. Fixed text. */
const START = [
	"[pine: your owner started a swarm for the request above. You lead it. Your sub-agents do the work, on this conversation's board; you plan, hand out, answer and put together.",
	"1. Look first, briefly: what are the pieces of the job, and what do all of them have to go by? Read what settles that (a spec, a list of the files, one example). Do none of the pieces yourself.",
	"2. Hand out the whole job in ONE call of subagent:",
	'   - "tasks": one piece each, self-contained: what to do, which files are its own (by path), what it leaves alone, what done means. A job that one agent does in a few minutes is ONE piece: one sub-agent does all of it. Split only what is too much for one (many files, many items) or what can be written side by side, and then into pieces that are each real work: several small files can be one piece.',
	'   - "stages" instead of "tasks" when pieces build on others (first the base, then what uses it): a list of lists. Pieces that do not need each other go into the same stage, where they are done side by side.',
	'   - "note": what all of them go by, in full: values, names, formats, and every decision that two pieces have to agree on (an interface, how a value is held). Sub-agents cannot talk to each other: the note is what makes their pieces fit. What is the same for every piece is said here once, and each task is then a line or two that names its piece.',
	'   - "check": rarely. It puts a second sub-agent behind every single piece, so it doubles the work: only when each piece is something written under rules that a second look catches (a text of a set length, a file in a set form). What fails is done again and checked again by itself. Never for pieces that only read and report.',
	'   No "verify": the check of the whole is pine\'s. When you have answered, pine has your answer checked against the request, by a sub-agent that did none of the work, and calls you with what it found.',
	"   A piece that is another agent's (delegate lists them: its files and what it knows are its own) goes to that agent with delegate, in the same answer as the subagent call. pine puts it on the board for you: do not post it yourself.",
	'3. When the call comes back before all is done (a sub-agent asked or failed, or it had started as many as one call starts): answer what was asked with board_answer (what only your owner can know, ask them with question), then call subagent with "pool": true and nothing else to go on.',
	"4. Read what came back. A piece that came back wrong, and work that turned up on the way, you hand out again. Do not do or fix pieces yourself.",
	"5. Then answer your owner, in full and in the form they asked for: the result first, then what is still open. Write it once and clean, with every part of what was asked in it: this answer is what gets checked. Do not end by asking whether to do more.",
	"pine calls you again while tasks on the board are not done, and then once with the check of your answer.]",
].join("\n");

/** The first message of a swarm: the job as the owner typed it, and pine's fixed frame. */
export const startPrompt = (objective: string) => `${objective}\n\n${START}`;

const numbers = (xs: BoardItem[]) => xs.slice(0, 12).map((t) => `#${t.id}`).join(", ") + (xs.length > 12 ? ` and ${xs.length - 12} more` : "");
const job = (objective: string) => `\n\nThe job, in your owner's words:\n${objective}`;

/** What calls the lead again. The owner's objective, fixed text of pine's, and numbers of tasks: nothing a model wrote. */
export const continuePrompts = {
	handOut: (objective: string) => `[pine: the swarm goes on, and its board has no task that is not done. Hand out what is left of the job, in one call of subagent ("tasks" or "stages", with a "note"), and then answer your owner in full.]${job(objective)}`,
	unfinished: (objective: string, open: BoardItem[], blocked: BoardItem[]) =>
		`[pine: the swarm is not finished. ${open.length ? `Not done on the board: ${numbers(open)}. Call subagent with "pool": true to have them worked${blocked.length ? "" : ", or remove a task that is no longer needed (board_remove with its id)"}. ` : ""}${blocked.length ? `Waiting for an answer: ${numbers(blocked)}. Answer each with board_answer (board_read shows the question; what only your owner can know, ask them with question), then call subagent with "pool": true. ` : ""}When all are done, give your owner the answer in full.]${job(objective)}`,
	check: (objective: string, id: number, again: boolean) =>
		`[pine: ${again ? "your answer is checked once more, since the check before this one failed" : "before the swarm is done, your answer is checked"}. Task #${id} on the board is that check: a sub-agent that did none of the work compares your answer with the request and with what was left. Call subagent with "pool": true and nothing else to have it done; give no task of your own for checking. If it ends with PASS: your answer stands, and your owner has it on the screen. Reply with one line that says it was checked and passed, and nothing else: no part of the answer again, not its closing lines either. If it ends with FAIL: a slip in your answer (a name left out or twice, a number copied wrong, a part that is missing) you correct yourself; work that is wrong you hand out again. Then give your owner the whole answer again, as it now stands: it takes the place of the one before.]${job(objective)}`,
};

/** The report as it is, up to what a long task holds: cut in the middle, a check would call what was left out missing. */
const excerpt = (text: string, head = 6000, tail = 6000) => (text.length > head + tail ? `${text.slice(0, head)}\n[... ${text.length - head - tail} characters left out here: not missing from the report ...]\n${text.slice(-tail)}` : text);

/** The check of the lead's answer that pine posts when everything on the board is done. */
export const checkTask = (objective: string, answer: string) =>
	[
		"Check the answer below before the one who asked for it relies on it. You did none of the work, and you change nothing.",
		"First compare it with what was asked, part by part: is everything that was asked for there, in the form that was asked for, each thing once and none left out or twice? Then do not take its word for it: look at what was left (open the files it names, run what can be run, count again, compare with the source), as far as it takes to be sure. Where the job was large, check the parts that matter most and a few picked at random.",
		"Say what is wrong or missing and where, one line each; then end your answer with one word on a line of its own: PASS when the answer is right and complete, FAIL when it is not. FAIL is for what can be pointed at: a wrong fact or number, a rule that is broken, a part that is missing or there twice. What is a matter of taste or wording is a remark, not a FAIL. You judge the answer, not what the job was about: a job that was to find faults and found them all is PASS.",
		"",
		"What was asked, in the owner's words:",
		objective,
		"",
		"The answer:",
		excerpt(answer.trim()) || "(nothing)",
	].join("\n");

type Manager = Pick<AgentManager, "cfg" | "kv" | "tasks" | "bus" | "boards" | "goals" | "submit" | "cancel" | "taintOf">;

export class Swarms {
	private m: Manager;
	private log: Logger;
	private key: (session: string) => string;
	/** True while this class submits a message itself: that one is the swarm's, not the owner speaking. */
	private starting = false;

	constructor(manager: Manager, log: Logger, sessionKey: (session: string) => string) {
		this.m = manager;
		this.log = log;
		this.key = sessionKey;
	}

	private id(agent: string, session: string): string {
		return `swarm:${agent}:${session}`;
	}

	private conversation(agent: string, session: string): string {
		if (!this.m.cfg.agents[agent]) throw new Error(`unknown agent "${agent}"`);
		if (session.endsWith("~u")) throw new Error("this conversation holds what came from outside; a swarm is started in a conversation of your own");
		const key = this.key(session);
		if (key === "new") throw new Error("a swarm needs a conversation that stays: give it a name");
		return key;
	}

	/** The swarm of a conversation, if it has one. */
	get(agent: string, session: string): Swarm | undefined {
		if (session.endsWith("~u")) return undefined;
		return this.m.kv.get<Swarm>(this.id(agent, this.key(session))) ?? undefined;
	}

	private save(swarm: Swarm, event: string): Swarm {
		this.m.kv.set(this.id(swarm.agent, swarm.session), swarm);
		this.tell(swarm, event);
		return swarm;
	}

	/** For whoever shows the conversation: where the swarm stands and what just happened. */
	private tell(swarm: Swarm, event: string): void {
		this.log.info(`swarm of ${swarm.agent}/${swarm.session}: ${swarm.note}`);
		this.m.bus.publish(`agent/${swarm.agent}/swarm`, { ...swarm, event }, { source: "pine" });
	}

	private rounds(): number {
		return this.m.cfg.limits.swarmRounds;
	}

	/** The tasks of the conversation's board that came with this swarm. */
	private tasksOf(swarm: Swarm): BoardItem[] {
		const board = this.m.boards.find("local", swarm.agent, swarm.session, "");
		return board ? this.m.boards.items(board.id, { kind: "task", after: swarm.since }) : [];
	}

	/** Start a swarm on a job. Reached from the control API only. */
	set(agent: string, session: string, wanted: string): Swarm {
		const key = this.conversation(agent, session);
		const objective = String(wanted ?? "").trim();
		if (!objective) throw new Error("a swarm needs a job: say what is to be done");
		if (objective.length > 4000) throw new Error("the job of a swarm is at most 4000 characters: put the details into a file and name the file");
		if (!this.m.cfg.agents[agent].subagents.enabled) throw new Error(`${agent} has no sub-agents (subagents.enabled is off), and a swarm is made of them`);
		if (this.m.goals.get(agent, key)?.status === "active") throw new Error("this conversation works on a goal. /goal clear first, or start the swarm in another conversation");
		const board = this.m.boards.find("local", agent, key, "");
		const since = board ? this.m.boards.last(board.id) : 0;
		let task: Task;
		this.starting = true;
		try {
			task = this.m.submit({ agent, session: key, kind: "prompt", trust: "owner", priority: 10, prompt: startPrompt(objective) });
		} finally {
			this.starting = false;
		}
		this.end(agent, key);
		const until = this.rounds();
		return this.save({ agent, session: key, objective, status: "active", round: 1, until, set: Date.now(), task: task.id, since, checks: 0, note: `started: ${agent} leads it` }, "set");
	}

	/** No further rounds until the owner says so. A round that is running ends by itself. */
	pause(agent: string, session: string): Swarm {
		const swarm = this.get(agent, this.conversation(agent, session));
		if (!swarm) throw new Error("this conversation has no swarm");
		if (swarm.status !== "active" && swarm.status !== "waiting") throw new Error(`the swarm is not at work (${swarm.note})`);
		return this.halt(swarm, "paused", "paused by you. /swarm resume goes on");
	}

	/** Go on with a swarm that stopped. */
	resume(agent: string, session: string): Swarm {
		const swarm = this.get(agent, this.conversation(agent, session));
		if (!swarm) throw new Error("this conversation has no swarm: /swarm <what is to be done> starts one");
		if (swarm.status === "active") throw new Error("the swarm is at work already");
		const round = swarm.round + 1;
		const until = round > swarm.until ? swarm.round + this.rounds() : swarm.until;
		const next = { ...swarm, status: "active" as const, round, until };
		const tasks = this.tasksOf(next);
		const open = tasks.filter((t) => t.state === "open" || t.state === "taken");
		const blocked = tasks.filter((t) => t.state === "blocked");
		const task = this.next(next, tasks.length ? continuePrompts.unfinished(swarm.objective, open, blocked) : continuePrompts.handOut(swarm.objective));
		return this.save({ ...next, task: task.id, note: `resumed: round ${round} of ${until}` }, "resumed");
	}

	/** Take the swarm off a conversation. Its board and what is on it stay. */
	clear(agent: string, session: string): boolean {
		const swarm = this.end(agent, this.conversation(agent, session));
		if (swarm) this.tell({ ...swarm, status: "paused", task: undefined, note: "cleared" }, "cleared");
		return Boolean(swarm);
	}

	/** The conversation is reset or removed: its swarm goes with it. */
	drop(agent: string, session: string): void {
		if (!session.endsWith("~u")) this.end(agent, this.key(session));
	}

	/** The conversation has another name now. */
	rename(agent: string, from: string, to: string): void {
		const swarm = this.m.kv.get<Swarm>(this.id(agent, from));
		if (!swarm) return;
		this.m.kv.set(this.id(agent, from), null);
		this.m.kv.set(this.id(agent, to), { ...swarm, session: to });
	}

	/** After a start of the daemon: a swarm that was at work waits for the owner's word, like a goal. */
	restore(): void {
		for (const key of this.m.kv.keys("swarm:")) {
			const swarm = this.m.kv.get<Swarm>(key);
			if (swarm?.status === "active") this.halt(swarm, "paused", "paused: pine was restarted. /swarm resume goes on");
		}
	}

	private end(agent: string, key: string): Swarm | undefined {
		const swarm = this.m.kv.get<Swarm>(this.id(agent, key)) ?? undefined;
		if (!swarm) return undefined;
		this.m.kv.set(this.id(agent, key), null);
		this.unqueue(swarm);
		return swarm;
	}

	/** A round that has not started does not start. */
	private unqueue(swarm: Swarm): boolean {
		if (swarm.task === undefined || this.m.tasks.get(swarm.task)?.status !== "pending") return false;
		return this.m.cancel(swarm.task);
	}

	private halt(swarm: Swarm, status: SwarmStatus, note: string): Swarm {
		// Stored first: cancelling the waiting round reports its end back here, and must find the swarm stopped.
		const stopped: Swarm = { ...swarm, status, note };
		this.m.kv.set(this.id(swarm.agent, swarm.session), stopped);
		if (this.unqueue(swarm)) stopped.round = Math.max(0, stopped.round - 1);
		return this.save({ ...stopped, task: undefined }, status);
	}

	/**
	 * The task that calls the lead again: trust "owner" and kind "notify", like a goal's round. Its text
	 * is pine's own with the owner's objective; nothing the agent wrote or read is in it.
	 */
	private next(swarm: Swarm, prompt: string): Task {
		return this.m.submit({ agent: swarm.agent, session: swarm.session, kind: "notify", trust: "owner", priority: 10, label: `swarm: round ${swarm.round} of ${swarm.until}`, prompt });
	}

	/**
	 * A message of the owner's own arrives in a conversation whose swarm waits for their answer (the lead
	 * asked them something): the swarm goes on with it, and the turn it starts is looked at like any round.
	 * While the swarm is at work, their message is one more turn of the lead's; the board is looked at after it too.
	 */
	incoming(agent: string, session: string, kind: string, wantsAnswer: boolean): void {
		if (this.starting || session.endsWith("~u")) return;
		if (kind !== "prompt" && !(kind === "event" && wantsAnswer)) return;
		const swarm = this.m.kv.get<Swarm>(this.id(agent, session));
		if (swarm?.status === "waiting") this.save({ ...swarm, status: "active", task: undefined, round: swarm.round + 1, until: Math.max(swarm.until, swarm.round + 1), note: "goes on with your answer" }, "resumed");
	}

	/** A task ended. If it was a turn of the lead of a swarm that is at work, the board says what comes next. Called by `AgentManager.finish`. */
	ended(task: Task, stopping = false): void {
		if (task.parent !== undefined || task.meta.trust !== "owner" || task.session.endsWith("~u") || task.session.startsWith("_t")) return;
		const swarm = this.m.kv.get<Swarm>(this.id(task.agent, task.session));
		if (!swarm || swarm.status !== "active") return;
		// A round pine started still waits or runs: that one is looked at when it ends, not what ended beside it.
		if (swarm.task !== undefined && swarm.task !== task.id && ["pending", "running"].includes(this.m.tasks.get(swarm.task)?.status ?? "")) return;
		if (task.status === "cancelled") return void this.halt(swarm, "paused", stopping ? "paused: pine was stopped while it was working. /swarm resume goes on" : "paused: you stopped the agent. /swarm resume goes on");
		if (task.status !== "done") return void this.halt(swarm, "paused", `paused: round ${swarm.round} failed (${String(task.error ?? task.status).slice(0, 200)}). /swarm resume tries again`);
		try {
			this.look(swarm, task);
		} catch (e) {
			this.log.warn(`swarm of ${swarm.agent}/${swarm.session}: could not go on`, errText(e));
			this.halt(swarm, "paused", `paused: the next round could not be started (${errText(e)}). /swarm resume tries again`);
		}
	}

	/** What the board says after a turn of the lead's: go on, check, wait for the owner, or done. */
	private look(swarm: Swarm, task: Task): void {
		const { boards } = this.m;
		const tasks = this.tasksOf(swarm);
		const open = tasks.filter((t) => t.state === "open" || t.state === "taken");
		const blocked = tasks.filter((t) => t.state === "blocked");
		const answer = task.result ?? "";
		const rounds = `${swarm.round} round${swarm.round === 1 ? "" : "s"}`;
		const again = (prompt: string, note: string, more: Partial<Swarm> = {}) => {
			if (swarm.round >= swarm.until) return void this.halt(swarm, "limit", `stopped after ${rounds}, which is the limit (limits.swarmRounds), with work left. /swarm resume gives it ${this.rounds()} more`);
			const round = swarm.round + 1;
			const next = this.next({ ...swarm, round }, prompt);
			this.save({ ...swarm, ...more, round, task: next.id, note }, "continue");
		};
		// The lead asks its owner something while work is left, or before it did anything: the swarm waits for the
		// answer, and goes on with it (`incoming`). A question at the end of an answer to a finished job is an offer,
		// and changes nothing.
		const idle = !tasks.length && !(task.meta.stats?.tools.length ?? 0);
		if (asksAtEnd(answer) && (open.length || blocked.length || idle)) return void this.save({ ...swarm, status: "waiting", task: undefined, note: `${swarm.agent} asks you something: answer it, and the swarm goes on` }, "waiting");
		if (open.length || blocked.length) return again(continuePrompts.unfinished(swarm.objective, open, blocked), `${open.length + blocked.length} task${open.length + blocked.length === 1 ? " is" : "s are"} not done: round ${swarm.round + 1} of ${swarm.until} starts`);
		// Everything on the board is settled, and the lead has answered. That answer is what the owner reads, so it
		// is what is checked: by a sub-agent that did none of the work, against the request and what was left. A
		// check the lead had made inside its call (verify) looked at the pieces before this answer was written, and
		// does not stand in for it. Has the last such check passed, with no work done since?
		const work = tasks.filter((t) => t.data?.check === undefined && t.state === "done");
		const lastWork = Math.max(0, ...work.map((t) => t.updated));
		const last = tasks.filter((t) => t.data?.check === "job" && t.data?.answer === true && t.state === "done").at(-1);
		// (A check that says neither PASS nor FAIL has not said the answer is right: it counts like one that failed.)
		const passed = last !== undefined && last.updated >= lastWork && verdictOf(last.result) === "pass";
		const pieces = work.length;
		const how = pieces ? `${pieces} task${pieces === 1 ? "" : "s"}` : `${swarm.agent} did it without handing anything out`;
		if (passed) return void this.save({ ...swarm, status: "done", task: undefined, note: `done after ${rounds}: ${how}, and the answer was checked` }, "done");
		if (swarm.checks >= MAX_CHECKS) return void this.save({ ...swarm, status: "done", task: undefined, note: `ended after ${rounds}: ${how}, and the last check of the answer still found something wrong, see the answer` }, "done");
		const failed = last !== undefined;
		// The task holds the lead's answer, in full, and carries the mark of the run that wrote it.
		const board = boards.find("local", swarm.agent, swarm.session, "") ?? boards.ensure("local", swarm.agent, swarm.session, "");
		const tainted = this.m.taintOf(task);
		const check = boards.post(board, { kind: "task", text: checkTask(swarm.objective, answer), data: { check: "job", answer: true }, by: swarm.agent, trust: "owner", tainted, long: true });
		again(continuePrompts.check(swarm.objective, check.id, failed), failed ? "the check failed: the answer is checked once more" : "the answer is checked by a sub-agent that did none of the work", { checks: swarm.checks + 1 });
	}
}
