// The rows of the lists the keyboard walks: the code pane's tree of folders and files and its lists
// of files, and the side bar's conversations. shadcn has neither primitive, and AI Elements' file tree
// gives every row a tab stop and no arrow keys, so both are ui-sdk's (`Tree`, `Listbox`), used directly,
// which keeps them one tab stop with the arrows, typing and Enter of the ARIA patterns.

/**
 * A row of a list or of the tree: highlighted while it is the one open. The lists are one tab stop each, so
 * the row that has the keyboard shows it (in the tree the focus is on the item around the row).
 */
export function rowClass(on?: boolean) {
	return `frow flex h-7 flex-none items-center gap-2 whitespace-nowrap px-2.5 text-xs outline-primary/60 -outline-offset-2 focus-visible:outline-2 [[data-slot=tree-item]:focus-visible>&]:outline-2 ${on ? "bg-press" : "hover:bg-hover"}`;
}
