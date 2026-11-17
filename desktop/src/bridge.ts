// What the page has of the world outside itself: the bridge the preload script exposes.
import type { Bridge } from "../electron/preload.ts";

declare global {
	interface Window {
		pine: Bridge;
	}
}

export type ServiceState = { status: "starting" } | { status: "ready"; mode: string; started: boolean; home: string; version?: string; from: string } | { status: "error"; kind: "no-home" | "no-node" | "no-pine" | "failed"; message: string };

export interface Prefs {
	home?: string;
	keepRunning: boolean;
	theme: "system" | "light" | "dark";
	notify: boolean;
	updates: boolean;
}

export type { Update } from "../electron/updates.ts";

export const bridge = window.pine;
