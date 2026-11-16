// The window: the list of agents and conversations at the side, the tabs along the top, one
// conversation in the middle with its panel, and whatever lies over them for a moment (a list
// to pick from, a question, the palette).
import { useEffect, useMemo, useRef, useState } from "react";
import { type AgentInfo, api, type Approval, type Conversation as Conv } from "./api.ts";
import { bridge } from "./bridge.ts";
import { CodePanel } from "./CodePanel.tsx";
import { COMMANDS } from "./commands.ts";
import { Conversation } from "./Conversation.tsx";
import { Events } from "./Events.tsx";
import { type Picker, store, type Tab, useModel, useSignal } from "./model.ts";
import { Settings } from "./Settings.tsx";
import { ago, fuzzy, until } from "./text.ts";
import { Button, Confirm, Dialog, Icon, Logo, Spinner } from "./ui.tsx";

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
						<p className="row"><Spinner /> Looking for a running pine, or starting one…</p>
					</>
				) : state.status === "error" && state.kind === "no-home" ? (
					<>
						<h1>Welcome to pine</h1>
						<p>pine keeps its agents, their workspaces and its settings in a home folder ({s.prefs.home ?? s.home ?? "~/.pine"}). There is none yet. Setting it up copies the example home and fetches the browser its web tools drive (about 600 MB, once).</p>
						{s.initLines.length ? <pre className="log" style={{ width: "100%" }}>{s.initLines.slice(-40).join("\n")}</pre> : null}
						<div className="row">
							<Button variant="primary" disabled={s.initRunning} onClick={() => void init()}>{s.initRunning ? <><Spinner size={12} /> Setting up…</> : "Set up pine"}</Button>
							<Button disabled={s.initRunning} onClick={() => void bridge.retry()}>Try again</Button>
						</div>
					</>
				) : state.status === "error" ? (
					<>
						<h1>{state.kind === "no-node" ? "pine needs Node" : state.kind === "no-pine" ? "pine is not installed" : "pine did not start"}</h1>
						<p>{state.message}</p>
						<div className="row">
							<Button variant="primary" onClick={() => void bridge.retry()}>Try again</Button>
							{state.kind === "no-node" ? <Button onClick={() => void bridge.open("https://nodejs.org")}>nodejs.org</Button> : null}
						</div>
					</>
				) : (
					<p className="row"><Spinner /> Loading your agents…</p>
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
		<div className={`side-row side-conv${tab && tab === s.active ? " on" : ""}`} onClick={() => void s.openTab(agent, c.session)} onContextMenu={(e) => (e.preventDefault(), void menu())} title={`${agent} · ${c.session} · ${kept}${c.folder ? ` · works in ${c.folder}` : ""}`}>
			{tab?.approvals.size ? <span className="needs">!</span> : working ? <Spinner size={11} /> : tab?.unread ? <span className="dot unread" /> : main || c.pinned ? <Icon name="star" size={12} className="faint" /> : c.folder ? <Icon name="folder" size={12} className="faint" /> : <Icon name="chat" size={12} className="faint" />}
			<span className="cut grow">{main ? "main conversation" : c.session}</span>
			<span className="when">{c.tasks ? ago(c.last).replace(" ago", "") : ""}</span>
			{main ? null : (
				<span className="acts" onClick={(e) => e.stopPropagation()}>
					<Confirm icon="trash" label="Remove this conversation for good" sure="Remove?" onConfirm={() => void s.removeConversation(agent, c.session)} />
				</span>
			)}
		</div>
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
			{ id: "fold", label: folded ? "Show its conversations" : "Hide its conversations" },
		]);
		if (picked === "new") await s.newConversation(a.id);
		if (picked === "folder") await pickFolder();
		if (picked === "settings") s.openSettings("agents", a.id);
		if (picked === "fold") s.toggleFold(a.id);
	};
	return (
		<div className="side-group">
			<div className="side-agent" title={`${a.id}: ${a.description || "no description"}\n${a.model} · ${a.mode}`} onClick={() => s.toggleFold(a.id)} onContextMenu={(e) => (e.preventDefault(), void menu())}>
				<Icon name={folded ? "right" : "down"} size={10} className="faint" />
				<span className="avatar">{a.id.slice(0, 1).toUpperCase()}</span>
				<span className="who">
					<span className="cut">{a.id}</span>
					<span className="what cut">{a.description || a.model}</span>
				</span>
				{waits ? <span className="needs">!</span> : working ? <Spinner size={11} /> : unread && folded ? <span className="dot unread" /> : null}
				<span className="agent-acts" onClick={(e) => e.stopPropagation()}>
					<Button small variant="ghost" icon="gear" title={`Settings of ${a.id}`} onClick={() => s.openSettings("agents", a.id)} />
					<Button small variant="ghost" icon="folder" title={`Open a folder for a conversation with ${a.id}`} onClick={() => void pickFolder()} />
				</span>
				<span onClick={(e) => e.stopPropagation()}>
					<Button small variant="ghost" icon="plus" title={`New conversation with ${a.id}`} onClick={() => void s.newConversation(a.id)} />
				</span>
			</div>
			{folded ? null : rows.map((c) => <ConversationRow key={c.session} agent={a.id} c={c} />)}
		</div>
	);
}

function Sidebar() {
	const s = useModel(store);
	const ready = s.service.status === "ready";
	const front = s.active;
	return (
		<aside className="sidebar">
			<div className="side-top">
				<Button variant="ghost" icon="sidebar" title="Hide the sidebar (⌘B)" onClick={() => void s.command("sidebar")} />
			</div>
			<div className="side-scroll">
				<div className="side-row" onClick={() => void s.command("palette")}><Icon name="search" size={14} /><span className="grow">Search and commands</span><kbd>⌘K</kbd></div>
				<div className="side-label">Agents<span className="grow" /><Button small variant="ghost" icon="plus" title="New agent" onClick={() => s.openSettings("agents", "+")} /></div>
				{s.agents.map((a) => <AgentGroup key={a.id} a={a} />)}
			</div>
			<div className="side-foot">
				<div className={`side-row${front?.kind === "events" ? " on" : ""}`} onClick={() => void s.openEvents()}><Icon name="wave" size={14} /><span className="grow">Events</span></div>
				<div className={`side-row${front?.kind === "settings" ? " on" : ""}`} onClick={() => s.openSettings()}><Icon name="gear" size={14} /><span className="grow">Settings</span><kbd>⌘,</kbd></div>
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
				{tab.approvals.size ? <span className="needs">!</span> : tab.busy ? <Spinner size={11} /> : tab.unread ? <span className="dot unread" /> : tab.kind === "events" ? <Icon name="wave" size={12} /> : tab.kind === "settings" ? <Icon name="gear" size={12} /> : tab.kind === "task" ? <Icon name="list" size={12} /> : <span className="avatar small">{tab.agent.slice(0, 1).toUpperCase()}</span>}
			</span>
			<span className="name">
				{tab.kind === "events" ? "Events" : tab.kind === "settings" ? "Settings" : tab.kind === "task" ? <><b>{tab.agent}</b> #{tab.task}</> : tab.session === "main" ? <b>{tab.agent}</b> : <><b>{tab.agent}</b> · {tab.session}</>}
			</span>
			{kept && tab.session !== "main" ? <Icon name="star" size={10} className="star" /> : null}
			<span className="close" onClick={(e) => (e.stopPropagation(), s.closeTab(tab))}><Icon name="x" size={11} /></span>
		</div>
	);
}

function TitleBar() {
	const s = useModel(store);
	const with_ = s.agentInFront();
	return (
		<header className="titlebar">
			{s.sidebar ? null : <Button variant="ghost" icon="sidebar" title="Show the sidebar (⌘B)" onClick={() => void s.command("sidebar")} />}
			<div className="tabs">
				{s.tabs.map((t, i) => <TabButton key={t.id} tab={t} index={i} />)}
			</div>
			<Button variant="ghost" icon="plus" title={with_ ? `New conversation with ${with_} (⌘T)` : "New conversation (⌘T): you are asked with which agent"} onClick={() => void s.newConversation()} />
			<span className="grow" />
		</header>
	);
}

// ---- what lies over the window for a moment --------------------------------------------------------------

function PickDialog({ p }: { p: Picker }) {
	const [query, setQuery] = useState("");
	const shown = useMemo(() => (query && !p.free ? p.items.map((i) => ({ i, rank: Math.min(...[fuzzy(query, i.label), fuzzy(query, i.about ?? "") + 10].filter((r) => r >= 0), 99) })).filter((x) => x.rank < 99).sort((a, b) => a.rank - b.rank).map((x) => x.i) : p.items), [query, p]);
	const [at, setAt] = useState(() => Math.max(0, p.items.findIndex((i) => i.value === p.current)));
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => setAt(0), [query]);
	useEffect(() => {
		// (In a block: scrolling answers with a promise, and an effect may only give back a function.)
		list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
	}, [at]);
	const typing = p.free || p.items.length > 7;
	return (
		<div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && p.done(undefined)}>
			<div className="dialog" style={{ width: 560 }}>
				<div className="pick-title">{p.title}</div>
				<input
					autoFocus
					className="pick-input"
					style={typing ? undefined : { position: "absolute", opacity: 0, pointerEvents: "none" }}
					placeholder={p.placeholder ?? "Type to narrow the list"}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") return p.done(undefined);
						if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							e.preventDefault();
							return setAt((at + (e.key === "ArrowDown" ? 1 : Math.max(1, shown.length) - 1)) % Math.max(1, shown.length));
						}
						if (e.key === "Enter") {
							e.preventDefault();
							// Words of the owner's own count before the list where both are possible.
							if (p.free && query.trim()) return p.done(query.trim());
							if (shown[at]) p.done(shown[at].value);
						}
					}}
				/>
				{shown.length ? (
					<div className="pick-list" ref={list}>
						{shown.map((i, n) => (
							<div key={i.value} className={`pick-item${n === at ? " on" : ""}${i.tone === "bad" ? " bad" : ""}`} onMouseMove={() => at !== n && setAt(n)} onClick={() => p.done(i.value)}>
								<span className="label">{i.label}</span>
								{i.about ? <span className="about">{i.about}</span> : null}
								{i.value === p.current ? <span className="cur"><Icon name="check" size={13} /></span> : null}
							</div>
						))}
					</div>
				) : p.free ? null : (
					<div className="empty" style={{ padding: 24 }}>Nothing fits.</div>
				)}
			</div>
		</div>
	);
}

function Palette() {
	const s = store;
	const [query, setQuery] = useState("");
	const [at, setAt] = useState(0);
	const list = useRef<HTMLDivElement>(null);
	const all = useMemo(() => {
		const chat = s.active?.kind === "chat";
		const rows: Array<{ id: string; group: string; label: string; about?: string; keys?: string; run: () => void }> = [];
		for (const c of COMMANDS) if (!c.chat || chat) rows.push({ id: `c:${c.name}`, group: "Commands", label: c.title, about: c.about, keys: c.keys, run: () => void c.run("", s.active) });
		for (const t of s.tabs) rows.push({ id: `t:${t.id}`, group: "Open tabs", label: t.kind === "chat" ? `${t.agent} · ${t.session}` : t.kind === "task" ? `${t.agent} task #${t.task}` : "events", run: () => s.activate(t) });
		for (const [agent, convs] of s.conversations) for (const c of convs) if (!s.tabs.some((t) => t.kind === "chat" && t.agent === agent && t.session === c.session)) rows.push({ id: `s:${agent}:${c.session}`, group: "Conversations", label: `${agent} · ${c.session}`, about: ago(c.last), run: () => void s.openTab(agent, c.session) });
		for (const a of s.agents) rows.push({ id: `a:${a.id}`, group: "Agents", label: `New conversation with ${a.id}`, about: a.description, run: () => void s.newConversation(a.id) });
		for (const [id, label] of [["general", "General"], ["agents", "Agents"], ["models", "Models"], ["mcp", "MCP servers"], ["skills", "Skills"], ["events", "Events"], ["instructions", "Instructions"], ["app", "App"]]) rows.push({ id: `p:${id}`, group: "Settings", label: `Settings: ${label}`, run: () => void s.command(`settings:${id}`) });
		return rows;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	const shown = useMemo(() => (query ? all.map((r) => ({ r, rank: Math.min(...[fuzzy(query, r.label), fuzzy(query, r.about ?? "") + 10].filter((x) => x >= 0), 99) })).filter((x) => x.rank < 99).sort((a, b) => a.rank - b.rank).map((x) => x.r).slice(0, 60) : all), [query, all]);
	useEffect(() => setAt(0), [query]);
	useEffect(() => {
		// (In a block: scrolling answers with a promise, and an effect may only give back a function.)
		list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
	}, [at]);
	const close = () => ((s.palette = false), s.touch());
	const run = (r: (typeof all)[number]) => (close(), r.run());
	return (
		<div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && close()}>
			<div className="dialog" style={{ width: 620 }}>
				<input
					autoFocus
					className="pick-input"
					placeholder="Type a command, an agent or a conversation"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") return close();
						if (e.key === "ArrowDown" || e.key === "ArrowUp") {
							e.preventDefault();
							return setAt((at + (e.key === "ArrowDown" ? 1 : Math.max(1, shown.length) - 1)) % Math.max(1, shown.length));
						}
						if (e.key === "Enter" && shown[at]) run(shown[at]);
					}}
				/>
				<div className="pick-list" ref={list}>
					{shown.map((r, n) => (
						<div key={r.id}>
							{!query && (n === 0 || shown[n - 1].group !== r.group) ? <div className="pick-group">{r.group}</div> : null}
							<div className={`pick-item${n === at ? " on" : ""}`} onMouseMove={() => at !== n && setAt(n)} onClick={() => run(r)}>
								<span className="label">{r.label}</span>
								{r.about ? <span className="about">{r.about}</span> : null}
								{r.keys ? <kbd style={{ marginLeft: "auto", flex: "none" }}>{r.keys}</kbd> : null}
							</div>
						</div>
					))}
					{shown.length ? null : <div className="empty" style={{ padding: 24 }}>Nothing fits.</div>}
				</div>
			</div>
		</div>
	);
}

/** A label that reads "name: what it is" or "NAME (what it is)" is its name and, under it, the rest. */
const labelParts = (label: string): [string, string] => {
	const m = label.match(/^([\w.-]+): ([\s\S]+)$/) ?? label.match(/^([\w.-]+) \(([\s\S]+)\)$/);
	return m ? [m[1], m[2]] : [label, ""];
};

/** A request for the owner's approval. Values only the owner has are typed here and go straight to the daemon. */
function ApprovalDialog({ req }: { req: Approval }) {
	const s = store;
	const fields = req.inputs ?? [];
	const [values, setValues] = useState<Record<string, string>>({});
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
		<Dialog
			tone="warn"
			width={560}
			onClose={() => s.closeAsking()}
			title={<><Icon name="alert" /> {fields.length ? "Approval needed, and something only you have" : "Approval needed"}</>}
			footer={
				<>
					<Button variant="ghost" onClick={() => s.closeAsking()}>Later <kbd>esc</kbd></Button>
					<span className="grow" />
					<Button variant="danger" onClick={() => void s.decide(req.id, false)}>Deny{fields.length ? "" : <kbd>d</kbd>}</Button>
					{req.remember && !fields.length ? <Button onClick={() => allow(true)}>Always here <kbd>s</kbd></Button> : null}
					<Button variant="primary" onClick={() => allow()}>{fields.length ? "Save and allow" : req.holds ? "Allow" : "Allow once"}{fields.length ? "" : <kbd>a</kbd>}</Button>
				</>
			}
		>
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
					<label className="field" key={f.name}>
						<span className="field-label" style={{ color: "var(--text)" }}>{name}{fields.length > 1 ? <span className="faint"> · {i + 1} of {fields.length}</span> : null}</span>
						{about ? <span className="field-hint">{about}</span> : null}
						<input id={`ap-${f.name}`} autoFocus={i === 0} className="input mono" type={f.secret !== false ? "password" : "text"} autoComplete="off" spellCheck={false} value={values[f.name] ?? ""} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && allow()} />
					</label>
				);
			})}
			{fields.length ? <div className="faint" style={{ fontSize: 12 }}>{fields.some((f) => f.secret !== false) ? "What you type is not shown, goes into pine's .env file, and never reaches the agent or its model." : "Without it, this cannot be allowed."}</div> : null}
		</Dialog>
	);
}

/** A question of the agent's: the answers it offers, and a line for the owner's own words. */
function QuestionDialog({ req }: { req: Approval }) {
	const s = store;
	const choices = req.choices ?? [];
	const [own, setOwn] = useState("");
	const [at, setAt] = useState(0);
	const answer = (text: string) => void s.decide(req.id, true, false, { answer: text });
	return (
		<Dialog tone="accent" width={560} onClose={() => s.closeAsking()} title={<><Icon name="chat" /> {req.agent} asks</>} footer={<><Button variant="ghost" onClick={() => s.closeAsking()}>Later <kbd>esc</kbd></Button><span className="grow" /><Button variant="ghost" onClick={() => void s.decide(req.id, false)}>No answer</Button><Button variant="primary" disabled={!own.trim() && !choices.length} onClick={() => answer(own.trim() || choices[at])}>Answer</Button></>}>
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
			<input
				autoFocus
				className="input"
				placeholder={choices.length ? "Or answer in your own words" : "Your answer"}
				value={own}
				onChange={(e) => setOwn(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") return own.trim() ? answer(own.trim()) : choices.length ? answer(choices[at]) : undefined;
					if (!own && /^[1-9]$/.test(e.key) && Number(e.key) <= choices.length) return (e.preventDefault(), answer(choices[Number(e.key) - 1]));
					if (!own && (e.key === "ArrowDown" || e.key === "ArrowUp") && choices.length) (e.preventDefault(), setAt((at + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length));
				}}
			/>
		</Dialog>
	);
}

function Asking() {
	const s = useModel(store);
	if (!s.asking) return null;
	const req = s.tabs.map((t) => t.approvals.get(s.asking!)).find(Boolean)?.req;
	if (!req) return null;
	return req.tool === "question" ? <QuestionDialog req={req} /> : <ApprovalDialog req={req} />;
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
		<Dialog title="Keys and commands" width={640} onClose={close} footer={<Button onClick={close}>Close</Button>}>
			<div style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: "6px 14px", fontSize: 12.5 }}>
				{keys.map(([k, about]) => [<span key={k}><kbd>{k}</kbd></span>, <span key={`${k}-a`} className="muted">{about}</span>])}
				{COMMANDS.map((c) => [<span key={c.name} className="mono">/{c.name}</span>, <span key={`${c.name}-a`} className="muted">{c.about}{c.keys ? <> <kbd>{c.keys}</kbd></> : null}</span>])}
			</div>
		</Dialog>
	);
}

function Lightbox() {
	const [src, setSrc] = useState<string>();
	useEffect(() => {
		const show = (e: Event) => setSrc((e as CustomEvent<string>).detail);
		const key = (e: KeyboardEvent) => e.key === "Escape" && setSrc(undefined);
		window.addEventListener("pine:zoom", show);
		window.addEventListener("keydown", key);
		return () => (window.removeEventListener("pine:zoom", show), window.removeEventListener("keydown", key));
	}, []);
	return src ? <div className="lightbox" onClick={() => setSrc(undefined)}><img src={src} alt="" /></div> : null;
}

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
	return (
		<div className={`app${s.sidebar && ready ? "" : " no-sidebar"}${s.fullscreen ? " fullscreen" : ""}`}>
			{!ready ? (
				<Gate />
			) : (
				<>
					{s.sidebar ? <Sidebar /> : null}
					<div className="main">
						<TitleBar />
						<div className="body">
							{tab!.kind === "settings" ? <Settings /> : tab!.kind === "events" ? <Events tab={tab!} /> : <Conversation key={tab!.id} tab={tab!} />}
							{s.code && tab!.kind === "chat" ? <CodePanel key={`code:${tab!.id}`} tab={tab!} /> : null}
						</div>
					</div>
				</>
			)}
			{s.picker ? <PickDialog key={s.picker.title} p={s.picker} /> : null}
			{s.palette ? <Palette /> : null}
			<Asking />
			{help ? <Help close={() => setHelp(false)} /> : null}
			<Lightbox />
			<div className="toasts">{s.toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>
		</div>
	);
}
