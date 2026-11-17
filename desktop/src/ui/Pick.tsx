import { type ReactNode } from "react";
import { Command, CommandGroup, CommandGroupLabel, CommandInput, CommandItem, CommandList } from "@ui-sdk/react/command";
import { Dialog as UiDialog, DialogBackdrop, DialogContent, DialogTitle } from "@ui-sdk/react/dialog";
import { Icon } from "./Icon.tsx";

/** One line of a `Pick`: what choosing it reports, what it shows, and the header of the group it sits in. */
export type PickRow = { value: string; label: ReactNode; about?: ReactNode; keys?: string; group?: string; current?: boolean; bad?: boolean };

/**
 * A list to choose one thing from, over the page under a field that narrows it, open while it is
 * rendered: the arrows move, Enter chooses, Escape closes, focus stays inside and returns where it
 * was. The caller narrows `rows` from `query` itself; consecutive rows of a `group` sit under its
 * header. `onEnter` takes Enter before the list when it returns true (words of the owner's own).
 */
export function Pick({ title, label, rows, query, onQuery, onChoose, onClose, initial, placeholder, width = 560, hideField, empty = "Nothing fits.", onEnter }: { title?: ReactNode; label: string; rows: PickRow[]; query: string; onQuery: (q: string) => void; onChoose: (value: string) => void; onClose: () => void; initial?: string; placeholder?: string; width?: number; hideField?: boolean; empty?: ReactNode; onEnter?: (query: string) => boolean }) {
	const groups: Array<{ name?: string; rows: PickRow[] }> = [];
	for (const r of rows) {
		const last = groups.at(-1);
		if (last && last.name === r.group) last.rows.push(r);
		else groups.push({ name: r.group, rows: [r] });
	}
	const item = (r: PickRow) => (
		<CommandItem key={r.value} value={r.value} className={`pick-item${r.bad ? " bad" : ""}`}>
			<span className="label">{r.label}</span>
			{r.about ? <span className="about">{r.about}</span> : null}
			{r.keys ? <kbd style={{ marginLeft: "auto", flex: "none" }}>{r.keys}</kbd> : null}
			{r.current ? <span className="cur"><Icon name="check" size={13} /></span> : null}
		</CommandItem>
	);
	return (
		<UiDialog open onOpenChange={(open) => !open && onClose()}>
			<DialogBackdrop className="scrim" />
			<DialogContent className="dialog" style={{ width }} aria-label={title ? undefined : label}>
				{title ? <DialogTitle render={<div className="pick-title" />}>{title}</DialogTitle> : null}
				<Command filter={false} query={query} onQueryChange={(q) => onQuery(q)} defaultValue={initial && rows.some((r) => r.value === initial) ? initial : undefined} onAction={(value) => onChoose(value)}>
					<CommandInput
						className="pick-input"
						aria-label={label}
						placeholder={placeholder}
						style={hideField ? { position: "absolute", opacity: 0, pointerEvents: "none" } : undefined}
						onKeyDown={(e) => {
							// Escape closes at once, whatever is typed, as it always has here.
							if (e.key === "Escape") return (e.preventDefault(), onClose());
							if (e.key === "Enter" && onEnter?.(query)) e.preventDefault();
						}}
					/>
					{rows.length ? (
						<CommandList className="pick-list">
							{groups.map((g, n) =>
								g.name ? (
									<CommandGroup key={`${g.name}:${n}`}>
										<CommandGroupLabel className="pick-group">{g.name}</CommandGroupLabel>
										{g.rows.map(item)}
									</CommandGroup>
								) : (
									g.rows.map(item)
								),
							)}
						</CommandList>
					) : empty ? (
						<div className="empty" style={{ padding: 24 }}>{empty}</div>
					) : null}
				</Command>
			</DialogContent>
		</UiDialog>
	);
}
