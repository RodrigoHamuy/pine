// One tab's conversation: what was said, the work of each turn folded into a line, and what
// waits for the owner. Each kind of line is a small component; the list only draws what changed.
import { ArrowUpIcon, BrainIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, CommandIcon, CpuIcon, FolderIcon, InfoIcon, ListChecksIcon, type LucideIcon, MessageCircleQuestionIcon, PanelRightIcon, PaperclipIcon, PlayIcon, SearchIcon, SettingsIcon, ShieldIcon, SquareIcon, StarIcon, TargetIcon, TriangleAlertIcon, Undo2Icon, XIcon, ZapIcon } from "lucide-react";
import { memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Confirmation, ConfirmationAction, ConfirmationActions, ConfirmationRequest, ConfirmationTitle } from "@/components/ai-elements/confirmation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Reasoning, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Task, TaskContent, TaskItem, TaskTrigger } from "@/components/ai-elements/task";
import { Tool, ToolContent, ToolOutput } from "@/components/ai-elements/tool";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { type AgentDetail, api, type TranscriptEntry } from "./api.ts";
import { Composer } from "./Composer.tsx";
import { Markdown, MEDIA } from "./markdown.tsx";
import { type Item, type Part, store, type Tab, type Tone, useModel, useSignal } from "./model.ts";
import { childKind, clock, count, MODES, oneLine, plural, short, speedText, tilde, took } from "./text.ts";
import { Pulse } from "./ui.tsx";

/** A picture that opens larger over the page, with a click or, focused, with Enter. */
const zoomable = {
	tabIndex: 0,
	onClick: (e: React.MouseEvent<HTMLImageElement>) => window.dispatchEvent(new CustomEvent("pine:zoom", { detail: e.currentTarget.src })),
	onKeyDown: (e: React.KeyboardEvent<HTMLImageElement>) => e.key === "Enter" && window.dispatchEvent(new CustomEvent("pine:zoom", { detail: e.currentTarget.src })),
};

const NOTE_TONE: Record<string, string | undefined> = { warn: "text-warn", bad: "text-destructive", good: "text-primary" };
const STATUS = "flex min-h-7.5 items-center gap-2 px-1 py-1.5 text-muted-foreground text-xs";

const TONE_ICON: Record<Tone, LucideIcon> = { muted: InfoIcon, warn: TriangleAlertIcon, bad: TriangleAlertIcon, good: CheckIcon, accent: Undo2Icon };

function Status({ status }: { status: "run" | "ok" | "fail" | "done" | "failed" | "cancelled" }) {
	if (status === "run") return <span className="inline-flex size-4 shrink-0 items-center justify-center"><Pulse size={11} /></span>;
	const ok = status === "ok" || status === "done";
	return <span className={cn("inline-flex size-4 shrink-0 items-center justify-center", ok ? "text-primary" : "text-destructive")}>{ok ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}</span>;
}

/** Thinking, folded into a line. Its text is shown as it is, never drawn as markdown: it is the model's own words. */
function Thought({ text, head, peek }: { text: string; head: ReactNode; peek?: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<Reasoning className="mb-0" open={open} onOpenChange={setOpen} data-part="thought">
			<ReasoningTrigger className="py-0.5 text-xs italic">
				<BrainIcon className="size-3.5" />
				{head}
				<ChevronDownIcon className={cn("size-3.5 transition-transform", open ? "rotate-180" : "rotate-0")} />
			</ReasoningTrigger>
			<CollapsibleContent className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground text-xs select-text">{text}</CollapsibleContent>
			{!open && peek ? <div className="mt-1 line-clamp-3 border-l-2 pl-3 text-muted-foreground text-xs">{text.slice(-600)}</div> : null}
		</Reasoning>
	);
}

/** One tool call: a line with what it did, which opens on what it returned or why it failed. */
function Call({ tool, subject, status, ms, depth = 0, output, error, images }: { tool: string; subject?: string; status: "run" | "ok" | "fail"; ms?: number; depth?: number; output?: string; error?: string; images?: string[] }) {
	const more = Boolean(output || error || images?.length);
	return (
		<Tool className="mb-0 border-0" style={{ paddingLeft: `calc(var(--spacing) * ${depth * 3.5})` }} data-part="tool" data-status={status}>
			<CollapsibleTrigger disabled={!more} className="flex w-full min-w-0 items-center gap-2 rounded-sm py-0.5 text-left text-xs enabled:cursor-pointer enabled:hover:bg-hover">
				<Status status={status} />
				<span className="shrink-0 font-mono text-foreground" data-tool>{tool}</span>
				<span className="truncate font-mono text-muted-foreground" title={subject}>{subject}</span>
				<span className="min-w-0 flex-1" />
				{ms !== undefined ? <span className="shrink-0 text-faint">{took(ms)}</span> : null}
			</CollapsibleTrigger>
			{more ? (
				<ToolContent className="p-2 pl-6">
					<ToolOutput output={output ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-2 font-mono select-text">{output}</pre> : undefined} errorText={error} />
					{(images ?? []).map((id) => (
						<div className={`it-media ${MEDIA.box.image}`} key={id}><img className={MEDIA.image} src={`pine-media://daemon/media/tool/${encodeURIComponent(id)}`} alt="" {...zoomable} /></div>
					))}
				</ToolContent>
			) : null}
		</Tool>
	);
}

function PartLine({ part, live }: { part: Part; live: boolean }) {
	if (part.p === "thought") {
		const secs = part.done ? undefined : Math.round((Date.now() - part.startedAt) / 1000);
		return <Thought text={part.text} peek={live && !part.done} head={<>{part.done ? `thought for ${took(part.ms)}` : `thinking ${secs}s`}{part.speed ? <span className="text-faint not-italic">{part.speed}</span> : null}</>} />;
	}
	if (part.p === "words") return <TaskItem className="whitespace-pre-wrap text-xs" data-part="words">{part.text}</TaskItem>;
	if (part.p === "child")
		return (
			<TaskItem className="flex min-w-0 items-center gap-2 text-xs" style={{ paddingLeft: `calc(var(--spacing) * ${Math.max(0, part.depth - 1) * 3.5})` }} data-part="child">
				<Status status={part.status} />
				<span className="shrink-0 font-mono text-foreground">↳ {part.agent}</span>
				<span className="truncate">{childKind(part.kind)} #{part.task}{part.how ? ` ${part.how}` : part.label ? `: ${part.label}` : ""}</span>
				<Button variant="link" size="xs" className="open-link" onClick={() => void store.openTask(part.task)}>open</Button>
			</TaskItem>
		);
	return <Call tool={part.tool} subject={part.subject} status={part.status} ms={part.ms} depth={part.depth} error={part.status === "fail" ? part.preview : undefined} />;
}

/** "12 tool calls · bash ×6 · read ×4 · edit · +1 more · 2 thoughts · 1 failed · 48s" */
function workHead(parts: Part[], done: boolean, ms?: number): string {
	const tools = parts.filter((p) => p.p === "tool") as Array<Extract<Part, { p: "tool" }>>;
	const by = new Map<string, number>();
	for (const t of tools) by.set(t.tool, (by.get(t.tool) ?? 0) + 1);
	const top = [...by].sort((a, b) => b[1] - a[1]);
	const thoughts = parts.filter((p) => p.p === "thought").length;
	const subs = parts.filter((p) => p.p === "child").length;
	const failed = tools.filter((t) => t.status === "fail").length;
	return [
		tools.length ? `${plural(tools.length, "tool call")}${done ? "" : " so far"}` : "",
		...top.slice(0, 3).map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)),
		top.length > 3 ? `+${top.length - 3} more` : "",
		subs ? plural(subs, "sub-task") : "",
		thoughts ? plural(thoughts, "thought") : "",
		failed ? `${failed} failed` : "",
		done && ms !== undefined ? took(ms) : "",
	]
		.filter(Boolean)
		.join(" · ");
}

function Work({ item }: { item: Extract<Item, { t: "work" }> }) {
	const [open, setOpen] = useState(item.open);
	const parts = item.parts;
	// A turn with a single call or thought is that call or thought itself, with no line above it.
	if (parts.length === 1 && item.done) return <div className="py-1" data-item="work"><PartLine part={parts[0]} live={false} /></div>;
	const shown = open ? parts : item.done ? [] : parts.slice(-6);
	// While the turn runs its last lines show under the head; a click shows all of them, another folds it.
	return (
		<Task open={shown.length > 0} onOpenChange={() => ((item.open = !open), setOpen(!open))} className="py-1" data-item="work" data-open={open || undefined}>
			<TaskTrigger title={workHead(parts, item.done, item.ms) || "working"}>
				<div className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-muted-foreground text-xs transition-colors hover:text-foreground">
					{item.done ? <ChevronRightIcon className={cn("size-3.5 transition-transform", open && "rotate-90")} /> : <Pulse size={12} />}
					<span className="min-w-0 flex-1 truncate text-left">{workHead(parts, item.done, item.ms) || "working"}</span>
					{!item.done && !open && parts.length > 6 ? <span className="text-faint">show all</span> : null}
				</div>
			</TaskTrigger>
			<TaskContent className="[&>div]:mt-1 [&>div]:space-y-0.5">
				{shown.map((p, i) => (
					<PartLine key={open ? i : parts.length - shown.length + i} part={p} live={!item.done} />
				))}
			</TaskContent>
		</Task>
	);
}

function Entry({ entry, agent }: { entry: TranscriptEntry; agent: string }) {
	if (entry.kind === "user")
		return (
			<Message from="user" data-item="user">
				<MessageContent className="whitespace-pre-wrap select-text"><span className="text-faint text-xs">task</span>{entry.text}</MessageContent>
			</Message>
		);
	if (entry.kind === "text")
		return (
			<Message from="assistant" className="max-w-full">
				<MessageContent className="w-full"><Markdown text={entry.text ?? ""} where={{ agent }} /></MessageContent>
			</Message>
		);
	if (entry.kind === "thinking") return <Thought text={entry.text ?? ""} head="thought" />;
	const ok = entry.ok === undefined ? "run" : entry.ok ? "ok" : "fail";
	const result = entry.result ? short(entry.result, 4000) : undefined;
	return <Call tool={entry.tool ?? ""} subject={entry.subject ? oneLine(entry.subject) : ""} status={ok} ms={entry.ms} output={ok === "fail" ? undefined : result} error={ok === "fail" ? result : undefined} images={entry.images} />;
}

/**
 * A request of the agent's, in the conversation: what it wants and why, answered right here or
 * in the dialog. What needs typing (a secret, the owner's own words) opens the dialog.
 */
function ApprovalCard({ item }: { item: Extract<Item, { t: "approval" }> }) {
	const { req, state } = item;
	const question = req.tool === "question";
	const choices = req.choices ?? [];
	const typed = Boolean(req.inputs?.length);
	const head = state === "open" ? (question ? `${req.agent} asks` : "Approval needed") : state === "gone" ? "No longer open" : question ? (state === "allowed" ? "Answered" : "No answer") : state === "allowed" ? "Allowed" : "Denied";
	const by = state !== "open" && item.by ? <span className="text-faint"> ({item.by}){item.always && req.remember ? ` · ${req.remember} will not ask again in this conversation` : ""}</span> : null;
	return (
		<div className="py-1" data-item="approval" data-state={state}>
			<Confirmation approval={state === "open" ? { id: req.id } : { id: req.id, approved: state === "allowed" }} state={state === "open" ? "approval-requested" : state === "gone" ? "output-denied" : "approval-responded"} className={cn(state !== "open" && "py-2 text-muted-foreground")}>
				<ConfirmationTitle className="flex items-start gap-2">
					{state === "open" ? question ? <MessageCircleQuestionIcon className="mt-0.5 size-4 shrink-0" /> : <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warn" /> : state === "allowed" ? <CheckIcon className="mt-0.5 size-4 shrink-0" /> : <XIcon className="mt-0.5 size-4 shrink-0" />}
					<span className="min-w-0">
						<b className="text-foreground">{head}</b>
						{question ? null : <> · <span className="font-mono">{req.tool}</span></>}
						{by}
						{state === "gone" ? <span className="text-faint"> · pine was restarted, or the question ran out of time</span> : null}
						<span className="block whitespace-pre-wrap break-words text-foreground select-text">{req.summary}</span>
					</span>
				</ConfirmationTitle>
				<ConfirmationRequest>
					{question ? null : <div className="pl-6 text-muted-foreground text-xs">{req.why}</div>}
					{question && choices.length ? (
						<Suggestions className="pl-6">
							{choices.map((c, i) => <Suggestion key={i} suggestion={c} variant={i === 0 ? "default" : "outline"} title={i === 0 ? "recommended" : undefined} onClick={(text) => void store.decide(req.id, true, false, { answer: text })} />)}
						</Suggestions>
					) : null}
				</ConfirmationRequest>
				<ConfirmationActions>
					{question ? (
						<>
							<ConfirmationAction variant="ghost" onClick={() => void store.decide(req.id, false)}>No answer</ConfirmationAction>
							<ConfirmationAction variant="outline" onClick={() => store.ask(req.id)}>{choices.length ? "In my own words…" : "Answer…"}</ConfirmationAction>
						</>
					) : typed ? (
						<>
							<ConfirmationAction variant="outline" onClick={() => void store.decide(req.id, false)}>Deny</ConfirmationAction>
							<ConfirmationAction onClick={() => store.ask(req.id)}>Decide…</ConfirmationAction>
						</>
					) : (
						<>
							<ConfirmationAction variant="outline" onClick={() => void store.decide(req.id, false)}>Deny</ConfirmationAction>
							{req.remember ? <ConfirmationAction variant="outline" onClick={() => void store.decide(req.id, true, true)}>Always here</ConfirmationAction> : null}
							<ConfirmationAction onClick={() => void store.decide(req.id, true)}>{req.holds ? "Allow" : "Allow once"}</ConfirmationAction>
						</>
					)}
				</ConfirmationActions>
			</Confirmation>
		</div>
	);
}

/** The agent's list of steps (its todo tool): how far it is, and each step. */
export function Steps({ items }: { items: Array<{ text: string; status: string }> }) {
	const done = items.filter((t) => t.status === "done").length;
	return (
		<Task data-item="steps">
			<TaskTrigger title={`steps · ${done} of ${items.length} done`}>
				<div className="flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-xs hover:text-foreground">
					<ListChecksIcon className="size-3.5" />
					<span>steps · {done} of {items.length} done</span>
					<span className="h-1 w-16 overflow-hidden rounded-full bg-press"><i className="block h-full bg-primary" style={{ width: `${(100 * done) / Math.max(1, items.length)}%` }} /></span>
					<ChevronDownIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
				</div>
			</TaskTrigger>
			<TaskContent className="[&>div]:mt-2 [&>div]:space-y-1">
				{items.map((t, i) => (
					<TaskItem key={i} className={cn("flex items-start gap-2 text-xs", t.status === "done" && "line-through", t.status === "in_progress" && "text-foreground")} data-status={t.status}>
						<span className={cn("mt-0.5 inline-flex size-3 shrink-0 items-center justify-center rounded-sm border", t.status === "done" && "border-primary bg-primary text-primary-foreground")}>{t.status === "done" ? <CheckIcon className="size-2.5" /> : null}</span>
						<span className="select-text">{t.text}</span>
					</TaskItem>
				))}
			</TaskContent>
		</Task>
	);
}


/** One item of a conversation, drawn as what it is. */
export const Row = memo(function Row({ item, tab }: { item: Item; v: number; tab: Tab }) {
	switch (item.t) {
		case "user":
			return (
				<Message from="user" className="py-1" data-item="user">
					<MessageContent className="whitespace-pre-wrap break-words select-text">
						{item.from ? <span className="text-faint text-xs">{item.from}</span> : null}
						{item.text}
						{item.files?.length ? <div className="flex flex-wrap gap-1">{item.files.map((f) => <Badge variant="outline" key={f}><PaperclipIcon data-icon="inline-start" />{f}</Badge>)}</div> : null}
					</MessageContent>
				</Message>
			);
		case "answer":
			return (
				<Message from="assistant" className="max-w-full py-1" data-item="answer">
					<MessageContent className="w-full">
						<Markdown text={item.text} live={item.live} where={{ agent: item.agent, session: tab.kind === "chat" ? tab.session : undefined }} />
					</MessageContent>
				</Message>
			);
		case "work":
			return <Work item={item} />;
		case "note": {
			const ToneIcon = TONE_ICON[item.tone];
			return (
				// The tone stays a class of its own too: the tests find a note by it.
				<div className={cn("it-note flex cursor-auto gap-2 text-muted-foreground text-xs select-text", item.tone, NOTE_TONE[item.tone])}>
					<ToneIcon size={14} className="mt-0.5" />
					<div className="min-w-0 flex-1">
						<span className={item.tone === "accent" ? "text-primary" : undefined}>{item.text}</span>
						{item.action ? <Button variant="link" size="xs" className="open-link ml-2" onClick={item.action.run}>{item.action.label}</Button> : null}
						{item.lines?.length ? <div className="mt-0.5 flex flex-col gap-px text-muted-foreground">{item.lines.filter((l) => l.text).map((l, i) => <span key={i} className={l.tone ? NOTE_TONE[l.tone] : undefined}>{l.text}</span>)}</div> : null}
					</div>
				</div>
			);
		}
		case "event":
			return (
				<div className="flex gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs select-text">
					<ZapIcon size={14} className="mt-0.5 text-warn" />
					<div className="min-w-0 flex-1">
						<b>{item.label}</b>
						<div className="text-muted-foreground wrap-anywhere">{short(oneLine(tilde(item.body)), 400)}</div>
					</div>
				</div>
			);
		case "approval":
			return <ApprovalCard item={item} />;
		case "steps":
			return <div className="my-1 rounded-lg border p-3"><Steps items={item.items} /></div>;
		case "media":
			return (
				<div className={`it-media ${MEDIA.box[item.kind]}`}>
					{item.kind === "image" ? <img className={MEDIA.image} src={item.url} alt={item.name} draggable={false} {...zoomable} /> : item.kind === "video" ? <video className={MEDIA.video} src={item.url} controls preload="metadata" /> : <audio className={MEDIA.audio} src={item.url} controls preload="metadata" />}
					<div className={MEDIA.cap}>{item.name}</div>
				</div>
			);
		case "goal": {
			const g = item.goal;
			const wait = g.status !== "met" && g.status !== "active";
			return (
				<div className="flex gap-2 text-xs select-text">
					<span className={cn("shrink-0", wait ? "text-warn" : "text-primary")}>{g.status === "met" ? "check" : wait ? <ClockIcon size={14} /> : <TargetIcon size={14} />}</span>
					<div>
						<b>goal</b> <span className="text-muted-foreground">{g.note}</span>
						{g.reason ? <div className="text-muted-foreground">{short(oneLine(g.reason), 240)}</div> : null}
						{item.full ? <div className="text-muted-foreground">the goal: {short(oneLine(g.objective), 320)}</div> : null}
					</div>
				</div>
			);
		}
		case "divider":
			return (
				<div className="flex items-center gap-3 text-faint text-xs">
					<span className="h-px flex-1 bg-line-soft" />
					{item.text}
					<span className="h-px flex-1 bg-line-soft" />
				</div>
			);
		case "entry":
			return <Entry entry={item.entry} agent={tab.agent} />;
	}
});

/** Where a conversation begins: who this agent is, what it runs on and reaches, and what it has. */
function Welcome({ tab }: { tab: Tab }) {
	useModel(store);
	const info = store.agent(tab.agent);
	const [has, setHas] = useState<AgentDetail>();
	useEffect(() => {
		let live = true;
		// (An older pine does not say; the line is then left out.)
		api.agentDetail(tab.agent).then((d) => live && setHas(d), () => {});
		return () => {
			live = false;
		};
	}, [tab.agent]);
	const say = (text: string) => {
		tab.draft = text;
		tab.touch();
		store.ask_("focus-input");
	};
	const mode = MODES.find((m) => m.value === info?.mode);
	const h = has?.holdings;
	const counts: Array<[string, number]> = h ? [["skill", h.skills.length], ["event source", h.sources.length], ["schedule", h.schedules.length], ["MCP server", h.servers.length], ["conversation", h.conversations.length]] : [];
	return (
		<div className="welcome my-auto flex flex-col items-start gap-2.5 py-10">
			<span className="grid size-10 shrink-0 place-items-center rounded-xl bg-press font-semibold text-foreground text-xl">{tab.agent.slice(0, 1).toUpperCase()}</span>
			<h1 className="mt-1.5 font-semibold text-2xl tracking-tight">{tab.agent}</h1>
			{/* A long path is broken where the line ends, not pushed out of it. */}
			<p className="max-w-lg text-muted-foreground wrap-anywhere">{info?.description || "An agent of yours."}</p>
			<div className="mt-0.5 flex flex-wrap gap-1.5">
				<Badge variant="outline" title="The model it runs on"><CpuIcon size={12} /><b>{info?.model ?? "no model"}</b></Badge>
				<Badge variant="outline" title={mode?.about}><ShieldIcon size={12} /><b>{info?.mode}</b>{info?.mode === "auto" || info?.mode === "bypass" ? "your account, no sandbox" : "in its sandbox"}</Badge>
				{info?.main ? <Badge variant="outline" title="It creates and changes the other agents and pine's settings when you ask it to">administers pine</Badge> : null}
				{info?.delegates.length ? <Badge variant="outline" title="Agents it can hand work to">hands work to <b>{info.delegates.includes("*") ? "every agent" : info.delegates.join(", ")}</b></Badge> : null}
				{counts.filter(([, n]) => n > 0).map(([what, n]) => <Badge variant="outline" key={what}><b>{n}</b>{n === 1 ? what : `${what}s`}</Badge>)}
			</div>
			{info?.modelProblem ? (
				<Alert className="notice max-w-xl">
					<TriangleAlertIcon />
					<AlertDescription>{info.modelProblem} Sign in to a provider (a Claude, ChatGPT or Copilot subscription, or an API key) or add a model server of your own, then choose the model {tab.agent} runs on.</AlertDescription>
					<AlertAction>
						<Button variant="outline" size="xs" onClick={() => store.openSettings("models")}>Models…</Button>
					</AlertAction>
				</Alert>
			) : null}
			<p className="text-faint wrap-anywhere">
				{tab.session === "main" ? "Its main conversation: the one it keeps for good, and where what it is subscribed to as an agent arrives." : `Conversation ${tab.session}.`} {tab.folder ? `It works in ${tilde(tab.folder)}.` : "It works in its own workspace."}
			</p>
			<div className="mt-2 flex flex-wrap gap-1.5">
				<Suggestion size="xs" suggestion="What can you do for me, and what are you set up with?" onClick={say}>What can you do?</Suggestion>
				<Button variant="outline" size="xs" onClick={() => store.openSettings("agents", tab.agent)}><SettingsIcon data-icon="inline-start" />Agent settings</Button>
				<Button variant="outline" size="xs" onClick={() => void store.pickFolder(tab)}><FolderIcon data-icon="inline-start" />Give it a folder</Button>
				<Button variant="outline" size="xs" onClick={() => void store.command("palette")}><CommandIcon data-icon="inline-start" />Commands <kbd className="rounded-sm border bg-card px-1 font-sans text-faint text-xs">⌘K</kbd></Button>
			</div>
		</div>
	);
}

/**
 * Find in the conversation. The matches are marked with the browser's own highlights, which
 * change nothing in the page: no element is added to what an answer drew.
 */
function FindBar({ root, close, initial }: { root: () => HTMLElement | null; close: () => void; initial?: string }) {
	const [query, setQuery] = useState(initial ?? "");
	const [at, setAt] = useState(0);
	const ranges = useRef<Range[]>([]);
	const [count, setCount] = useState(0);
	const marks = (CSS as any).highlights as Map<string, unknown> | undefined;
	useEffect(() => {
		const el = root();
		ranges.current = [];
		const q = query.toLowerCase();
		if (el && q) {
			const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
			for (let node = walker.nextNode(); node && ranges.current.length < 2000; node = walker.nextNode()) {
				const text = (node.textContent ?? "").toLowerCase();
				for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
					const r = new Range();
					r.setStart(node, i);
					r.setEnd(node, i + q.length);
					ranges.current.push(r);
				}
			}
		}
		setCount(ranges.current.length);
		// The newest match first: what is looked for is usually near the end.
		setAt(Math.max(0, ranges.current.length - 1));
		marks?.set("pine-find", new (window as any).Highlight(...ranges.current));
		return () => void (marks?.delete("pine-find"), marks?.delete("pine-find-at"));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query]);
	useEffect(() => {
		const r = ranges.current[at];
		if (!r) return void marks?.delete("pine-find-at");
		marks?.set("pine-find-at", new (window as any).Highlight(r));
		(r.startContainer.parentElement as HTMLElement | null)?.closest("details:not([open])")?.setAttribute("open", "");
		r.startContainer.parentElement?.scrollIntoView({ block: "center" });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [at, count]);
	const step = (by: number) => count && setAt((at + by + count) % count);
	return (
		<div className="find absolute top-11.5 right-5.5 z-5 flex items-center gap-1 rounded-lg border bg-card py-1 pr-1.5 pl-2.5 text-xs shadow-md">
			<SearchIcon size={13} className="text-faint" />
			<input
				autoFocus
				className="w-55 border-0 bg-transparent outline-none select-text"
				placeholder="Find in this conversation"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Escape") close();
					if (e.key === "Enter") step(e.shiftKey ? 1 : -1);
				}}
			/>
			<span className="text-faint">{query ? (count ? `${at + 1} of ${count}` : "nothing") : ""}</span>
			<Button variant="ghost" size="icon-xs" title="Earlier (↩)" onClick={() => step(-1)}><ArrowUpIcon /></Button>
			<Button variant="ghost" size="icon-xs" title="Later (⇧↩)" onClick={() => step(1)}><ChevronDownIcon /></Button>
			<Button variant="ghost" size="icon-xs" onClick={close}><XIcon /></Button>
		</div>
	);
}

/** The line above the input: what is going on right now, and the way to stop it. */
function StatusLine({ tab }: { tab: Tab }) {
	const [, tick] = useState(0);
	useEffect(() => {
		if (!tab.busy) return;
		const t = window.setInterval(() => tick((n) => n + 1), 1000);
		return () => window.clearInterval(t);
	}, [tab.busy]);
	const waiting = [...tab.approvals.values()];
	const elsewhere = store.tabs.find((t) => t !== tab && t.approvals.size > 0);
	const goal = tab.goal?.status === "active" ? tab.goal : undefined;
	if (!tab.busy) {
		if (waiting.length) return <div className={cn(STATUS, "text-warn")}><TriangleAlertIcon size={14} /><span>{waiting[0].req.tool === "question" ? "A question waits for your answer." : "A request waits for your approval."}</span><Button variant="outline" size="xs" onClick={() => store.ask(waiting[0].req.id)}>Open</Button></div>;
		if (goal) return <div className={STATUS}><TargetIcon size={14} /><span>goal · round {goal.round} of {goal.until} · checking whether it is met</span><Button variant="outline" size="xs" onClick={() => void store.setGoal(tab, "pause")}>Pause</Button></div>;
		if (elsewhere) return <div className={cn(STATUS, "text-warn")}><TriangleAlertIcon size={14} /><span>{elsewhere.agent} · {elsewhere.session} waits for you.</span><Button variant="outline" size="xs" onClick={() => store.activate(elsewhere)}>Go there</Button></div>;
		if (tab.programs.length) return <div className={STATUS}><PlayIcon size={13} /><span>{plural(tab.programs.length, "program")} still running</span><Button variant="ghost" size="xs" onClick={() => void store.command("code-running")}>Show</Button></div>;
		return <div className={STATUS} />;
	}
	const secs = Math.max(0, Math.round((Date.now() - tab.startedAt) / 1000));
	const steps = tab.steps?.items ?? [];
	const at = steps.findIndex((s) => s.status === "in_progress");
	const helpers = [...tab.children.values()].filter((c) => c.running).length;
	const total = tab.tokens.input + tab.tokens.cached;
	const parts = [
		waiting.length ? "waiting for you" : tab.thinking ? "thinking" : "working",
		clock(secs),
		at >= 0 ? `step ${at + 1} of ${steps.length}` : "",
		tab.toolCalls ? plural(tab.toolCalls, "tool call") : "",
		helpers ? `${plural(helpers, "sub-task")} running` : "",
		tab.tokens.output ? `${count(total)}↑${tab.tokens.cached ? ` (${Math.round((100 * tab.tokens.cached) / Math.max(1, total))}% cached)` : ""} ${count(tab.tokens.output)}↓` : "",
		speedText(tab.speed),
	].filter(Boolean);
	return (
		<div className={cn(STATUS, waiting.length && "text-warn")}>
			<Pulse size={13} />
			{goal ? <span>goal · round {goal.round} of {goal.until}</span> : null}
			{parts.map((p, i) => <span key={i} className={i || goal ? "before:mr-2 before:text-faint before:content-['·']" : undefined}>{p}</span>)}
			<span className="min-w-0 flex-1" />
			{waiting.length ? <Button variant="outline" size="xs" onClick={() => store.ask(waiting[0].req.id)}>Open</Button> : null}
		</div>
	);
}

/** What a conversation is, in one line at its top: whose, which, where it works; and how full its context is. */
function ConvHead({ tab }: { tab: Tab }) {
	useModel(store);
	const chat = tab.kind === "chat";
	const total = tab.tokens.input + tab.tokens.cached;
	return (
		<div className="conv-head flex h-10 min-w-0 shrink-0 items-center gap-2 pr-2 pl-3 text-xs">
			<span className="grid size-5 shrink-0 place-items-center rounded-sm bg-press font-semibold text-muted-foreground text-xs">{tab.agent.slice(0, 1).toUpperCase()}</span>
			<span className="text-muted-foreground">{tab.agent}</span>
			<span className="text-faint">/</span>
			<b className="min-w-0 shrink truncate font-semibold" title={chat ? `conversation ${tab.session}` : undefined}>{chat ? store.titleOf(tab.agent, tab.session) : `task #${tab.task}`}</b>
			{chat && tab.folder ? <Button variant="ghost" size="xs" className="min-w-0 shrink" title={`Works in ${tab.folder}`} onClick={() => void store.pickFolder(tab)}><FolderIcon data-icon="inline-start" /><span className="truncate">{tilde(tab.folder)}</span></Button> : null}
			{chat && store.pins.has(tab.key) ? <StarIcon size={12} className="text-faint" /> : null}
			<span className="min-w-0 flex-1" />
			{tab.context !== undefined ? (
				<span className="mr-1 flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs tabular-nums" title={`Context ${tab.context}% full${tab.cacheShare !== undefined ? ` · ${tab.cacheShare}% of the last request came from the model server's cache` : ""}${speedText(tab.speed) ? ` · ${speedText(tab.speed)}` : ""}`}>
					<Ring percent={tab.context} />
					{total ? `${count(total)} · ` : ""}{Math.round(tab.context)}%
				</span>
			) : null}
			{chat ? <Button variant={store.code ? "secondary" : "ghost"} size="icon-xs" aria-pressed={store.code} title="The agent and its workspace: what it has, files, changes, output (⌥⌘B)" onClick={() => void store.command("code")}><PanelRightIcon /></Button> : null}
		</div>
	);
}

/** A small ring that fills with the conversation's context window. */
function Ring({ percent }: { percent: number }) {
	const r = 6;
	const c = 2 * Math.PI * r;
	const colour = percent >= 85 ? "var(--bad)" : percent >= 65 ? "var(--warn)" : "var(--text-muted)";
	return (
		<svg className="shrink-0 -rotate-90" width="16" height="16" viewBox="0 0 16 16">
			<circle cx="8" cy="8" r={r} fill="none" stroke="var(--press)" strokeWidth="2" />
			<circle cx="8" cy="8" r={r} fill="none" stroke={colour} strokeWidth="2" strokeDasharray={`${(c * Math.min(100, percent)) / 100} ${c}`} strokeLinecap="round" />
		</svg>
	);
}

export function Conversation({ tab }: { tab: Tab }) {
	useModel(tab);
	// It opens by a key, and by itself when the conversation was found by words that are in it.
	const take = () => (store.pendingFind?.key === tab.key ? store.pendingFind.query : undefined);
	const [finding, setFinding] = useState(() => take() !== undefined);
	const [looked, setLooked] = useState(() => {
		const q = take();
		if (q !== undefined) store.pendingFind = undefined;
		return q;
	});
	useSignal("find", () => {
		if (store.active !== tab) return;
		const q = take();
		if (q !== undefined) (store.pendingFind = undefined), setLooked(q);
		setFinding(true);
	});
	// The words are marked once what was said is on the page.
	const loaded = tab.loaded;
	const scroller = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const [away, setAway] = useState(false);
	const toEnd = () => {
		const el = scroller.current;
		if (el) el.scrollTop = el.scrollHeight;
	};
	// A new tab starts at its end; what arrives keeps the end in view unless the reader went up.
	useLayoutEffect(() => {
		stick.current = true;
		toEnd();
	}, [tab.id]);
	useLayoutEffect(() => {
		if (stick.current) toEnd();
	});
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		// Text that is drawn a frame later (an answer that is still arriving) grows the page after the layout above.
		const ro = new ResizeObserver(() => stick.current && toEnd());
		for (const child of el.children) ro.observe(child);
		return () => ro.disconnect();
	}, [tab.id]);
	const chat = tab.kind === "chat";
	return (
		<div className="relative flex min-w-85 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
			<ConvHead tab={tab} />
			{finding && loaded ? <FindBar key={looked ?? ""} initial={looked} root={() => scroller.current} close={() => (setFinding(false), setLooked(undefined))} /> : null}
			<div
				// No scroll anchoring: the code above keeps the end in view, and the browser's own would fight it.
				className="flex-1 overflow-x-hidden overflow-y-auto [overflow-anchor:none]"
				ref={scroller}
				onScroll={(e) => {
					const el = e.currentTarget;
					const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
					stick.current = near;
					if (away === near) setAway(!near);
				}}
			>
				<div className="column mx-auto flex min-h-full max-w-3xl flex-col gap-3.5 px-7 pt-7 pb-2">
					{!tab.loaded ? <div className="m-auto py-10"><Pulse /></div> : !tab.items.length && chat ? <Welcome tab={tab} /> : tab.items.map((item) => <Row key={item.id} item={item} v={item.v} tab={tab} />)}
				</div>
			</div>
			{away ? <Button variant="outline" size="xs" className="absolute bottom-3 left-1/2 z-3 -translate-x-1/2 shadow-md" onClick={() => ((stick.current = true), toEnd(), setAway(false))}><ChevronDownIcon data-icon="inline-start" />Latest</Button> : null}
			<div className="shrink-0 px-7 pb-4">
				<div className="relative mx-auto max-w-3xl">
					<StatusLine tab={tab} />
					{chat ? (
						<Composer tab={tab} />
					) : tab.busy ? (
						<div className="flex items-center gap-2"><span className="min-w-0 flex-1 text-muted-foreground">This tab shows one task's work and takes no messages.</span><Button variant="outline" size="xs" onClick={() => void store.stop(tab)}><SquareIcon data-icon="inline-start" />Stop this task</Button></div>
					) : null}
				</div>
			</div>
		</div>
	);
}
