// Where the owner writes: the message, the files that go with it, and under it what the
// conversation runs on (folder, model, reasoning, mode), each a click away.
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { ArrowUpIcon, ClockIcon, CpuIcon, EyeIcon, FileIcon, FolderIcon, MicIcon, PlusIcon, ShieldIcon, SparkleIcon, XIcon } from "lucide-react";
import { PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, PromptInputHeader, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxItem, ComboboxList } from "@/components/ui/combobox";
import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import { bridge } from "./bridge.ts";
import { COMMANDS, runSlash } from "./commands.ts";
import { type Attachment, store, type Tab, useModel, useSignal } from "./model.ts";
import { baseName, size, tilde } from "./text.ts";

const MAX_FILE = 20 * 1024 * 1024;
const MAX_FILES = 10;

const toBase64 = (buf: ArrayBuffer) => {
	const bytes = new Uint8Array(buf);
	let out = "";
	for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(out);
};

/** Files for the next message. A folder is not attached: it is opened for the conversation. */
export async function attach(tab: Tab, files: File[]): Promise<void> {
	for (const file of files) {
		if (tab.attachments.length >= MAX_FILES) return store.flash("At most 10 files per message.", "bad");
		if (file.size > MAX_FILE) {
			store.flash(`${file.name} is larger than 20 MB.`, "bad");
			continue;
		}
		const name = file.name || `pasted-${Date.now()}.png`;
		if (tab.attachments.some((a) => a.name === name && a.size === file.size)) continue;
		const item: Attachment = { name, size: file.size, data: toBase64(await file.arrayBuffer()) };
		if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) item.preview = URL.createObjectURL(file);
		tab.attachments.push(item);
	}
	tab.touch();
}

interface Suggestion {
	value: string;
	label: string;
	about?: string;
}

/** A key event that went through Base UI: `preventBaseUIHandler` keeps the combobox's own handling out of it. */
type ListKeyEvent = React.KeyboardEvent<HTMLTextAreaElement> & { preventBaseUIHandler: () => void };

const TONE: Record<string, string> = { good: "text-primary", warn: "text-warn", bad: "text-destructive", plan: "text-plan" };

export function Composer({ tab }: { tab: Tab }) {
	useModel(tab);
	useModel(store);
	const area = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	const [over, setOver] = useState(false);
	const [items, setItems] = useState<Suggestion[]>([]);
	const highlighted = useRef<Suggestion | undefined>(undefined);
	const [kind, setKind] = useState<"slash" | "file" | undefined>();
	const recall = useRef(-1);
	// Dictating: what is heard is put after what was typed, and is text in the input and nothing
	// more. It is never sent by itself.
	const [voice, setVoice] = useState<"off" | "starting" | "listening">("off");
	const [voiceNote, setVoiceNote] = useState("");
	const typed = useRef("");
	const hearing = useRef(false);
	const text = tab.draft;
	const info = store.agent(tab.agent);

	const set = (value: string) => {
		tab.draft = value;
		tab.touch();
	};

	const close = () => {
		setItems([]);
		setKind(undefined);
	};

	useEffect(() => {
		area.current?.focus();
	}, [tab.id]);

	const heard = (said: string) => `${typed.current}${typed.current && !/\s$/.test(typed.current) && said ? " " : ""}${said}`;
	/** `cancel`: nothing more is put into the input. Otherwise "that was all": the last words still arrive. */
	const endVoice = (cancel: boolean) => {
		if (cancel) {
			hearing.current = false;
			setVoice("off");
			setVoiceNote("");
		}
		void bridge.voiceStop(cancel);
	};
	const dictate = async () => {
		if (voice !== "off") return endVoice(false);
		if (store.platform !== "darwin") return store.flash("Voice input needs a Mac: it uses the speech recognition macOS has on the device.");
		typed.current = tab.draft;
		hearing.current = true;
		setVoice("starting");
		try {
			await bridge.voiceStart(store.voiceLanguage);
		} catch (e) {
			hearing.current = false;
			setVoice("off");
			store.flash(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ""), "bad", 9000);
		}
	};
	useEffect(
		() =>
			bridge.onVoice((m: { type: string; text?: string; state?: string; error?: string }) => {
				if (!hearing.current) return;
				if (m.type === "ready") setVoice("listening");
				else if (m.type === "model") setVoiceNote(m.state === "downloading" ? "the system is fetching its speech model for this language, once" : "");
				else if (m.type === "partial") set(heard(m.text ?? ""));
				else if (m.type === "done") {
					hearing.current = false;
					setVoice("off");
					setVoiceNote("");
					if (m.text) set(heard(m.text));
					if (m.error) store.flash(m.error, "bad", 8000);
					area.current?.focus();
				}
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[tab],
	);
	// Leaving the conversation ends the listening.
	useEffect(() => () => void (hearing.current && bridge.voiceStop(true)), []);

	// A menu asked for something only this part can do.
	useSignal("voice", () => void dictate());
	useSignal("attach", () => picker.current?.click());
	useSignal("focus-input", () => area.current?.focus());

	/** What is being typed right before the cursor: a command at the start of the input, or a file after an @. */
	const suggest = async (value: string, cursor: number) => {
		const before = value.slice(0, cursor);
		if (/^\/[a-z]*$/i.test(before)) {
			const word = before.slice(1).toLowerCase();
			setKind("slash");
			return setItems(COMMANDS.filter((c) => c.name.startsWith(word)).map((c) => ({ value: c.name, label: `/${c.name}${c.hint ? ` ${c.hint}` : ""}`, about: c.about })));
		}
		const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
		if (mention) {
			const found = await api.find(tab.agent, tab.session, mention[1].split("#")[0]).catch(() => ({ files: [] as string[] }));
			// What was typed meanwhile decides whether the answer is still wanted.
			if (area.current && area.current.value.slice(0, area.current.selectionStart) !== before) return;
			for (const f of found.files) tab.files.add(f);
			setKind("file");
			return setItems(found.files.slice(0, 12).map((f) => ({ value: f, label: f })));
		}
		close();
	};

	const take = (s: Suggestion) => {
		const el = area.current!;
		const cursor = el.selectionStart;
		const before = text.slice(0, cursor);
		const next = kind === "slash" ? `/${s.value} ` : `${before.replace(/@([^\s@]*)$/, `@${s.value} `)}`;
		const whole = kind === "slash" ? next : next + text.slice(cursor);
		set(whole);
		close();
		requestAnimationFrame(() => {
			el.focus();
			const pos = kind === "slash" ? whole.length : next.length;
			el.setSelectionRange(pos, pos);
		});
	};

	const send = async (whenBusy: "steer" | "queue") => {
		const value = text.trim();
		if (!value) return;
		recall.current = -1;
		close();
		if (value.startsWith("/") && !value.startsWith("//")) {
			tab.inputs.push(value);
			set("");
			return runSlash(value.slice(1), tab);
		}
		await store.submit(tab, value, whenBusy);
	};

	const onKey = (e: ListKeyEvent) => {
		if (e.nativeEvent.isComposing) return;
		if (voice !== "off") {
			// Enter says "that was all" and sends nothing; escape throws away what was heard.
			if (e.key === "Enter") return (e.preventBaseUIHandler(), e.preventDefault(), endVoice(false));
			if (e.key === "Escape") return (e.preventBaseUIHandler(), e.preventDefault(), endVoice(true), set(typed.current));
		}
		// While suggestions show, the arrows, Enter and Escape are the combobox's: they move the
		// highlight, pick it (`take`) and close the list. Everything else is the composer's.
		const s = highlighted.current;
		if (items.length && s && !e.altKey) {
			if (e.key === "Tab" && !e.shiftKey) {
				e.preventBaseUIHandler();
				e.preventDefault();
				return take(s);
			}
			// A command typed out whole is run, not picked again.
			const whole = e.key === "Enter" && !e.shiftKey && kind === "slash" && s.value === text.slice(1).trim();
			if (!whole && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))) return;
		}
		e.preventBaseUIHandler();
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			return void send(e.altKey ? "queue" : "steer");
		}
		if (e.key === "Escape" && tab.busy) {
			e.preventDefault();
			return void store.stop(tab);
		}
		// Next mode, as in the terminal UI: while the input is empty.
		if (e.key === "Tab" && e.shiftKey && !text) {
			e.preventDefault();
			const order = ["auto", "plan", "safe", "manual", "bypass"];
			return void store.setMode(tab, order[(order.indexOf(store.modeOf(tab)) + 1) % order.length]);
		}
		// Earlier inputs, while nothing was typed or one of them is shown.
		if ((e.key === "ArrowUp" || e.key === "ArrowDown") && tab.inputs.length && (!text || recall.current >= 0) && !text.includes("\n")) {
			const next = e.key === "ArrowUp" ? (recall.current < 0 ? tab.inputs.length - 1 : Math.max(0, recall.current - 1)) : recall.current + 1;
			if (e.key === "ArrowDown" && recall.current < 0) return;
			e.preventDefault();
			if (next >= tab.inputs.length) {
				recall.current = -1;
				return set("");
			}
			recall.current = next;
			return set(tab.inputs[next]);
		}
	};

	const onDrop = async (e: React.DragEvent) => {
		e.preventDefault();
		setOver(false);
		const list = [...e.dataTransfer.items].filter((i) => i.kind === "file");
		const files: File[] = [];
		for (const entry of list) {
			const file = entry.getAsFile();
			if (!file) continue;
			// A folder is opened for the conversation, as with /folder.
			if (entry.webkitGetAsEntry()?.isDirectory) {
				const dir = bridge.pathOf(file);
				if (dir) await store.setFolder(tab, dir);
			} else files.push(file);
		}
		if (files.length) await attach(tab, files);
		area.current?.focus();
	};

	const mode = store.modeOf(tab);
	const paused = store.bypassPaused(tab);
	const tainted = store.taints.get(`${tab.agent}:${tab.session}`);
	const modeTone = paused ? "warn" : mode === "bypass" ? "bad" : mode === "safe" ? "good" : mode === "plan" ? "plan" : "";
	const goal = tab.goal && tab.goal.status !== "met" ? tab.goal : undefined;

	return (
		<>
			{goal && goal.status !== "active" ? (
				<div className={`banner mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs bg-warn-soft`}>
					<ClockIcon size={14} />
					<span className="min-w-0 flex-1 truncate">Goal {goal.status === "paused" ? "paused" : goal.status === "blocked" ? "waits for you" : "at its limit"}: {goal.note}</span>
					<Button variant="link" size="xs" className="open-link" onClick={() => void store.setGoal(tab, "resume")}>Resume</Button>
					<Button variant="link" size="xs" className="open-link" onClick={() => void store.setGoal(tab, "clear")}>Clear</Button>
				</div>
			) : null}
			{voice !== "off" ? (
				<div className={`banner mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs bg-brand-soft`}>
					<span className="size-2 shrink-0 rounded-full bg-destructive" />
					<span className="min-w-0 flex-1">{voice === "starting" ? "getting ready to listen…" : "listening · speak · ↩ when you are done · esc to throw it away"}{voiceNote ? ` · ${voiceNote}` : ""}</span>
				</div>
			) : null}
			{/* The files are pine's own (`attach`: its limits, a folder opened instead, base64 for the
			    daemon), so the Prompt Input keeps none of its own: maxFiles 0. */}
			<PromptInput
				className="composer [&[data-over]_[data-slot=input-group]]:border-dashed [&[data-over]_[data-slot=input-group]]:border-primary [&[data-over]_[data-slot=input-group]]:bg-brand-soft!"
				data-over={over || undefined}
				maxFiles={0}
				onSubmit={() => void send("steer")}
				onDragOver={(e) => {
					if (![...e.dataTransfer.types].includes("Files")) return;
					e.preventDefault();
					setOver(true);
				}}
				onDragLeave={() => setOver(false)}
				onDrop={(e) => void onDrop(e)}
			>
				{tab.attachments.length ? (
					<PromptInputHeader>
						{tab.attachments.map((f, i) => (
							<span className="flex items-center gap-1.5 rounded-md border border-line-soft bg-raised py-0.5 pr-1 pl-2 text-xs" key={`${f.name}:${i}`}>
								{f.preview ? <img className="-ml-1 size-5.5 rounded-sm object-cover" src={f.preview} alt="" /> : <FileIcon size={13} />}
								<span className="max-w-45 truncate">{f.name}</span>
								<span className="text-faint">{size(f.size)}</span>
								<Button variant="ghost" size="icon-xs" title="Remove" onClick={() => (tab.attachments.splice(i, 1), tab.touch())}><XIcon /></Button>
							</span>
						))}
					</PromptInputHeader>
				) : null}
				<PromptInputBody>
					{/* The `/` commands and `@` files: pine finds them (`suggest`) and the combobox shows them. */}
					<Combobox<Suggestion>
						items={items}
						filter={null}
						autoHighlight
						open={items.length > 0}
						onOpenChange={(open) => void (!open && close())}
						inputValue={text}
						value={null}
						onValueChange={(s) => void (s && take(s))}
						onItemHighlighted={(s) => void (highlighted.current = s)}
						itemToStringLabel={(s) => s.label}
					>
						<ComboboxPrimitive.Input
							ref={area as unknown as React.Ref<HTMLInputElement>}
							render={<PromptInputTextarea rows={1} />}
							className="max-h-80 min-h-0 px-3.5 pt-3 text-sm"
							placeholder={tab.busy ? `Say something to ${tab.agent} while it works…` : `Message ${tab.agent} · / for commands · @ for files`}
							onChange={(e) => {
								// A key that types ends the listening: what was heard stays, and nothing more is put into the input.
								if (voice !== "off") endVoice(true);
								recall.current = -1;
								set(e.target.value);
								void suggest(e.target.value, e.target.selectionStart ?? e.target.value.length);
							}}
							onKeyDown={(e) => onKey(e as unknown as ListKeyEvent)}
							onPaste={(e) => {
								const files = [...e.clipboardData.files];
								if (!files.length) return;
								e.preventDefault();
								void attach(tab, files);
							}}
						/>
						<ComboboxContent side="top">
							<ComboboxList>
								{(s: Suggestion) => (
									<ComboboxItem key={s.value} value={s}>
										<span data-part="label" className="shrink-0 font-mono">{s.label}</span>
										{s.about ? <span className="truncate text-muted-foreground">{s.about}</span> : null}
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</PromptInputBody>
				{/* A narrow input keeps every button on one line and whole: only the model's and the folder's
				    names are cut, and what has no room for its words stands as its sign alone, with the words in its tooltip. */}
				<PromptInputFooter className="@container/bar">
					<PromptInputTools className="min-w-0 flex-1">
						<PromptInputButton title="Attach files (or drop them here)" onClick={() => picker.current?.click()}><PlusIcon /></PromptInputButton>
						<PromptInputButton size="sm" className="min-w-0 shrink" title={`Model: ${info?.model ?? "none"}`} onClick={() => void store.pickModel(tab)}>
							<CpuIcon />
							<span className="truncate @max-sm/bar:hidden">{info?.model?.split("/").pop() ?? "model"}</span>
						</PromptInputButton>
						<PromptInputButton size="sm" title={`How much the model thinks before it answers: ${info?.thinking ?? "off"}`} onClick={() => void store.pickReasoning(tab)}>
							<SparkleIcon />
							<span className="@max-xs/bar:hidden">{info?.thinking ?? "off"}</span>
						</PromptInputButton>
						<PromptInputButton size="sm" className={TONE[modeTone]} title="How much this agent does without asking" onClick={() => void store.pickMode(tab)}>
							<ShieldIcon />
							<span>{mode}{paused ? " (paused)" : ""}</span>
						</PromptInputButton>
						<PromptInputButton size="sm" className="min-w-0 shrink" title={tab.folder ? `Works in ${tab.folder}` : "Where this conversation works: the agent's own workspace, or a folder of yours"} onClick={() => void store.pickFolder(tab)}>
							<FolderIcon />
							<span className="truncate @max-2xs/bar:hidden">{tab.folder ? baseName(tab.folder) : "its workspace"}</span>
						</PromptInputButton>
						{tainted ? <span className="flex shrink-0 items-center gap-1.5 px-2 text-xs text-warn" title={`This conversation has read outside content (${tainted}): the agent asks before it sends something out.`}><EyeIcon className="size-3.5" /><span className="@max-lg/bar:hidden">outside content</span></span> : null}
					</PromptInputTools>
					<PromptInputTools className="shrink-0">
						{store.platform === "darwin" ? <PromptInputButton className={voice !== "off" ? TONE.bad : undefined} title={voice === "off" ? "Dictate the message (⌃R)" : "End the listening"} onClick={() => void dictate()}><MicIcon /></PromptInputButton> : null}
						{tab.busy && !text.trim() ? (
							<PromptInputSubmit status="streaming" onStop={() => void store.stop(tab)} title="Stop (esc)" />
						) : (
							<PromptInputSubmit title={tab.busy ? "Give it to the agent while it works (↩) · ⌥↩ waits its turn" : "Send (↩)"} disabled={!text.trim()}><ArrowUpIcon /></PromptInputSubmit>
						)}
					</PromptInputTools>
				</PromptInputFooter>
			</PromptInput>
			<input ref={picker} type="file" multiple hidden onChange={(e) => (void attach(tab, [...(e.target.files ?? [])]), (e.target.value = ""))} />
			{tab.folder && !tab.items.length ? <div className="px-1 pt-1.5 text-faint text-xs">{tab.agent}'s tools start in {tilde(tab.folder)} and may read and change what is in it.</div> : null}
		</>
	);
}
