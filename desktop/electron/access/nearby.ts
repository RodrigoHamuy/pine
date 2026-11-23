// Being found on the local network (ADR 0005): while browser access and "Visible on this network"
// are on, the app announces this computer with Bonjour (mDNS, DNS-SD), so that the Pine app on a phone
// lists it and can ask to pair without a code. The record says only "this machine id waits at this
// meeting service": no name of the computer's, no address to connect to. There is no server behind it:
// the phone still joins the machine's meeting room through the service, as with a pairing link, and
// checks the host key against the machine id. So an announcement proves nothing, and the four
// digits shown on both screens are what the owner compares.
//
// Pure JavaScript (`bonjour-service`), one code for macOS, Windows and Linux. No Electron here, so
// that a test hands in a stand-in for the library.
import { Bonjour } from "bonjour-service";
import type { Announcement } from "./control.ts";

/** The service type: `_pine._tcp`. */
export const NEARBY_TYPE = "pine";
/**
 * The instance name: "Pine" and the start of the machine id, never the computer's own name. The id's
 * start keeps two computers on one network apart: the library does not rename a name already in use,
 * it gives up announcing.
 */
export const nearbyName = (id: string) => `Pine ${id.slice(0, 8)}`;
/**
 * The port the record names. Nothing listens there and nothing connects to it: DNS-SD requires a port,
 * and 9 is the "discard" port, which says as much. A phone reads the TXT record and nothing else.
 */
export const NEARBY_PORT = 9;
/** The version of what the record says, so that a phone can skip a record it would misread. */
export const NEARBY_VERSION = "1";

/** The TXT record of an announcement: the version, the machine id and the meeting service's origin. */
export const txtOf = (what: Announcement): Record<string, string> => ({ v: NEARBY_VERSION, id: what.id, service: what.service });

/** What the announcer needs of the library: publish one service, and stop everything. */
export interface Mdns {
	publish(config: { name: string; type: string; port: number; protocol: "tcp"; txt: Record<string, string>; disableIPv6?: boolean }): unknown;
	destroy(callback?: () => void): void;
}

/**
 * Announces what it is told, and stops with none. A socket the library cannot open (port 5353 held by
 * another program, a firewall) is no failure of the app's: the code and the link pair without it. The library (and its multicast socket) exists only
 * while something is announced: nothing listens on port 5353 while visibility is off.
 */
export function createAnnouncer(make: () => Mdns = () => new Bonjour({}, () => {}) as unknown as Mdns): { announce(what: Announcement | undefined): void; stop(): void } {
	let mdns: Mdns | undefined;
	const stop = () => {
		const was = mdns;
		mdns = undefined;
		try {
			// Destroying unpublishes first: the phones hear a goodbye and drop the computer from their list.
			was?.destroy();
		} catch {
			// a socket that is already gone
		}
	};
	return {
		announce(what) {
			stop();
			if (!what) return;
			mdns = make();
			mdns.publish({ name: nearbyName(what.id), type: NEARBY_TYPE, port: NEARBY_PORT, protocol: "tcp", txt: txtOf(what) });
		},
		stop,
	};
}

/**
 * Whether an address the system handed the app is `pine://pair`, the web client's "Open Pine on this
 * computer": exactly that, with or without a slash. Anything else under `pine:` (the mobile app's
 * `pine://pair?service=...` among them) is not the desktop app's, and is ignored.
 */
export function isPairAddress(url: string): boolean {
	return /^pine:\/\/pair\/?$/i.test(url.trim());
}
