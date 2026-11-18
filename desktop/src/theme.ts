// Dark mode is a `.dark` class on the root element, the way shadcn's tokens expect it. What decides
// it is the app's Appearance setting: Light or Dark by itself, and System by the system's
// `prefers-color-scheme`. The page reads the setting rather than only the query, because the query
// is not always the setting's: in the app, Electron's native theme (set from the same setting in
// the main process) drives it, but in the preview (`npm run dev:preview`) nothing does.
const query = "(prefers-color-scheme: dark)";

/** The app's Appearance setting, as its preferences keep it. */
export type Appearance = "system" | "light" | "dark";

/**
 * Keeps the `.dark` class of the root element in step with the Appearance setting (`chosen`) and,
 * for System, with the system's appearance. `onChange` subscribes to changes of the setting.
 */
export function followAppearance(chosen: () => Appearance, onChange: (fn: () => void) => () => void, root: HTMLElement = document.documentElement): () => void {
	const media = window.matchMedia(query);
	const apply = () => {
		const theme = chosen();
		root.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
	};
	apply();
	media.addEventListener("change", apply);
	const stop = onChange(apply);
	return () => {
		media.removeEventListener("change", apply);
		stop();
	};
}
