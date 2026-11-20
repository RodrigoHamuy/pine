// What the page draws of the machines it can use, read from the states and preferences a bridge
// hands it: a Mac paired with the web client by its name (its id is a fingerprint, which says
// nothing to the owner), a pairing under way on the first screen, how a pairing ended, and where
// the suggestion to add the web client to the home screen is worth making. Nothing here reads
// the window or the bridge, so that the web client's tests drive it with the states its bridge says.
import type { ServiceState } from "./bridge.ts";

/** How a Mac paired by its link is named among the machines: `mac:` and its machine id (the web client's). */
const PAIRED = "mac:";

/** Whether a machine of the list is a Mac paired by its link, rather than a user@host one. */
export const isPaired = (host: string): boolean => host.startsWith(PAIRED);

/** The name the owner sees for a machine: the one kept for it; else for a paired Mac "your Mac", for user@host the host as written. Never a machine id. */
export function machineName(host: string, names?: Record<string, string>): string {
	return names?.[host] ?? (isPaired(host) ? "your Mac" : host);
}

/** Where the Pine app is downloaded, for a browser that is to pair with a Mac that does not have it yet. */
export const APP_DOWNLOAD = "https://github.com/pmndre/pine/releases/latest";

/** The first screen during a pairing: what it says, and the four digits once the Mac showed them. None: no pairing under way. */
export function firstScreen(state: ServiceState): { title: string; about: string; code?: string } | undefined {
	if (state.status !== "starting" || !state.pairing) return undefined;
	const { code, name } = state.pairing;
	if (!code) return { title: "Pairing with your Mac", about: "Reaching your Mac through the link of its code…" };
	return { title: "Confirm on your Mac", about: `Your Mac asks whether ${name ? `"${name}"` : "this browser"} may connect. Press Allow there if it shows ${code}, the same digits as here.`, code };
}

/**
 * How a pairing ended, from the state before and the one after: "paired" when the Mac said yes
 * and the bridge goes on to reach it, "failed" when the bridge says why with no machine named
 * (refused, expired, used, not reached). None: no pairing ended.
 */
export function pairingEnded(before: ServiceState, after: ServiceState): "paired" | "failed" | undefined {
	if (before.status !== "starting" || !before.pairing) return undefined;
	if (after.status === "starting" && after.pairing) return undefined;
	if (after.host) return "paired";
	if (after.status === "error") return "failed";
	return undefined;
}

/**
 * Whether a web app added to the home screen keeps this browser's data, and so the key the Mac
 * knows it by: on Android, where it shares the browser's storage. Not on iOS and iPadOS, where
 * an app on the home screen has storage of its own and would have to be paired again (iPadOS
 * says it is a Mac: told apart by its touch points). Not on a computer, which has no home screen.
 */
export function homeScreenKeeps(userAgent: string, touchPoints = 0): boolean {
	if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return false;
	return /Android/.test(userAgent);
}
