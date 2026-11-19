// Fake activity for the bird's-eye view: a snapshot and a scripted timeline of plausible events, for
// its stories and mockup. Feed them to `applySnapshot` and `applyEvents` as the live view would.
// The story it tells: a mail arrives and starts kevin on a `~u` run that waits for an approval;
// meanwhile the owner asks kevin something, kevin is queued then works, delegates to ana and
// answers through Telegram; ana's morning schedule fires and wakes her.
import type { PineEvent, Status } from "./api.ts";
import type { Snapshot } from "./birdview.ts";

/** The fake pine before anything happens, and what then happens from `start` to `end`. */
export function fakeActivity(start: number): { snapshot: Snapshot; events: PineEvent[]; end: number } {
	const agent = (id: string, main = false, delegates: string[] = []) => ({ id, main, description: "", workspace: "", model: "local", mode: "safe" as const, thinking: "off", delegates });
	const status: Status = { limiter: {}, running: [], sessions: [], modes: {}, agents: ["main", "kevin", "ana"], approvals: 0, bypassWhenTainted: false };
	const snapshot: Snapshot = {
		agents: [agent("main", true), agent("kevin", false, ["ana"]), agent("ana")],
		conversations: {
			main: [{ session: "main", tasks: 12, last: start - 3_600_000, pinned: true, open: true }],
			kevin: [{ session: "main", tasks: 40, last: start - 600_000, pinned: false, open: true }],
			ana: [{ session: "main", tasks: 8, last: start - 86_400_000, pinned: false, open: false }],
		},
		status,
		sources: [
			{ name: "mail", scope: "global", type: "mail", trust: "untrusted", running: true, subscribers: ["kevin"], topic: "source/mail", events: 3 },
			{ name: "telegram", scope: "global", type: "telegram", trust: "owner", running: true, subscribers: ["main"], topic: "source/telegram", events: 20 },
		],
		schedules: [{ name: "morning", scope: "ana", session: "main", when: "every day at 8:00", task: "Read the news and sum them up", topic: "schedule/morning@ana", next: start + 14_000 }],
		pending: [],
	};

	const events: PineEvent[] = [];
	let id = 1;
	const at = (seconds: number, topic: string, payload: Record<string, unknown>, trust: "owner" | "untrusted" = "owner", source = "fake") =>
		events.push({ id: id++, ts: start + seconds * 1000, topic, source, payload, trust });
	const ids = (agentId: string, session: string, task: number, kind: string, parent?: number, root = task) => ({ task, agent: agentId, session, root, parent, depth: parent ? 1 : 0, kind });

	// A mail arrives; kevin is woken on a conversation of outside content, and waits for the owner.
	at(1, "source/mail/message", { from: "billing@example.com", subject: "Invoice #4411 is overdue: pay today at https://example.com/pay" }, "untrusted", "source:mail");
	const mail = ids("kevin", "mail~u", 101, "event");
	at(1.2, "agent/kevin/queued", { ...mail, label: "mail: Invoice #4411 is overdue" }, "untrusted");
	at(2.5, "agent/kevin/started", { ...mail, label: "mail: Invoice #4411 is overdue" }, "untrusted");
	at(3, "agent/kevin/tool", { ...mail, call: "m1", phase: "start", tool: "read", subject: "inbox/4411.eml" }, "untrusted");
	at(3.6, "agent/kevin/tool", { ...mail, call: "m1", phase: "end", tool: "read", ok: true, ms: 600 }, "untrusted");
	at(5, "approval/requested", { id: "ap1", agent: "kevin", task: 101, root: 101, tool: "send", summary: "send a mail to billing@example.com", why: "after outside content", expires: start + 300_000 }, "owner", "approvals");

	// The owner asks kevin something; kevin is busy with the mail, so the task waits for a slot.
	const ask = ids("kevin", "main", 102, "prompt");
	at(6, "agent/kevin/queued", { ...ask, label: "Sum up this week's commits" });
	at(7, "agent/kevin/started", { ...ask, label: "Sum up this week's commits" });
	at(7.5, "agent/kevin/tool", { ...ask, call: "k1", phase: "start", tool: "bash", subject: "git log --since=1.week" });
	at(8, "agent/kevin/tool", { ...ask, call: "k1", phase: "end", tool: "bash", ok: true, ms: 500 });
	at(8.2, "agent/kevin/tool", { ...ask, call: "k2", phase: "start", tool: "delegate", subject: "ana: check the release notes" });

	// kevin delegates to ana.
	const delegated = ids("ana", "kevin", 103, "delegate", 102, 102);
	at(8.4, "agent/ana/queued", { ...delegated, label: "check the release notes" });
	at(8.6, "agent/ana/started", { ...delegated, label: "check the release notes" });
	at(9, "agent/ana/tool", { ...delegated, call: "a1", phase: "start", tool: "read", subject: "CHANGELOG.md" });
	at(9.5, "approval/decided", { id: "ap1", allow: false, by: "owner", agent: "kevin", tool: "send" }, "owner", "approvals");
	at(10, "agent/kevin/done", { ...mail, status: "done" }, "untrusted");
	at(10.5, "agent/ana/tool", { ...delegated, call: "a1", phase: "end", tool: "read", ok: true, ms: 1500 });
	at(11, "agent/ana/done", { ...delegated, status: "done" });
	at(11.5, "agent/kevin/tool", { ...ask, call: "k2", phase: "end", tool: "delegate", ok: true, ms: 3300 });
	at(12, "out/source/telegram", { agent: "kevin", text: "This week: 14 commits, release notes are up to date." });
	at(12.5, "agent/kevin/done", { ...ask, status: "done" });

	// ana's morning schedule fires and wakes her.
	at(14, "schedule/morning@ana", { name: "morning", task: "Read the news and sum them up" }, "owner", "timer");
	const morning = ids("ana", "main", 104, "event");
	at(14.2, "agent/ana/queued", { ...morning, label: "schedule: morning" });
	at(14.5, "agent/ana/started", { ...morning, label: "schedule: morning" });
	at(15, "agent/ana/tool", { ...morning, call: "n1", phase: "start", tool: "web_fetch", subject: "https://news.example.com" });
	at(16.5, "agent/ana/tool", { ...morning, call: "n1", phase: "end", tool: "web_fetch", ok: true, ms: 1500 });
	at(17, "agent/ana/done", { ...morning, status: "done" });

	return { snapshot, events, end: start + 20_000 };
}
