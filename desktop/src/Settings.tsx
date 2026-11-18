// Settings: everything about pine that is otherwise a command in a shell or a sentence to the
// main agent. Each page asks the daemon what there is and tells it what to change; the daemon
// checks every change as it checks the main agent's, and nothing here writes a file itself.
import { AudioLinesIcon, BookIcon, CheckIcon, ChevronRightIcon, ChevronLeftIcon, ClockIcon, CpuIcon, ExternalLinkIcon, FolderIcon, GitBranchIcon, InfoIcon, MessageSquareIcon, PencilIcon, PlugIcon, PlusIcon, RotateCwIcon, SettingsIcon, SlidersHorizontalIcon, Trash2Icon, TriangleAlertIcon, Undo2Icon, UsersIcon, XIcon, ZapIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Sidebar as SidebarRoot, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "cn";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { type AgentDetail, api, type LoginState, type Setting, type SourceType } from "./api.ts";
import { bridge } from "./bridge.ts";
import { Editor } from "./CodePanel.tsx";
import { store, useModel } from "./model.ts";
import { ago, errText, MODES, plural, REASONING, short, tilde } from "./text.ts";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyView, useLoad } from "./ui.tsx";
import { Textarea } from "@/components/ui/textarea";

const SECTIONS: Array<{ id: string; label: string; icon: LucideIcon }> = [
	{ id: "general", label: "General", icon: SlidersHorizontalIcon },
	{ id: "agents", label: "Agents", icon: UsersIcon },
	{ id: "models", label: "Models", icon: CpuIcon },
	{ id: "mcp", label: "MCP servers", icon: PlugIcon },
	{ id: "skills", label: "Skills", icon: BookIcon },
	{ id: "events", label: "Events", icon: ZapIcon },
	{ id: "instructions", label: "Instructions", icon: PencilIcon },
	{ id: "app", label: "App", icon: SettingsIcon },
];

// Every page is made of stock Item, Field, Badge and Alert, written out where they are used. Some
// carry a class the desktop tests look for (set-group, item, name, ctl, form, log, tag, notice,
// good, warn, mono): it carries no style. An Item's description is shown whole and broken anywhere
// (`line-clamp-none wrap-anywhere`): stock cuts it after two lines, and here it is what explains
// the thing (a path, an address, a list of models). A Badge's variant follows its tone: default
// for good, outline for warn, destructive for bad, secondary for none.

function Page({ title, lead, children, actions }: { title: string; lead?: ReactNode; children: ReactNode; actions?: ReactNode }) {
	return (
		<div className="set-in mx-auto flex max-w-3xl flex-col gap-6 px-9 pt-8 pb-16 select-text">
			<div className="flex items-start gap-2">
				<div className="min-w-0 flex-1">
					<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
					{lead ? <p className="mt-1 max-w-2xl text-muted-foreground">{lead}</p> : null}
				</div>
				{actions}
			</div>
			{children}
		</div>
	);
}

/** Who something can be for, as the items of a Select: all agents ("") or one. */
const whom = (agents: Array<{ id: string }>) => [{ value: "", label: "all agents" }, ...agents.map((a) => ({ value: a.id, label: a.id }))];

const scopeText = (scope: string, session?: string) => (scope === "global" ? "all agents" : session && session !== "main" ? `${scope} · ${session}` : scope);

// A single-choice toggle group hands back a list, empty when its pressed item is pressed again: that keeps the choice.
const one = <T,>(set: (value: T) => void) => (values: T[]) => {
	if (values[0] !== undefined) set(values[0]);
};

// ---- general ----------------------------------------------------------------------------------------

function SettingRow({ s, models, reload }: { s: Setting; models: string[]; reload: () => void }) {
	const [draft, setDraft] = useState<string>();
	const id = useId();
	const set = async (value: unknown) => {
		const done = await store.attempt(() => api.setSetting(s.key, value));
		if (!done) return;
		setDraft(undefined);
		store.flash(done.live ? `${s.key} is now ${done.now}.` : `${s.key} is saved; it holds from the next start of pine.`, "good", 3000);
		reload();
		void store.refreshTaints();
		store.agents = await store.askAgents().catch(() => store.agents);
		store.touch();
	};
	const k = s.kind;
	const saved = (s as Setting & { saved?: string }).saved;
	const unset = /^not set/.test(s.now) || s.now === "none";
	let control: ReactNode;
	if (k === "boolean") control = <Switch id={id} checked={s.now === "true"} onCheckedChange={(on) => void set(on)} />;
	else if (k === "model" || (typeof k === "object" && "one" in k)) {
		const items =
			k === "model"
				? [{ value: "", label: unset ? s.now : "pine's default" }, ...(!unset && !models.includes(s.now) ? [s.now] : []).concat(models).map((m) => ({ value: m, label: m }))]
				: [...(k.one.includes(s.now) ? [] : [{ value: "", label: s.now }]), ...k.one.map((v) => ({ value: v, label: v }))];
		const value = k === "model" ? (unset ? "" : s.now) : k.one.includes(s.now) ? s.now : "";
		control = (
			<Select items={items} value={value} onValueChange={(v) => void set(v || "default")}>
				<SelectTrigger id={id} className="w-48">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{items.map((o) => (
							<SelectItem key={o.value} value={o.value}>
								{o.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		);
	} else {
		const hint = typeof k === "object" ? `A whole number from ${k.from} to ${k.to}` : "A time such as 90s or 5m";
		control = (
			<>
				<Tooltip>
					<TooltipTrigger render={<Input id={id} className="mono w-28 font-mono" value={draft ?? s.now} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && draft !== undefined && void set(draft)} />} />
					<TooltipContent>{hint}</TooltipContent>
				</Tooltip>
				{draft !== undefined && draft !== s.now ? <Button size="xs" onClick={() => void set(draft)}>Save</Button> : null}
			</>
		);
	}
	return (
		<Field orientation="horizontal" className="item">
			<FieldContent>
				<FieldLabel htmlFor={id} className="name">
					<span>{s.title ?? s.key}</span>
					{s.title ? (
						<Tooltip>
							<TooltipTrigger render={<span className="mono font-mono font-normal text-muted-foreground">{s.key}</span>} />
							<TooltipContent>Its name in pine.json, and for the main agent</TooltipContent>
						</Tooltip>
					) : null}
					{s.live ? null : <Badge variant="secondary" className="tag">from the next start</Badge>}
					{saved ? <Badge variant="outline" className="tag warn">saved: {saved}</Badge> : null}
				</FieldLabel>
				<FieldDescription>
					<span className="whitespace-pre-line">{s.about}</span>
				</FieldDescription>
			</FieldContent>
			<div className="ctl flex items-center gap-1.5">{control}</div>
		</Field>
	);
}

function General() {
	const overview = useLoad(() => api.overview());
	const settings = useLoad(() => api.settings());
	const models = useLoad(() => api.models());
	const groups: Array<[string, string]> = [["defaults.", "What agents start from"], ["limits.", "Limits"], ["security.", "Security"]];
	return (
		<Page title="General" lead="pine's own settings. A change is checked by pine before it is written; one that would not load is not kept.">
			{overview.data ? (
				<>
					<ItemGroup className="set-group">
						<Item variant="outline" className="item">
							<ItemContent className="min-w-0">
								<ItemTitle className="name">pine {overview.data.version}</ItemTitle>
								<ItemDescription className="line-clamp-none wrap-anywhere">{`Home: ${tilde(overview.data.home)} · main agent: ${overview.data.main} · ${overview.data.sandbox ? "sandbox available" : "no sandbox on this system"}`}</ItemDescription>
							</ItemContent>
							<ItemActions className="ctl">
								<Button variant="outline" size="xs" onClick={() => void bridge.reveal(overview.data!.log)}><ExternalLinkIcon data-icon="inline-start" />Show log</Button>
							</ItemActions>
						</Item>
					</ItemGroup>
					{overview.data.warnings.length || overview.data.modelNotes.length ? (
						<>
							<h2 className="flex items-center gap-2 text-base font-medium">Notes on this setup</h2>
							{[...overview.data.warnings, ...overview.data.modelNotes].map((w, i) => (
								<Alert key={i} className="notice">
									<TriangleAlertIcon />
									<AlertDescription>{w}</AlertDescription>
								</Alert>
							))}
						</>
					) : null}
				</>
			) : overview.error ? (
				<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{overview.error}</AlertDescription></Alert>
			) : (
				<Spinner className="m-auto" />
			)}
			{settings.data ? (
				groups.map(([prefix, title]) => (
					<FieldSet key={prefix}>
						<FieldLegend>{title}</FieldLegend>
						<FieldGroup className="set-group">
							{settings.data!.filter((s) => s.key.startsWith(prefix)).map((s) => <SettingRow key={s.key} s={s} models={models.data ?? []} reload={settings.reload} />)}
						</FieldGroup>
					</FieldSet>
				))
			) : settings.error ? (
				<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{settings.error}</AlertDescription></Alert>
			) : (
				<Spinner className="m-auto" />
			)}
		</Page>
	);
}

// ---- agents -----------------------------------------------------------------------------------------

/** Several out of a list, on stock ToggleGroup. */
function Checks({ label, all, value, onChange, id }: { label: string; all: string[]; value: string[]; onChange: (v: string[]) => void; id?: string }) {
	return (
		<ToggleGroup id={id} aria-label={label} multiple variant="outline" size="sm" className="flex-wrap" value={value} onValueChange={(v) => onChange(v)}>
			{all.map((x) => (
				<ToggleGroupItem key={x} value={x}>
					{value.includes(x) ? <CheckIcon data-icon="inline-start" /> : null}
					{x}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

const FILES: Array<{ key: "instructions" | "soul" | "tooling" | "memory" | "rules"; label: string; name: string; about: string; edit: boolean }> = [
	{ key: "instructions", label: "AGENTS.md", name: "AGENTS.md", about: "Its purpose and how it works. The agent keeps this file itself, and you can shape it here.", edit: true },
	{ key: "soul", label: "SOUL.md", name: "SOUL.md", about: "Who it is: character and tone.", edit: true },
	{ key: "tooling", label: "TOOLS.md", name: "TOOLS.md", about: "Its own defaults and preferences for its tools, on top of those for all agents. May be empty.", edit: true },
	{ key: "memory", label: "MEMORY.md", name: "MEMORY.md", about: "What it wrote down to outlive a conversation. The agent's own; shown, not changed here.", edit: false },
	{ key: "rules", label: "Your rules", name: "agents/<id>/AGENTS.md", about: "Rules of yours that the agent reads and cannot change. Kept in pine's home; edit the file there.", edit: false },
];

/** Files to read and change, one tab each: what the file is for, and the file in an editor. */
function FileTabs<K extends string>({ files, value, onChange, children }: { files: Array<{ key: K; label: string; about?: string }>; value: K; onChange: (v: K) => void; children: (key: K) => ReactNode }) {
	return (
		<Tabs value={value} onValueChange={onChange}>
			<TabsList activateOnFocus>
				{files.map((f) => (
					<TabsTrigger key={f.key} value={f.key}>
						{f.label}
					</TabsTrigger>
				))}
			</TabsList>
			{files.map((f) => (
				<TabsContent key={f.key} value={f.key} className="flex flex-col gap-2">
					{f.about ? <p className="text-muted-foreground">{f.about}</p> : null}
					{children(f.key)}
				</TabsContent>
			))}
		</Tabs>
	);
}

function AgentPage({ id, back }: { id: string; back: () => void }) {
	const detail = useLoad(() => api.agentDetail(id), [id]);
	const models = useLoad(() => api.models());
	const [change, setChange] = useState<Record<string, unknown>>({});
	const [file, setFile] = useState<(typeof FILES)[number]["key"]>("instructions");
	const [texts, setTexts] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const field = useId();
	const d = detail.data;
	useEffect(() => (setChange({}), setTexts({})), [id, d]);
	if (!d)
		return (
			<Page title={id}>
				<Button variant="ghost" size="xs" className="self-start" onClick={back}>
					<ChevronLeftIcon data-icon="inline-start" />
					Agents
				</Button>
				{detail.error ? <Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{detail.error}</AlertDescription></Alert> : <Spinner className="m-auto" />}
			</Page>
		);
	const now = <K extends keyof AgentDetail>(key: K): AgentDetail[K] => (key in change ? (change[key as string] as AgentDetail[K]) : d[key]);
	const put = (key: string, value: unknown) => setChange({ ...change, [key]: value });
	const dirtyFiles = FILES.filter((f) => f.edit && texts[f.key] !== undefined && texts[f.key] !== (d.files[f.key] ?? ""));
	const dirty = Object.keys(change).length > 0 || dirtyFiles.length > 0;
	const save = async () => {
		setBusy(true);
		const body = { ...change, ...Object.fromEntries(dirtyFiles.map((f) => [f.key, texts[f.key]])) };
		const done = await store.attempt(() => api.updateAgent(id, body));
		setBusy(false);
		if (!done) return;
		store.flash(`Updated ${id}; it holds from its next message on.${done.warnings.length ? ` Note: ${done.warnings.join("; ")}` : ""}`, done.warnings.length ? "warn" : "good", done.warnings.length ? 9000 : 3500);
		detail.reload();
		store.agents = await store.askAgents().catch(() => store.agents);
		store.touch();
	};
	const remove = async () => {
		if (await store.removeAgent(id)) back();
	};
	const addFolder = async (kind: "read" | "write") => {
		const dir = await bridge.pickFolder(kind === "write" ? `A folder ${id} may read and change` : `A folder ${id} may read`);
		if (dir) put(kind, [...((change[kind] as string[]) ?? []), dir]);
	};
	const others = store.agents.filter((a) => a.id !== id).map((a) => a.id);
	const mode = now("mode");
	const forget = (change.forget as string[]) ?? [];
	const modelItems = [{ value: "", label: d.defaultModel ? `${d.defaultModel} (the default)` : "the default" }, ...(d.model && !(models.data ?? []).includes(d.model) ? [d.model] : []).concat(models.data ?? []).map((m) => ({ value: m, label: m }))];
	const reasoningItems = REASONING.map((r) => ({ value: r, label: r }));
	const modeAbout = MODES.find((m) => m.value === mode)?.about;
	return (
		<Page
			title={d.id}
			lead={d.main ? "The main agent: it administers pine, and may hand work to every other agent." : `An agent with its own workspace at ${tilde(d.workspace)}.`}
			actions={
				<>
					<Button variant="outline" onClick={() => void store.openTab(id, "main")}><MessageSquareIcon data-icon="inline-start" />Open</Button>
					<Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</Button>
				</>
			}
		>
			<Button variant="ghost" size="xs" className="self-start" onClick={back}>
				<ChevronLeftIcon data-icon="inline-start" />
				Agents
			</Button>
			<FieldGroup className="form grid grid-cols-2">
				<Field className="col-span-full">
					<FieldLabel htmlFor={`${field}-description`}>What it is for</FieldLabel>
					<Input id={`${field}-description`} value={now("description")} onChange={(e) => put("description", e.target.value)} />
					<FieldDescription>One line. Other agents read it when they decide whom to hand work to.</FieldDescription>
				</Field>
				<Field>
					<FieldLabel htmlFor={`${field}-model`}>Model</FieldLabel>
					<Select items={modelItems} value={(change.model as string) ?? d.model ?? ""} onValueChange={(v) => put("model", v || "default")}>
						<SelectTrigger id={`${field}-model`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{modelItems.map((o) => (
									<SelectItem key={o.value} value={o.value}>
										{o.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</Field>
				<Field>
					<FieldLabel htmlFor={`${field}-reasoning`}>Reasoning</FieldLabel>
					<Select items={reasoningItems} value={now("thinking")} onValueChange={(v) => put("thinking", v ?? "")}>
						<SelectTrigger id={`${field}-reasoning`}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{reasoningItems.map((o) => (
									<SelectItem key={o.value} value={o.value}>
										{o.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<FieldDescription>How much its model thinks before it answers.</FieldDescription>
				</Field>
				<Field className="col-span-full">
					<FieldLabel htmlFor={`${field}-mode`}>Mode</FieldLabel>
					<ToggleGroup id={`${field}-mode`} aria-label="Mode" variant="outline" value={[mode]} onValueChange={one((m) => put("mode", m))}>
						{MODES.map((o) => (
							<ToggleGroupItem key={o.value} value={o.value}>
								{o.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					{modeAbout ? <FieldDescription>{modeAbout}</FieldDescription> : null}
				</Field>
				<Field className="col-span-full">
					<FieldLabel htmlFor={`${field}-tools`}>Built-in tools</FieldLabel>
					<Checks id={`${field}-tools`} label="Built-in tools" all={d.allTools} value={now("tools")} onChange={(v) => put("tools", v)} />
					<FieldDescription>Without bash, edit and write an agent only reads.</FieldDescription>
				</Field>
				<Field className="col-span-full">
					<FieldLabel htmlFor={`${field}-delegates`}>May hand work to</FieldLabel>
					{others.length ? <Checks id={`${field}-delegates`} label="May hand work to" all={["*", ...others]} value={now("delegates")} onChange={(v) => put("delegates", v)} /> : <p id={`${field}-delegates`} className="text-muted-foreground">There is no other agent yet.</p>}
					<FieldDescription>{d.main ? "The main agent may delegate to everyone." : "Agents it can give a task to with its delegate tool."}</FieldDescription>
				</Field>
				<Field orientation="horizontal" className="col-span-full">
					<FieldContent>
						<FieldLabel htmlFor={`${field}-network`}>Network from its shell</FieldLabel>
						<FieldDescription>In its sandbox (safe and manual mode) its commands have no network unless this is on. With it, a command can send what the agent reads anywhere.</FieldDescription>
					</FieldContent>
					<Switch id={`${field}-network`} checked={now("network")} onCheckedChange={(on) => put("network", on)} />
				</Field>
				<FieldSet className="col-span-full">
					<FieldLegend variant="label">Folders outside its workspace</FieldLegend>
					<FieldDescription>What it may reach in its sandbox besides its own folders.</FieldDescription>
					<ItemGroup>
						{[...d.read.map((p) => ({ p, kind: "read" })), ...d.write.map((p) => ({ p, kind: "read and change" }))].map(({ p, kind }) => {
							const dropped = forget.includes(p);
							return (
								<Item key={`${kind}:${p}`} variant="outline" size="xs">
									<ItemMedia variant="icon"><FolderIcon /></ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle className={cn("mono font-mono", dropped && "line-through")}>{tilde(p)}</ItemTitle>
									</ItemContent>
									<ItemActions>
										<Badge variant="secondary" className="tag">{kind}</Badge>
										<Tooltip>
											<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label={dropped ? "Keep it" : "Take it away"} onClick={() => put("forget", dropped ? forget.filter((x) => x !== p) : [...forget, p])}>{dropped ? <Undo2Icon /> : <XIcon />}</Button>} />
											<TooltipContent>{dropped ? "Keep it" : "Take it away"}</TooltipContent>
										</Tooltip>
									</ItemActions>
								</Item>
							);
						})}
						{(["read", "write"] as const).flatMap((kind) =>
							((change[kind] as string[]) ?? []).map((p) => (
								<Item key={`new:${kind}:${p}`} variant="outline" size="xs">
									<ItemMedia variant="icon"><PlusIcon /></ItemMedia>
									<ItemContent className="min-w-0">
										<ItemTitle className="mono font-mono">{tilde(p)}</ItemTitle>
									</ItemContent>
									<ItemActions>
										<Badge className="tag good">{kind === "write" ? "read and change" : "read"} · new</Badge>
										<Tooltip>
											<TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Leave it out" onClick={() => put(kind, ((change[kind] as string[]) ?? []).filter((x) => x !== p))}><XIcon /></Button>} />
											<TooltipContent>Leave it out</TooltipContent>
										</Tooltip>
									</ItemActions>
								</Item>
							)),
						)}
					</ItemGroup>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="xs" onClick={() => void addFolder("read")}><PlusIcon data-icon="inline-start" />May read…</Button>
						<Button variant="outline" size="xs" onClick={() => void addFolder("write")}><PlusIcon data-icon="inline-start" />May read and change…</Button>
					</div>
				</FieldSet>
			</FieldGroup>

			<h2 className="flex items-center gap-2 text-base font-medium">What it is told</h2>
			<FileTabs files={FILES.filter((f) => f.edit || d.files[f.key] !== undefined)} value={file} onChange={setFile}>
				{(key) => {
					const meta = FILES.find((f) => f.key === key)!;
					return (
						<div className="flex h-96 overflow-hidden rounded-lg border">
							<Editor key={`${id}:${key}`} file={`${key}.md`} text={texts[key] ?? d.files[key] ?? ""} readOnly={!meta.edit} onChange={(v) => setTexts((was) => ({ ...was, [key]: v }))} onSave={() => void save()} />
						</div>
					);
				}}
			</FileTabs>

			<h2 className="flex items-center gap-2 text-base font-medium">What it has</h2>
			<ItemGroup className="set-group">
				{(
					[
						["Conversations", d.holdings.conversations],
						["Event sources", d.holdings.sources],
						["MCP servers", d.holdings.servers],
						["Schedules", d.holdings.schedules],
						["Skills", d.holdings.skills],
						["Routes that wake it", d.holdings.routes],
					] as Array<[string, string[]]>
				).map(([label, list]) => (
					<Item key={label} variant="outline" className="item">
						<ItemContent className="min-w-0">
							<ItemTitle className="name">{label}</ItemTitle>
							<ItemDescription className="line-clamp-none wrap-anywhere">{list?.length ? list.join(", ") : "none"}</ItemDescription>
						</ItemContent>
					</Item>
				))}
				<Item variant="outline" className="item">
					<ItemContent className="min-w-0">
						<ItemTitle className="name">Workspace</ItemTitle>
						<ItemDescription className="line-clamp-none font-mono wrap-anywhere">{`${tilde(d.workspace)} · ${plural(d.holdings.files, "file")}`}</ItemDescription>
					</ItemContent>
					<ItemActions className="ctl">
						<Button variant="outline" size="xs" onClick={() => void bridge.reveal(d.workspace)}><ExternalLinkIcon data-icon="inline-start" />Show</Button>
					</ItemActions>
				</Item>
			</ItemGroup>
			{d.main ? null : (
				<ItemGroup className="set-group">
					<Item variant="outline" className="item">
						<ItemContent className="min-w-0">
							<ItemTitle className="name">Remove this agent</ItemTitle>
							<ItemDescription className="line-clamp-none wrap-anywhere">{`With its conversations, sources, schedules, servers, skills, the routes that wake it, its folder and its private home.${d.holdings.outside ? " Its workspace lies outside pine's home and is left as it is." : ""}`}</ItemDescription>
						</ItemContent>
						<ItemActions className="ctl">
							<Button variant="destructive" onClick={() => void remove()}><Trash2Icon data-icon="inline-start" />Remove…</Button>
						</ItemActions>
					</Item>
				</ItemGroup>
			)}
		</Page>
	);
}

function NewAgent({ close, made }: { close: () => void; made: (id: string) => void }) {
	const models = useLoad(() => api.models());
	const [f, setF] = useState({ id: "", description: "", instructions: "", model: "" });
	const field = useId();
	const modelItems = [{ value: "", label: "pine's default" }, ...(models.data ?? []).map((m) => ({ value: m, label: m }))];
	const create = async () => {
		const instructions = f.instructions.trim() || `You are ${f.id}. ${f.description.trim().replace(/\.?$/, ".")}`;
		const done = await store.attempt(() => api.createAgent({ id: f.id.trim(), description: f.description.trim(), instructions, model: f.model || undefined }));
		if (!done) return;
		store.agents = await store.askAgents().catch(() => store.agents);
		void store.refreshConversations();
		store.flash(`Created the agent ${done.id}.`, "good");
		made(done.id);
	};
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>A new agent</DialogTitle>
				</DialogHeader>
				<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
					<FieldGroup className="px-4 select-text">
						<Field>
							<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
							<Input id={`${field}-name`} autoFocus className="mono font-mono" value={f.id} onChange={(e) => setF({ ...f, id: e.target.value.toLowerCase() })} />
							<FieldDescription>Lowercase letters, digits, - and _ (for example research, home, books).</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${field}-description`}>What it is for</FieldLabel>
							<Input id={`${field}-description`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
							<FieldDescription>One line. Other agents read it when they decide whom to hand work to.</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${field}-instructions`}>Instructions</FieldLabel>
							<Textarea id={`${field}-instructions`} className="min-h-24 max-h-64" value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="You are …" />
							<FieldDescription>Who it is and how it works, written to the agent itself. Left empty, it starts from what it is for and keeps the file itself from then on.</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor={`${field}-model`}>Model</FieldLabel>
							<Select items={modelItems} value={f.model} onValueChange={(model) => setF({ ...f, model: model ?? "" })}>
								<SelectTrigger id={`${field}-model`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{modelItems.map((o) => (
											<SelectItem key={o.value} value={o.value}>
												{o.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						</Field>
					</FieldGroup>
				</ScrollArea>
				<DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!f.id.trim() || !f.description.trim()} onClick={() => void create()}>Create agent</Button></DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Agents() {
	const s = useModel(store);
	// Which agent's page is open is the app's to say: the side bar opens one too. "+" is the new agent's dialog.
	const open = s.settingsAgent !== "+" ? s.settingsAgent : undefined;
	const adding = s.settingsAgent === "+";
	const setOpen = (id?: string) => ((s.settingsAgent = id), s.touch());
	const setAdding = (on: boolean) => setOpen(on ? "+" : undefined);
	if (open && s.agents.some((a) => a.id === open)) return <AgentPage id={open} back={() => setOpen(undefined)} />;
	return (
		<Page title="Agents" lead="An agent is a folder with a workspace, instructions and a model. Each has its own conversations and reach." actions={<Button onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" />New agent</Button>}>
			<ItemGroup className="set-group">
				{s.agents.map((a) => (
					<Item key={a.id} variant="outline" className="item" render={<button type="button" />} onClick={() => setOpen(a.id)}>
						<ItemContent className="min-w-0">
							<ItemTitle className="name">
								{a.id}
								{a.main ? <Badge className="tag good">main</Badge> : null}
								<Badge variant={a.mode === "bypass" ? "destructive" : a.mode === "safe" ? "default" : "secondary"} className={cn("tag", a.mode === "bypass" && "bad", a.mode === "safe" && "good")}>{a.mode}</Badge>
							</ItemTitle>
							<ItemDescription>{a.description || "no description"}</ItemDescription>
							<ItemDescription className="font-mono">{a.model} · reasoning {a.thinking} · {tilde(a.workspace)}</ItemDescription>
						</ItemContent>
						<ItemActions><ChevronRightIcon /></ItemActions>
					</Item>
				))}
			</ItemGroup>
			{adding ? <NewAgent close={() => setAdding(false)} made={(id) => setOpen(id)} /> : null}
		</Page>
	);
}

// ---- models -----------------------------------------------------------------------------------------

/** pi's sign-in, shown step by step: a page to open, a code to type there, or a key to paste here. */
function SignIn({ provider, type, close }: { provider: string; type?: "api_key" | "oauth"; close: (done: boolean, choose?: string[]) => void }) {
	const [id, setId] = useState<string>();
	const [state, setState] = useState<LoginState>();
	const [answer, setAnswer] = useState("");
	const [error, setError] = useState<string>();
	const opened = useRef<string>(undefined);
	const field = useId();
	useEffect(() => {
		let live = true;
		api.login(provider, type).then((r) => live && setId(r.id), (e) => live && setError(errText(e)));
		return () => {
			live = false;
		};
	}, [provider, type]);
	useEffect(() => {
		if (!id) return;
		let live = true;
		const look = async () => {
			try {
				const next = await api.loginState(id);
				if (!live) return;
				setState(next);
				// The page is opened here, where the owner sits; once.
				if (next.url && opened.current !== next.url) (opened.current = next.url), void bridge.open(next.url);
				if (!next.done) timer = window.setTimeout(look, 700);
			} catch (e) {
				if (live) setError(errText(e));
			}
		};
		let timer = window.setTimeout(look, 150);
		return () => {
			live = false;
			window.clearTimeout(timer);
		};
	}, [id]);
	const cancel = () => {
		if (id && !state?.done) void api.loginAnswer(id, { cancel: true }).catch(() => {});
		close(Boolean(state?.done && !state.error));
	};
	const send = async (text: string) => {
		if (!id) return;
		setAnswer("");
		await api.loginAnswer(id, { answer: text }).catch((e) => setError(errText(e)));
	};
	const q = state?.question;
	return (
		<Dialog open onOpenChange={(open) => open || cancel()}>
			<DialogContent showCloseButton={false} className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>Sign in to {provider}</DialogTitle>
				</DialogHeader>
				<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
					<div className="flex flex-col gap-3 px-4 select-text">
						{error || state?.error ? <Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{error ?? state?.error}</AlertDescription></Alert> : null}
						{state?.lines.length ? (
							<CodeBlock size="sm">
								<CodeBlockContent wrap className="log max-h-60 select-text">{state.lines.join("\n")}</CodeBlockContent>
							</CodeBlock>
						) : null}
						{state?.url && !state.done ? <div className="flex items-center gap-2"><Button variant="outline" onClick={() => void bridge.open(state.url!)}><ExternalLinkIcon data-icon="inline-start" />Open the sign-in page again</Button>{state.code ? <span>Code: <b className="mono cursor-auto font-mono">{state.code}</b></span> : null}</div> : null}
						{q && !state?.done ? (
							q.options?.length ? (
								<FieldSet>
									<FieldLegend variant="label">{q.message}</FieldLegend>
									<ItemGroup>
										{q.options.map((o) => (
											<Item key={o.id} variant="outline" size="sm" render={<button type="button" />} onClick={() => void send(o.id)}>
												<ItemContent className="min-w-0">
													<ItemTitle>{o.label}</ItemTitle>
													{o.description ? <ItemDescription>{o.description}</ItemDescription> : null}
												</ItemContent>
											</Item>
										))}
									</ItemGroup>
								</FieldSet>
							) : (
								<Field>
									<FieldLabel htmlFor={`${field}-answer`}>{q.message}</FieldLabel>
									<div className="flex items-center gap-2">
										<Input id={`${field}-answer`} autoFocus className="mono font-mono" type={q.secret ? "password" : "text"} autoComplete="off" spellCheck={false} value={answer} onChange={(e) => setAnswer(e.target.value)} onKeyDown={(e) => e.key === "Enter" && answer.trim() && void send(answer.trim())} />
										<Button disabled={!answer.trim()} onClick={() => void send(answer.trim())}>Continue</Button>
									</div>
									{q.secret ? <FieldDescription>It is not shown, and is stored in auth.json in pine's home, where agents cannot read it.</FieldDescription> : null}
								</Field>
							)
						) : !state?.done && !error ? (
							<div className="flex items-center gap-2 text-muted-foreground"><Spinner /> {state?.url ? "Waiting for you to sign in in the browser…" : "Starting…"}</div>
						) : null}
						{state?.done && !state.error ? (
							<Alert className="notice plain">
								<CheckIcon />
								<AlertDescription>{state.models?.length ? `${plural(state.models.length, "model")} available, for example ${state.models.slice(0, 4).join(", ")}.` : "Signed in."}</AlertDescription>
							</Alert>
						) : null}
						{/* A sign-in changes no agent's model: which of the new ones the agents run on is asked here, where they were just made available. */}
						{state?.done && !state.error && state.models?.length ? <div className="flex items-center gap-2"><Button onClick={() => close(true, state.models)}>Choose the model your agents run on…</Button><span className="text-muted-foreground">Or later: Change, on the Models page.</span></div> : null}
					</div>
				</ScrollArea>
				<DialogFooter><Button variant={state?.done ? "default" : "outline"} onClick={cancel}>{state?.done ? "Done" : "Cancel"}</Button></DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Models() {
	const providers = useLoad(() => api.providers());
	const servers = useLoad(() => api.modelServers());
	const models = useLoad(() => api.models());
	const [signIn, setSignIn] = useState<{ provider: string; type?: "api_key" | "oauth" }>();
	const [f, setF] = useState({ name: "", url: "", key: "", context: "" });
	const [locked, setLocked] = useState(false);
	const [busy, setBusy] = useState(false);
	const [all, setAll] = useState(false);
	const field = useId();
	const s = useModel(store);
	// The model of every agent that has none of its own, and the agents whose model cannot answer.
	const fallback = useLoad(() => api.settings().then((all) => all.find((x) => x.key === "defaults.model")?.now ?? "none"));
	const details = useLoad(() => Promise.all(store.agents.map((a) => api.agentDetail(a.id))));
	const own = (details.data ?? []).filter((d) => d.model).map((d) => `${d.id} (${d.model})`);
	const stuck = s.agents.filter((a) => a.modelProblem);
	const reload = () => (providers.reload(), servers.reload(), models.reload(), fallback.reload(), details.reload(), void store.refreshAgents());
	const add = async () => {
		setBusy(true);
		try {
			const done = await api.addModelServer({ name: f.name.trim(), url: f.url.trim(), key: f.key.trim() || undefined, context: Number(f.context) > 0 ? Number(f.context) : undefined });
			store.flash(`Added ${f.name} with ${done.models.join(", ")}.`, "good");
			setF({ name: "", url: "", key: "", context: "" });
			setLocked(false);
			reload();
		} catch (e: any) {
			if (e?.data?.locked) setLocked(true);
			store.flash(errText(e), "bad");
		}
		setBusy(false);
	};
	const mine = new Set((servers.data ?? []).map((s) => s.name));
	const hosted = (providers.data ?? []).filter((p) => !mine.has(p.id));
	const shown = all ? hosted : hosted.filter((p) => p.signedIn);
	return (
		<Page title="Models" lead="Which models your agents can run on: providers you sign in to, and model servers of your own. An agent's model is chosen on its page, or in the bar under a conversation.">
			<h2 className="flex items-center gap-2 text-base font-medium">Model servers of your own</h2>
			<ItemGroup className="set-group">
				{servers.data?.length ? (
					servers.data.map((s) => (
						<Item key={s.name} variant="outline" className="item">
							<ItemContent className="min-w-0">
								<ItemTitle className="name">
									{s.name}
									<Badge variant="secondary" className="tag mono font-mono">{s.baseUrl}</Badge>
									<Badge variant="secondary" className="tag">key: {s.key}</Badge>
								</ItemTitle>
								<ItemDescription className="line-clamp-none font-mono wrap-anywhere">{s.models.map((m) => `${s.name}/${m.id}${m.contextWindow ? ` (${Math.round(m.contextWindow / 1000)}k${m.images ? ", sees pictures" : ""}${m.reasoning ? ", thinks" : ""})` : ""}`).join(" · ") || "no models"}</ItemDescription>
							</ItemContent>
							<ItemActions className="ctl">
								<AlertDialog>
									<AlertDialogTrigger render={<Button variant="ghost" size="xs" />}>Remove</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Remove the model server {s.name}?</AlertDialogTitle>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeModelServer(s.name)).then((r) => r && (store.flash(`Removed ${s.name}.`), reload()))}>Remove</AlertDialogCancel>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							</ItemActions>
						</Item>
					))
				) : servers.data ? (
					<EmptyView icon={CpuIcon} title="No model server yet">Anything that speaks OpenAI's chat API works: llama.cpp, vLLM, LM Studio.</EmptyView>
				) : servers.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{servers.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>
			<FieldSet>
				<FieldLegend>Add a model server</FieldLegend>
				<FieldGroup className="form grid grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="mono font-mono" placeholder="studio" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
						<FieldDescription>Its models are then called name/model.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-url`}>Address</FieldLabel>
						<Input id={`${field}-url`} className="mono font-mono" placeholder="http://127.0.0.1:8080" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
						<FieldDescription>pine asks the server which models it has.</FieldDescription>
					</Field>
					{locked || f.key ? (
						<Field>
							<FieldLabel htmlFor={`${field}-key`}>API key</FieldLabel>
							<Input id={`${field}-key`} className="mono font-mono" type="password" autoComplete="off" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} />
							<FieldDescription>The server wants a key. It goes into pine's .env file.</FieldDescription>
						</Field>
					) : null}
					<Field>
						<FieldLabel htmlFor={`${field}-context`}>Context (tokens)</FieldLabel>
						<Input id={`${field}-context`} className="mono font-mono" placeholder="from the server" value={f.context} onChange={(e) => setF({ ...f, context: e.target.value.replace(/\D/g, "") })} />
						<FieldDescription>Only when the server does not say.</FieldDescription>
					</Field>
				</FieldGroup>
				<Field orientation="horizontal">
					<FieldDescription>An agent that is given one of its models sends its whole conversations there.</FieldDescription>
					<Button disabled={!f.name.trim() || !f.url.trim() || busy} onClick={() => void add()}>{busy ? <><Spinner data-icon="inline-start" />Asking the server…</> : "Add server"}</Button>
				</Field>
			</FieldSet>

			<h2 className="flex items-center gap-2 text-base font-medium">Providers <Button variant="ghost" size="xs" onClick={() => setAll(!all)}>{all ? "Only those signed in" : `Show all ${hosted.length}`}</Button></h2>
			<ItemGroup className="set-group">
				{providers.data ? (
					shown.length ? (
						shown.map((p) => (
							<Item key={p.id} variant="outline" className="item">
								<ItemContent className="min-w-0">
									<ItemTitle className="name">
										{p.name ?? p.id}
										{p.name && p.name !== p.id ? <Badge variant="secondary" className="tag mono font-mono">{p.id}</Badge> : null}
										{p.signedIn ? <Badge className="tag good">signed in</Badge> : null}
									</ItemTitle>
									<ItemDescription className="line-clamp-none wrap-anywhere">{plural(p.models, "model")}</ItemDescription>
								</ItemContent>
								<ItemActions className="ctl">
									{p.signedIn ? <AlertDialog>
										<AlertDialogTrigger render={<Button variant="ghost" size="xs" />}>Sign out</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Sign out of {p.name ?? p.id}?</AlertDialogTitle>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.logout(p.id)).then((r) => r && reload())}>Sign out</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog> : null}
									{p.oauth ? <Button variant="outline" size="xs" onClick={() => setSignIn({ provider: p.id, type: "oauth" })}>Sign in</Button> : null}
									<Button variant="outline" size="xs" onClick={() => setSignIn({ provider: p.id, type: "api_key" })}>{p.signedIn ? "New key" : "API key"}</Button>
								</ItemActions>
							</Item>
						))
					) : (
						<EmptyView icon={CpuIcon} title="Signed in to no provider">Show all to pick one (OpenCode, Claude, ChatGPT, …), or add a model server of your own above.</EmptyView>
					)
				) : providers.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{providers.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>

			<h2 className="flex items-center gap-2 text-base font-medium">The model your agents run on</h2>
			<ItemGroup className="set-group">
				<Item variant="outline" className="item fallback-model">
					<ItemContent className="min-w-0">
						<ItemTitle className="name"><span className="font-mono">{fallback.data ?? "…"}</span></ItemTitle>
						<ItemDescription className="line-clamp-none wrap-anywhere">{`Every agent that has no model of its own runs on it${own.length ? `. With a model of their own: ${own.join(", ")}` : ""}.`}</ItemDescription>
					</ItemContent>
					<ItemActions className="ctl">
						<Button variant="outline" size="xs" onClick={() => void store.chooseDefaultModel().then(reload)}>Change…</Button>
					</ItemActions>
				</Item>
				{stuck.map((a) => (
					<Alert key={a.id} className="notice">
						<TriangleAlertIcon />
						<AlertDescription><b>{a.id}</b> cannot answer: {a.modelProblem}</AlertDescription>
					</Alert>
				))}
			</ItemGroup>

			<h2 className="flex items-center gap-2 text-base font-medium">Models you can use now</h2>
			{models.data ? (
				models.data.length ? (
					<div className="flex flex-wrap gap-1.5">{models.data.map((m) => <Badge key={m} variant="outline" className="font-mono">{m}</Badge>)}</div>
				) : (
					<p className="text-muted-foreground">none: sign in to a provider or add a server</p>
				)
			) : (
				<p className="text-muted-foreground">…</p>
			)}
			{signIn ? <SignIn provider={signIn.provider} type={signIn.type} close={(_done, choose) => (setSignIn(undefined), reload(), choose ? void store.chooseDefaultModel(choose).then(reload) : undefined)} /> : null}
		</Page>
	);
}

// ---- MCP servers ------------------------------------------------------------------------------------

/** A command line cut into its words, with quotes kept together. */
function words(line: string): string[] {
	const out: string[] = [];
	const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
	for (let m = re.exec(line); m; m = re.exec(line)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
	return out;
}

function Mcp() {
	const servers = useLoad(() => api.mcp());
	const states = useLoad(() => api.mcpStates());
	const [f, setF] = useState({ name: "", kind: "remote" as "remote" | "local", target: "", agent: "", description: "", taints: false });
	const [busy, setBusy] = useState<string>();
	const [out, setOut] = useState<string>();
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const reload = () => (servers.reload(), states.reload());
	const add = async () => {
		const argv = words(f.target);
		const server = f.kind === "remote" ? { url: f.target.trim() } : { command: argv[0], args: argv.slice(1) };
		const done = await store.attempt(() => api.addMcp(f.name.trim(), { ...server, ...(f.description.trim() ? { description: f.description.trim() } : {}), ...(f.taints ? { taints: true } : {}) }, f.agent || undefined));
		if (!done) return;
		store.flash(`Added ${f.name} for ${f.agent || "all agents"}.${f.kind === "remote" ? " If it requires a sign-in, use Sign in on its row." : ""}`, "good", 6000);
		setF({ ...f, name: "", target: "", description: "" });
		reload();
	};
	const login = async (name: string, agent?: string) => {
		setBusy(name);
		setOut(undefined);
		const r = await store.attempt(() => api.mcpLogin(name, agent));
		setBusy(undefined);
		if (r) (setOut(r.out.trim() || (r.code === 0 ? "Signed in." : `It ended with exit ${r.code}.`)), reload());
	};
	return (
		<Page title="MCP servers" lead="Servers that offer tools to your agents: a remote one by its address, or a program on this computer, which runs where the commands of the agent that uses it run.">
			<ItemGroup className="set-group">
				{servers.data ? (
					servers.data.length ? (
						servers.data.map((x) => {
							const state = !x.enabled ? "disabled" : (states.data?.[x.name] ?? (states.loading ? "…" : x.remote ? "unknown" : "local"));
							const agent = x.scope === "global" ? undefined : x.scope;
							const tone = /connected|ok|local|authenticated/i.test(state) ? "good" : /needs|error|fail|unauth/i.test(state) ? "warn" : undefined;
							return (
								<Item key={`${x.scope}:${x.name}`} variant="outline" className="item">
									<ItemContent className="min-w-0">
										<ItemTitle className="name">
											{x.name}
											<Badge variant={tone === "good" ? "default" : tone === "warn" ? "outline" : "secondary"} className={cn("tag", tone)}>{state}</Badge>
											<Badge variant="secondary" className="tag">{x.scope === "global" ? `all: ${x.agents.join(", ") || "nobody"}` : x.session ? `only the conversation ${x.session} of ${x.scope}` : `only ${x.scope}`}</Badge>
											{x.taints ? <Badge variant="outline" className="tag warn">outside content</Badge> : null}
											{x.approve !== "never" ? <Badge variant="secondary" className="tag">asks: {x.approve}</Badge> : null}
										</ItemTitle>
										<ItemDescription className="line-clamp-none font-mono wrap-anywhere">{x.target}</ItemDescription>
									</ItemContent>
									<ItemActions className="ctl">
										{x.remote ? <Button variant="outline" size="xs" disabled={busy === x.name} onClick={() => void login(x.name, agent)}>{busy === x.name ? <><Spinner data-icon="inline-start" />In your browser…</> : "Sign in"}</Button> : null}
										{x.target.startsWith("bundled:") ? null : <AlertDialog>
											<AlertDialogTrigger render={<Button variant="ghost" size="xs" />}>Remove</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Remove the MCP server {x.name}?</AlertDialogTitle>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeMcp(x.name, agent)).then((r) => r && (store.flash(`Removed ${x.name}.`), reload()))}>Remove</AlertDialogCancel>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>}
									</ItemActions>
								</Item>
							);
						})
					) : (
						<EmptyView icon={PlugIcon} title="No MCP servers yet" />
					)
				) : servers.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{servers.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>
			{out ? (
				<CodeBlock size="sm">
					<CodeBlockContent wrap className="log max-h-60 select-text">{out}</CodeBlockContent>
				</CodeBlock>
			) : null}
			<FieldSet>
				<FieldLegend>Add a server</FieldLegend>
				<FieldGroup className="form grid grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="mono font-mono" placeholder="home_link" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
						<FieldDescription>Lowercase letters, digits and _. Its tools appear as mcp__name__tool.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
						<Select items={forItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
							<SelectTrigger id={`${field}-for`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{forItems.map((o) => (
										<SelectItem key={o.value} value={o.value}>
											{o.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-kind`}>Kind</FieldLabel>
						<ToggleGroup id={`${field}-kind`} aria-label="Kind" variant="outline" value={[f.kind]} onValueChange={one((kind) => setF({ ...f, kind: kind as "remote" | "local", target: "" }))}>
							<ToggleGroupItem value="remote">Remote (https address)</ToggleGroupItem>
							<ToggleGroupItem value="local">A program on this computer</ToggleGroupItem>
						</ToggleGroup>
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-target`}>{f.kind === "remote" ? "Address" : "Command"}</FieldLabel>
						<Input id={`${field}-target`} className="mono font-mono" placeholder={f.kind === "remote" ? "https://mcp.example.com/mcp" : "npx -y @example/mcp@latest"} value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} />
						<FieldDescription>{f.kind === "remote" ? "Its https URL." : "The program and its arguments, as its documentation gives them. One program, no shell operators."}</FieldDescription>
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-description`}>What it offers</FieldLabel>
						<Input id={`${field}-description`} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
						<FieldDescription>One sentence, for the agents.</FieldDescription>
					</Field>
					<Field orientation="horizontal" className="col-span-full">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-taints`}>Returns outside content</FieldLabel>
							<FieldDescription>Its results mark a conversation as having read outside content (a server that reads the web, mail or other people's words).</FieldDescription>
						</FieldContent>
						<Switch id={`${field}-taints`} checked={f.taints} onCheckedChange={(taints) => setF({ ...f, taints })} />
					</Field>
				</FieldGroup>
				<Field orientation="horizontal" className="justify-end">
					<Button disabled={!f.name.trim() || !f.target.trim()} onClick={() => void add()}>Add server</Button>
				</Field>
			</FieldSet>
		</Page>
	);
}

// ---- skills -----------------------------------------------------------------------------------------

function Skills() {
	const skills = useLoad(() => api.skills());
	const [edit, setEdit] = useState<{ name: string; description: string; instructions: string; agent: string; isNew: boolean; managed: boolean }>();
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const save = async () => {
		if (!edit) return;
		const done = await store.attempt(() => api.addSkill({ name: edit.name.trim(), description: edit.description.trim(), instructions: edit.instructions, agent: edit.agent || undefined }));
		if (!done) return;
		store.flash(`${done.replaced ? "Replaced" : "Added"} the skill ${done.name}.`, "good");
		setEdit(undefined);
		skills.reload();
	};
	if (edit)
		return (
			<Page title={edit.isNew ? "A new skill" : edit.name} lead="A skill is how something is done, written down so that an agent can do it again: a name, one or two sentences on when to use it, and the steps." actions={edit.managed ? <Button disabled={!edit.name.trim() || !edit.description.trim() || !edit.instructions.trim()} onClick={() => void save()}>Save skill</Button> : undefined}>
				<Button variant="ghost" size="xs" className="self-start" onClick={() => setEdit(undefined)}>
					<ChevronLeftIcon data-icon="inline-start" />
					Skills
				</Button>
				{edit.managed ? null : (
					<Alert className="notice plain">
						<InfoIcon />
						<AlertDescription>This skill lies in a folder of yours that the configuration names. pine shows it and does not change it.</AlertDescription>
					</Alert>
				)}
				<FieldGroup className="form grid grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="mono font-mono" disabled={!edit.isNew} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value.toLowerCase() })} placeholder="invoices" />
						<FieldDescription>Lowercase letters, digits and single hyphens.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
						{edit.isNew ? (
							<Select items={forItems} value={edit.agent} onValueChange={(agent) => setEdit({ ...edit, agent: agent ?? "" })}>
								<SelectTrigger id={`${field}-for`}>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{forItems.map((o) => (
											<SelectItem key={o.value} value={o.value}>
												{o.label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
						) : (
							<Input id={`${field}-for`} disabled value={edit.agent || "all agents"} />
						)}
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-description`}>When to use it</FieldLabel>
						<Textarea id={`${field}-description`} className="min-h-14 max-h-30" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} readOnly={!edit.managed} />
						<FieldDescription>This line is always in front of the agent; it decides by it whether to read the rest.</FieldDescription>
					</Field>
				</FieldGroup>
				<div className="flex h-104 overflow-hidden rounded-lg border">
					<Editor file="SKILL.md" text={edit.instructions} readOnly={!edit.managed} onChange={(instructions) => setEdit((was) => (was ? { ...was, instructions } : was))} onSave={() => void save()} />
				</div>
			</Page>
		);
	return (
		<Page title="Skills" lead="What your agents know how to do. An agent writes one when you ask it to (“make a skill for this”); here you can read them, change them and add your own." actions={<Button onClick={() => setEdit({ name: "", description: "", instructions: "", agent: "", isNew: true, managed: true })}><PlusIcon data-icon="inline-start" />New skill</Button>}>
			<ItemGroup className="set-group">
				{skills.data ? (
					skills.data.length ? (
						skills.data.map((x) => {
							const managed = x.managed && x.scope !== "local";
							return (
								<Item key={x.dir} variant="outline" className="item">
									<ItemContent className="min-w-0">
										<ItemTitle className="name">
											{x.name}
											<Badge variant="secondary" className="tag">{x.scope === "global" ? "all agents" : x.scope === "agent" ? x.agent : `${x.agent} · ${x.session}`}</Badge>
											{x.managed ? null : <Badge variant="secondary" className="tag">yours, from the configuration</Badge>}
										</ItemTitle>
										<ItemDescription className="line-clamp-none wrap-anywhere">{short(x.description, 220)}</ItemDescription>
									</ItemContent>
									<ItemActions className="ctl">
										<Button variant="outline" size="xs" onClick={() => setEdit({ name: x.name, description: x.description, instructions: x.instructions ?? "", agent: x.agent ?? "", isNew: false, managed })}>{managed ? "Edit" : "Read"}</Button>
										{x.managed ? <AlertDialog>
											<Tooltip>
												<TooltipTrigger render={<AlertDialogTrigger render={<Button variant="ghost" size="icon-xs" />} aria-label="Remove this skill"><Trash2Icon /></AlertDialogTrigger>} />
												<TooltipContent>Remove this skill</TooltipContent>
											</Tooltip>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Remove the skill {x.name}?</AlertDialogTitle>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Cancel</AlertDialogCancel>
													<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeSkill(x.name, x.agent, x.session)).then((r) => r && (store.flash(`Removed the skill ${x.name}.`), skills.reload()))}>Remove</AlertDialogCancel>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog> : null}
									</ItemActions>
								</Item>
							);
						})
					) : (
						<EmptyView icon={BookIcon} title="No skills yet">An agent writes one when you ask it to, or add one here.</EmptyView>
					)
				) : skills.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{skills.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>
		</Page>
	);
}

// ---- events: sources, schedules, routes -----------------------------------------------------------------

/** One option of a source type, drawn by what its schema says it is. */
function OptionField({ name, schema, required, value, onChange }: { name: string; schema: any; required: boolean; value: unknown; onChange: (v: unknown) => void }) {
	const type = schema?.type ?? (schema?.anyOf ? "any" : "string");
	const label = `${name}${required ? " *" : ""}`;
	const hint: string | undefined = schema?.description;
	const id = useId();
	if (type === "boolean")
		return (
			<Field orientation="horizontal" className="col-span-full">
				<FieldContent>
					<FieldLabel htmlFor={id}>{label}</FieldLabel>
					{hint ? <FieldDescription>{hint}</FieldDescription> : null}
				</FieldContent>
				<Switch id={id} checked={value === true} onCheckedChange={onChange} />
			</Field>
		);
	if (Array.isArray(schema?.enum)) {
		const items = [{ value: "", label: "not set" }, ...schema.enum.map((v: string) => ({ value: v, label: v }))];
		return (
			<Field>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Select items={items} value={String(value ?? "")} onValueChange={(v) => onChange(v || undefined)}>
					<SelectTrigger id={id}>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{items.map((o) => (
								<SelectItem key={o.value} value={o.value}>
									{o.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
				{hint ? <FieldDescription>{hint}</FieldDescription> : null}
			</Field>
		);
	}
	if (type === "number" || type === "integer")
		return (
			<Field>
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Input id={id} className="mono font-mono" value={value === undefined ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} inputMode="decimal" />
				{hint ? <FieldDescription>{hint}</FieldDescription> : null}
			</Field>
		);
	if (type === "array")
		return (
			<Field className="col-span-full">
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Input id={id} className="mono font-mono" value={Array.isArray(value) ? value.join(", ") : ""} onChange={(e) => onChange(e.target.value.trim() ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : undefined)} />
				<FieldDescription>{`${hint ?? ""} Several: separate them with commas.`.trim()}</FieldDescription>
			</Field>
		);
	if (type === "object" || type === "any")
		return (
			<Field className="col-span-full">
				<FieldLabel htmlFor={id}>{label}</FieldLabel>
				<Input id={id} className="mono font-mono" value={typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
				<FieldDescription>{`${hint ?? ""} As JSON.`.trim()}</FieldDescription>
			</Field>
		);
	return (
		<Field className={String(hint ?? "").length > 90 ? "col-span-full" : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input id={id} className="mono font-mono" value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />
			{hint ? <FieldDescription>{hint}</FieldDescription> : null}
		</Field>
	);
}

function NewSource({ types, close, made }: { types: SourceType[]; close: () => void; made: () => void }) {
	const [f, setF] = useState({ name: "", type: "", description: "", agent: "", own: false, note: "" });
	const [options, setOptions] = useState<Record<string, unknown>>({});
	const [plan, setPlan] = useState<Awaited<ReturnType<typeof api.proposeSource>>>();
	const [values, setValues] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const typeItems = [{ value: "", label: "Choose what it watches…" }, ...types.map((t) => ({ value: t.name, label: `${t.name}: ${short(t.summary, 80)}` }))];
	const type = types.find((t) => t.name === f.type);
	const props = Object.entries<any>(type?.options?.properties ?? {}).filter(([, schema]) => schema?.secret !== true);
	const required = new Set(type?.options?.required ?? []);
	// What was typed as JSON is handed on as what it says.
	const clean = () => Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined).map(([k, v]) => {
		const kind = type?.options?.properties?.[k]?.type;
		if (typeof v === "string" && (kind === "object" || kind === undefined && type?.options?.properties?.[k]?.anyOf)) {
			try {
				return [k, JSON.parse(v)];
			} catch {
				return [k, v];
			}
		}
		return [k, v];
	}));
	const check = async () => {
		setBusy(true);
		const p = await store.attempt(() => api.proposeSource({ name: f.name.trim(), type: f.type, options: clean(), agent: f.agent || undefined }));
		setBusy(false);
		if (p) (setPlan(p), setValues({}));
	};
	const add = async () => {
		setBusy(true);
		const done = await store.attempt(() => api.addSource({ name: f.name.trim(), type: f.type, description: f.description.trim() || type?.summary || f.type, options: clean(), agent: f.agent || undefined, own: f.own || undefined, values: plan?.needs.length ? values : undefined }));
		if (done && f.note.trim()) {
			const note = f.note.trim();
			await store.attempt(() => (f.agent ? api.subscribe(f.agent, done.name, { note }) : api.subscribeAll(done.name, { note })));
		}
		setBusy(false);
		if (!done) return;
		store.flash(`Added the event source ${done.name}.${done.tell ? ` ${done.tell}` : ""}`, "good", done.tell ? 12_000 : 4000);
		made();
	};
	return (
		<Dialog open onOpenChange={(open) => open || close()}>
			<DialogContent showCloseButton={false} className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>A new event source</DialogTitle>
				</DialogHeader>
				<ScrollArea className="-mx-4 flex max-h-(--dialog-scroll) min-h-0 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
					<div className="flex flex-col gap-3 px-4 select-text">
						{plan ? (
							<>
								<div><b>{f.name}</b> ({f.type}) for {f.agent || "all agents"} will:</div>
								<ul className="list-disc pl-5">{plan.does.map((d, i) => <li key={i}>{d}</li>)}</ul>
								{plan.owner ? (
									<Alert className="notice">
										<TriangleAlertIcon />
										<AlertDescription>What it reports is treated as your own words: the agent it wakes gets its full tools.</AlertDescription>
									</Alert>
								) : null}
								<FieldGroup>
									{plan.needs.map((n) => {
										const at = n.label.indexOf(": ");
										return (
											<Field key={n.name}>
												<FieldLabel htmlFor={`${field}-need-${n.name}`}>{at > 0 ? n.label.slice(0, at) : n.name}</FieldLabel>
												<Input id={`${field}-need-${n.name}`} className="mono font-mono" type="password" autoComplete="off" value={values[n.name] ?? ""} onChange={(e) => setValues({ ...values, [n.name]: e.target.value })} />
												<FieldDescription>{`${at > 0 ? n.label.slice(at + 2) : ""} It is not shown, goes into pine's .env file, and never reaches an agent.`.trim()}</FieldDescription>
											</Field>
										);
									})}
									<Field>
										<FieldLabel htmlFor={`${field}-note`}>Subscribe right away</FieldLabel>
										<Input id={`${field}-note`} placeholder="for example: file the scan and tell me what it is" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
										<FieldDescription>{`What is to be done when it reports something. With a note, ${f.agent || "every agent"} is woken by its events; without one, nobody is subscribed yet.`}</FieldDescription>
									</Field>
								</FieldGroup>
							</>
						) : (
							<FieldGroup className="form grid grid-cols-2">
								<Field>
									<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
									<Input id={`${field}-name`} autoFocus className="mono font-mono" placeholder="scans" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
									<FieldDescription>Lowercase letters, digits, - and _.</FieldDescription>
								</Field>
								<Field>
									<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
									<Select items={forItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
										<SelectTrigger id={`${field}-for`}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{forItems.map((o) => (
													<SelectItem key={o.value} value={o.value}>
														{o.label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
								</Field>
								<Field className="col-span-full">
									<FieldLabel htmlFor={`${field}-type`}>Type</FieldLabel>
									<Select items={typeItems} value={f.type} onValueChange={(next) => (setF({ ...f, type: next ?? "" }), setOptions({}))}>
										<SelectTrigger id={`${field}-type`}>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectGroup>
												{typeItems.map((o) => (
													<SelectItem key={o.value} value={o.value}>
														{o.label}
													</SelectItem>
												))}
											</SelectGroup>
										</SelectContent>
									</Select>
									{type?.summary ? <FieldDescription>{type.summary}</FieldDescription> : null}
								</Field>
								{type ? (
									<Field className="col-span-full">
										<FieldLabel htmlFor={`${field}-description`}>What it reports</FieldLabel>
										<Input id={`${field}-description`} placeholder={type.summary} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
									</Field>
								) : null}
								{props.map(([name, schema]) => <OptionField key={name} name={name} schema={schema} required={required.has(name)} value={options[name]} onChange={(v) => setOptions({ ...options, [name]: v })} />)}
								{type ? (
									<Field orientation="horizontal" className="col-span-full">
										<FieldContent>
											<FieldLabel htmlFor={`${field}-own`}>It is my own</FieldLabel>
											<FieldDescription>Only for a device or folder nobody else can put content into: what it reports is then trusted like your own messages.</FieldDescription>
										</FieldContent>
										<Switch id={`${field}-own`} checked={f.own} onCheckedChange={(own) => setF({ ...f, own })} />
									</Field>
								) : null}
								{type ? <FieldDescription className="col-span-full">A password or token it needs is asked for in the next step.</FieldDescription> : null}
							</FieldGroup>
						)}
					</div>
				</ScrollArea>
				<DialogFooter>{plan ? <><Button variant="outline" onClick={() => setPlan(undefined)}>Back</Button><Button disabled={busy || plan.needs.some((n) => !values[n.name]?.trim())} onClick={() => void add()}>Add source</Button></> : <><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={busy || !f.name.trim() || !f.type} onClick={() => void check()}>Continue</Button></>}</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function Sources() {
	const s = useModel(store);
	const sources = useLoad(() => api.sources());
	const types = useLoad(() => api.sourceTypes());
	const [adding, setAdding] = useState(false);
	const subscribe = async (name: string) => {
		const agent = await store.pick({ title: `Who wakes on ${name}?`, items: [{ value: "*", label: "All agents", about: "each in its main conversation" }, ...s.agents.map((a) => ({ value: a.id, label: a.id, about: "in its main conversation" }))] });
		if (!agent) return;
		const note = await store.pick({ title: "What is to be done when it reports something?", items: [{ value: "-", label: "Nothing in particular", about: "the agent decides by the event" }], free: true, placeholder: "A note that is shown with every event" });
		if (note === undefined) return;
		const details = note === "-" ? {} : { note };
		const done = await store.attempt(() => (agent === "*" ? api.subscribeAll(name, details) : api.subscribe(agent, name, details)));
		if (done) (store.flash(`${agent === "*" ? "All agents are" : `${agent} is`} subscribed to ${name}.`, "good"), sources.reload());
	};
	const unsubscribe = async (name: string, who: string) => {
		const [agent, session] = who.split("/");
		const done = await store.attempt(() => (who === "*" || who === "all agents" ? api.unsubscribeAll(name) : api.unsubscribe(agent, name, session ?? "main")));
		if (done) sources.reload();
	};
	return (
		<>
			<div className="flex items-center gap-2"><p className="grow text-muted-foreground">What can wake an agent: a folder, a web address, a chat, a device. A source costs nothing until somebody is subscribed to it.</p><Button disabled={!types.data} onClick={() => setAdding(true)}><PlusIcon data-icon="inline-start" />New source</Button></div>
			<ItemGroup className="set-group">
				{sources.data ? (
					sources.data.length ? (
						sources.data.map((x) => (
							<Item key={`${x.scope}:${x.name}`} variant="outline" className="item">
								<ItemMedia><span className={cn("size-2 rounded-full", x.error ? "bg-destructive" : x.running ? "bg-primary" : "bg-muted-foreground")} /></ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle className="name">
										{x.name}
										<Badge variant="secondary" className="tag">{x.type}</Badge>
										<Badge variant="secondary" className="tag">{scopeText(x.scope)}</Badge>
										{x.trust === "owner" ? <Badge className="tag good">yours</Badge> : null}
									</ItemTitle>
									<ItemDescription className="line-clamp-none wrap-anywhere">
										{x.description ? <>{x.description}<br /></> : null}
										{x.error ? `not running: ${x.error}` : x.running ? (x.status ?? "running") : "idle, nobody is subscribed"} · {x.last ? `last event ${ago(x.last.ts)}, ${x.events} since start` : "no events since start"}
									</ItemDescription>
									<div className="flex flex-wrap items-center gap-1">
										{x.subscribers.map((who) => (
											<Tooltip key={who}>
												<TooltipTrigger render={<Button variant="outline" size="xs" aria-label={`End the subscription of ${who}`} onClick={() => void unsubscribe(x.name, who)}>{who}<XIcon data-icon="inline-end" /></Button>} />
												<TooltipContent>End the subscription of {who}</TooltipContent>
											</Tooltip>
										))}
										<Button variant="ghost" size="xs" onClick={() => void subscribe(x.name)}><PlusIcon data-icon="inline-start" />Subscribe</Button>
									</div>
								</ItemContent>
								<ItemActions className="ctl">
									<AlertDialog>
										<Tooltip>
											<TooltipTrigger render={<AlertDialogTrigger render={<Button variant="ghost" size="icon-xs" />} aria-label="Remove this source"><Trash2Icon /></AlertDialogTrigger>} />
											<TooltipContent>Remove this source</TooltipContent>
										</Tooltip>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Remove the event source {x.name}?</AlertDialogTitle>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeSource(x.name, x.scope === "global" ? undefined : x.scope)).then((r) => r && (store.flash(`Removed the event source ${x.name}.`), sources.reload()))}>Remove</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</ItemActions>
							</Item>
						))
					) : (
						<EmptyView icon={ZapIcon} title="No event sources yet">Add one, or ask an agent: “watch ~/Scans”, “tell me when the price drops”.</EmptyView>
					)
				) : sources.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{sources.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>
			{adding && types.data ? <NewSource types={types.data} close={() => setAdding(false)} made={() => (setAdding(false), sources.reload())} /> : null}
		</>
	);
}

const WHEN: Record<"cron" | "every" | "at" | "in", { label: string; name: string; hint: string }> = {
	cron: { label: "At set times", name: "Times", hint: "minute hour day month weekday, for example 0 7 * * 1-5 (weekdays at seven)" },
	every: { label: "Every", name: "Interval", hint: "an interval, for example 30m or 6h" },
	at: { label: "Once, at", name: "Moment", hint: "a moment, for example 2026-12-24T17:00" },
	in: { label: "Once, in", name: "From now", hint: "from now, for example 20m" },
};

function Schedules() {
	const list = useLoad(() => api.schedules());
	const [f, setF] = useState({ name: "", kind: "cron" as keyof typeof WHEN, when: "", task: "", agent: "" });
	const s = useModel(store);
	const field = useId();
	const forItems = whom(s.agents);
	const add = async () => {
		const done = await store.attempt(() => api.addSchedule({ name: f.name.trim(), task: f.task.trim(), [f.kind]: f.when.trim(), agent: f.agent || undefined } as any));
		if (!done) return;
		store.flash(`Scheduled ${done.name}: ${done.when}.`, "good");
		setF({ ...f, name: "", when: "", task: "" });
		list.reload();
	};
	return (
		<>
			<p className="text-muted-foreground">What happens because of the time. A schedule wakes an agent with a task, in your name.</p>
			<ItemGroup className="set-group">
				{list.data ? (
					list.data.length ? (
						list.data.map((x) => (
							<Item key={`${x.scope}:${x.name}`} variant="outline" className="item">
								<ItemMedia variant="icon"><ClockIcon /></ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle className="name">
										{x.name}
										<Badge variant="secondary" className="tag">{scopeText(x.scope, x.session)}</Badge>
										<Badge variant="secondary" className="tag">{x.when}</Badge>
										{x.next ? <Badge className="tag good">next {new Date(x.next).toLocaleString("sv-SE").slice(0, 16)}</Badge> : null}
									</ItemTitle>
									<ItemDescription className="line-clamp-none wrap-anywhere">{x.task ?? `publishes ${x.topic}`}</ItemDescription>
								</ItemContent>
								<ItemActions className="ctl">
									<AlertDialog>
										<Tooltip>
											<TooltipTrigger render={<AlertDialogTrigger render={<Button variant="ghost" size="icon-xs" />} aria-label="Remove this schedule"><Trash2Icon /></AlertDialogTrigger>} />
											<TooltipContent>Remove this schedule</TooltipContent>
										</Tooltip>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Remove the schedule {x.name}?</AlertDialogTitle>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeSchedule(x.name, x.scope === "global" ? undefined : x.scope)).then((r) => r && list.reload())}>Remove</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</ItemActions>
							</Item>
						))
					) : (
						<EmptyView icon={ClockIcon} title="Nothing is scheduled">An agent schedules something when you ask it to (“every morning at seven …”, “remind me at five”).</EmptyView>
					)
				) : list.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{list.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>
			<FieldSet>
				<FieldLegend>Add a schedule</FieldLegend>
				<FieldGroup className="form grid grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="mono font-mono" placeholder="morning" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-for`}>For</FieldLabel>
						<Select items={forItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
							<SelectTrigger id={`${field}-for`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{forItems.map((o) => (
										<SelectItem key={o.value} value={o.value}>
											{o.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-kind`}>When</FieldLabel>
						<ToggleGroup id={`${field}-kind`} aria-label="When" variant="outline" value={[f.kind]} onValueChange={one((kind) => setF({ ...f, kind: kind as keyof typeof WHEN, when: "" }))}>
							{Object.entries(WHEN).map(([value, w]) => (
								<ToggleGroupItem key={value} value={value}>
									{w.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-when`}>{WHEN[f.kind].name}</FieldLabel>
						<Input id={`${field}-when`} className="mono font-mono" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
						<FieldDescription>{WHEN[f.kind].hint}</FieldDescription>
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-task`}>Task</FieldLabel>
						<Textarea id={`${field}-task`} className="min-h-14 max-h-44" value={f.task} onChange={(e) => setF({ ...f, task: e.target.value })} />
						<FieldDescription>What the agent is to do when it is time, written so that it is enough on its own.</FieldDescription>
					</Field>
				</FieldGroup>
				<Field orientation="horizontal" className="justify-end">
					<Button disabled={!f.name.trim() || !f.when.trim() || !f.task.trim()} onClick={() => void add()}>Add schedule</Button>
				</Field>
			</FieldSet>
		</>
	);
}

function Routes() {
	const list = useLoad(() => api.routes());
	const s = useModel(store);
	const empty = { name: "", on: "", when: "", agent: "", prompt: "", session: "", throttle: "", set: "", publish_topic: "", publish_payload: "" };
	const [f, setF] = useState(empty);
	const field = useId();
	const agentItems = [{ value: "", label: "nobody" }, ...s.agents.map((a) => ({ value: a.id, label: a.id }))];
	const add = async () => {
		const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || undefined]));
		const done = await store.attempt(() => api.addRoute(body));
		if (!done) return;
		store.flash(`Added the route ${done.name}: ${done.lines.join("; ")}.${done.wider ? ` Note: ${done.wider}` : ""}`, done.wider ? "warn" : "good", 8000);
		setF(empty);
		list.reload();
	};
	const does = (r: NonNullable<typeof list.data>[number]) => [r.set ? `sets ${JSON.stringify(r.set)}` : "", r.call ? `asks a model: ${short(r.call.prompt, 80)}` : "", r.publish ? `publishes ${r.publish.topic}` : "", r.agent ? `wakes ${r.agent}${r.session ? ` (${r.session})` : ""}${r.prompt ? ` with: ${short(r.prompt, 100)}` : ""}` : ""].filter(Boolean).join("; ");
	return (
		<>
			<p className="text-muted-foreground">Rules that turn an event into something: wake an agent, write shared state, publish another event. A subscription is the simple case and needs no route.</p>
			<ItemGroup className="set-group">
				{list.data ? (
					list.data.length ? (
						list.data.map((r) => (
							<Item key={r.name} variant="outline" className="item">
								<ItemContent className="min-w-0">
									<ItemTitle className="name">
										{r.name}
										<Badge variant="secondary" className="tag mono font-mono">on {r.on.join(", ")}</Badge>
										{r.when ? <Badge variant="secondary" className="tag mono font-mono">when {short(JSON.stringify(r.when), 60)}</Badge> : null}
										{r.trust === "owner" ? <Badge variant="outline" className="tag warn">counts as your words</Badge> : null}
									</ItemTitle>
									<ItemDescription className="line-clamp-none wrap-anywhere">{does(r)}</ItemDescription>
								</ItemContent>
								<ItemActions className="ctl">
									<AlertDialog>
										<Tooltip>
											<TooltipTrigger render={<AlertDialogTrigger render={<Button variant="ghost" size="icon-xs" />} aria-label="Remove this route"><Trash2Icon /></AlertDialogTrigger>} />
											<TooltipContent>Remove this route</TooltipContent>
										</Tooltip>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>Remove the route {r.name}?</AlertDialogTitle>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>Cancel</AlertDialogCancel>
												<AlertDialogCancel variant="destructive" onClick={() => void store.attempt(() => api.removeRoute(r.name)).then((x) => x && list.reload())}>Remove</AlertDialogCancel>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								</ItemActions>
							</Item>
						))
					) : (
						<p className="text-muted-foreground">No routes.</p>
					)
				) : list.error ? (
					<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{list.error}</AlertDescription></Alert>
				) : (
					<Spinner className="m-auto" />
				)}
			</ItemGroup>
			<FieldSet>
				<FieldLegend>Add a route</FieldLegend>
				<FieldGroup className="form grid grid-cols-2">
					<Field>
						<FieldLabel htmlFor={`${field}-name`}>Name</FieldLabel>
						<Input id={`${field}-name`} className="mono font-mono" placeholder="door" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.toLowerCase() })} />
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-on`}>On</FieldLabel>
						<Input id={`${field}-on`} className="mono font-mono" placeholder="source/house/message" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
						<FieldDescription>Topic patterns, separated by commas.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-when`}>Only when</FieldLabel>
						<Input id={`${field}-when`} className="mono font-mono" placeholder={'{"payload.open": true}'} value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} />
						<FieldDescription>Optional, as JSON.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-throttle`}>At most one per</FieldLabel>
						<Input id={`${field}-throttle`} className="mono font-mono" value={f.throttle} onChange={(e) => setF({ ...f, throttle: e.target.value })} />
						<FieldDescription>Optional, a time such as 5m.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-agent`}>Wake the agent</FieldLabel>
						<Select items={agentItems} value={f.agent} onValueChange={(agent) => setF({ ...f, agent: agent ?? "" })}>
							<SelectTrigger id={`${field}-agent`}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{agentItems.map((o) => (
										<SelectItem key={o.value} value={o.value}>
											{o.label}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-session`}>In the conversation</FieldLabel>
						<Input id={`${field}-session`} className="mono font-mono" disabled={!f.agent} value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })} />
						<FieldDescription>Empty: its main one. “new”: a fresh one for every event.</FieldDescription>
					</Field>
					<Field className="col-span-full">
						<FieldLabel htmlFor={`${field}-prompt`}>With</FieldLabel>
						<Input id={`${field}-prompt`} disabled={!f.agent} value={f.prompt} onChange={(e) => setF({ ...f, prompt: e.target.value })} />
						<FieldDescription>What it is told. {"{{payload.field}}"} stands for a value of the event.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-set`}>Set shared state</FieldLabel>
						<Input id={`${field}-set`} className="mono font-mono" placeholder={'{"house/mode": "{{payload.value}}"}'} value={f.set} onChange={(e) => setF({ ...f, set: e.target.value })} />
						<FieldDescription>Optional, as JSON.</FieldDescription>
					</Field>
					<Field>
						<FieldLabel htmlFor={`${field}-publish`}>Publish the event</FieldLabel>
						<Input id={`${field}-publish`} className="mono font-mono" value={f.publish_topic} onChange={(e) => setF({ ...f, publish_topic: e.target.value })} />
						<FieldDescription>Optional: a topic of your own.</FieldDescription>
					</Field>
				</FieldGroup>
				<Field orientation="horizontal" className="justify-end">
					<Button disabled={!f.name.trim() || !f.on.trim()} onClick={() => void add()}>Add route</Button>
				</Field>
			</FieldSet>
		</>
	);
}

function EventsPage() {
	const [tab, setTab] = useState<"sources" | "schedules" | "routes">("sources");
	return (
		<Page title="Events" lead="What reaches your agents without you typing: sources that report, schedules that fire, and routes between them." actions={<Button variant="outline" onClick={() => void store.openEvents()}><AudioLinesIcon data-icon="inline-start" />Open the event log</Button>}>
			<Tabs value={tab} onValueChange={setTab}>
				<TabsList activateOnFocus>
					<TabsTrigger value="sources"><ZapIcon data-icon="inline-start" />Sources</TabsTrigger>
					<TabsTrigger value="schedules"><ClockIcon data-icon="inline-start" />Schedules</TabsTrigger>
					<TabsTrigger value="routes"><GitBranchIcon data-icon="inline-start" />Routes</TabsTrigger>
				</TabsList>
				<TabsContent value="sources" className="flex flex-col gap-6"><Sources /></TabsContent>
				<TabsContent value="schedules" className="flex flex-col gap-6"><Schedules /></TabsContent>
				<TabsContent value="routes" className="flex flex-col gap-6"><Routes /></TabsContent>
			</Tabs>
		</Page>
	);
}

// ---- instructions for all agents -------------------------------------------------------------------------

function Instructions() {
	const files = useLoad(() => api.shared());
	const [name, setName] = useState("AGENTS.md");
	const [texts, setTexts] = useState<Record<string, string>>({});
	const file = files.data?.find((f) => f.name === name);
	const text = texts[name] ?? file?.text ?? "";
	const dirty = file !== undefined && text !== file.text;
	const save = async () => {
		if (!dirty) return;
		const done = await store.attempt(() => api.setShared(name, text));
		if (!done) return;
		store.flash(`Saved ${name}. It reaches every agent with its next message.`, "good");
		setTexts((was) => Object.fromEntries(Object.entries(was).filter(([k]) => k !== name)));
		files.reload();
	};
	return (
		<Page title="Instructions" lead="What holds for all agents: three files in pine's home that are put into every agent's prompt. The main agent keeps them when you tell it something that is for everybody; here you can read and change them yourself." actions={<Button disabled={!dirty} onClick={() => void save()}>Save {name}</Button>}>
			{files.data ? (
				<FileTabs files={files.data.map((f) => ({ key: f.name, label: f.name, about: f.about }))} value={name} onChange={setName}>
					{(key) => (
						<div className="flex h-116 overflow-hidden rounded-lg border">
							<Editor key={key} file={key} text={texts[key] ?? files.data!.find((f) => f.name === key)?.text ?? ""} onChange={(v) => setTexts((was) => ({ ...was, [key]: v }))} onSave={() => void save()} />
						</div>
					)}
				</FileTabs>
			) : files.error ? (
				<Alert variant="destructive" className="notice"><TriangleAlertIcon /><AlertDescription>{files.error}</AlertDescription></Alert>
			) : (
				<Spinner className="m-auto" />
			)}
			<Alert className="notice plain">
				<InfoIcon />
				<AlertDescription>What only one agent should know or do goes into that agent's own files, on its page under Agents.</AlertDescription>
			</Alert>
		</Page>
	);
}

// ---- the app itself ----------------------------------------------------------------------------------------

function AppPage() {
	const s = useModel(store);
	const set = async (change: Record<string, unknown>) => {
		s.prefs = await bridge.prefs(change);
		s.touch();
	};
	const service = s.service.status === "ready" ? s.service : undefined;
	const newer = s.update?.status === "newer" ? s.update : undefined;
	// `pine` for a terminal: what the shell has, as the app's main process sees it.
	const [command, setCommand] = useState<{ state: "none" | "here" | "other" | "unavailable"; why?: string; text: string }>();
	useEffect(() => void bridge.command().then(setCommand), []);
	// (Looked at again whenever this page is opened: the browser may have been fetched in a terminal.)
	useEffect(() => void store.checkBrowser(), []);
	const field = useId();
	return (
		<Page title="App" lead="How this window behaves, and the pine it talks to.">
			<FieldSet>
				<FieldLegend>This app</FieldLegend>
				<FieldGroup className="set-group">
					<Field orientation="horizontal" className="item">
						<FieldContent>
							<FieldTitle className="name">Appearance</FieldTitle>
							<FieldDescription>Light, dark, or what the system is set to.</FieldDescription>
						</FieldContent>
						<div className="ctl flex items-center gap-1.5">
							<ToggleGroup aria-label="Appearance" variant="outline" value={[s.prefs.theme]} onValueChange={one((theme) => void set({ theme }))}>
								<ToggleGroupItem value="system">System</ToggleGroupItem>
								<ToggleGroupItem value="light">Light</ToggleGroupItem>
								<ToggleGroupItem value="dark">Dark</ToggleGroupItem>
							</ToggleGroup>
						</div>
					</Field>
					{s.updates ? (
						<Field orientation="horizontal" className="item updates">
							<FieldContent>
								<FieldTitle className="name">
									Pine {s.versions.app}
									{newer ? <Badge variant="outline" className="tag warn">{newer.version} is available</Badge> : s.update?.status === "latest" ? <Badge className="tag good">the latest version</Badge> : null}
								</FieldTitle>
								<FieldDescription>{newer ? "The new app is a disk image on the release's page on GitHub: download it and put the app in place of this one. Your pine home stays as it is." : "The app does not update itself. It asks GitHub for pine's last release, and says so when that is newer."}</FieldDescription>
							</FieldContent>
							<div className="ctl flex items-center gap-1.5">
								{newer ? <Button variant="outline" size="xs" onClick={() => void bridge.open(newer.url)}><ExternalLinkIcon data-icon="inline-start" />Release page</Button> : null}
								<Button variant="outline" size="xs" disabled={s.updateLooking} onClick={() => void s.lookForUpdate(true)}><RotateCwIcon data-icon="inline-start" />Check now</Button>
							</div>
						</Field>
					) : null}
					{s.updates ? (
						<Field orientation="horizontal" className="item">
							<FieldContent>
								<FieldLabel htmlFor={`${field}-updates`} className="name">Look for a newer version at the start</FieldLabel>
								<FieldDescription>One question to GitHub each time the app starts. It says nothing about this Mac or your pine.</FieldDescription>
							</FieldContent>
							<div className="ctl flex items-center gap-1.5">
								<Switch id={`${field}-updates`} checked={s.prefs.updates} onCheckedChange={(updates) => void set({ updates })} />
							</div>
						</Field>
					) : null}
					<Field orientation="horizontal" className="item">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-notify`} className="name">Notifications</FieldLabel>
							<FieldDescription>When an agent is done, stops with an error, needs your approval or asks you something while the window is not in front. The text is pine's own, never the agent's.</FieldDescription>
						</FieldContent>
						<div className="ctl flex items-center gap-1.5">
							<Switch id={`${field}-notify`} checked={s.prefs.notify} onCheckedChange={(notify) => void set({ notify })} />
						</div>
					</Field>
				</FieldGroup>
			</FieldSet>
			<FieldSet>
				<FieldLegend>pine</FieldLegend>
				<FieldGroup className="set-group">
					<Field orientation="horizontal" className="item">
						<FieldContent>
							<FieldTitle className="name">
								{service ? `pine ${service.version ?? ""}` : "pine"}
								<Badge variant={s.connected ? "default" : "outline"} className={cn("tag", s.connected ? "good" : "warn")}>{s.connected ? "connected" : "not connected"}</Badge>
							</FieldTitle>
							<FieldDescription>{service ? (service.started ? `Started by this app (${service.mode}), from ${service.from}. It stops when the app quits unless the switch below is on.` : "Attached to a pine that was already running. It goes on when this app quits.") : "Not running."}</FieldDescription>
						</FieldContent>
						{service?.started ? (
							<div className="ctl flex items-center gap-1.5">
								<Button variant="outline" size="xs" onClick={() => void s.attempt(() => bridge.restart())}><RotateCwIcon data-icon="inline-start" />Restart</Button>
							</div>
						) : null}
					</Field>
					<Field orientation="horizontal" className="item">
						<FieldContent>
							<FieldLabel htmlFor={`${field}-keep-running`} className="name">Keep pine running after the app quits</FieldLabel>
							<FieldDescription>A pine this app starts then goes on in the background: schedules fire, sources report and Telegram answers while the window is closed. Holds from the next time the app starts pine.</FieldDescription>
						</FieldContent>
						<div className="ctl flex items-center gap-1.5">
							<Switch id={`${field}-keep-running`} checked={s.prefs.keepRunning} onCheckedChange={(keepRunning) => void set({ keepRunning })} />
						</div>
					</Field>
					{command && (command.state !== "unavailable" || command.why) ? (
						<Field orientation="horizontal" className="item">
							<FieldContent>
								<FieldTitle className="name">
									pine in a terminal
									{command.state === "here" ? <Badge className="tag good">set up</Badge> : null}
								</FieldTitle>
								<FieldDescription>{command.text}</FieldDescription>
							</FieldContent>
							{command.state === "none" || command.state === "here" ? (
								<div className="ctl flex items-center gap-1.5">
									{command.state === "none" ? <Button variant="outline" size="xs" onClick={() => void bridge.command("install").then(setCommand)}>Set up</Button> : <Button variant="outline" size="xs" onClick={() => void bridge.command("remove").then(setCommand)}>Remove</Button>}
								</div>
							) : null}
						</Field>
					) : null}
					{s.browser !== undefined || s.browserFetching ? (
						<Field orientation="horizontal" className="item browser">
							<FieldContent>
								<FieldTitle className="name">
									Browser for the web tools
									<Badge variant={s.browser ? "default" : "outline"} className={cn("tag", s.browser ? "good" : "warn")}>{s.browser ? "on this Mac" : "not on this Mac"}</Badge>
								</FieldTitle>
								<FieldDescription>{s.browser ? "The browser your agents open pages with, in the build this pine drives." : "Each version of pine drives a browser build of its own, and this one's is not here: it was never fetched, or it is the build of an older pine. About 600 MB, once. Until then the browser tools do not work; web search and reading a page do."}</FieldDescription>
								{!s.browser && s.initLines.length ? (
									<CodeBlock size="sm">
										<CodeBlockContent wrap className="log max-h-60 select-text">{s.initLines.slice(-12).join("\n")}</CodeBlockContent>
									</CodeBlock>
								) : null}
							</FieldContent>
							{s.browser ? null : <Button variant="outline" size="xs" disabled={s.browserFetching} onClick={() => void s.fetchBrowser()}>{s.browserFetching ? <><Spinner data-icon="inline-start" />Fetching…</> : "Fetch it"}</Button>}
						</Field>
					) : null}
					<Field orientation="horizontal" className="item">
						<FieldContent>
							<FieldTitle className="name">Home folder</FieldTitle>
							<FieldDescription>
								<span className="block font-mono">{tilde(service?.home ?? s.prefs.home ?? "~/.pine")}</span>
								Where pine keeps its agents and settings. Another one is another pine. Changing it restarts a pine this app started.
							</FieldDescription>
						</FieldContent>
						<div className="ctl flex items-center gap-1.5">
							{s.prefs.home ? <Button variant="outline" size="xs" onClick={() => void set({ home: "" }).then(() => bridge.retry())}>Use ~/.pine</Button> : null}
							<Button variant="outline" size="xs" onClick={() => void bridge.pickFolder("A pine home folder").then((dir: string | undefined) => dir && set({ home: dir }).then(() => (service?.started ? bridge.restart() : bridge.retry())))}><FolderIcon data-icon="inline-start" />Choose…</Button>
						</div>
					</Field>
				</FieldGroup>
			</FieldSet>
			<p className="text-muted-foreground">Pine {s.versions.app} · Electron {s.versions.electron}</p>
		</Page>
	);
}

export function Settings() {
	const s = useModel(store);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border bg-background">
			{/* A provider of its own, as in shadcn's sidebar in a dialog: the page needs one where no app side bar is around it (Storybook).
			    Its ⌘B listener changes nothing here (open is fixed and the side bar cannot collapse); the app's provider still gets the key. */}
			<SidebarProvider open className="min-h-0 w-auto flex-none">
				<SidebarRoot collapsible="none" className="set-nav w-50 border-r border-line-soft bg-transparent">
					<SidebarContent>
						<ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade">
							<SidebarGroup role="navigation" className="py-4">
								<SidebarGroupContent>
									<SidebarMenu>
										{SECTIONS.map((x) => (
											<SidebarMenuItem key={x.id}>
												<SidebarMenuButton isActive={s.section === x.id} className="side-row" aria-current={s.section === x.id ? "page" : undefined} onClick={() => ((s.section = x.id), (s.settingsAgent = undefined), s.touch())}><x.icon />{x.label}</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</ScrollArea>
					</SidebarContent>
				</SidebarRoot>
			</SidebarProvider>
			<ScrollArea className="set-page flex min-h-0 min-w-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:scroll-fade" key={s.section}>
				{s.section === "agents" ? <Agents /> : s.section === "models" ? <Models /> : s.section === "mcp" ? <Mcp /> : s.section === "skills" ? <Skills /> : s.section === "events" ? <EventsPage /> : s.section === "instructions" ? <Instructions /> : s.section === "app" ? <AppPage /> : <General />}
			</ScrollArea>
		</div>
	);
}
