// The small parts of pine's own that everything else is built from, on shadcn's components: the
// logo, the working dot, a text that grows, an empty view, a view being read, where notices show.
import type { LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Empty as StockEmpty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/** pine's mark: the P of its wordmark (docs/images/logo-dark.svg), four blocks on a grid. */
export function Logo({ size = 18 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 800 800" fill="currentColor" aria-hidden="true" className="shrink-0 text-foreground">
			<rect x="280" y="560" width="240" height="240" />
			<rect x="280" y="280" width="240" height="240" />
			<rect x="0" y="280" width="240" height="240" />
			<path d="M560 0H280V240H560V520H800V0H560Z" />
		</svg>
	);
}

/**
 * Something is at work: a green dot that breathes. `size` is the room it stands in (an icon's),
 * so that what it takes the place of does not move. Every such dot on screen breathes in step,
 * whenever it appeared: each one's animation is set to have begun when the page did.
 */
export function Pulse({ size = 14 }: { size?: number }) {
	const dot = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		for (const breath of dot.current?.getAnimations() ?? []) breath.startTime = 0;
	}, []);
	const d = Math.min(9, Math.max(6, Math.round(size * 0.6)));
	return (
		<span className="inline-grid flex-none place-items-center" style={{ width: size, height: size }} aria-label="working">
			{/* Tailwind's own pulse: slow, and every dot in step (above). */}
			<span ref={dot} className="animate-pulse rounded-full bg-primary motion-reduce:animate-none" style={{ width: d, height: d }} />
		</span>
	);
}

/** Where pine's passing notices (`store.flash`) show: at the bottom, as Sonner's pile that opens on hover. */
export function Notices() {
	return <Toaster position="bottom-center" />;
}

/** A text field that grows with what is typed into it. */
export function AutoText({ value, onChange, minRows = 3, maxRows = 24, mono, className, ...rest }: { value: string; onChange: (v: string) => void; minRows?: number; maxRows?: number; mono?: boolean } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
		el.style.height = `${Math.min(Math.max(el.scrollHeight + 2, minRows * line + 18), maxRows * line + 18)}px`;
	}, [value, minRows, maxRows]);
	return <Textarea ref={ref} className={cn(mono && "font-mono", className)} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} {...rest} />;
}

/**
 * A view with nothing in it: stock Empty, its icon, title and what to do. One line for the twenty
 * places that say so, each with an icon, a title and at most a sentence.
 */
export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
	return (
		<StockEmpty>
			<EmptyHeader>
				{Icon ? (
					<EmptyMedia variant="icon">
						<Icon />
					</EmptyMedia>
				) : null}
				<EmptyTitle>{title}</EmptyTitle>
				{children ? <EmptyDescription>{children}</EmptyDescription> : null}
			</EmptyHeader>
		</StockEmpty>
	);
}

/** Something is being read: stock Spinner in the middle of the view it will fill. (Not an agent at work: that is Pulse.) */
export function Loading() {
	return (
		<div className="m-auto grid place-items-center p-6">
			<Spinner />
		</div>
	);
}

/** Load something when the part appears, and again when `reload` is called or a dependency changes. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []): { data?: T; error?: string; loading: boolean; reload: () => void } {
	const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
	const [tick, setTick] = useState(0);
	useEffect(() => {
		let live = true;
		setState((s) => ({ ...s, loading: true }));
		load().then(
			(data) => live && setState({ data, loading: false }),
			(e) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }),
		);
		return () => {
			live = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [...deps, tick]);
	return { ...state, reload: () => setTick((t) => t + 1) };
}
