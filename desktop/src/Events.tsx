// The event log: everything pine publishes, as it happens. A line opens to its whole payload.
import { AudioLinesIcon, PlayIcon, SearchIcon, SquareIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "cn";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type PineEvent } from "./api.ts";
import { store, type Tab, useModel } from "./model.ts";
import { short } from "./text.ts";
import { Empty } from "./ui.tsx";
import { ScrollFadeArea } from "@/components/scroll-fade-area";

/** "agent/#" fits every topic under agent; "+" fits one level; a word without either is looked for anywhere. */
function fits(pattern: string, e: PineEvent): boolean {
	const p = pattern.trim();
	if (!p) return true;
	if (!/[#+/]/.test(p)) return e.topic.includes(p) || e.source.includes(p) || JSON.stringify(e.payload ?? "").includes(p);
	const want = p.split("/");
	const have = e.topic.split("/");
	for (let i = 0; i < want.length; i++) {
		if (want[i] === "#") return true;
		if (have[i] === undefined || (want[i] !== "+" && want[i] !== have[i])) return false;
	}
	return want.length === have.length;
}

export function Events({ tab }: { tab: Tab }) {
	useModel(tab);
	const [filter, setFilter] = useState(tab.logFilter);
	const [open, setOpen] = useState<number>();
	const [paused, setPaused] = useState(false);
	const [frozen, setFrozen] = useState<PineEvent[]>([]);
	const scroller = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const source = paused ? frozen : tab.log;
	const shown = source.filter((e) => fits(filter, e)).slice(-600);
	useLayoutEffect(() => {
		const el = scroller.current;
		if (el && stick.current && open === undefined) el.scrollTop = el.scrollHeight;
	});
	// The log follows its end while it is scrolled to there. (The viewport's scroll does not reach React's onScroll on the Root.)
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const follow = () => (stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60);
		el.addEventListener("scroll", follow);
		return () => el.removeEventListener("scroll", follow);
	}, []);
	useEffect(() => {
		tab.logFilter = filter;
	}, [filter, tab]);
	const emit = async () => {
		const topic = await store.pick({ title: "Publish an event as yourself", items: [], free: true, placeholder: "topic, then optionally JSON: house/mode {\"value\":\"away\"}" });
		if (!topic) return;
		const at = topic.indexOf(" ");
		let payload: unknown = null;
		if (at > 0) {
			try {
				payload = JSON.parse(topic.slice(at + 1));
			} catch {
				return store.flash("The payload is not JSON.", "bad");
			}
		}
		const done = await store.attempt(() => api.emit(at > 0 ? topic.slice(0, at) : topic, payload));
		if (done) store.flash(`Published event #${done.id}.`);
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background">
			<div className="flex flex-none items-center gap-2 border-b border-line-soft px-4 py-2.5">
				<SearchIcon className="size-3.5 text-faint" />
				<Input className="max-w-90" placeholder="Filter: a word, or a topic pattern such as agent/# or source/+/message" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
				<span className="text-faint">{shown.length} shown · text deltas are left out</span>
				<span className="min-w-0 flex-1" />
				<Button variant="outline" size="xs" onClick={() => (setFrozen([...tab.log]), setPaused(!paused))}>{paused ? <PlayIcon data-icon="inline-start" /> : <SquareIcon data-icon="inline-start" />}{paused ? "Follow" : "Pause"}</Button>
				<Button variant="outline" size="xs" onClick={() => void emit()}><ZapIcon data-icon="inline-start" />Publish…</Button>
				<Button variant="ghost" size="icon-xs" title="Clear the view" onClick={() => ((tab.log = []), tab.touch())}><Trash2Icon /></Button>
			</div>
			<ScrollFadeArea axis="both" bar={false} className="events-list flex-1 cursor-auto font-mono text-xs select-text" viewportRef={scroller}>
				<div className="flex min-h-full flex-col py-1.5">
				{shown.length ? (
					shown.map((e, i) => (
						<div key={`${e.id}:${e.ts}:${i}`}>
							<div className={cn("ev flex gap-3 px-4 py-0.5 whitespace-nowrap hover:bg-hover", open === i && "bg-hover")} onClick={() => setOpen(open === i ? undefined : i)}>
								<span className="flex-none text-faint">{new Date(e.ts).toLocaleTimeString("sv-SE")}</span>
								<span className={cn("w-11 flex-none", e.trust === "owner" ? "text-primary" : "text-faint")}>{e.trust === "owner" ? "owner" : "other"}</span>
								<span className="flex-none font-semibold">{e.topic}</span>
								<span className="truncate text-muted-foreground">{short(JSON.stringify(e.payload ?? null), 220)}</span>
							</div>
							{open === i ? <div className="mx-4 mb-1.5 ml-20 rounded-md bg-sunk px-2.5 py-2 whitespace-pre-wrap wrap-anywhere text-muted-foreground select-text">{`#${e.id} · from ${e.source}\n${JSON.stringify(e.payload ?? null, null, 2)}`}</div> : null}
						</div>
					))
				) : (
					<Empty icon={AudioLinesIcon} title={tab.log.length ? "No event fits the filter" : "No events yet"}>Messages, tool calls, sources, schedules and approvals all pass through here.</Empty>
				)}
				</div>
			</ScrollFadeArea>
		</div>
	);
}
