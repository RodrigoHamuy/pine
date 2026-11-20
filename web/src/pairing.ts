// A paired Mac, as the web bridge knows it: its machine id (the fingerprint of the Mac's host key),
// the pairing link the Pine app's QR code carries, and the pairing request the Mac's access server
// answers. The link's fragment is the one place a host key comes from without the owner's press on
// "Trust this key": the owner scanned it at the Mac, which is what makes it the Mac's.
import { base64, type Channel, type Connection } from "./ssh.ts";

/** How a paired Mac is written among the machines: `mac:` and its machine id. */
export const MAC = "mac:";
/** A machine id: SHA-256 of the Mac's SSH public key blob, base64url without padding. */
const MACHINE_ID = /^[A-Za-z0-9_-]{43}$/;
/** A pairing code: 16 random bytes, base64url without padding. */
const PAIR_CODE = /^[A-Za-z0-9_-]{22}$/;
/** The SSH user of a paired browser's session, and of a pairing session (`pair.<code>`). */
export const PAIRED_USER = "pine";
export const pairUser = (code: string) => `pair.${code}`;

export type PairLink = { id: string; code: string };

/** Whether a machine is a paired Mac (`mac:<machine id>`), not `user@host`. */
export const isMac = (host: string) => host.startsWith(MAC) && MACHINE_ID.test(host.slice(MAC.length));

/** The host key fingerprint a machine id stands for, as OpenSSH prints it (`SHA256:` and base64). */
export const macFingerprint = (id: string) => `SHA256:${id.replace(/-/g, "+").replace(/_/g, "/")}`;

/**
 * The pairing link in `address`'s fragment (`#pair=<machine id>.<code>`), taken out of the address
 * at once with `replace` (history.replaceState), so that the code is in no address the browser
 * keeps, malformed or not. A malformed one is ignored, with a message for the console.
 */
export function takePairLink(address: { href: string; hash: string }, replace: (url: string) => void): { link?: PairLink; problem?: string } {
	if (!address.hash.startsWith("#pair=")) return {};
	replace(address.href.slice(0, address.href.indexOf("#")));
	const [id, code, ...more] = address.hash.slice("#pair=".length).split(".");
	if (more.length || !MACHINE_ID.test(id ?? "") || !PAIR_CODE.test(code ?? "")) return { problem: "That pairing link is not one this page can read: it was ignored. Open Pine on the Mac and add this device again." };
	return { link: { id, code } };
}

/** A name to be shown as text: no control characters, at most 60 characters. */
export const cleanName = (name: string) => name.replace(/[\0-\x1f\x7f-\x9f]/g, "").trim().slice(0, 60);

/** This browser's name for the Mac to show: the browser and the system, from the user agent ("Chrome on Android"). */
export function deviceName(userAgent: string): string {
	const browser = [
		[/Edg(A|iOS)?\//, "Edge"],
		[/OPR\/|Opera/, "Opera"],
		[/Firefox\/|FxiOS\//, "Firefox"],
		[/Chrome\/|CriOS\//, "Chrome"],
		[/Version\/[\d.]+.*Safari\//, "Safari"],
	].find(([pattern]) => (pattern as RegExp).test(userAgent))?.[1];
	const system = [
		[/Android/, "Android"],
		[/iPhone/, "iPhone"],
		[/iPad/, "iPad"],
		[/CrOS/, "ChromeOS"],
		[/Macintosh|Mac OS X/, "Mac"],
		[/Windows/, "Windows"],
		[/Linux/, "Linux"],
	].find(([pattern]) => (pattern as RegExp).test(userAgent))?.[1];
	if (!browser || !system) return "A web browser";
	return cleanName(`${browser} on ${system}`);
}

/** The pairing request: `pine-pair` and the base64url of `{"name": ...}`. */
export function pairCommand(name: string): string {
	const json = new TextEncoder().encode(JSON.stringify({ name: cleanName(name) }));
	return `pine-pair ${base64(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export type PairAnswer = { ok: true; name: string } | { ok: false; reason: "refused" | "expired" };

/**
 * Runs the pairing request on a pairing session and waits for the owner's answer at the Mac.
 * `onCode` is told the four digits the Mac shows beside this browser's name. A channel that ends
 * without an answer counts as expired.
 */
export async function askToPair(connection: Connection, name: string, onCode: (code: string) => void): Promise<PairAnswer> {
	const channel: Channel = await connection.exec(pairCommand(name));
	return new Promise<PairAnswer>((resolve) => {
		let text = "";
		const decoder = new TextDecoder();
		channel.onData((bytes) => {
			text += decoder.decode(bytes, { stream: true });
			for (let end = text.indexOf("\n"); end >= 0; end = text.indexOf("\n")) {
				const line = text.slice(0, end);
				text = text.slice(end + 1);
				let said: { code?: unknown; ok?: unknown; name?: unknown; reason?: unknown };
				try {
					said = JSON.parse(line);
				} catch {
					continue;
				}
				if (typeof said.code === "string" && /^\d{4}$/.test(said.code)) onCode(said.code);
				else if (said.ok === true) resolve({ ok: true, name: cleanName(typeof said.name === "string" ? said.name : "") || "Mac" });
				else if (said.ok === false) resolve({ ok: false, reason: said.reason === "refused" ? "refused" : "expired" });
			}
		});
		void channel.closed.then(() => resolve({ ok: false, reason: "expired" }));
	});
}
