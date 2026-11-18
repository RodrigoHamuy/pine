// The agent, beside its conversation: who it is, what it runs on, what it is doing, and what it
// has been given (what it listens to, its schedules, skills and servers, what it remembers).
// A conversation in pine is a conversation with an agent; this is the agent.
import { CheckIcon, CpuIcon, SettingsIcon, ShieldIcon, SparkleIcon, BookIcon, ClockIcon, PlugIcon, ZapIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "./api.ts";
import { store, type Tab, useModel } from "./model.ts";
import { childKind, MODES, oneLine, short } from "./text.ts";
import { Pulse, useLoad } from "./ui.tsx";
import { ScrollFadeArea } from "@/components/scroll-fade-area";

const FACT = "inline-flex items-center gap-1.5 rounded-md border border-line-soft bg-raised px-2 py-0.5 text-xs text-muted-foreground [&_b]:font-medium [&_b]:text-foreground";
const CLICK = "hover:border-faint hover:text-foreground";
const NONE = "px-3.5 py-0.5 text-faint wrap-anywhere";
const LOG = "m-0 px-3 py-2.5 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-muted-foreground select-text";
const LINE = "agent-line flex min-h-7 items-center gap-2 px-3.5";
const NAME = "name max-w-2/5 flex-none truncate font-medium";
const ABOUT = "about min-w-0 flex-1 truncate text-muted-foreground";

function Section({ title, count, children, action }: { title: string; count?: number; children: React.ReactNode; action?: React.ReactNode }) {
	return (
		<section>
			<h3 className="mt-1.5 mb-1 flex min-h-6 items-center gap-2 pr-2 pl-3.5 text-xs font-semibold text-faint">
				{title}
				{count !== undefined ? <Badge variant="secondary">{count}</Badge> : null}
				<span className="min-w-0 flex-1" />
				{action}
			</h3>
			{children}
		</section>
	);
}

const Line = ({ icon: Icon, name, about, tag, run }: { icon: LucideIcon; name: string; about?: string; tag?: string; run?: () => void }) => (
	<div className={cn(LINE, run && "hover:bg-hover")} onClick={run} title={about}>
		<Icon size={13} className="text-faint" />
		<span className={NAME}>{name}</span>
		<span className={ABOUT}>{about}</span>
		{tag ? <Badge variant="secondary">{tag}</Badge> : null}
	</div>
);

export function AgentView({ tab }: { tab: Tab }) {
	useModel(tab);
	const s = useModel(store);
	const info = s.agent(tab.agent);
	// Each is asked by itself: an older pine answers only some of them, and what it does not know is left out.
	const quiet = <T,>(ask: () => Promise<T>) => () => ask().catch(() => undefined);
	const detail = useLoad(quiet(() => api.agentDetail(tab.agent)), [tab.agent, tab.codeTick]);
	const sources = useLoad(quiet(() => api.agentSources(tab.agent, tab.session)), [tab.key, tab.codeTick]);
	const schedules = useLoad(quiet(() => api.schedules()), [tab.agent, tab.codeTick]);
	const skills = useLoad(quiet(() => api.skills()), [tab.agent, tab.codeTick]);
	const servers = useLoad(quiet(() => api.mcp()), [tab.agent, tab.codeTick]);
	if (!info) return null;
	const mode = MODES.find((m) => m.value === info.mode);
	const listens = (sources.data ?? []).filter((x) => x.local || x.agent || x.global);
	const could = (sources.data ?? []).length - listens.length;
	const timed = (schedules.data ?? []).filter((x) => x.scope === tab.agent || (x.scope === "global" && x.task));
	const knows = (skills.data ?? []).filter((x) => x.scope === "global" || (x.agent === tab.agent && (x.scope === "agent" || x.session === tab.session)));
	const tools = (servers.data ?? []).filter((x) => x.enabled && x.agents.includes(tab.agent) && (!x.session || x.session === tab.session));
	const helpers = [...tab.children].reverse().slice(0, 8);
	const elsewhere = [...s.busy].filter(([key, tasks]) => tasks.size && key.startsWith(`${tab.agent}:`) && key !== tab.key).map(([key]) => key.slice(tab.agent.length + 1));
	const memory = detail.data?.files.memory?.trim();
	return (
		<ScrollFadeArea className="agent-view flex-1 cursor-auto text-xs select-text">
		<div className="flex flex-col gap-3 pb-2">
			<div className="flex items-start gap-3 px-3.5 pt-4 pb-0.5">
				<span className="grid size-10 flex-none place-items-center rounded-lg bg-press text-xl font-semibold text-foreground">{tab.agent.slice(0, 1).toUpperCase()}</span>
				<div className="min-w-0 flex-1">
					<div className="agent-name flex items-center gap-2 text-base font-semibold">{tab.agent}{info.main ? <Badge className="bg-brand-soft text-primary">main</Badge> : null}</div>
					<div className="text-muted-foreground">{info.description || "no description"}</div>
				</div>
				<Button variant="outline" size="xs" onClick={() => s.openSettings("agents", tab.agent)}><SettingsIcon data-icon="inline-start" />Settings</Button>
			</div>
			<div className="mt-0.5 flex flex-wrap gap-1.5 px-3.5">
				<button type="button" className={cn(FACT, CLICK)} title="The model it runs on" onClick={() => void s.pickModel(tab)}><CpuIcon size={12} /><b>{info.model}</b></button>
				<button type="button" className={cn(FACT, CLICK)} title="How much its model thinks before it answers" onClick={() => void s.pickReasoning(tab)}><SparkleIcon size={12} />reasoning <b>{info.thinking}</b></button>
				<button type="button" className={cn(FACT, CLICK)} title={mode?.about} onClick={() => void s.pickMode(tab)}><ShieldIcon size={12} /><b>{info.mode}</b>{info.mode === "auto" || info.mode === "bypass" ? "your account" : "in its sandbox"}</button>
				{info.delegates.length ? <span className={FACT} title="Agents it can hand work to">hands work to <b>{info.delegates.includes("*") ? "every agent" : info.delegates.join(", ")}</b></span> : null}
			</div>

			{tab.busy || helpers.length || elsewhere.length ? (
				<Section title="At work">
					{tab.busy ? <div className={LINE}><Pulse size={11} /><span className={NAME}>this conversation</span><span className={ABOUT}>{tab.thinking ? "thinking" : "working"}{tab.toolCalls ? ` · ${tab.toolCalls} tool calls` : ""}</span></div> : null}
					{helpers.map(([id, c]) => (
						<div key={id} className={cn(LINE, "hover:bg-hover")} onClick={() => void s.openTask(id)}>
							{c.running ? <Pulse size={11} /> : <CheckIcon size={13} className="text-faint" />}
							<span className={NAME}>{c.agent}</span>
							<span className={ABOUT}>{childKind(c.kind)} #{id}: {c.label}</span>
							<Badge variant="secondary">open</Badge>
						</div>
					))}
					{elsewhere.map((session) => <div key={session} className={cn(LINE, "hover:bg-hover")} onClick={() => void s.openTab(tab.agent, session)}><Pulse size={11} /><span className={NAME}>{session}</span><span className={ABOUT}>another conversation of {tab.agent}</span><Badge variant="secondary">open</Badge></div>)}
				</Section>
			) : null}

			{sources.data ? (
				<Section title="Listens to" count={listens.length} action={<Button variant="ghost" size="xs" onClick={() => s.openSettings("events")}>Events</Button>}>
					{listens.length ? listens.map((x) => <Line key={x.name} icon={ZapIcon} name={x.name} about={(x.local ?? x.agent ?? x.global)?.note || x.description || x.type} tag={x.local ? "this conversation" : x.agent ? "as an agent" : "all agents"} />) : <div className={NONE}>Nothing wakes it by itself.{could > 0 ? ` ${could} event source${could === 1 ? "" : "s"} could: ask it to watch one, or subscribe it under Events.` : " Ask it to watch something (“tell me when a file lands in ~/Scans”)."}</div>}
				</Section>
			) : null}
			{schedules.data ? (
				<Section title="Schedules" count={timed.length}>
					{timed.length ? timed.map((x) => <Line key={`${x.scope}:${x.name}`} icon={ClockIcon} name={x.name} about={`${x.when}${x.task ? ` · ${oneLine(x.task)}` : ""}`} tag={x.scope === "global" ? "all agents" : x.session && x.session !== "main" ? x.session : undefined} />) : <div className={NONE}>Nothing is scheduled. Ask it (“every morning at seven …”).</div>}
				</Section>
			) : null}
			{skills.data ? (
				<Section title="Skills" count={knows.length} action={<Button variant="ghost" size="xs" onClick={() => s.openSettings("skills")}>Skills</Button>}>
					{knows.length ? knows.map((x) => <Line key={x.dir} icon={BookIcon} name={x.name} about={x.description} tag={x.scope === "global" ? "all agents" : x.scope === "local" ? "this conversation" : undefined} />) : <div className={NONE}>No skills yet. Ask it to “make a skill for this”.</div>}
				</Section>
			) : null}
			{servers.data ? (
				<Section title="MCP servers" count={tools.length} action={<Button variant="ghost" size="xs" onClick={() => s.openSettings("mcp")}>Servers</Button>}>
					{tools.length ? tools.map((x) => <Line key={`${x.scope}:${x.name}`} icon={PlugIcon} name={x.name} about={x.target} tag={x.scope === "global" ? "all agents" : x.session ? "this conversation" : undefined} />) : <div className={NONE}>No MCP servers.</div>}
				</Section>
			) : null}
			{memory !== undefined ? (
				<Section title="What it remembers">
					{memory ? <ScrollFadeArea className="mx-3.5 max-h-56 rounded-md bg-sunk"><pre className={LOG}>{short(memory, 6000)}</pre></ScrollFadeArea> : <div className={NONE}>Its MEMORY.md is empty.</div>}
				</Section>
			) : null}
			{detail.data ? <div className={cn(NONE, "pb-4")}>Its workspace is {detail.data.workspace}; the Files view shows {tab.folder ? "the folder this conversation works in" : "it"}.</div> : null}
		</div>
		</ScrollFadeArea>
	);
}
