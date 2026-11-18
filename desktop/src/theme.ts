import type { MtbConfig } from "material-theme-builder";
import type { Prefs } from "./bridge.ts";

// Dark mode is a `.dark` class on the root element, the way shadcn's tokens expect it. What decides
// it is the app's Appearance setting: Light or Dark by itself, and System by the system's
// `prefers-color-scheme`. The page reads the setting rather than only the query, because the query
// is not always the setting's: in the app, Electron's native theme (set from the same setting in
// the main process) drives it, but in the preview (`npm run dev:preview`) nothing does.
const query = "(prefers-color-scheme: dark)";

/** The app's Appearance setting, as its preferences keep it. */
export type Appearance = Prefs["theme"];

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

/**
 * What the page's colours are generated from: a Material 3 scheme that `<Mtb>` (material-theme-builder)
 * writes into the page as `--md-sys-color-*`, light on `:root` and dark on `.dark`. index.css points
 * shadcn's tokens at roles of that scheme, and components use the roles as utilities for the rest.
 */
export type Palette = Required<Pick<MtbConfig, "source" | "neutral" | "neutralVariant" | "colorMatch" | "scheme" | "contrast" | "customColors">>;

/**
 * pine's palette: poimandres' mint as the source, its night blue as the neutral (the surfaces) and its
 * comment blue grey as the neutral variant (muted text and outlines), in M3's tonal spot scheme. Colour
 * match is off on purpose: with it, material-theme-builder uses the content variant, as Google's Material
 * Theme Builder does, and that variant divides a neutral's chroma by 8, which turns poimandres' blue grey
 * into a plain grey. Tonal spot keeps the neutrals' tint. Warnings, info and keywords in code (`plan`) have
 * no role in M3: they are custom colours that keep their hue (`blend: false`) so that they do not drift
 * towards the mint, while their tone follows the look (darker in light, lighter in dark). Their names are
 * fixed: components use them as `text-warn`, `text-info`, `text-plan`, and index.css reads `--md-sys-color-warn` and the others.
 */
export const DEFAULT_PALETTE = {
	source: "#5de4c7",
	neutral: "#1b1e28",
	neutralVariant: "#767c9d",
	colorMatch: false,
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
		neutralVariant: isHex(r.neutralVariant) ? r.neutralVariant.toLowerCase() : d.neutralVariant,
		colorMatch: typeof r.colorMatch === "boolean" ? r.colorMatch : d.colorMatch,
		scheme: typeof r.scheme === "string" && Object.hasOwn(SCHEMES, r.scheme) ? (r.scheme as SchemeName) : d.scheme,
		contrast: typeof r.contrast === "number" && r.contrast >= -1 && r.contrast <= 1 ? r.contrast : d.contrast,
		customColors: d.customColors.map((c) => {
			const hex = given.find((g) => g?.name === c.name)?.hex;
			return { name: c.name, hex: isHex(hex) ? hex.toLowerCase() : c.hex, blend: false };
		}),
	};
}
