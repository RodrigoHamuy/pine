import type { MtbConfig } from "material-theme-builder";

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

/**
 * What the page's colours are generated from: a Material 3 scheme that `<Mtb>` (material-theme-builder)
 * writes into the page as `--md-sys-color-*`, light on `:root` and dark on `.dark`. index.css points
 * shadcn's tokens and pine's own colour names at roles of that scheme.
 */
export type Palette = Pick<MtbConfig, "source" | "neutral" | "colorMatch" | "scheme" | "contrast" | "customColors">;

/**
 * pine's palette: poimandres' mint as the source and its night blue as the neutral, with colour match
 * on so that the mint keeps its strength. Warnings, info and plan mode have no role in M3: they are
 * custom colours, kept as given (`blend: false`) so that they do not drift towards the mint. Their
 * names are fixed: index.css aliases `--md-sys-color-warn` and the others.
 */
export const DEFAULT_PALETTE = {
	source: "#5de4c7",
	neutral: "#1b1e28",
	colorMatch: true,
	scheme: "tonalSpot",
	contrast: 0,
	customColors: [
		{ name: "warn", hex: "#c48814", blend: false },
		{ name: "info", hex: "#2a6fc0", blend: false },
		{ name: "plan", hex: "#7c4fd0", blend: false },
	],
} satisfies Palette;
