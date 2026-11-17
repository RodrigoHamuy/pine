// Lists the keyboard walks: a tree of folders and files, and a list of rows to open. shadcn has
// neither primitive, and AI Elements' file tree gives every row a tab stop and no arrow keys, so
// both are ui-sdk's, which keeps them one tab stop with the arrows, typing and Enter of the ARIA patterns.
import { type ReactNode } from "react";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { Tree as UiTree, TreeGroup, TreeItem, TreeItemLabel } from "@ui-sdk/react/tree";

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

/**
 * A list of rows to open, one tab stop: Tab goes in, the arrow keys move, Enter or a click opens a row
 * with `onOpen`. `value` is the row that is open, if one of them is.
 */
export function List({ label, value = null, onOpen, className, children }: { label: string; value?: string | null; onOpen: (value: string) => void; className?: string; children: ReactNode }) {
	return (
		<Listbox aria-label={label} className={className} activation="manual" value={value} onValueChange={(next) => typeof next === "string" && onOpen(next)}>
			{children}
		</Listbox>
	);
}

/** One row of a `List`. */
export function ListRow({ value, label, className, children, ...rest }: { value: string; label?: string; className?: string; children: ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, "children">) {
	return (
		<ListboxItem value={value} label={label} className={className} {...rest}>
			{children}
		</ListboxItem>
	);
}
