// What the page has of the world outside itself: the bridge the preload script exposes.
import type { Bridge } from "../electron/preload.ts";
import type { Palette } from "./theme.ts";

declare global {
	interface Window {
		pine: Bridge;
	}
	/** Set by `npm run dev:preview` only (vite.config.ts): the page runs in an ordinary browser, with src/preview-bridge.ts. */
	const __PINE_PREVIEW__: boolean;
}

export type ServiceState = { status: "starting" } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string } | { status: "error"; kind: "no-home" | "no-node" | "no-pine" | "failed"; message: string };

export interface Prefs {
	home?: string;
	keepRunning: boolean;
	theme: "system" | "light" | "dark";
	notify: boolean;
	updates: boolean;
	/** The palette the colours are generated from (theme.ts), or none: pine's default. */
	palette?: Palette;
	/** Code in dark draws with roles of the palette (on) or keeps poimandres' own colours (off). */
	codeFollowsPalette: boolean;
}

export type { Update } from "../electron/updates.ts";

export const bridge = window.pine;

/** Where the daemon's pictures, video and sound are fetched from: the app's scheme, or in the preview its server's path. */
export const MEDIA_BASE = import.meta.env.DEV && __PINE_PREVIEW__ ? "/__pine/media" : "pine-media://daemon";
