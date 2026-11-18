// The window: the list of agents and conversations at the side, the tabs along the top, one
// conversation in the middle with its panel, and whatever lies over them for a moment (a list
// to pick from, a question, the palette).
import { ArrowUpIcon, AudioLinesIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, FolderIcon, ListIcon, MessageSquareIcon, PanelLeftIcon, PlusIcon, SearchIcon, SettingsIcon, StarIcon, Trash2Icon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { type Layout, usePanelRef } from "react-resizable-panels";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { cn } from "cn";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { type AgentInfo, api, type Approval, type Conversation as Conv } from "./api.ts";
import { bridge } from "./bridge.ts";
import { CODE_KEY, CodePanel } from "./CodePanel.tsx";
import { COMMANDS } from "./commands.ts";
import { Conversation } from "./Conversation.tsx";
import { Events } from "./Events.tsx";
import { type Picker, store, type Tab, useModel, useSignal } from "./model.ts";
import { Settings } from "./Settings.tsx";
import { ago, fuzzy, until } from "./text.ts";
import { List, ListRow } from "./lists.tsx";
import { Confirm } from "./Confirm.tsx";
import { Logo, Notices, Pulse } from "./ui.tsx";

// ---- before pine answers -----------------------------------------------------------------------------

function Gate() {
	const s = useModel(store);
	const state = s.service;
	const init = async () => {
		s.initRunning = true;
		s.initLines = [];
		s.touch();
		const code = await bridge.init().catch(() => 1);
		s.initRunning = false;
		s.touch();
		if (code === 0) await bridge.retry();
		else s.flash("pine init did not finish. What it said is shown above.", "bad");
	};
	return (
		<div className="gate">
			<div className="gate-in">
				<Logo size={36} />
				{state.status === "starting" ? (
					<>
						<h1>Starting pine</h1>
						<p className="row"><Pulse /> Looking for a running pine, or starting one…</p>
					</>
				) : state.status === "error" && state.kind === "no-home" ? (
					<>
						<h1>Welcome to pine</h1>
						<p>pine keeps its agents, their workspaces and its settings in a home folder ({s.prefs.home ?? s.home ?? "~/.pine"}). There is none yet. Setting it up copies the example home and fetches the browser its web tools drive (about 600 MB, once).</p>
						{s.initLines.length ? <pre className="log" style={{ width: "100%" }}>{s.initLines.slice(-40).join("\n")}</pre> : null}
						<div className="row">
							<Button disabled={s.initRunning} onClick={() => void init()}>{s.initRunning ? <><Pulse size={12} /> Setting up…</> : "Set up pine"}</Button>
							<Button variant="outline" disabled={s.initRunning} onClick={() => void bridge.retry()}>Try again</Button>
						</div>
					</>
				) : state.status === "error" ? (
					<>
						<h1>{state.kind === "no-node" ? "pine needs Node" : state.kind === "no-pine" ? "pine is not installed" : "pine did not start"}</h1>
						<p>{state.message}</p>
						<div className="row">
							<Button onClick={() => void bridge.retry()}>Try again</Button>
							{state.kind === "no-node" ? <Button variant="outline" onClick={() => void bridge.open("https://nodejs.org")}>nodejs.org</Button> : null}
						</div>
					</>
				) : (
					<p className="row"><Pulse /> Loading your agents…</p>
				)}
			</div>
		</div>
	);
}

// ---- the side ----------------------------------------------------------------------------------------
// The side bar is the agents. Each is a group of its own: who it is, whether it is at work, and
// under it its conversations. What starts something new stands on the agent's own line, so it
// is never a question whom a new conversation or a folder is for.

function ConversationRow({ agent, c }: { agent: string; c: Conv }) {
	const s = store;
	const tab = s.tabs.find((t) => t.kind === "chat" && t.agent === agent && t.session === c.session);
	const main = c.session === "main";
	const menu = async () => {
		const picked = await bridge.contextMenu([
			{ id: "open", label: "Open" },
			...(main ? [] : [{ id: "pin", label: c.pinned ? "Unpin" : "Pin" }, { id: "rename", label: "Rename…" }]),
			{ id: "sep", label: "", separator: true },
			main ? { id: "reset", label: "Start over…" } : { id: "remove", label: "Remove…" },
		]);
		if (picked === "open") await s.openTab(agent, c.session);
		if (picked === "pin") {
			await s.attempt(() => api.pinSession(agent, c.session, !c.pinned));
			await s.refreshConversations(agent);
		}
		if (picked === "rename") {
			const to = await s.pick({ title: `Another name for ${c.session}`, items: [], free: true, placeholder: "The new name" });
			if (to?.trim()) await s.rename(agent, c.session, to.trim());
		}
		if (picked === "remove") {
			const sure = await s.pick({ title: `Remove the conversation ${c.session} of ${agent}?`, items: [{ value: "yes", label: "Remove it for good", about: "Its history, what it may do without asking, what it listens to and whatever was set up for it alone all go.", tone: "bad" }, { value: "no", label: "Cancel" }] });
			if (sure === "yes") await s.removeConversation(agent, c.session);
		}
		if (picked === "reset") {
			await s.openTab(agent, c.session);
			if (s.active) await s.reset(s.active);
		}
	};
	const kept = main ? "the agent's own, always kept" : c.pinned ? "pinned" : c.open ? "open in a tab" : c.expires ? `goes ${until(c.expires)}` : "kept";
	const working = tab?.busy || s.isBusy(agent, c.session);
	return (
		<ListRow value={c.session} label={s.titleOf(agent, c.session)} className={`side-row side-conv${tab && tab === s.active ? " on" : ""}`} onContextMenu={(e) => (e.preventDefault(), void menu())} title={`${agent} · ${c.session} · ${kept}${c.folder ? ` · works in ${c.folder}` : ""}`}>
			<span className="lead">{tab?.approvals.size ? <span className="needs">!</span> : working ? <Pulse size={11} /> : tab?.unread ? <span className="dot unread" /> : main || c.pinned ? <StarIcon size={12} className="faint" /> : c.folder ? <FolderIcon size={12} className="faint" /> : <MessageSquareIcon size={12} className="faint" />}</span>
			<span className="cut grow">{s.titleOf(agent, c.session)}</span>
			<span className="when">{c.tasks ? ago(c.last).replace(" ago", "") : ""}</span>
			{main ? null : (
				<span className="acts" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.currentTarget.contains(e.target as Node) && e.stopPropagation()} onKeyDown={(e) => e.currentTarget.contains(e.target as Node) && e.stopPropagation()}>
					<Confirm icon={Trash2Icon} label="Remove this conversation for good" question={`Remove the conversation ${s.titleOf(agent, c.session)} for good?`} action="Remove" onConfirm={() => void s.removeConversation(agent, c.session)} />
				</span>
			)}
		</ListRow>
	);
}

function AgentGroup({ a }: { a: AgentInfo }) {
	const s = store;
	const folded = s.folded.has(a.id);
	const list = s.conversations.get(a.id) ?? [];
	// The agent's own conversation first, then what is pinned, then by when it was last used.
	const sorted = [...list].sort((x, y) => Number(y.session === "main") - Number(x.session === "main") || Number(y.pinned) - Number(x.pinned) || y.last - x.last);
	const rows = sorted.some((c) => c.session === "main") ? sorted : [{ session: "main", tasks: 0, last: 0, pinned: false, open: false }, ...sorted];
	// A conversation that is open in a tab and has not been said anything in yet is not in the daemon's list.
	for (const t of s.tabs) if (t.kind === "chat" && t.agent === a.id && !rows.some((c) => c.session === t.session)) rows.push({ session: t.session, tasks: 0, last: Date.now(), pinned: false, open: true });
	const tabs = s.tabs.filter((t) => t.agent === a.id && t.kind === "chat");
	const waits = tabs.some((t) => t.approvals.size > 0);
	const working = s.isBusy(a.id) || tabs.some((t) => t.busy);
	const unread = tabs.some((t) => t.unread);
	const pickFolder = async () => {
		const dir = await bridge.pickFolder(`A folder for a conversation with ${a.id}`);
		if (dir) await s.openFolder(dir, a.id);
	};
	const menu = async () => {
		const picked = await bridge.contextMenu([
			{ id: "new", label: `New conversation with ${a.id}` },
			{ id: "folder", label: `Open a folder with ${a.id}…` },
			{ id: "sep", label: "", separator: true },
			{ id: "settings", label: "Agent settings…" },
			// The main agent administers pine and stays.
			...(a.main ? [] : [{ id: "sep2", label: "", separator: true }, { id: "remove", label: `Remove ${a.id}…` }]),
		]);
		if (picked === "new") await s.newConversation(a.id);
		if (picked === "folder") await pickFolder();
		if (picked === "settings") s.openSettings("agents", a.id);
		if (picked === "remove") await s.removeAgent(a.id);
	};
	return (
		<Collapsible className="side-group" open={!folded} onOpenChange={() => s.toggleFold(a.id)}>
			<div className="side-agent" title={`${a.id}: ${a.description || "no description"}\n${a.model} · ${a.mode}`} onContextMenu={(e) => (e.preventDefault(), void menu())}>
				<CollapsibleTrigger className="fold-trigger">
					{folded ? <ChevronRightIcon size={10} className="faint" /> : <ChevronDownIcon size={10} className="faint" />}
					<span className="avatar">{a.id.slice(0, 1).toUpperCase()}</span>
					<span className="who">
						<span className="cut">{a.id}</span>
						<span className="what"><span>{a.description || a.model}</span></span>
					</span>
					{waits ? <span className="needs">!</span> : working ? <Pulse size={11} /> : unread && folded ? <span className="dot unread" /> : null}
				</CollapsibleTrigger>
				<span className="agent-acts">
					<Button variant="ghost" size="icon-xs" title={`Settings of ${a.id}`} onClick={() => s.openSettings("agents", a.id)}><SettingsIcon /></Button>
					<Button variant="ghost" size="icon-xs" title={`Open a folder for a conversation with ${a.id}`} onClick={() => void pickFolder()}><FolderIcon /></Button>
				</span>
				<Button variant="ghost" size="icon-xs" title={`New conversation with ${a.id}`} onClick={() => void s.newConversation(a.id)}><PlusIcon /></Button>
			</div>
			<CollapsibleContent>
				<List label={`Conversations with ${a.id}`} value={s.active?.kind === "chat" && s.active.agent === a.id ? s.active.session : null} onOpen={(session) => void s.openTab(a.id, session)}>
					{rows.map((c) => <ConversationRow key={c.session} agent={a.id} c={c} />)}
				</List>
			</CollapsibleContent>
		</Collapsible>
	);
}

function Sidebar() {
	const s = useModel(store);
	const ready = s.service.status === "ready";
	const front = s.active;
	const newer = s.update?.status === "newer" ? s.update : undefined;
	return (
		<aside className="sidebar">
			<div className="side-top">
				<Button variant="ghost" size="icon" title="Hide the sidebar (⌘B)" onClick={() => void s.command("sidebar")}><PanelLeftIcon /></Button>
			</div>
			<div className="side-scroll">
				<div className="side-row" onClick={() => void s.command("palette")} title="Find a conversation by its name or by what was said in it, or a command, an agent, a settings page"><SearchIcon size={14} /><span className="grow">Search</span><kbd>⌘K</kbd></div>
				<div className="side-label">Agents<span className="grow" /><Button variant="ghost" size="icon-xs" title="New agent" onClick={() => s.openSettings("agents", "+")}><PlusIcon /></Button></div>
				{s.agents.map((a) => <AgentGroup key={a.id} a={a} />)}
			</div>
			<div className="side-foot">
				{newer ? <div className="side-row side-update" onClick={() => void bridge.open(newer.url)} title={`This is Pine ${newer.mine}. Opens the release's page on GitHub in your browser: download the disk image there and put the app in place of this one.`}><ArrowUpIcon size={14} /><span className="grow cut">Pine {newer.version} is available</span><ExternalLinkIcon size={12} /></div> : null}
				<div className={`side-row${front?.kind === "events" ? " on" : ""}`} onClick={() => void s.openEvents()}><AudioLinesIcon size={14} /><span className="grow">Events</span></div>
				<div className={`side-row${front?.kind === "settings" ? " on" : ""}`} onClick={() => s.openSettings()}><SettingsIcon size={14} /><span className="grow">Settings</span><kbd>⌘,</kbd></div>
				<div className="side-status" title={s.service.status === "ready" ? `${s.service.home} · ${s.service.started ? "started by this app" : "a pine that was already running"}` : ""}>
					<span className={`dot ${!ready ? "warn" : s.connected ? "good" : "bad"}`} />
					<span className="cut">{!ready ? "starting" : !s.connected ? "pine does not answer" : `pine${s.service.status === "ready" && s.service.version ? ` ${s.service.version}` : ""} · ${s.service.status === "ready" && s.service.started ? "started here" : "attached"}`}</span>
				</div>
			</div>
		</aside>
	);
}

// ---- the tabs ------------------------------------------------------------------------------------------

function TabButton({ tab, index }: { tab: Tab; index: number }) {
	useModel(tab);
	const s = store;
	const [drop, setDrop] = useState(false);
	const on = s.active === tab;
	const kept = tab.kind === "chat" && (tab.session === "main" || s.pins.has(tab.key));
	return (
		<div
			className={`tab${on ? " on" : ""}${drop ? " drop" : ""}`}
			draggable
			onDragStart={(e) => (e.dataTransfer.setData("application/x-pine-tab", String(index)), (e.dataTransfer.effectAllowed = "move"))}
			onDragOver={(e) => e.dataTransfer.types.includes("application/x-pine-tab") && (e.preventDefault(), setDrop(true))}
			onDragLeave={() => setDrop(false)}
			onDrop={(e) => (setDrop(false), s.moveTab(Number(e.dataTransfer.getData("application/x-pine-tab")), index))}
			onClick={() => s.activate(tab)}
			onAuxClick={(e) => e.button === 1 && s.closeTab(tab)}
			title={tab.kind === "chat" ? `${tab.agent} · ${tab.session}${tab.folder ? ` · ${tab.folder}` : ""}` : tab.kind === "task" ? `task #${tab.task}` : tab.kind}
		>
			<span className="mark">
				{tab.approvals.size ? <span className="needs">!</span> : tab.busy ? <Pulse size={11} /> : tab.unread ? <span className="dot unread" /> : tab.kind === "events" ? <AudioLinesIcon size={12} /> : tab.kind === "settings" ? <SettingsIcon size={12} /> : tab.kind === "task" ? <ListIcon size={12} /> : <span className="avatar small">{tab.agent.slice(0, 1).toUpperCase()}</span>}
			</span>
			<span className="name">
				{tab.kind === "events" ? "Events" : tab.kind === "settings" ? "Settings" : tab.kind === "task" ? <><b>{tab.agent}</b> #{tab.task}</> : tab.session === "main" ? <b>{tab.agent}</b> : <><b>{tab.agent}</b> · {s.titleOf(tab.agent, tab.session)}</>}
			</span>
			{kept && tab.session !== "main" ? <StarIcon size={10} className="star" /> : null}
			<span className="close" onClick={(e) => (e.stopPropagation(), s.closeTab(tab))}><XIcon size={11} /></span>
		</div>
	);
}

function TitleBar() {
	const s = useModel(store);
	const with_ = s.agentInFront();
	return (
		<header className="titlebar">
			{s.sidebar ? null : <Button variant="ghost" size="icon" title="Show the sidebar (⌘B)" onClick={() => void s.command("sidebar")}><PanelLeftIcon /></Button>}
			<div className="tabs">
				{s.tabs.map((t, i) => <TabButton key={t.id} tab={t} index={i} />)}
			</div>
			<Button variant="ghost" size="icon" title={with_ ? `New conversation with ${with_} (⌘T)` : "New conversation (⌘T): you are asked with which agent"} onClick={() => void s.newConversation()}><PlusIcon /></Button>
			<span className="grow" />
		</header>
	);
}

// ---- what lies over the window for a moment --------------------------------------------------------------

/**
 * Which line of a cmdk list is active, announced to screen readers. cmdk names the active line in
 * aria-activedescendant only when the choice is made outside React's effects (a key, the pointer):
 * the line it picks by itself when the list is drawn or the text changes is shown but never named.
 * So once the list is drawn (`redo` changed) the line is chosen again as the pointer would choose it:
 * `start` the first time, then the first line. The value is let go of first, since cmdk ignores a
 * choice of the line it already has: both drawn at once, so that no key comes between.
 */
function useActiveLine(root: React.RefObject<HTMLDivElement | null>, redo: unknown, start?: string) {
	const [value, setValue] = useState(start ?? "");
	const first = useRef(true);
	useEffect(() => {
		const target = first.current ? start : undefined;
		first.current = false;
		const frame = requestAnimationFrame(() => {
			flushSync(() => setValue(""));
			const line = root.current?.querySelector(target === undefined ? "[cmdk-item]" : `[cmdk-item][data-value="${CSS.escape(target)}"]`);
			flushSync(() => line?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })));
		});
		return () => cancelAnimationFrame(frame);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [redo]);
	return { value, onValueChange: setValue };
}

/**
 * What had focus when a dialog opened, to give it back when it closes. A dialog whose field takes focus
 * as it is drawn (autoFocus: the keys typed at once go there) would otherwise give it back to that field.
 */
function useOpener(): () => HTMLElement | null {
	const [opener] = useState(() => document.activeElement as HTMLElement | null);
	return () => opener;
}

export function PickDialog({ p }: { p: Picker }) {
	const [query, setQuery] = useState("");
	const shown = useMemo(() => (query && !p.free ? p.items.map((i) => ({ i, rank: Math.min(...[fuzzy(query, i.label), fuzzy(query, i.about ?? "") + 10].filter((r) => r >= 0), 99) })).filter((x) => x.rank < 99).sort((a, b) => a.rank - b.rank).map((x) => x.i) : p.items), [query, p]);
	// The list starts on the one in use.
	const root = useRef<HTMLDivElement>(null);
	const line = useActiveLine(root, query, p.current);
	const opener = useOpener();
	// A short list is chosen from with the arrows; its field is there for the keyboard and for screen readers, unseen.
	const typing = p.free || p.items.length > 7;
	const list = (
		<Command
			ref={root}
			{...line}
			shouldFilter={false}
			loop
			onKeyDown={(e) => {
				// Words of the owner's own count before the list where both are possible.
				if (e.key === "Enter" && p.free && query.trim()) (e.preventDefault(), p.done(query.trim()));
			}}
		>
			<div className={typing ? undefined : "sr-only"}>
				<CommandInput autoFocus placeholder={p.placeholder ?? "Type to narrow the list"} value={query} onValueChange={setQuery} />
			</div>
			<CommandList className="max-h-[52vh]">
				{shown.length ? (
					<CommandGroup>
						{shown.map((i) => (
							<CommandItem key={i.value} value={i.value} data-checked={i.value === p.current} onSelect={() => p.done(i.value)}>
								<span className={cn("label max-w-[60%] flex-none truncate", i.tone === "bad" && "text-destructive")}>{i.label}</span>
								{i.about ? <span className="about min-w-0 truncate text-xs text-muted-foreground">{i.about}</span> : null}
							</CommandItem>
						))}
					</CommandGroup>
				) : null}
				{p.free ? null : <CommandEmpty>Nothing fits.</CommandEmpty>}
			</CommandList>
		</Command>
	);
	const close = (open: boolean) => open || p.done(undefined);
	if (p.items.some((i) => i.tone === "bad"))
		return (
			<AlertDialog open onOpenChange={close}>
				<AlertDialogContent finalFocus={opener} className="gap-2 p-2 data-[size=default]:sm:max-w-[560px]">
					<AlertDialogHeader className="px-2 pt-2">
						<AlertDialogTitle>{p.title}</AlertDialogTitle>
					</AlertDialogHeader>
					{list}
				</AlertDialogContent>
			</AlertDialog>
		);
	return (
		<Dialog open onOpenChange={close}>
			<DialogContent showCloseButton={false} finalFocus={opener} className="gap-2 p-2 sm:max-w-[560px]">
				<DialogHeader className="px-2 pt-2">
					<DialogTitle>{p.title}</DialogTitle>
				</DialogHeader>
				{list}
			</DialogContent>
		</Dialog>
	);
}

export function Palette() {
	const s = store;
	const [query, setQuery] = useState("");
	const root = useRef<HTMLDivElement>(null);
	const line = useActiveLine(root, query);
	const opener = useOpener();
	useModel(s);
	type Row = { id: string; group: string; label: string; about?: string; keys?: string; run: () => void; conv?: { agent: string; session: string } };
	const all = useMemo(() => {
		const chat = s.active?.kind === "chat";
		const rows: Row[] = [];
		for (const t of s.tabs) rows.push({ id: `t:${t.id}`, group: "Open tabs", label: t.kind === "chat" ? `${t.agent} · ${s.titleOf(t.agent, t.session)}` : t.kind === "task" ? `${t.agent} task #${t.task}` : t.kind === "settings" ? "Settings" : "Events", run: () => s.activate(t), conv: t.kind === "chat" ? { agent: t.agent, session: t.session } : undefined });
		for (const [agent, convs] of s.conversations) for (const c of convs) if (!s.tabs.some((t) => t.kind === "chat" && t.agent === agent && t.session === c.session)) rows.push({ id: `s:${agent}:${c.session}`, group: "Conversations", label: `${agent} · ${s.titleOf(agent, c.session)}`, about: `${ago(c.last)}${c.folder ? ` · ${c.folder}` : ""}`, run: () => void s.openTab(agent, c.session), conv: { agent, session: c.session } });
		for (const c of COMMANDS) if (!c.chat || chat) rows.push({ id: `c:${c.name}`, group: "Commands", label: c.title, about: c.about, keys: c.keys, run: () => void c.run("", s.active) });
		for (const a of s.agents) rows.push({ id: `a:${a.id}`, group: "Agents", label: `New conversation with ${a.id}`, about: a.description, run: () => void s.newConversation(a.id) });
		for (const [id, label] of [["general", "General"], ["agents", "Agents"], ["models", "Models"], ["mcp", "MCP servers"], ["skills", "Skills"], ["events", "Events"], ["instructions", "Instructions"], ["app", "App"]]) rows.push({ id: `p:${id}`, group: "Settings", label: `Settings: ${label}`, run: () => void s.command(`settings:${id}`) });
		return rows;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [s.titles]);
	// What fits by its name comes first; then the conversations in which the words were said; then
	// what only fits by its description, and last what fits by letters in order.
	const shown = useMemo(() => {
		if (!query.trim()) return all;
		const q = query.trim().toLowerCase();
		const named: Row[] = [];
		const described: Row[] = [];
		const loose: Row[] = [];
		for (const r of all) {
			if (r.label.toLowerCase().includes(q)) named.push(r);
			else if ((r.about ?? "").toLowerCase().includes(q)) described.push(r);
			else if (fuzzy(q, r.label) >= 0) loose.push(r);
		}
		// A conversation is listed once. One that fits by its name and also holds the words opens at the words.
		const found = s.searchSaid(q);
		const holds = (r: Row) => (r.conv ? found.find((m) => m.agent === r.conv!.agent && m.session === r.conv!.session) : undefined);
		const listed = new Set<string>();
		const here = (r: Row): Row => {
			const m = holds(r);
			if (!m) return r;
			listed.add(`${m.agent}:${m.session}`);
			return { ...r, about: `${m.who}: ${m.snippet}`, keys: ago(m.ts), run: () => void s.openFound(m.agent, m.session, query.trim()) };
		};
		const byName = named.map(here);
		const said: Row[] = found.filter((m) => !listed.has(`${m.agent}:${m.session}`)).map((m) => ({ id: `m:${m.agent}:${m.session}`, group: "Said in conversations", label: `${m.agent} · ${s.titleOf(m.agent, m.session)}`, about: `${m.who}: ${m.snippet}`, keys: ago(m.ts), run: () => void s.openFound(m.agent, m.session, query.trim()) }));
		return [...byName, ...said, ...described.filter((r) => !holds(r) || !listed.has(`${r.conv!.agent}:${r.conv!.session}`)), ...loose.filter((r) => !r.conv || !listed.has(`${r.conv.agent}:${r.conv.session}`))].slice(0, 80);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, all, s.said]);
	// Rows that follow each other under the same heading are one group.
	const groups: Array<{ name: string; rows: Row[] }> = [];
	for (const r of shown) groups.at(-1)?.name === r.group ? groups.at(-1)!.rows.push(r) : groups.push({ name: r.group, rows: [r] });
	const close = () => ((s.palette = false), s.touch());
	const run = (r: Row) => (close(), r.run());
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} finalFocus={opener} className="gap-0 p-0 sm:max-w-[620px]">
				<DialogTitle className="sr-only">Search everything</DialogTitle>
				<Command ref={root} {...line} shouldFilter={false} loop>
					<CommandInput autoFocus placeholder="Search conversations (by name or by what was said), commands, agents" value={query} onValueChange={setQuery} />
					<CommandList className="max-h-[52vh]">
						{groups.map((g, n) => (
							<CommandGroup key={`${n}:${g.name}`} heading={g.name}>
								{g.rows.map((r) => (
									<CommandItem key={r.id} value={r.id} onSelect={() => run(r)}>
										<span className="label max-w-[60%] flex-none truncate">{r.label}</span>
										{r.about ? <span className="about min-w-0 truncate text-xs text-muted-foreground">{r.about}</span> : null}
										{r.keys ? <CommandShortcut>{r.keys}</CommandShortcut> : null}
									</CommandItem>
								))}
							</CommandGroup>
						))}
						<CommandEmpty>Nothing fits.</CommandEmpty>
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}

/** A label that reads "name: what it is" or "NAME (what it is)" is its name and, under it, the rest. */
const labelParts = (label: string): [string, string] => {
	const m = label.match(/^([\w.-]+): ([\s\S]+)$/) ?? label.match(/^([\w.-]+) \(([\s\S]+)\)$/);
	return m ? [m[1], m[2]] : [label, ""];
};

/** A request for the owner's approval. Values only the owner has are typed here and go straight to the daemon. */
export function ApprovalDialog({ req }: { req: Approval }) {
	const s = store;
	const fields = req.inputs ?? [];
	const [values, setValues] = useState<Record<string, string>>({});
	const opener = useOpener();
	const allow = (always = false) => {
		if (fields.length) {
			const empty = fields.find((f) => !values[f.name]?.trim());
			if (empty) return void document.getElementById(`ap-${empty.name}`)?.focus();
			return void s.decide(req.id, true, false, Object.fromEntries(fields.map((f) => [f.name, values[f.name].trim()])));
		}
		void s.decide(req.id, true, always);
	};
	useEffect(() => {
		if (fields.length) return;
		// Letters answer while nothing is to be typed, as in the terminal UI.
		const key = (e: KeyboardEvent) => {
			if (e.metaKey || e.ctrlKey || e.altKey) return;
			if (e.key === "a" || e.key === "y") allow();
			else if (e.key === "s" && req.remember) allow(true);
			else if (e.key === "d" || e.key === "n") void s.decide(req.id, false);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [req.id]);
	return (
		<Dialog open onOpenChange={(open) => open || s.closeAsking()}>
			<DialogContent data-tone="warn" showCloseButton={false} finalFocus={opener} className="max-h-[76vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2"><TriangleAlertIcon className="text-warn" /> {fields.length ? "Approval needed, and something only you have" : "Approval needed"}</DialogTitle>
				</DialogHeader>
				<div className="-mx-4 flex min-h-0 flex-col gap-3 overflow-y-auto px-4 select-text">
					<div className="row muted">
						<span>{req.agent}</span>
						{req.task ? <span className="faint">task #{req.task}</span> : null}
						<span className="tag mono">{req.tool}</span>
					</div>
					<pre className="log" style={{ maxHeight: 220, color: "var(--text)" }}>{req.summary}</pre>
					<div className="muted" style={{ fontSize: 12.5 }}>
						Why you are asked: {req.why}
						{req.holds ? <div>“Allow” holds for {req.holds}: you are not asked about it again there.</div> : null}
						{req.remember ? <div>“Always here” stops asking about {req.remember} in this conversation.</div> : null}
						{!req.remember && !req.holds && !fields.length ? <div>This one is asked every time: there is no “always” for it.</div> : null}
					</div>
					{fields.map((f, i) => {
						const [name, about] = labelParts(f.label ?? f.name);
						return (
							<Field key={f.name}>
								<FieldLabel htmlFor={`ap-${f.name}`}>{name}{fields.length > 1 ? <span className="faint"> · {i + 1} of {fields.length}</span> : null}</FieldLabel>
								{about ? <FieldDescription>{about}</FieldDescription> : null}
								<Input id={`ap-${f.name}`} autoFocus={i === 0} className="mono" type={f.secret !== false ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && allow()} />
							</Field>
						);
					})}
					{fields.length ? <div className="faint" style={{ fontSize: 12 }}>{fields.some((f) => f.secret !== false) ? "What you type is not shown, goes into pine's .env file, and never reaches the agent or its model." : "Without it, this cannot be allowed."}</div> : null}
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => s.closeAsking()}>Later <kbd>esc</kbd></Button>
					<span className="grow" />
					<Button variant="destructive" onClick={() => void s.decide(req.id, false)}>Deny{fields.length ? "" : <kbd>d</kbd>}</Button>
					{req.remember && !fields.length ? <Button variant="outline" onClick={() => allow(true)}>Always here <kbd>s</kbd></Button> : null}
					<Button onClick={() => allow()}>{fields.length ? "Save and allow" : req.holds ? "Allow" : "Allow once"}{fields.length ? "" : <kbd>a</kbd>}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A question of the agent's: the answers it offers, and a line for the owner's own words. */
export function QuestionDialog({ req }: { req: Approval }) {
	const s = store;
	const choices = req.choices ?? [];
	const [own, setOwn] = useState("");
	const [at, setAt] = useState(0);
	const opener = useOpener();
	const answer = (text: string) => void s.decide(req.id, true, false, { answer: text });
	return (
		<Dialog open onOpenChange={(open) => open || s.closeAsking()}>
			<DialogContent data-tone="accent" showCloseButton={false} finalFocus={opener} className="max-h-[76vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2"><MessageSquareIcon className="text-primary" /> {req.agent} asks</DialogTitle>
				</DialogHeader>
				<div className="-mx-4 flex min-h-0 flex-col gap-3 overflow-y-auto px-4 select-text">
					<div style={{ whiteSpace: "pre-wrap" }}>{req.summary}</div>
					{choices.length ? (
						<div className="pick-list" style={{ padding: 0 }}>
							{choices.map((c, i) => (
								<div key={i} className={`pick-item${i === at && !own ? " on" : ""}`} onMouseMove={() => at !== i && setAt(i)} onClick={() => answer(c)}>
									<kbd>{i + 1}</kbd>
									<span style={{ whiteSpace: "normal" }}>{c}</span>
									{i === 0 ? <span className="tag good" style={{ marginLeft: "auto" }}>recommended</span> : null}
								</div>
							))}
						</div>
					) : null}
					<Input
						autoFocus
						placeholder={choices.length ? "Or answer in your own words" : "Your answer"}
						value={own}
						onChange={(e) => setOwn(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") return own.trim() ? answer(own.trim()) : choices.length ? answer(choices[at]) : undefined;
							if (!own && /^[1-9]$/.test(e.key) && Number(e.key) <= choices.length) return (e.preventDefault(), answer(choices[Number(e.key) - 1]));
							if (!own && (e.key === "ArrowDown" || e.key === "ArrowUp") && choices.length) (e.preventDefault(), setAt((at + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length));
						}}
					/>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={() => s.closeAsking()}>Later <kbd>esc</kbd></Button>
					<span className="grow" />
					<Button variant="ghost" onClick={() => void s.decide(req.id, false)}>No answer</Button>
					<Button disabled={!own.trim() && !choices.length} onClick={() => answer(own.trim() || choices[at])}>Answer</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Asking() {
	const s = useModel(store);
	if (!s.asking) return null;
	const req = s.tabs.map((t) => t.approvals.get(s.asking!)).find(Boolean)?.req;
	if (!req) return null;
	return req.tool === "question" ? <QuestionDialog key={req.id} req={req} /> : <ApprovalDialog key={req.id} req={req} />;
}

function Help({ close }: { close: () => void }) {
	const keys: Array<[string, string]> = [
		["↩", "Send. While the agent works, the message is given to that work and read at its next step"],
		["⌥↩", "Send, but let the message wait its turn"],
		["⇧↩", "New line"],
		["↑ ↓", "Earlier inputs, while the input is empty"],
		["esc", "Stop what the agent is doing"],
		["⇧⇥", "Next mode for this agent, while the input is empty"],
		["@", "Point at a file of the conversation's folder"],
		["/", "Commands, as in the terminal UI"],
		["⌘K", "Everything by name"],
		["⌘1 … ⌘9", "Go to that tab"],
		["⌃⇥", "Next tab"],
	];
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="max-h-[76vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[640px]">
				<DialogHeader>
					<DialogTitle>Keys and commands</DialogTitle>
				</DialogHeader>
				<div className="-mx-4 min-h-0 overflow-y-auto px-4 select-text" style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: "6px 14px", fontSize: 12.5 }}>
					{keys.map(([k, about]) => [<span key={k}><kbd>{k}</kbd></span>, <span key={`${k}-a`} className="muted">{about}</span>])}
					{COMMANDS.map((c) => [<span key={c.name} className="mono">/{c.name}</span>, <span key={`${c.name}-a`} className="muted">{c.about}{c.keys ? <> <kbd>{c.keys}</kbd></> : null}</span>])}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={close}>Close</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/** A picture of the conversation, larger, over the page. A click on it, beside it, or Escape closes it. */
export function Lightbox() {
	const [src, setSrc] = useState<string>();
	useEffect(() => {
		const show = (e: Event) => setSrc((e as CustomEvent<string>).detail);
		window.addEventListener("pine:zoom", show);
		return () => window.removeEventListener("pine:zoom", show);
	}, []);
	if (!src) return null;
	return (
		<Dialog open onOpenChange={(open) => open || setSrc(undefined)}>
			<DialogContent showCloseButton={false} className="w-auto max-w-[calc(100vw-64px)] p-2 sm:max-w-[calc(100vw-64px)]">
				<DialogTitle className="sr-only">The picture, larger</DialogTitle>
				<img src={src} alt="" className="max-h-[calc(100vh-96px)] max-w-full rounded-md" onClick={() => setSrc(undefined)} />
			</DialogContent>
		</Dialog>
	);
}

/** After "Check for Updates…" found a newer app: where it is. The app fetches and installs nothing itself. */
function UpdateAsk() {
	const s = useModel(store);
	const u = s.update;
	const close = () => ((s.updateAsk = false), s.touch());
	if (u?.status !== "newer") return null;
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>Pine {u.version} is available</DialogTitle>
				</DialogHeader>
				<div className="select-text">
					<p className="muted" style={{ margin: 0 }}>This is Pine {u.mine}. The new app is a disk image on the release's page on GitHub: download it, quit Pine and put the new app in place of this one. Your pine home, with your agents, conversations and settings, stays as it is.</p>
					<p className="faint mono selectable update-link" style={{ margin: "10px 0 0", fontSize: 12 }}>{u.url}</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={close}>Not now</Button>
					<Button onClick={() => (void bridge.open(u.url), close())}><ExternalLinkIcon data-icon="inline-start" />Open the release page</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The browser the web tools drive is not on this Mac in the build this pine needs: asked at the
 * start, once for a version of pine. Settings > App offers the same at any time. While it is
 * fetched, the dialog stays.
 */
function BrowserAsk() {
	const s = useModel(store);
	const later = () => void s.browserLater();
	return (
		<Dialog open onOpenChange={(open) => open || s.browserFetching || later()}>
			<DialogContent showCloseButton={false} className="sm:max-w-[560px]">
				<DialogHeader>
					<DialogTitle>The browser for the web tools is not on this Mac</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3 select-text">
					<p className="muted" style={{ margin: 0 }}>Your agents open pages that need a real browser with one that pine fetches for itself. Each version of pine drives a build of its own, and this one's is not here yet: it was never fetched, or it is the build of an older pine. It is about 600 MB and is fetched once. Until then the browser tools do not work; web search and reading a page do.</p>
					{s.initLines.length ? <pre className="log">{s.initLines.slice(-12).join("\n")}</pre> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" disabled={s.browserFetching} onClick={later}>Not now</Button>
					<Button disabled={s.browserFetching} onClick={() => void s.fetchBrowser()}>{s.browserFetching ? <><Pulse size={12} /> Fetching…</> : "Fetch it"}</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const SIDE_KEY = "pine.sidebar.width";
const SIDE_WIDTH = 248;

/** Remembers how wide a panel is, in pixels, for the next start. Only what the owner did is kept: a narrow window squeezes a panel without changing what it is set to. */
const keepWidth = (layout: Layout, panel: string, key: string) => {
	// The layout is in shares of the room the panels have together, and is told before the panels are
	// drawn at their new widths (after a key): the room is the same before and after.
	const group = document.getElementById(panel)?.parentElement;
	const share = layout[panel];
	if (!group || share === undefined) return;
	const room = [...group.children].filter((el) => el.hasAttribute("data-panel")).reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
	localStorage.setItem(key, String(Math.round((share * room) / 100)));
};

export function App() {
	const s = useModel(store);
	const [help, setHelp] = useState(false);
	useEffect(() => void s.boot(), [s]);
	useSignal("help", () => setHelp(true));
	// A file dropped beside the input must not take the window to that file.
	useEffect(() => {
		const stop = (e: DragEvent) => e.preventDefault();
		window.addEventListener("dragover", stop);
		window.addEventListener("drop", stop);
		return () => (window.removeEventListener("dragover", stop), window.removeEventListener("drop", stop));
	}, []);
	const ready = s.service.status === "ready" && s.agents.length > 0 && s.active;
	const tab = s.active;
	const side = usePanelRef();
	return (
		<div className={`app${s.sidebar && ready ? "" : " no-sidebar"}${s.fullscreen ? " fullscreen" : ""}`}>
			{!ready ? (
				<Gate />
			) : (
				<ResizablePanelGroup orientation="horizontal" onLayoutChanged={(layout, meta) => meta.isUserInteraction && keepWidth(layout, "sidebar-panel", SIDE_KEY)}>
					{s.sidebar ? (
						<>
							<ResizablePanel id="sidebar-panel" className="flex" panelRef={side} defaultSize={Number(localStorage.getItem(SIDE_KEY)) || SIDE_WIDTH} minSize={190} maxSize={460} groupResizeBehavior="preserve-pixel-size">
								<Sidebar />
							</ResizablePanel>
							<ResizableHandle className="bg-transparent" disableDoubleClick onDoubleClick={() => (side.current?.resize(SIDE_WIDTH), localStorage.setItem(SIDE_KEY, String(SIDE_WIDTH)))} title="Drag to make the side bar wider or narrower" />
						</>
					) : null}
					<ResizablePanel id="main" className="flex">
						<div className="main">
							<TitleBar />
							<div className="body">
								<ResizablePanelGroup orientation="horizontal" onLayoutChanged={(layout, meta) => meta.isUserInteraction && keepWidth(layout, "code-panel", CODE_KEY)}>
									<ResizablePanel id="view" className="flex" minSize={420}>
										{tab!.kind === "settings" ? <Settings /> : tab!.kind === "events" ? <Events tab={tab!} /> : <Conversation key={tab!.id} tab={tab!} />}
									</ResizablePanel>
									{s.code && tab!.kind === "chat" ? <CodePanel key={`code:${tab!.id}`} tab={tab!} /> : null}
								</ResizablePanelGroup>
							</div>
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			)}
			{s.browserAsk ? <BrowserAsk /> : null}
			{s.updateAsk ? <UpdateAsk /> : null}
			{s.picker ? <PickDialog key={s.picker.title} p={s.picker} /> : null}
			{s.palette ? <Palette /> : null}
			<Asking />
			{help ? <Help close={() => setHelp(false)} /> : null}
			<Lightbox />
			<Notices />
		</div>
	);
}
