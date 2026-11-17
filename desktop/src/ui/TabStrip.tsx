import { bindDrag, dragThreshold } from "@ui-sdk/core";
import { createContext, type ReactNode, useContext } from "react";
import { Tabs, TabsList, TabsTab } from "@ui-sdk/react/tabs";

const StripMove = createContext<(from: number, to: number) => void>(() => {});

/** A row of tabs that the arrows move along, Enter or Space opens, and a pointer drags to another place. */
export function TabStrip({ label, value, onSelect, onMove, children }: { label: string; value: string | null; onSelect: (value: string) => void; onMove: (from: number, to: number) => void; children: ReactNode }) {
	return (
		<Tabs value={value} activation="manual" onValueChange={(next) => next !== null && onSelect(next)}>
			<TabsList className="tabs" aria-label={label}>
				<StripMove.Provider value={onMove}>{children}</StripMove.Provider>
			</TabsList>
		</Tabs>
	);
}

/** One tab of a `TabStrip`. */
export function StripTab({ value, className, children, ...rest }: { value: string; className?: string; children: ReactNode } & Omit<React.HTMLAttributes<HTMLButtonElement>, "children">) {
	const move = useContext(StripMove);
	const grab = (down: React.PointerEvent<HTMLButtonElement>) => {
		if (down.button !== 0) return;
		const el = down.currentTarget;
		const list = el.parentElement!;
		const tabs = () => [...list.querySelectorAll<HTMLElement>('[data-slot="tabs-tab"]')];
		const from = tabs().indexOf(el);
		let to = from;
		const unmark = () => tabs().forEach((t) => (delete t.dataset.drop, delete t.dataset.grabbed));
		bindDrag(el, down.nativeEvent, {
			threshold: dragThreshold,
			cancelOnEscape: true,
			onStart: () => void (el.dataset.grabbed = ""),
			onMove: ({ x }) => {
				const others = tabs().filter((t) => t !== el);
				to = others.filter((t) => { const r = t.getBoundingClientRect(); return r.left + r.width / 2 < x; }).length;
				unmark();
				el.dataset.grabbed = "";
				if (to === from) return;
				if (to < others.length) others[to].dataset.drop = "before";
				else others[others.length - 1].dataset.drop = "after";
			},
			onEnd: (_event, canceled) => (unmark(), canceled || move(from, to)),
		});
	};
	return (
		<TabsTab value={value} className={className} onPointerDown={grab} {...rest}>
			{children}
		</TabsTab>
	);
}
