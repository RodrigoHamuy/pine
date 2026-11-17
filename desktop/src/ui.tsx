// The small parts of pine's own that everything else is built from, on shadcn's components: the
// logo, the working dot, a labelled field, a choice, a text that grows, an empty view.
import type { LucideIcon } from "lucide-react";
import { cloneElement, isValidElement, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** pine's mark: the P of its wordmark (docs/images/logo-dark.svg), four blocks on a grid. */
export function Logo({ size = 18 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 800 800" fill="currentColor" aria-hidden="true" className="logo">
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
		<span className="pulse" style={{ width: size, height: size }} aria-label="working">
			<span ref={dot} style={{ width: d, height: d }} />
		</span>
	);
}

/**
 * A labelled field: shadcn's Field with its label and hint. The label names the control it holds
 * (it points at the control's id, given to it here unless it has one), so a click on the label
 * reaches the control and a screen reader says the label with it.
 */
export function LabeledField({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
	const made = useId();
	const one = isValidElement<{ id?: string }>(children) ? children : undefined;
	const id = one?.props.id ?? made;
	return (
		<Field className={wide ? "field-wide" : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{one && !one.props.id ? cloneElement(one, { id }) : children}
			{hint ? <FieldDescription>{hint}</FieldDescription> : null}
		</Field>
	);
}

/** One value out of a list, on shadcn's Select (what was a native select). "" is a value like any other. */
export function Choice({ value, options, onChange, id, disabled }: { value: string; options: Array<{ value: string; label: string }>; onChange: (v: string) => void; id?: string; disabled?: boolean }) {
	return (
		<Select items={options} value={value} onValueChange={(v) => onChange(v ?? "")} disabled={disabled}>
			<SelectTrigger id={id} className="w-full">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{options.map((o) => (
						<SelectItem key={o.value} value={o.value}>
							{o.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
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
	return <Textarea ref={ref} className={[mono ? "mono" : "", className ?? ""].join(" ").trim() || undefined} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} {...rest} />;
}

export function Empty({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
	return (
		<div className="empty">
			{Icon ? <Icon size={22} /> : null}
			<div className="empty-title">{title}</div>
			{children ? <div className="empty-text">{children}</div> : null}
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
