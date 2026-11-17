import { type ReactNode, useState } from "react";
import { createResizableController, Resizable, ResizableHandle, ResizablePanel } from "@ui-sdk/react/resizable";

/**
 * A pane beside the rest, as wide as it was last made: its edge is a separator that a pointer drags and the
 * arrow keys move, a double click sets it back to `width`, and the width is kept under `pine.<id>.width`.
 * Without a `pane`, the rest takes the whole row.
 */
export function Split({ id, label, side, pane, width, min, max, restMin, className, children }: { id: string; label: string; side: "start" | "end"; pane: ReactNode; width: number; min: number; max: number; restMin: number; className?: string; children: ReactNode }) {
	const [controller] = useState(createResizableController);
	const key = `pine.${id}.width`;
	const save = () => {
		const el = document.getElementById(id);
		if (el) localStorage.setItem(key, String(el.getBoundingClientRect().width));
	};
	const parts = [
		<ResizablePanel key="rest" id={`${id}-rest`} className="split-pane" minSize={`${restMin}px`}>
			{children}
		</ResizablePanel>,
	];
	if (pane) {
		const edge = (
			<ResizableHandle
				key="edge"
				aria-label={label}
				title={`Drag to make the ${label.replace(/^Resize /, "")} wider or narrower`}
				className={`splitter${side === "start" ? " side" : ""}`}
				onDoubleClick={() => {
					controller.resize(id, `${width}px`);
					save();
				}}
			/>
		);
		const own = (
			<ResizablePanel key="pane" id={id} className="split-pane" defaultSize={`${Number(localStorage.getItem(key)) || width}px`} minSize={`${min}px`} maxSize={`${max}px`}>
				{pane}
			</ResizablePanel>
		);
		if (side === "start") parts.unshift(own, edge);
		else parts.push(edge, own);
	}
	return (
		<Resizable className={className} controller={controller} onLayoutCommit={save}>
			{parts}
		</Resizable>
	);
}
