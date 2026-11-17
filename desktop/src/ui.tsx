// The small parts everything else is built from: icons, buttons, fields, a dialog, a menu.
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog as UiDialog, DialogBackdrop, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";

const PATHS: Record<string, string> = {
	plus: "M8 3v10M3 8h10",
	x: "M4 4l8 8M12 4l-8 8",
	check: "M3 8.5l3.2 3L13 4.5",
	right: "M6 3.5L10.5 8 6 12.5",
	down: "M3.5 6L8 10.5 12.5 6",
	up: "M8 13V3M3.5 7.5L8 3l4.5 4.5",
	sidebar: "M2.5 3.5h11v9h-11zM6 3.5v9",
	panel: "M2.5 3.5h11v9h-11zM10 3.5v9",
	gear: "M8 5.6a2.4 2.4 0 100 4.8 2.4 2.4 0 000-4.8zM8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2",
	folder: "M2 4.5h4l1.4 1.5H14v6.5H2z",
	file: "M4 2h5l3 3v9H4zM9 2v3h3",
	branch: "M5 3.2v9.6M5 3.2a1.2 1.2 0 100-.01M5 12.8a1.2 1.2 0 100 .01M11 5.2a1.2 1.2 0 100-.01M11 6.4c0 3-6 1.6-6 4.4",
	terminal: "M2.5 3.5h11v9h-11zM5 6.5L7 8l-2 1.5M8.5 9.8h2.5",
	play: "M5 3.5v9l7-4.5z",
	stop: "M4.5 4.5h7v7h-7z",
	pin: "M9.5 2l4.5 4.5-2.6.9-2.2 2.2.2 3.2L7 10.4 3 14.2 2.8 13l3.8-4L4.2 6.6l3.2.2 2.2-2.2z",
	star: "M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z",
	search: "M7 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM10.3 10.3l3.2 3.2",
	copy: "M5.5 5.5h8v8h-8zM2.5 10.5v-8h8",
	alert: "M8 2.2L14.2 13H1.8zM8 6.4v3.2M8 11.3v.2",
	clip: "M11.6 7.4l-4.3 4.3a2.3 2.3 0 01-3.3-3.3l5-5a1.6 1.6 0 012.3 2.3l-4.9 4.9a.8.8 0 01-1.1-1.1l4.2-4.2",
	bolt: "M9 1.8L3.5 9H8l-1 5.2L12.5 7H8z",
	refresh: "M13 8a5 5 0 11-1.5-3.5M13 2.5v2.5h-2.5",
	trash: "M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v4M9.2 7v4",
	edit: "M3 13l.6-2.8L10.8 3l2.2 2.2-7.2 7.2zM9.6 4.2l2.2 2.2",
	external: "M6.5 3.5h-3v9h9v-3M9 3h4v4M13 3L7.5 8.5",
	clock: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5v3.2l2 1.3",
	cpu: "M4.5 4.5h7v7h-7zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14",
	spark: "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.8 1.8M10.2 10.2L12 12M12 4l-1.8 1.8M5.8 10.2L4 12",
	shield: "M8 1.8l5 1.8v4.2c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4V3.6z",
	target: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM8 7.8v.4",
	list: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.4M2.5 8h.4M2.5 12h.4",
	more: "M3.5 8h.2M8 8h.2M12.5 8h.2",
	undo: "M5.5 3L2.5 6l3 3M2.5 6h7a4 4 0 010 8H7",
	chat: "M2.5 3.5h11v7.5H7.5l-3 2.5v-2.5h-2z",
	plug: "M6 2v3.5M10 2v3.5M4 5.5h8v2.5a4 4 0 01-8 0zM8 12v2",
	book: "M3 2.5h7.5a2 2 0 012 2v9H5a2 2 0 01-2-2zM3 11.5a2 2 0 012-2h7.5",
	users: "M6 7.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.8 13.5c0-2.3 1.9-3.8 4.2-3.8s4.2 1.5 4.2 3.8M10.8 7.3a2.2 2.2 0 000-4.4M12 9.9c1.4.5 2.3 1.8 2.3 3.6",
	sliders: "M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6M8.5 3v3M5.5 10v3",
	info: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 7.4v3.6M8 5.2v.2",
	eye: "M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6z",
	wave: "M2 8h1.5M5 5v6M8 3v10M11 5.5v5M13.5 8H14",
	command: "M5.5 5.5h5v5h-5zM5.5 5.5V4a1.5 1.5 0 10-1.5 1.5zM10.5 5.5H12A1.5 1.5 0 1010.5 4zM10.5 10.5V12a1.5 1.5 0 101.5-1.5zM5.5 10.5H4A1.5 1.5 0 105.5 12z",
	save: "M3 2.5h8l2 2v9H3zM5.5 2.5v3.5h4.5V2.5M5.5 13.5v-4h5v4",
	back: "M9.5 3.5L5 8l4.5 4.5",
	mic: "M8 2a2 2 0 00-2 2v4a2 2 0 004 0V4a2 2 0 00-2-2zM4 7.5a4 4 0 008 0M8 11.5V14",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName | string; size?: number; className?: string }) {
	return (
		<svg className={`icon${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d={PATHS[name] ?? PATHS.info} />
		</svg>
	);
}

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

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "plain"; icon?: IconName | string; small?: boolean };

export function Button({ variant = "plain", icon, small, className, children, ...rest }: ButtonProps) {
	return (
		<button type="button" className={`btn btn-${variant}${small ? " btn-small" : ""}${children ? "" : " btn-icon"}${className ? ` ${className}` : ""}`} {...rest}>
			{icon ? <Icon name={icon} size={small ? 14 : 16} /> : null}
			{children}
		</button>
	);
}

export function Field({ label, hint, children, wide }: { label: string; hint?: ReactNode; children: ReactNode; wide?: boolean }) {
	return (
		<label className={`field${wide ? " field-wide" : ""}`}>
			<span className="field-label">{label}</span>
			{children}
			{hint ? <span className="field-hint">{hint}</span> : null}
		</label>
	);
}

export function Switch({ on, onChange, disabled }: { on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
	return <button type="button" role="switch" aria-checked={on} disabled={disabled} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string; icon?: string; badge?: number }>; onChange: (v: T) => void }) {
	return (
		<div className="segmented" role="tablist">
			{options.map((o) => (
				<button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} onClick={() => onChange(o.value)}>
					{o.icon ? <Icon name={o.icon} size={14} /> : null}
					{o.label}
					{o.badge ? <span className="badge">{o.badge}</span> : null}
				</button>
			))}
		</div>
	);
}

/**
 * A window over the page that asks for one thing, open while it is rendered. Escape and a press
 * beside it close it when there is an `onClose`; focus stays inside and returns where it was.
 */
export function Dialog({ title, children, onClose, width = 520, tone, footer }: { title?: ReactNode; children: ReactNode; onClose?: () => void; width?: number; tone?: "warn" | "accent"; footer?: ReactNode }) {
	return (
		<UiDialog open dismissible={Boolean(onClose)} onOpenChange={(open) => !open && onClose?.()}>
			<DialogBackdrop className="scrim" />
			<DialogContent className={`dialog${tone ? ` dialog-${tone}` : ""}`} style={{ width }} aria-label={title ? undefined : "Dialog"}>
				{title ? <DialogTitle render={<div className="dialog-title" />}>{title}</DialogTitle> : null}
				<div className="dialog-body">{children}</div>
				{footer ? <div className="dialog-foot">{footer}</div> : null}
			</DialogContent>
		</UiDialog>
	);
}

/** A text field that grows with what is typed into it. */
export function AutoText({ value, onChange, minRows = 3, maxRows = 24, mono, ...rest }: { value: string; onChange: (v: string) => void; minRows?: number; maxRows?: number; mono?: boolean } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value">) {
	const ref = useRef<HTMLTextAreaElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
		el.style.height = `${Math.min(Math.max(el.scrollHeight + 2, minRows * line + 18), maxRows * line + 18)}px`;
	}, [value, minRows, maxRows]);
	return <textarea ref={ref} className={`input${mono ? " mono" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} {...rest} />;
}

export function Empty({ icon, title, children }: { icon?: string; title: string; children?: ReactNode }) {
	return (
		<div className="empty">
			{icon ? <Icon name={icon} size={22} /> : null}
			<div className="empty-title">{title}</div>
			{children ? <div className="empty-text">{children}</div> : null}
		</div>
	);
}

/** Ask twice before something that cannot be taken back: the first click arms the button, the second does it. */
export function Confirm({ label, sure = "Sure?", onConfirm, icon, small = true }: { label?: string; sure?: string; onConfirm: () => void; icon?: string; small?: boolean }) {
	const [armed, setArmed] = useState(false);
	useEffect(() => {
		if (!armed) return;
		const t = window.setTimeout(() => setArmed(false), 3000);
		return () => window.clearTimeout(t);
	}, [armed]);
	return (
		<Button
			small={small}
			variant={armed ? "danger" : "ghost"}
			icon={armed ? undefined : icon}
			title={label}
			onClick={(e) => {
				e.stopPropagation();
				if (armed) onConfirm();
				setArmed(!armed);
			}}
		>
			{armed ? sure : icon ? undefined : label}
		</Button>
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
