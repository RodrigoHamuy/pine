import { builder, type MtbConfig } from "material-theme-builder";
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

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

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

/**
 * The colours an agent can be given in one click on its settings page (the owner can also type any
 * other). Hues apart from each other and from pine's mint (#5de4c7), so that two agents are told apart
 * at a glance after the scheme has toned them.
 */
export const AGENT_COLOURS = [
	{ name: "Red", hex: "#d9534f" },
	{ name: "Coral", hex: "#e0805a" },
	{ name: "Amber", hex: "#d4a017" },
	{ name: "Olive", hex: "#8cb33a" },
	{ name: "Green", hex: "#4caf50" },
	{ name: "Blue", hex: "#4a7fd9" },
	{ name: "Indigo", hex: "#6a5acd" },
	{ name: "Violet", hex: "#a05ad0" },
	{ name: "Pink", hex: "#d65c9e" },
] as const;

/** An M3 scheme as material-theme-builder gives it: role name (camelCase) to hex, for light and for dark. */
export type Schemes = { light: Record<string, string>; dark: Record<string, string> };

/**
 * The role families the window can take from the agent in front (Settings > App > Colours), with the
 * name Settings shows for each. Error and the custom colours are never an agent's: they mean the same
 * whoever is in front.
 */
export const FAMILIES = {
	primary: "Primary",
	secondary: "Secondary",
	tertiary: "Tertiary",
	surfaces: "Surfaces",
	outlines: "Outlines",
} as const;
export type Family = keyof typeof FAMILIES;

/** What the window follows of the agent in front when the owner said nothing: its accent. */
export const DEFAULT_FAMILIES: Family[] = ["primary"];

/**
 * The families as they were stored or sent, made safe: the known names, each once, in Settings' order.
 * What is not a list at all is the default. An empty list is kept: the owner unticked them all. The
 * app's main process runs this when the families are set and read; the preview's bridge does the same.
 */
export function cleanFamilies(raw: unknown): Family[] {
	if (!Array.isArray(raw)) return [...DEFAULT_FAMILIES];
	return (Object.keys(FAMILIES) as Family[]).filter((f) => raw.includes(f));
}

/**
 * The roles of each family (camelCase, as the scheme names them), and the tonal palette its
 * `--md-ref-palette-<name>-<tone>` variables belong to. The surfaces are the neutral's roles, the
 * outlines and muted text the neutral variant's.
 */
const ROLES: Record<Family, { palette: string; roles: string[] }> = {
	primary: { palette: "primary", roles: ["primary", "onPrimary", "primaryContainer", "onPrimaryContainer", "inversePrimary", "surfaceTint", "primaryFixed", "primaryFixedDim", "onPrimaryFixed", "onPrimaryFixedVariant"] },
	secondary: { palette: "secondary", roles: ["secondary", "onSecondary", "secondaryContainer", "onSecondaryContainer", "secondaryFixed", "secondaryFixedDim", "onSecondaryFixed", "onSecondaryFixedVariant"] },
	tertiary: { palette: "tertiary", roles: ["tertiary", "onTertiary", "tertiaryContainer", "onTertiaryContainer", "tertiaryFixed", "tertiaryFixedDim", "onTertiaryFixed", "onTertiaryFixedVariant"] },
	surfaces: {
		palette: "neutral",
		roles: ["background", "onBackground", "surface", "onSurface", "surfaceDim", "surfaceBright", "surfaceContainerLowest", "surfaceContainerLow", "surfaceContainer", "surfaceContainerHigh", "surfaceContainerHighest", "inverseSurface", "inverseOnSurface", "shadow", "scrim"],
	},
	outlines: { palette: "neutral-variant", roles: ["surfaceVariant", "onSurfaceVariant", "outline", "outlineVariant"] },
};

/** An agent's scheme, with its tonal palettes by name (primary, neutral-variant…) and tone. */
export type AgentScheme = Schemes & { palettes: Record<string, Record<string, string>> };

const agentSchemes = new Map<string, AgentScheme>();

/**
 * The M3 scheme of an agent's colour: the owner's palette (its variant, contrast and custom colours)
 * with the agent's colour as the source. With surfaces among `families` the owner's neutral is left
 * out, and with outlines its neutral variant, so that those come from the agent's colour too. Kept per
 * colour and the options the scheme is generated with (a few dozen at most): the window draws often,
 * and generating a scheme is not free.
 */
export function agentScheme(color: string, palette: Palette = DEFAULT_PALETTE, families: readonly Family[] = []): AgentScheme {
	const { source: _global, neutral, neutralVariant, ...rest } = palette;
	const options = {
		...rest,
		...(families.includes("surfaces") ? {} : { neutral }),
		...(families.includes("outlines") ? {} : { neutralVariant }),
	};
	const key = `${color}|${JSON.stringify(options)}`;
	let scheme = agentSchemes.get(key);
	if (!scheme) {
		const all = builder(color, options).toJson();
		scheme = { light: all.schemes.light, dark: all.schemes.dark, palettes: all.palettes };
		// Dragging a palette control in Settings makes a new key at every step: start over rather than grow without end.
		if (agentSchemes.size >= 64) agentSchemes.clear();
		agentSchemes.set(key, scheme);
	}
	return scheme;
}

const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The `--md-sys-color-*` and `--md-ref-palette-*` variables of the ticked families, from an agent's
 * scheme in one look (light or dark): what the root element is given while that agent is in front.
 * Only variables <Mtb> writes too, so that every shadcn token that reads them follows and none is
 * declared again.
 */
export function agentVariables(scheme: AgentScheme, families: readonly Family[], look: "light" | "dark"): Record<string, string> {
	const vars: Record<string, string> = {};
	for (const family of families) {
		const { palette, roles } = ROLES[family];
		for (const role of roles) if (scheme[look][role]) vars[`--md-sys-color-${kebab(role)}`] = scheme[look][role];
		for (const [tone, hex] of Object.entries(scheme.palettes[palette] ?? {})) vars[`--md-ref-palette-${palette}-${tone}`] = hex;
	}
	return vars;
}
