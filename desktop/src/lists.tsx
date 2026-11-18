// The rows of the lists the keyboard walks: the code pane's tree of folders and files and its lists
// of files, and the side bar's conversations. shadcn has neither primitive, and AI Elements' file tree
// gives every row a tab stop and no arrow keys, so both are ui-sdk's (`Tree`, `Listbox`), used directly,
// which keeps them one tab stop with the arrows, typing and Enter of the ARIA patterns.

/** The props every keyboard list shares: Enter or a click opens a row, and no row stays selected (what is open is the app's state, shown by `rowClass`). */
export const LISTBOX = { activation: "manual", value: null } as const;

/** Hands a list's picked value on as the string it is, for `onValueChange`. */
export const onPick = (set: (value: string) => void) => (value: unknown) => {
	if (typeof value === "string") set(value);
};

/**
 * The class of a tree's item. In the tree the focus is on the item around the row, so the item draws no
 * outline and the row inside it shows the focus (`rowClass`).
 */
export const TREE_ITEM = "outline-none";

/**
 * A row of a list or of the tree: highlighted while it is the one open. The lists are one tab stop each, so
 * the row that has the keyboard shows it, also where the focus is on the tree's item around it (`TREE_ITEM`).
 */
export function rowClass(on?: boolean) {
	return `frow flex h-7 flex-none items-center gap-2 whitespace-nowrap px-2.5 text-xs outline-primary/60 -outline-offset-2 focus-visible:outline-2 [[data-slot=tree-item]:focus-visible>&]:outline-2 ${on ? "bg-press" : "hover:bg-hover"}`;
}
