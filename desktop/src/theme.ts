// Dark mode is a `.dark` class on the root element, the way shadcn's tokens expect it. What decides
// it is the system's `prefers-color-scheme`, which Electron's native theme drives: the app's
// System/Light/Dark setting sets that theme in the main process, and the page follows the query.
const query = "(prefers-color-scheme: dark)";

/** Keeps the `.dark` class of the root element in step with the system's appearance. */
export function followAppearance(root: HTMLElement = document.documentElement): () => void {
	const media = window.matchMedia(query);
	const apply = () => root.classList.toggle("dark", media.matches);
	apply();
	media.addEventListener("change", apply);
	return () => media.removeEventListener("change", apply);
}
