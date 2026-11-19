// What the page has of the world outside itself: the bridge the preload script exposes.
import type { Bridge } from "../electron/preload.ts";
import type { Look } from "./theme.ts";

declare global {
	interface Window {
		pine: PageBridge;
	}
	/** Set by `npm run dev:preview` only (vite.config.ts): the page runs in an ordinary browser, with src/preview-bridge.ts. */
	const __PINE_PREVIEW__: boolean;
}

/** The pine the app uses, and how it is. `host` and `label` name another machine reached over SSH; without them it is this computer's. */
export type ServiceState = { status: "starting"; host?: string } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string; host?: string; label?: string } | { status: "error"; kind: "no-home" | "no-node" | "no-pine" | "ssh" | "failed"; message: string; host?: string };

export interface Prefs {
	home?: string;
	keepRunning: boolean;
	/** Other machines whose pine the app can use, each a host for ssh. */
	hosts: string[];
	/** The one the app uses; none: this computer's pine. */
	use?: string;
	notify: boolean;
	updates: boolean;
	/** The theme the window was last drawn in (theme.ts), so that it opens in it; none: pmndre. */
	look?: Look;
	/** While a coloured agent's conversation is in front, the window's accent is its colour (on unless false). */
	agentAccent: boolean;
}

export type { Update } from "../electron/updates.ts";

/** What the bridge's `state()` answers when the page starts. */
export interface AppState {
	state: ServiceState;
	/** Whether the event stream is up. */
	connected?: boolean;
	home?: string;
	prefs: Prefs;
	platform: string;
	focused: boolean;
	/** Whether this app asks for a newer one at all. */
	updates: boolean;
	versions: { app: string; electron: string };
	/**
	 * Whether there is a "this computer" whose pine the app can use. Set to false by a bridge that
	 * only reaches other machines (the mobile app's): the page then offers no local machine and
	 * never asks `use()` for one. The desktop app and the preview leave it out, which means there is.
	 */
	local?: boolean;
}

/**
 * The bridge as the page sees it: the preload script's, or a stand-in of the same shape (the
 * preview's, the mobile app's).
 */
export type PageBridge = Omit<Bridge, "state"> & {
	state: () => Promise<AppState>;
	/**
	 * Where the daemon's pictures, video and sound are fetched from, set by a bridge whose page
	 * fetches them from another address than the app's scheme (the mobile app's, on its own origin).
	 * The desktop app and the preview leave it out.
	 */
	mediaBase?: string;
};

export const bridge = window.pine;

/** Where the daemon's pictures, video and sound are fetched from: what the bridge says, else the app's scheme, or in the preview its server's path. */
// (Asked by its type: Storybook's stand-in answers every name with a function.)
export const MEDIA_BASE = typeof bridge.mediaBase === "string" ? bridge.mediaBase : import.meta.env.DEV && __PINE_PREVIEW__ ? "/__pine/media" : "pine-media://daemon";
