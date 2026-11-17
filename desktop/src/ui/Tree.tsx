import { type ReactNode } from "react";
import { TreeGroup, TreeItem, TreeItemLabel, Tree as UiTree } from "@ui-sdk/react/tree";

/**
 * A hierarchy announced as a tree: the arrow keys move, open and close its branches, Enter or a click runs
 * `onOpen` with a row's value. Which branches are open is `expanded`, kept by the caller.
 */
export function Tree({ label, expanded, onExpandedChange, onOpen, children }: { label: string; expanded: string[]; onExpandedChange: (expanded: string[]) => void; onOpen: (value: string) => void; children: ReactNode }) {
	return (
		<UiTree aria-label={label} className="tree" expanded={expanded} onExpandedChange={(next) => onExpandedChange(next)} expandOnPress onAction={(value) => onOpen(value)}>
			{children}
		</UiTree>
	);
}

/** One row of a `Tree`, `depth` levels in. A `branch` holds its rows in `children`, shown while it is open. */
export function TreeRow({ value, label, row, on, depth, branch, children }: { value: string; label: string; row: ReactNode; on?: boolean; depth: number; branch?: boolean; children?: ReactNode }) {
	return (
		<TreeItem value={value} label={label} branch={branch}>
			<TreeItemLabel className={`frow${on ? " on" : ""}`} style={{ paddingLeft: 10 + depth * 14 }}>
				{row}
			</TreeItemLabel>
			{branch ? <TreeGroup>{children}</TreeGroup> : null}
		</TreeItem>
	);
}
