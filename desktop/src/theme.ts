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
export type Palette = Required<Pick<MtbConfig, "source" | "neutral" | "colorMatch" | "scheme" | "contrast" | "customColors">>;

/**
 * pine's palette: poimandres' mint as the source and its night blue as the neutral, with colour match
 * on so that the mint keeps its strength. Warnings, info and keywords in code (`plan`) have no role in
 * M3: they are custom colours that keep their hue (`blend: false`) so that they do not drift towards the
 * mint, while their tone follows the look (darker in light, lighter in dark). Their names are fixed:
 * index.css aliases `--md-sys-color-warn` and the others.
 */
export const DEFAULT_PALETTE = {
	source: "#5de4c7",
	neutral: "#1b1e28",
	colorMatch: true,
	scheme: "tonalSpot",
	contrast: 0,
	customColors: [
		{ name: "warn" as const, hex: "#c48814", blend: false },
		{ name: "info" as const, hex: "#2a6fc0", blend: false },
		{ name: "plan" as const, hex: "#7c4fd0", blend: false },
	],
} satisfies Palette;

type SchemeName = Palette["scheme"];

/**
 * material-theme-builder's scheme variants, with the name Settings shows for each. A record, so that
 * the type checker says when the package adds or drops one (the package exports the list only as a type).
 */
export const SCHEMES: Record<SchemeName, string> = {
	tonalSpot: "Tonal spot",
	neutral: "Neutral",
	vibrant: "Vibrant",
	expressive: "Expressive",
	fidelity: "Fidelity",
	content: "Content",
	monochrome: "Monochrome",
};

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/**
 * A palette as it was stored or sent, made safe to draw: each field that is not what it has to be
 * is pine's default for that field, and only the three custom colours of the default (by name) are
 * kept. What is not a palette at all gives `undefined`, which is the default palette. The app's main
 * process runs this when a palette is set and when it is read from its preferences; the preview's
 * stand-in for the bridge does the same.
 */
export function cleanPalette(raw: unknown): Palette | undefined {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const d = DEFAULT_PALETTE;
	const given = Array.isArray(r.customColors) ? (r.customColors as Array<Record<string, unknown> | null>) : [];
	return {
		source: isHex(r.source) ? r.source.toLowerCase() : d.source,
		neutral: isHex(r.neutral) ? r.neutral.toLowerCase() : d.neutral,
		colorMatch: typeof r.colorMatch === "boolean" ? r.colorMatch : d.colorMatch,
		scheme: typeof r.scheme === "string" && Object.hasOwn(SCHEMES, r.scheme) ? (r.scheme as SchemeName) : d.scheme,
		contrast: typeof r.contrast === "number" && r.contrast >= -1 && r.contrast <= 1 ? r.contrast : d.contrast,
		customColors: d.customColors.map((c) => {
			const hex = given.find((g) => g?.name === c.name)?.hex;
			return { name: c.name, hex: isHex(hex) ? hex.toLowerCase() : c.hex, blend: false };
		}),
	};
}
