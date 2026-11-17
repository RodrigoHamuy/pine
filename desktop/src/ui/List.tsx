import { type ReactNode } from "react";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";

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
