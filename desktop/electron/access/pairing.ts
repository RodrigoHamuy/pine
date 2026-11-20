// Pairing: how a new key gets onto the access server's list. The owner opens a pairing at the Mac
// and gets a link that carries this Mac's machine id and a one-time code. A browser that connects
// with that code under the user name `pair.<code>` may run one command, the pairing request, which
// names the device. It is shown four digits, the owner is asked with the device's name and the same
// digits, and only the owner's yes stores the key. No Electron here: the owner's question is a
// function the caller hands in (a dialog in the app, a direct answer in the tests).
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import os from "node:os";
import type { ServerChannel } from "ssh2";
import { type Admission, type Admit, type Key, pairedKeys } from "./server.ts";
import { type AccessStore, cleanName, type Device } from "./store.ts";

/** How long a pairing's code works, from the moment it is opened. */
export const PAIRING_MS = 2 * 60_000;
/** How long a pairing request waits for the owner's answer. */
export const ANSWER_MS = 2 * 60_000;
/** Wrong codes that close a pairing. */
export const WRONG_CODES = 5;
/** The user name prefix of a pairing session; a paired session is `pine`. */
export const PAIR_USER = "pair.";
/** The command of the pairing request: this word, a space, and base64url of `{"name": string}`. */
export const PAIR_COMMAND = "pine-pair";
/** The name of a device that gave none that can be shown. */
export const NO_NAME = "Unnamed device";
/** The prefix of the id a pairing session has in the access server's reports and for `cut`. */
export const PAIRING_ID = "pairing:";

/** Why a request did not end in a pairing: the owner said no, time ran out, the device left, the owner closed the pairing. */
export type Ended = "refused" | "expired" | "closed" | "cancelled";

/** What the owner is asked about: the device's name as plain text, and the four digits its screen shows. */
export interface PairingRequest {
	name: string;
	code: string;
}

/**
 * The owner's decision: true allows the device. `signal` is aborted when the question no longer
 * stands, with the reason (`Ended`) as `signal.reason`, so that a dialog can close and say why.
 */
export type Ask = (request: PairingRequest, signal: AbortSignal) => Promise<boolean>;

export interface PairingOptions {
	store: AccessStore;
	/** The address of the web client and the meeting service: the link's origin. */
	service: string;
	ask: Ask;
	/** Ends the access server's sessions of an id (`AccessServer.cut`): closes a pairing's session when it is cancelled. */
	cut: (id: string) => void;
	/** The name the browser stores for this Mac. */
	computerName?: () => string;
	/** A device was paired (the app's notification). */
	paired?: (device: Device) => void;
	pairingMs?: number;
	answerMs?: number;
}

/** An open pairing, as the settings show it: the link (the QR code encodes it) and when it stops working. */
export interface Opened {
	link: string;
	expires: Date;
}

export interface Pairing {
	/** Opens a pairing, closing the one that was open. */
	open(): Opened;
	/** Closes the open pairing: its code stops working, a question to the owner is withdrawn and its session is closed. */
	cancel(): void;
	/** The open pairing whose code still works. */
	current(): Opened | undefined;
	/** The access server's decision: paired keys as `pine`, and an unknown key with the open pairing's code. */
	admit: Admit;
}

interface Open {
	opened: Opened;
	/** The SHA-256 of the code: compared in constant time, and of the same length whatever a client sends. */
	digest: Buffer;
	/** Wrong codes so far. */
	wrong: number;
	/** The code was presented: the pairing is used, and this is its session. */
	session?: string;
	/** The pairing request was made (one per pairing). */
	asked?: boolean;
	/** The owner answered: nothing is withdrawn after that. */
	decided?: boolean;
	/** Withdraws the question to the owner. */
	abort: AbortController;
	timer: ReturnType<typeof setTimeout>;
}

const digestOf = (code: string) => createHash("sha256").update(code, "utf8").digest();

/** The longest pairing request read: a name of 60 characters needs far less. */
const MAX_REQUEST = 4096;

/** The device's name from a pairing request, or undefined when it is no request. */
function requested(command: string): string | undefined {
	if (command.length > MAX_REQUEST || !command.startsWith(`${PAIR_COMMAND} `)) return undefined;
	const body = command.slice(PAIR_COMMAND.length + 1);
	if (!/^[A-Za-z0-9_-]+$/.test(body)) return undefined;
	try {
		const said = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
		if (typeof said?.name !== "string") return undefined;
		return cleanName(said.name) || NO_NAME;
	} catch {
		return undefined;
	}
}

export function createPairing(options: PairingOptions): Pairing {
	const pairingMs = options.pairingMs ?? PAIRING_MS;
	const answerMs = options.answerMs ?? ANSWER_MS;
	const computerName = options.computerName ?? (() => os.hostname());
	const paired = pairedKeys(options.store);
	let open: Open | undefined;

	const close = (which: Open, why: Ended) => {
		clearTimeout(which.timer);
		if (open === which) open = undefined;
		if (!which.decided) {
			which.decided = true;
			which.abort.abort(why);
		}
		// A session that made its request is told why on its channel first, and cut when that channel closes.
		if (which.session && (why === "cancelled" || why === "closed" || !which.asked)) options.cut(which.session);
	};

	/** The pairing request on the pairing's one session: four digits, the owner's answer, and the key stored or not. */
	function request(which: Open, key: Key, command: string, accept: () => ServerChannel): boolean {
		const name = requested(command);
		// One request per pairing: a second exec on the same session is refused.
		if (name === undefined || which.abort.signal.aborted || which.asked) return false;
		which.asked = true;
		const channel = accept();
		const code = String(randomInt(0, 10_000)).padStart(4, "0");
		const signal = which.abort.signal;
		const finish = (ok: boolean, line: object) => {
			if (channel.destroyed) return;
			channel.write(`${JSON.stringify(line)}\n`);
			channel.exit(ok ? 0 : 1);
			channel.end();
		};
		channel.on("error", () => {});
		channel.on("data", () => {});
		channel.once("close", () => close(which, "closed"));
		clearTimeout(which.timer);
		which.timer = setTimeout(() => close(which, "expired"), answerMs);
		channel.write(`${JSON.stringify({ code })}\n`);

		const withdrawn = new Promise<false>((resolve) => signal.addEventListener("abort", () => resolve(false), { once: true }));
		Promise.race([Promise.resolve().then(() => options.ask({ name, code }, signal)), withdrawn])
			.then(async (yes) => {
				if (!signal.aborted) which.decided = true;
				if (signal.aborted) return finish(false, { ok: false, reason: signal.reason === "expired" ? "expired" : "refused" });
				if (yes !== true) {
					finish(false, { ok: false, reason: "refused" });
					return close(which, "refused");
				}
				clearTimeout(which.timer);
				const device = await options.store.add({ key: key.data, name });
				finish(true, { ok: true, name: computerName() });
				if (open === which) open = undefined;
				options.paired?.(device);
			})
			.catch(() => {
				which.decided = true;
				finish(false, { ok: false, reason: "refused" });
				close(which, "refused");
			});
		return true;
	}

	const admit: Admit = (user, key) => {
		if (!user.startsWith(PAIR_USER)) return paired(user, key);
		const which = open;
		// A wrong code, or a code with no pairing open, closes the connection.
		if (!which || which.session || Date.now() >= which.opened.expires.getTime()) return false;
		if (!timingSafeEqual(digestOf(user.slice(PAIR_USER.length)), which.digest)) {
			if (++which.wrong >= WRONG_CODES) close(which, "cancelled");
			return false;
		}
		// The first connection that presents the code consumes it.
		which.session = `${PAIRING_ID}${randomBytes(9).toString("base64url")}`;
		const admission: Admission = { id: which.session, pine: false, exec: (command, accept) => request(which, key, command, accept) };
		return admission;
	};

	return {
		open() {
			if (open) close(open, "cancelled");
			const code = randomBytes(16).toString("base64url");
			const opened = { link: `${options.service.replace(/\/+$/, "")}/#pair=${options.store.machineId()}.${code}`, expires: new Date(Date.now() + pairingMs) };
			const which: Open = { opened, digest: digestOf(code), wrong: 0, abort: new AbortController(), timer: setTimeout(() => close(which, "expired"), pairingMs) };
			open = which;
			return { ...opened };
		},
		cancel() {
			if (open) close(open, "cancelled");
		},
		current() {
			if (!open || open.session || Date.now() >= open.opened.expires.getTime()) return undefined;
			return { ...open.opened };
		},
		admit,
	};
}
