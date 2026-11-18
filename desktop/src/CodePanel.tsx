// The panel beside a conversation: the agent itself (AgentView.tsx), then its work: the files
// with an editor, what changed in the folder (git), what the last message changed, what the
// agent's tool calls printed, and what its commands left running. Everything is read through the control API; a file is written through it too, by
// the daemon, inside a sandbox that reaches only this folder.
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, FileIcon, FolderIcon, GitBranchIcon, PencilIcon, PlayIcon, RotateCwIcon, SaveIcon, SearchIcon, SquareTerminalIcon, Undo2Icon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel } from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { Fragment, type UIEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockCopyButton, CodeBlockLine } from "@/components/ui/code-block";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { api, type Change, media, type TranscriptEntry } from "./api.ts";
import { AgentView } from "./AgentView.tsx";
import { bridge } from "./bridge.ts";
import { BrowserView } from "./Browser.tsx";
import { Steps } from "./Conversation.tsx";
import { type CodeView, mediaKind, store, type Tab, useModel, useSignal } from "./model.ts";
import { clock, errText, oneLine, plural, short, size, tilde, took } from "./text.ts";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Confirm } from "./Confirm.tsx";
import { List, ListRow, rowClass, Tree, TreeRow } from "./lists.tsx";
import { Empty, Loading, Pulse, useLoad } from "./ui.tsx";
import { Hint } from "@/components/hint";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { ScrollFadeArea } from "@/components/scroll-fade-area";
import { LogText } from "@/components/log";

// ---- the editor ------------------------------------------------------------------------------------

// The editor says what a token is and what it looks like: the colours differ between light and dark (dark is
// poimandres, token by token as the theme has them, which tells more kinds of keyword apart than light does).
const colours = HighlightStyle.define([
	{ tag: [t.comment], class: "text-faint italic dark:text-(--p-comment)/70" },
	{ tag: [t.meta], class: "text-faint italic dark:text-(--p-fg) dark:not-italic" },
	{ tag: [t.keyword], class: "text-plan dark:text-(--p-fg)" },
	{ tag: [t.definitionKeyword], class: "text-plan dark:text-(--p-steel)" },
	{ tag: [t.controlKeyword], class: "text-plan dark:text-(--p-mint)/75" },
	{ tag: [t.moduleKeyword, t.modifier, t.operatorKeyword, t.self], class: "text-plan dark:text-(--p-mint)" },
	{ tag: [t.string, t.special(t.string)], class: "text-add dark:text-(--p-mint)" },
	{ tag: [t.regexp, t.escape], class: "text-add dark:text-(--p-teal)" },
	{ tag: [t.number, t.atom, t.url], class: "text-warn dark:text-(--p-mint)" },
	{ tag: [t.bool], class: "text-warn dark:text-(--p-mint)" },
	{ tag: [t.null], class: "text-warn dark:text-(--p-pink)" },
	{ tag: [t.variableName], class: "dark:text-(--p-bright)" },
	{ tag: [t.propertyName], class: "text-foreground dark:text-(--p-bright)" },
	{ tag: [t.attributeName], class: "text-foreground dark:text-(--p-steel) dark:italic" },
	{ tag: [t.function(t.variableName), t.function(t.propertyName)], class: "text-info dark:text-(--p-bright)/80" },
	{ tag: [t.function(t.definition(t.variableName)), t.definition(t.function(t.propertyName))], class: "text-info dark:text-(--p-blue)" },
	{ tag: [t.className, t.definition(t.className)], class: "text-info dark:text-(--p-blue)" },
	{ tag: [t.typeName], class: "text-info dark:text-(--p-fg)/75" },
	{ tag: [t.namespace], class: "text-info dark:text-(--p-steel)" },
	{ tag: [t.tagName], class: "text-info dark:text-(--p-mint)" },
	{ tag: [t.heading], class: "font-semibold dark:text-(--p-mint)" },
	{ tag: [t.emphasis], class: "italic dark:text-(--p-slate)" },
	{ tag: [t.strong], class: "font-semibold dark:text-(--p-slate)" },
	{ tag: [t.link], class: "underline dark:text-(--p-blue)" },
	{ tag: [t.inserted], class: "text-add dark:text-(--p-blue)" },
	{ tag: [t.deleted, t.invalid], class: "text-del dark:text-(--p-pink)" },
	{ tag: [t.punctuation, t.bracket], class: "text-muted-foreground dark:text-(--p-fg)" },
	{ tag: [t.operator], class: "text-muted-foreground dark:text-(--p-steel)" },
]);

// CodeMirror's own look, in pine's colours. Its base theme is a style sheet of its own, outside Tailwind's
// layers, so what it also sets wins here only as important.
const EDITOR = [
	"editor flex min-h-0 flex-1 overflow-hidden",
	"[&_.cm-editor]:h-full [&_.cm-editor]:min-w-0 [&_.cm-editor]:flex-1 [&_.cm-editor]:bg-background [&_.cm-editor]:text-foreground [&_.cm-editor]:outline-none! dark:[&_.cm-editor]:text-(--p-fg)",
	"[&_.cm-scroller]:font-mono! [&_.cm-scroller]:text-xs [&_.cm-scroller]:leading-relaxed!",
	"[&_.cm-gutters]:border-r! [&_.cm-gutters]:border-line-soft! [&_.cm-gutters]:bg-background! [&_.cm-gutters]:text-faint! dark:[&_.cm-gutters]:text-(--p-comment)/55!",
	"[&_.cm-activeLine]:bg-hover! [&_.cm-activeLineGutter]:bg-hover! dark:[&_.cm-activeLine]:bg-(--select)/25! dark:[&_.cm-activeLineGutter]:bg-(--select)/25! dark:[&_.cm-activeLineGutter]:text-(--p-fg)!",
	"[&_.cm-selectionBackground]:bg-(--select)! [&_.cm-cursor]:border-l-primary! dark:[&_.cm-cursor]:border-l-(--p-fg)!",
	"[&_.cm-panels]:border-border! [&_.cm-panels]:bg-raised! [&_.cm-panels]:text-foreground!",
	"[&_.cm-textfield]:rounded-md! [&_.cm-textfield]:border-border! [&_.cm-textfield]:bg-card! [&_.cm-textfield]:font-sans [&_.cm-textfield]:text-xs! [&_.cm-textfield]:text-foreground",
	"[&_.cm-button]:rounded-md! [&_.cm-button]:border-border! [&_.cm-button]:bg-card! [&_.cm-button]:bg-none! [&_.cm-button]:font-sans [&_.cm-button]:text-xs! [&_.cm-button]:text-foreground",
	"[&_.cm-searchMatch]:bg-warn-soft! [&_.cm-searchMatch]:outline-1! [&_.cm-searchMatch]:outline-warn/50! dark:[&_.cm-searchMatch]:bg-(--p-blue)/25! dark:[&_.cm-searchMatch]:outline-(--p-blue)/50!",
].join(" ");

// The panel's parts: a bar of controls with a line under it, and what scrolls below.
/** What scrolls under a bar; `wide` for what can be wider than the panel (a diff), which scrolls sideways too. */
function Body({ wide, children }: { wide?: boolean; children: React.ReactNode }) {
	return (
		<ScrollFadeArea axis={wide ? "both" : "y"} className="flex-1">
			<div className="flex min-h-full flex-col">{children}</div>
		</ScrollFadeArea>
	);
}
const SUB = "code-sub flex min-h-9 flex-none items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5 text-xs text-muted-foreground";
const PICTURE = "block max-h-80 max-w-full rounded-lg border sm:max-w-md";
const STATUS: Record<string, string> = { M: "text-warn", A: "text-add", "?": "text-add", D: "text-del", R: "text-info" };

function language(file: string): Extension {
	const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
	if (["ts", "mts", "cts"].includes(ext)) return javascript({ typescript: true });
	if (ext === "tsx") return javascript({ typescript: true, jsx: true });
	if (["js", "mjs", "cjs", "jsx"].includes(ext)) return javascript({ jsx: true });
	if (["json", "jsonc"].includes(ext)) return json();
	if (["md", "markdown", "mdx"].includes(ext)) return markdown();
	if (["css", "scss"].includes(ext)) return css();
	if (["html", "htm", "vue", "svelte", "xml", "svg"].includes(ext)) return html();
	if (ext === "py") return python();
	if (ext === "rs") return rust();
	if (["yml", "yaml"].includes(ext)) return yaml();
	return [];
}

/** A text editor. `text` is what is on disk; what is typed is told with `onChange`, and ⌘S asks to save. */
export function Editor({ file, text, readOnly, onChange, onSave }: { file: string; text: string; readOnly?: boolean; onChange?: (text: string) => void; onSave?: () => void }) {
	const host = useRef<HTMLDivElement>(null);
	const view = useRef<EditorView>(undefined);
	const lock = useRef(new Compartment());
	const live = useRef({ onChange, onSave });
	live.current = { onChange, onSave };
	useEffect(() => {
		const v = new EditorView({
			parent: host.current!,
			state: EditorState.create({
				doc: text,
				extensions: [
					lineNumbers(),
					highlightActiveLineGutter(),
					highlightActiveLine(),
					history(),
					drawSelection(),
					indentOnInput(),
					bracketMatching(),
					highlightSelectionMatches(),
					search({ top: true }),
					syntaxHighlighting(colours),
					language(file),
					EditorView.lineWrapping,
					keymap.of([{ key: "Mod-s", run: () => (live.current.onSave?.(), true) }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
					lock.current.of([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]),
					EditorView.updateListener.of((u) => u.docChanged && live.current.onChange?.(u.state.doc.toString())),
				],
			}),
		});
		view.current = v;
		return () => v.destroy();
		// A new file is a new editor; what it shows of the old one is replaced below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [file]);
	useEffect(() => {
		const v = view.current;
		if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
	}, [text]);
	useEffect(() => {
		view.current?.dispatch({ effects: lock.current.reconfigure([EditorState.readOnly.of(Boolean(readOnly)), EditorView.editable.of(!readOnly)]) });
	}, [readOnly]);
	return <div className={EDITOR} ref={host} />;
}

// What a line of a unified diff is: a change is drawn by the stock line variants, which put the
// sign in front themselves, so its own sign is taken off; a hunk header is highlighted; the
// lines about the file itself are muted.
const META = ["+++", "---", "diff ", "index ", "new file", "deleted file", "similarity", "rename "];

/** A unified diff, coloured line by line. */
export function Diff({ text }: { text: string }) {
	const lines = text.split("\n");
	return (
		<CodeBlock size="sm" className="diff m-2 w-auto select-text">
			<CodeBlockContent>
				{lines.map((l, i) => {
					if (l.startsWith("@@")) return <CodeBlockLine key={i} variant="highlighted">{l}</CodeBlockLine>;
					if (META.some((m) => l.startsWith(m))) return <CodeBlockLine key={i} className="text-muted-foreground">{l}</CodeBlockLine>;
					if (l.startsWith("+")) return <CodeBlockLine key={i} variant="added" className="add">{l.slice(1)}</CodeBlockLine>;
					if (l.startsWith("-")) return <CodeBlockLine key={i} variant="removed">{l.slice(1)}</CodeBlockLine>;
					return <CodeBlockLine key={i}>{l.startsWith(" ") ? l.slice(1) : l}</CodeBlockLine>;
				})}
			</CodeBlockContent>
		</CodeBlock>
	);
}

/** A path in the folder, a crumb per folder and the file last. */
function PathCrumbs({ path, children }: { path: string; children?: React.ReactNode }) {
	const parts = path.split("/");
	const last = parts.length - 1;
	return (
		<Breadcrumb className="min-w-0 flex-1" title={path}>
			<BreadcrumbList className="flex-nowrap font-mono">
				{parts.map((part, i) => (
					<Fragment key={i}>
						{i ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem className={i === last ? "min-w-0" : undefined}>
							{i === last ? <BreadcrumbPage className="truncate">{part}{children}</BreadcrumbPage> : part}
						</BreadcrumbItem>
					</Fragment>
				))}
			</BreadcrumbList>
		</Breadcrumb>
	);
}

// ---- its views -------------------------------------------------------------------------------------

function ChangeRow({ c }: { c: Change }) {
	const at = c.path.lastIndexOf("/");
	return (
		<ListRow value={c.path} label={c.path.slice(at + 1)} className={rowClass()} title={c.path}>
			<span className={`w-3.5 flex-none text-center font-mono font-semibold ${STATUS[c.status] ?? ""}`}>{c.status === "?" ? "U" : c.status}</span>
			<span className="truncate">{c.path.slice(at + 1)}</span>
			<span className="min-w-0 flex-1 truncate text-faint">{at > 0 ? c.path.slice(0, at) : ""}</span>
			{c.added ? <span className="font-mono text-add">+{c.added}</span> : null}
			{c.removed ? <span className="font-mono text-del">−{c.removed}</span> : null}
		</ListRow>
	);
}

/** What differs from the last commit, or from before the owner's last message. */
function Changes({ tab, turn, openFile }: { tab: Tab; turn: boolean; openFile: (file: string) => void }) {
	const list = useLoad(async () => (turn ? { ...(await api.turn(tab.agent, tab.session)), repo: true, branch: undefined as string | undefined } : { ...(await api.changes(tab.agent, tab.session)), note: undefined as string | undefined, prompt: undefined as string | undefined }), [tab.key, tab.codeTick, turn]);
	const [file, setFile] = useState<string>();
	const diff = useLoad(async () => (file ? (turn ? api.turnDiff(tab.agent, tab.session, file) : api.diff(tab.agent, tab.session, file)) : undefined), [tab.key, file, tab.codeTick, turn]);
	useEffect(() => setFile(undefined), [tab.key, turn]);
	const data = list.data;
	// A change is named from the top of its repository; a file is opened by its path in the folder.
	const inFolder = (p: string) => {
		const top = (data as { top?: string } | undefined)?.top;
		const root = data?.root;
		const prefix = top && root && root !== top && root.startsWith(`${top}/`) ? `${root.slice(top.length + 1)}/` : "";
		return prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p;
	};
	if (list.error) return <Empty icon={turn ? Undo2Icon : GitBranchIcon} title={turn ? "Nothing to show" : "No changes to show"}>{turn ? "No message of yours in this conversation changed a file that pine records." : list.error}</Empty>;
	if (!data) return <Loading />;
	if (!turn && !data.repo) return <Empty icon={GitBranchIcon} title="Not a git repository">The folder this conversation works in has no git history, so there are no changes to show. The files are in the Files view.</Empty>;
	if (file)
		return (
			<>
				<div className={SUB}>
					<Hint label="Back to the list"><Button variant="ghost" size="icon-xs" onClick={() => setFile(undefined)}><ChevronLeftIcon /></Button></Hint>
					<PathCrumbs path={file} />
					<Button variant="ghost" size="xs" onClick={() => openFile(inFolder(file))}><PencilIcon data-icon="inline-start" />Edit</Button>
				</div>
				<Body wide>{diff.data ? <><Diff text={diff.data.diff || "No difference."} />{diff.data.truncated ? <LogText className="cursor-text text-muted-foreground">… the rest of this diff is too long to show.</LogText> : null}</> : diff.error ? <Empty icon={GitBranchIcon} title="This diff cannot be shown">{diff.error}</Empty> : <Loading />}</Body>
			</>
		);
	return (
		<>
			<div className={SUB}>
				{turn ? <><Undo2Icon size={13} /><span className="min-w-0 flex-1 truncate">{data.prompt ? `Since “${short(oneLine(data.prompt), 60)}”` : "Since your last message"}</span>{data.files.length ? <Button variant="outline" size="xs" onClick={() => void store.undo(tab, false)}>Take back</Button> : null}</> : <><GitBranchIcon size={13} /><span className="min-w-0 flex-1 truncate">{data.branch || "no branch"} · {data.files.length ? plural(data.files.length, "changed file") : "clean"}</span></>}
				<Hint label="Read again"><Button variant="ghost" size="icon-xs" onClick={list.reload}><RotateCwIcon /></Button></Hint>
			</div>
			<Body>
				{data.note ? <LogText className="cursor-text text-muted-foreground">{data.note}</LogText> : null}
				{data.files.length ? <List label={turn ? "Files the last message changed" : "Changed files"} onOpen={setFile}>{data.files.map((c) => <ChangeRow key={c.path} c={c} />)}</List> : <Empty icon={CheckIcon} title={turn ? "The last message changed no files" : "Nothing changed since the last commit"} />}
				{data.more ? <LogText className="cursor-text text-muted-foreground">… and more.</LogText> : null}
			</Body>
		</>
	);
}

interface TreeState {
	open: Set<string>;
	dirs: Map<string, Array<{ name: string; dir: boolean; size: number }>>;
	/** Why a folder could not be read, by folder, so a failed read is not taken for an empty folder. */
	failed: Map<string, string>;
	file?: string;
}
const trees = new Map<string, TreeState>();
const treeOf = (key: string): TreeState => trees.get(key) ?? (trees.set(key, { open: new Set(), dirs: new Map(), failed: new Map() }), trees.get(key)!);

/** The folder's files as a tree: a folder opens and closes, a file opens in the editor. */
function FileTree({ tab, pick, tick }: { tab: Tab; pick: (file: string) => void; tick: number }) {
	const state = treeOf(tab.key);
	const [, redraw] = useState(0);
	const isDir = (full: string) => {
		const at = full.lastIndexOf("/");
		return Boolean(state.dirs.get(at > 0 ? full.slice(0, at) : "")?.find((e) => e.name === full.slice(at + 1))?.dir);
	};
	const entries = state.dirs.get("");
	const failed = state.failed.get("");
	return (
		<>
			{failed ? <Empty icon={FolderIcon} title="This folder cannot be read">{failed}</Empty> : null}
			{entries && !entries.length ? <Empty icon={FolderIcon} title="This folder is empty" /> : null}
			{entries || failed ? null : <Loading />}
			<Tree label="Files" expanded={[...state.open]} onExpandedChange={(open) => ((state.open = new Set(open)), redraw((n) => n + 1))} onOpen={(full) => !isDir(full) && pick(full)}>
				<Dir tab={tab} dir="" depth={0} tick={tick} onLoad={() => redraw((n) => n + 1)} />
			</Tree>
		</>
	);
}

/** A folder's rows in the tree, read when it opens; `onLoad` redraws the tree around once they are read. */
function Dir({ tab, dir, depth, tick, onLoad }: { tab: Tab; dir: string; depth: number; tick: number; onLoad: () => void }) {
	const state = treeOf(tab.key);
	const read = useLoad(() => api.tree(tab.agent, tab.session, dir), [tab.key, dir, tick]);
	useEffect(() => {
		if (read.loading) return;
		if (read.data) state.dirs.set(dir, read.data.entries), state.failed.delete(dir);
		else state.failed.set(dir, read.error ?? ""), state.dirs.delete(dir);
		onLoad();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [read.loading, read.data, read.error]);
	const failed = state.failed.get(dir);
	if (failed && dir) return <LogText className="cursor-text text-faint" style={{ paddingLeft: `calc(var(--spacing) * ${2.5 + depth * 3.5})` }}>{failed}</LogText>;
	const entries = state.dirs.get(dir);
	if (!entries) return null;
	return (
		<>
			{entries.map((e) => {
				const full = dir ? `${dir}/${e.name}` : e.name;
				const open = state.open.has(full);
				const row = (
					<>
						{e.dir ? (open ? <ChevronDownIcon size={12} className="text-faint" /> : <ChevronRightIcon size={12} className="text-faint" />) : <span className="w-3 flex-none" />}
						{e.dir ? <FolderIcon size={13} className="text-faint" /> : <FileIcon size={13} className="text-faint" />}
						<span className="min-w-0 flex-1 truncate">{e.name}</span>
						{!e.dir ? <span className="text-faint">{size(e.size)}</span> : null}
					</>
				);
				return (
					<TreeRow key={full} value={full} label={e.name} row={row} on={state.file === full} depth={depth} branch={e.dir}>
						{e.dir && open ? <Dir tab={tab} dir={full} depth={depth + 1} tick={tick} onLoad={onLoad} /> : null}
					</TreeRow>
				);
			})}
		</>
	);
}

/** One file, to read and to change. What the agent changes meanwhile is shown unless the owner has typed. */
function FileView({ tab, file, close }: { tab: Tab; file: string; close: () => void }) {
	const disk = useLoad(() => api.file(tab.agent, tab.session, file), [tab.key, file, tab.codeTick]);
	const [draft, setDraft] = useState<string>();
	const [saving, setSaving] = useState(false);
	const [base, setBase] = useState<string>();
	const kind = mediaKind(file);
	const text = disk.data?.text;
	const dirty = draft !== undefined && draft !== base;
	// What is on disk becomes what the editor shows, as long as nothing was typed.
	useEffect(() => {
		if (text !== undefined && !dirty) (setBase(text), setDraft(undefined));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [text]);
	useEffect(() => (setDraft(undefined), setBase(undefined)), [file]);
	const save = async () => {
		if (!dirty || saving) return;
		setSaving(true);
		try {
			await api.writeFile(tab.agent, tab.session, file, draft!);
			setBase(draft);
			tab.codeTick++;
			tab.touch();
			store.flash(`Saved ${file}.`, "good", 1800);
		} catch (e) {
			store.flash(`Not saved: ${errText(e)}`, "bad");
		}
		setSaving(false);
	};
	useSignal("save", () => void save());
	// Leaving with what was typed and not saved is asked first.
	const [leaving, setLeaving] = useState(false);
	const changedOnDisk = dirty && text !== undefined && text !== base;
	const root = tab.folder ?? tab.workspace;
	return (
		<>
			<div className={SUB}>
				<Hint label="Back to the files"><Button variant="ghost" size="icon-xs" onClick={() => (dirty ? setLeaving(true) : close())}><ChevronLeftIcon /></Button></Hint>
				<AlertDialog open={leaving} onOpenChange={setLeaving}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Leave {file} without saving what you typed?</AlertDialogTitle>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction variant="destructive" onClick={() => (setLeaving(false), close())}>Leave</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				<PathCrumbs path={file}>{dirty ? <span className="text-warn"> ●</span> : null}</PathCrumbs>
				{disk.data?.truncated ? <Badge variant="outline">too large to edit</Badge> : null}
				{root ? <Hint label="Show in the Finder"><Button variant="ghost" size="icon-xs" onClick={() => void bridge.reveal(`${root}/${file}`)}><ExternalLinkIcon /></Button></Hint> : null}
				{kind || disk.data?.binary ? null : <Button variant={dirty ? "default" : "ghost"} size="xs" disabled={!dirty || saving} onClick={() => void save()}><SaveIcon data-icon="inline-start" />Save</Button>}
			</div>
			{changedOnDisk ? (
				<Alert className="m-2 w-auto">
					<AlertDescription>This file changed on disk while you were typing.</AlertDescription>
					<AlertAction>
						<Button variant="outline" size="xs" onClick={() => (setBase(text), setDraft(undefined))}>Take the new one</Button>
					</AlertAction>
				</Alert>
			) : null}
			{/* The editor scrolls itself (CodeMirror draws only the lines in view): around it nothing scrolls. */}
			{!kind && !disk.error && disk.data && !disk.data.binary ? (
				<div className="flex min-h-0 flex-1 flex-col">
					<Editor file={file} text={dirty ? draft! : (base ?? text ?? "")} readOnly={disk.data.truncated} onChange={setDraft} onSave={() => void save()} />
				</div>
			) : (
			<Body>
				{kind ? (
					<div className="p-3.5">{kind === "image" ? <img className={PICTURE} src={media.workspace(tab.agent, file, tab.session)} alt={file} /> : kind === "video" ? <video className="block max-h-90 max-w-full rounded-lg bg-black sm:max-w-lg" src={media.workspace(tab.agent, file, tab.session)} controls /> : <audio className="block w-full max-w-md" src={media.workspace(tab.agent, file, tab.session)} controls />}</div>
				) : disk.error ? (
					<Empty icon={FileIcon} title="This file cannot be shown">{disk.error}</Empty>
				) : !disk.data ? (
					<Loading />
				) : (
					<Empty icon={FileIcon} title="A binary file">{size(disk.data.size)}. It is not shown as text.</Empty>
				)}
			</Body>
			)}
		</>
	);
}

function Files({ tab, file, setFile }: { tab: Tab; file?: string; setFile: (file?: string) => void }) {
	const [tick, setTick] = useState(0);
	const [query, setQuery] = useState("");
	const found = useLoad(async () => (query.trim() ? (await api.find(tab.agent, tab.session, query.trim())).files : undefined), [tab.key, query]);
	useEffect(() => setTick((n) => n + 1), [tab.codeTick]);
	if (file) return <FileView tab={tab} file={file} close={() => setFile(undefined)} />;
	const root = tab.folder ?? tab.workspace;
	return (
		<>
			<div className={SUB}>
				<InputGroup>
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
					<InputGroupInput aria-label="Find a file" placeholder={root ? `Find a file in ${tilde(root)}` : "Find a file"} value={query} onChange={(e) => setQuery(e.target.value)} />
				</InputGroup>
				<Hint label="Read again"><Button variant="ghost" size="icon-xs" onClick={() => setTick((n) => n + 1)}><RotateCwIcon /></Button></Hint>
			</div>
			<Body>
				{query.trim() ? (
					found.data?.length ? <List label="Files that fit" onOpen={setFile}>{found.data.map((f) => <ListRow key={f} value={f} label={f} className={rowClass()}><FileIcon size={13} className="text-faint" /><span className="truncate">{f}</span></ListRow>)}</List> : found.loading ? <Loading /> : <Empty icon={SearchIcon} title="No file fits" />
				) : (
					<FileTree tab={tab} pick={setFile} tick={tick} />
				)}
			</Body>
		</>
	);
}

/**
 * What a tool or a program printed: a stock Code Block, as shadcn's Terminal pattern shows a
 * command's output, with the terminal's colours read by the stock highlighter ("ansi"). The panel
 * is already the viewer, so there is no Trace line around it. `sm` caps it where several follow
 * each other (the pattern's `max-h-64`).
 */
function Printed({ text, failed = false, sm = false, className }: { text: string; failed?: boolean; sm?: boolean; className?: string }) {
	const lines = useHighlightedCode(text, "ansi");
	// A program that is still running keeps printing: like a terminal, the block follows its end
	// while it is scrolled to the end, and holds still once the owner scrolled up to read.
	const pre = useRef<HTMLPreElement>(null);
	const atEnd = useRef(true);
	useLayoutEffect(() => {
		const el = pre.current;
		if (el && atEnd.current) el.scrollTop = el.scrollHeight;
	}, [lines]);
	const onScroll = (e: UIEvent<HTMLPreElement>) => {
		const el = e.currentTarget;
		atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
	};
	return (
		<CodeBlock variant={failed ? "destructive" : "default"} size={sm ? "sm" : "default"} className={className} data-status={failed ? "fail" : "ok"}>
			<CodeBlockActions>
				<CodeBlockCopyButton value={text} />
			</CodeBlockActions>
			<CodeBlockContent ref={pre} onScroll={onScroll} wrap className={sm ? "max-h-64" : undefined}>
				{lines.map((line, i) => <CodeBlockLine key={i}>{line}</CodeBlockLine>)}
			</CodeBlockContent>
		</CodeBlock>
	);
}

/** The tool calls of the last messages, each with what it printed. */
function Output({ tab }: { tab: Tab }) {
	const calls = useLoad(async () => {
		const tasks = (await api.history(tab.agent, tab.session, 8)).filter((x) => x.depth === 0 && !x.meta?.compact);
		const out: Array<{ task: number; n: number; entry: TranscriptEntry }> = [];
		for (const task of tasks) {
			const entries = (await api.transcript(task.id, true).catch(() => undefined))?.entries ?? [];
			entries.filter((e) => e.kind === "tool").forEach((entry, n) => out.push({ task: task.id, n, entry }));
		}
		return out;
	}, [tab.key, tab.codeTick]);
	const [open, setOpen] = useState<string>();
	if (!calls.data) return calls.error ? <Empty icon={SquareTerminalIcon} title="The tool calls cannot be read">{calls.error}</Empty> : <Loading />;
	if (!calls.data.length) return <Empty icon={SquareTerminalIcon} title="No tool calls yet">What the agent's commands and tools print appears here.</Empty>;
	const shown = calls.data.find((c) => `${c.task}:${c.n}` === open);
	if (shown)
		return (
			<>
				<div className={SUB}>
					<Hint label="Back to the list"><Button variant="ghost" size="icon-xs" onClick={() => setOpen(undefined)}><ChevronLeftIcon /></Button></Hint>
					<span className="font-mono">{shown.entry.tool}</span>
					<span className="min-w-0 flex-1 truncate font-mono text-faint">{shown.entry.subject}</span>
				</div>
				<Body>
					<Printed text={shown.entry.result || "(it printed nothing)"} failed={shown.entry.ok === false} className="m-2" />
					{(shown.entry.images ?? []).map((id) => <div className="p-3" key={id}><img className={PICTURE} src={media.tool(id)} alt="" /></div>)}
				</Body>
			</>
		);
	return (
		<Body>
			<List label="Tool calls" onOpen={setOpen}>
			{calls.data.map((c) => (
				<ListRow key={`${c.task}:${c.n}`} value={`${c.task}:${c.n}`} label={`${c.entry.tool} ${c.entry.subject ?? ""}`} className={rowClass()}>
					{c.entry.ok === false ? <XIcon size={13} className="flex-none text-destructive" /> : c.entry.ok ? <CheckIcon size={13} className="flex-none text-primary" /> : <Pulse size={13} />}
					<span className="font-mono">{c.entry.tool}</span>
					<span className="min-w-0 flex-1 truncate font-mono text-faint">{c.entry.subject ? oneLine(c.entry.subject) : ""}</span>
					{c.entry.ms !== undefined ? <span className="text-faint">{took(c.entry.ms)}</span> : null}
				</ListRow>
			))}
				</List>
			</Body>
	);
}

/** What the conversation's commands left running, and the way to stop each. */
function Running({ tab }: { tab: Tab }) {
	if (!tab.programs.length) return <Empty icon={PlayIcon} title="Nothing is running">A dev server or a watcher the agent starts keeps running after its turn. It is listed here, and stopped from here.</Empty>;
	return (
		<Body>
			{tab.programs.map((p) => (
				<div className="flex flex-col gap-1 border-b border-line-soft p-2" key={p.id}>
					<Item size="sm">
						<ItemMedia>
							<span className="size-2 rounded-full bg-primary" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle className="font-mono">{p.command}</ItemTitle>
							<ItemDescription>
								running for {clock(p.seconds)} · {plural(p.processes, "process", "processes")}
								{p.background ? " · in the background" : null}
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							{p.ports.map((port) => (
								<Button key={port} variant="link" size="xs" onClick={() => void bridge.open(`http://localhost:${port}`)}>localhost:{port}</Button>
							))}
							<Confirm label="Stop" question={`Stop ${short(p.command, 80)}?`} onConfirm={() => void store.attempt(() => api.stopProgram(tab.agent, tab.session, p.id)).then(() => store.flash("Stopping…"))} />
						</ItemActions>
					</Item>
					{p.output ? <Printed text={p.output} sm /> : null}
				</div>
			))}
		</Body>
	);
}

export const CODE_KEY = "pine.code.width";

export function CodePanel({ tab }: { tab: Tab }) {
	useModel(tab);
	useModel(store);
	const [width] = useState(() => Number(localStorage.getItem(CODE_KEY)) || 520);
	const state = treeOf(tab.key);
	const [, redraw] = useState(0);
	const view = store.codeView;
	const setView = (v: CodeView) => ((store.codeView = v), store.touch());
	const setFile = (file?: string) => ((state.file = file), redraw((n) => n + 1));
	const steps = tab.steps?.items.some((s) => s.status !== "done") ? tab.steps.items : undefined;
	return (
		<>
			<ResizableHandle className="w-1.5 bg-transparent" disableDoubleClick title="Drag to make the panel wider or narrower" />
			<ResizablePanel id="code-panel" className="flex" defaultSize={width} minSize={320} groupResizeBehavior="preserve-pixel-size">
				<div className="code flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
					<div className="flex h-10 flex-none items-center gap-1.5 border-b border-line-soft px-2">
						{/* Seven tabs in a narrow panel: the row scrolls sideways, and fades where it is cut. The padding is the room
						    for the line under the tab in front, which stock draws below the list. */}
						<ScrollFadeArea axis="x" bar={false} className="min-w-0 flex-initial">
						<div className="pb-1.5">
						<Tabs value={view} onValueChange={(v) => setView(v as CodeView)}>
							<TabsList variant="line" activateOnFocus>
								<TabsTrigger value="agent">Agent</TabsTrigger>
								<TabsTrigger value="files">Files</TabsTrigger>
								<TabsTrigger value="changes">Changes</TabsTrigger>
								<TabsTrigger value="turn">Last turn</TabsTrigger>
								<TabsTrigger value="browser">Browser</TabsTrigger>
								<TabsTrigger value="output">Output</TabsTrigger>
								<TabsTrigger value="running">
									Running
									{tab.programs.length ? <Badge variant="secondary">{tab.programs.length}</Badge> : null}
								</TabsTrigger>
							</TabsList>
						</Tabs>
						</div>
						</ScrollFadeArea>
						<span className="min-w-0 flex-1" />
						<Hint label="Close the panel"><Button variant="ghost" size="icon-xs" onClick={() => void store.command("code")}><XIcon /></Button></Hint>
					</div>
					{steps ? <ScrollFadeArea className="max-h-48 flex-none border-b border-line-soft"><div className="px-3 py-2.5"><Steps items={steps} /></div></ScrollFadeArea> : null}
					{view === "agent" ? (
						<AgentView tab={tab} />
					) : view === "changes" || view === "turn" ? (
						<Changes tab={tab} turn={view === "turn"} openFile={(f) => (setFile(f), setView("files"))} />
					) : view === "files" ? (
						<Files tab={tab} file={state.file} setFile={setFile} />
					) : view === "browser" ? (
						<BrowserView tab={tab} />
					) : view === "output" ? (
						<Output tab={tab} />
					) : (
						<Running tab={tab} />
					)}
				</div>
			</ResizablePanel>
		</>
	);
}
