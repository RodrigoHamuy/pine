// What the web bridge does over its SSH connection: run `pine service` and read its line, and
// speak HTTP/1.1 to the daemon through a direct-tcpip channel to the machine's own loopback, the
// way desktop/electron/daemon.ts speaks to it through ssh's forward. A browser has no socket of
// its own, so the few parts of HTTP the control API uses are written here.
import { daemonPath } from "./protocol.ts";
import { base64, concat, type Channel, type Connection } from "./ssh.ts";

const text = new TextDecoder();
const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s);
const CRLF = bytes("\r\n");
const CRLFCRLF = bytes("\r\n\r\n");

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
	outer: for (let i = from; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
		return i;
	}
	return -1;
}

/** Why `pine service` gave no line: the channel ended (with its status) or what it printed is not JSON. */
export class ServiceTrouble extends Error {
	readonly exitStatus?: number;
	readonly stderr: string;
	constructor(message: string, stderr: string, exitStatus?: number) {
		super(message);
		this.exitStatus = exitStatus;
		this.stderr = stderr;
	}
}

/**
 * Runs `command` (pine service) and reads its one line of JSON. The channel stays open: what it
 * holds by its stdin (a daemon it started) lives until the channel or the connection ends.
 */
export async function runService(connection: Connection, command: string, ms = 60_000): Promise<{ said: any; channel: Channel }> {
	const channel = await connection.exec(command);
	let out = "";
	let err = "";
	channel.onStderr((b) => (err = (err + text.decode(b)).slice(-4000)));
	return new Promise((resolve, reject) => {
		let settled = false;
		const done = (f: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			f();
		};
		const timer = setTimeout(() => done(() => (void channel.close().catch(() => {}), reject(new ServiceTrouble("timeout", err)))), ms);
		channel.onData((b) => {
			out += text.decode(b);
			const end = out.indexOf("\n");
			if (end < 0) return;
			done(() => {
				try {
					resolve({ said: JSON.parse(out.slice(0, end)), channel });
				} catch {
					void channel.close().catch(() => {});
					reject(new ServiceTrouble(`answered with something that is not pine's service line: ${out.slice(0, 200)}`, err));
				}
			});
		});
		// Settles after any output that came with it was handed on.
		void channel.closed.then((c) => setTimeout(() => done(() => reject(new ServiceTrouble("ended", err, c.exitStatus))), 20));
	});
}

/** Where the daemon answers, from the service line: a port of the machine's own loopback, or nothing is connected to. */
export function loopbackEnd(base: unknown): { host: string; port: number } {
	let url: URL;
	try {
		url = new URL(String(base));
	} catch {
		throw new Error(`The other machine's pine named no address it answers at: ${String(base).slice(0, 80)}`);
	}
	const port = Number(url.port);
	const host = url.hostname === "[::1]" ? "::1" : /^127(\.\d{1,3}){3}$/.test(url.hostname) ? url.hostname : undefined;
	if (url.protocol !== "http:" || url.username || url.password || !host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`The other machine's pine says it answers at ${String(base).slice(0, 80)}, which is not a port of its own loopback. Only that is connected to.`);
	return { host, port };
}

export type Head = { status: number; headers: Record<string, string> };

/**
 * One HTTP request over a channel: the head comes to `onHead`, the body's bytes to `onBody` as they
 * arrive (chunked or not). Settles when the body has ended or the channel closed.
 */
export async function exchange(
	channel: Channel,
	request: { method: string; path: string; host: string; headers: Record<string, string>; body?: Uint8Array },
	onHead: (head: Head) => void,
	onBody: (data: Uint8Array) => void,
): Promise<void> {
	const lines = [`${request.method} ${request.path} HTTP/1.1`, `Host: ${request.host}`, "Connection: close"];
	for (const [k, v] of Object.entries(request.headers)) lines.push(`${k}: ${v}`);
	if (request.body) lines.push(`Content-Length: ${request.body.length}`);
	let buf: Uint8Array = new Uint8Array(0);
	let head: Head | undefined;
	let chunked = false;
	let left = Infinity;
	let finished = false;
	return new Promise((resolve, reject) => {
		const finish = () => {
			if (finished) return;
			finished = true;
			void channel.close().catch(() => {});
			resolve();
		};
		// A chunked body: size lines and chunks, until the chunk of size 0.
		const chunks = () => {
			for (;;) {
				const eol = indexOf(buf, CRLF);
				if (eol < 0) return;
				const size = parseInt(text.decode(buf.subarray(0, eol)), 16);
				if (!Number.isFinite(size)) return reject(new Error("a chunk of the answer could not be read"));
				if (size === 0) return finish();
				if (buf.length < eol + 2 + size + 2) return;
				onBody(buf.slice(eol + 2, eol + 2 + size));
				buf = buf.slice(eol + 2 + size + 2);
			}
		};
		channel.onData((data) => {
			if (finished) return;
			buf = concat(buf, data);
			if (!head) {
				const end = indexOf(buf, CRLFCRLF);
				if (end < 0) return;
				const [status, ...fields] = text.decode(buf.subarray(0, end)).split("\r\n");
				const headers: Record<string, string> = {};
				for (const f of fields) {
					const at = f.indexOf(":");
					if (at > 0) headers[f.slice(0, at).trim().toLowerCase()] = f.slice(at + 1).trim();
				}
				head = { status: Number(status.split(" ")[1]), headers };
				chunked = /chunked/i.test(headers["transfer-encoding"] ?? "");
				if (!chunked && headers["content-length"] !== undefined) left = Number(headers["content-length"]);
				buf = buf.slice(end + 4);
				try {
					onHead(head);
				} catch (e) {
					finished = true;
					void channel.close().catch(() => {});
					return reject(e);
				}
			}
			if (chunked) return chunks();
			if (buf.length) {
				const take = buf.subarray(0, Math.min(buf.length, left));
				left -= take.length;
				onBody(take.slice());
				buf = new Uint8Array(0);
			}
			if (left <= 0) finish();
		});
		void channel.closed.then(() => {
			if (finished) return;
			if (!head) return reject(new Error("the daemon closed the connection without an answer"));
			finish();
		});
		void channel.send(concat(bytes(`${lines.join("\r\n")}\r\n\r\n`), request.body ?? new Uint8Array(0))).catch(reject);
	});
}

/** Where a daemon answers through the tunnel, and its token. */
export type Daemon = { connection: Connection; host: string; port: number; token: string };

const hostHeader = (d: Daemon) => (d.host.includes(":") ? `[${d.host}]:${d.port}` : `${d.host}:${d.port}`);

/** One call of the control API in the owner's name, answered as desktop/electron/daemon.ts's `callDaemon` answers. */
export async function callDaemon(daemon: Daemon | undefined, method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
	if (!daemon) return { ok: false, status: 503, data: { error: "pine is not running yet" } };
	if ((method !== "GET" && method !== "POST") || typeof url !== "string" || !daemonPath(url)) return { ok: false, status: 400, data: { error: "not a call of the control API" } };
	try {
		const channel = await daemon.connection.forward(daemon.host, daemon.port);
		let head: Head | undefined;
		const parts: Uint8Array[] = [];
		await exchange(
			channel,
			{ method, path: url, host: hostHeader(daemon), headers: { Authorization: `Bearer ${daemon.token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? bytes(JSON.stringify(body)) : undefined },
			(h) => (head = h),
			(b) => parts.push(b),
		);
		const got = concat(...parts);
		const status = head!.status;
		const ok = status >= 200 && status < 300;
		const type = head!.headers["content-type"] ?? "";
		if (type.startsWith("application/json")) {
			let data: unknown = {};
			try {
				data = JSON.parse(text.decode(got));
			} catch {}
			return { ok, status, data };
		}
		return { ok, status, data: { mime: type, base64: base64(got) } };
	} catch (e) {
		return { ok: false, status: 0, data: { error: `pine does not answer (${e instanceof Error ? e.message : e})` } };
	}
}

/** The most of one picture, video or sound the bridge holds for the page: it is handed over whole, not streamed. */
export const MEDIA_MAX = 256 * 1024 * 1024;

/** Why a media request is not answered with bytes, in the words of the desktop's statuses (404, 415). */
export class MediaRefused extends Error {}

/**
 * One of the daemon's pictures, videos or sounds, by its path and query (checked against `MEDIA`
 * by the caller), as desktop/electron/daemon.ts's `mediaFromDaemon` answers: only what is drawn or
 * played, never a drawing, which can carry scripts.
 */
export async function mediaOf(daemon: Daemon, target: string, max = MEDIA_MAX): Promise<{ type: string; bytes: Uint8Array }> {
	let type = "";
	const parts: Uint8Array[] = [];
	let size = 0;
	let tooLarge = false;
	const channel = await daemon.connection.forward(daemon.host, daemon.port);
	await exchange(
		channel,
		{ method: "GET", path: target, host: hostHeader(daemon), headers: { Authorization: `Bearer ${daemon.token}` } },
		(head) => {
			type = head.headers["content-type"] ?? "";
			if (head.status < 200 || head.status > 299) throw new MediaRefused("not found");
			if (!/^(image|video|audio)\//.test(type) || type.startsWith("image/svg")) throw new MediaRefused("not shown: it is not a picture, a video or a sound");
		},
		(data) => {
			size += data.length;
			if (size > max) {
				tooLarge = true;
				void channel.close().catch(() => {});
				return;
			}
			parts.push(data);
		},
	);
	if (tooLarge) throw new MediaRefused(`not shown: it is larger than ${Math.round(max / 1024 / 1024)} MB`);
	const bytes = new Uint8Array(size);
	let at = 0;
	for (const part of parts) {
		bytes.set(part, at);
		at += part.length;
	}
	return { type, bytes };
}

/**
 * The daemon's live events, read until `signal` aborts and handed on in small batches, as
 * desktop/electron/daemon.ts's `followEvents` does: a lost stream is opened again a second later,
 * unless `lost`, told how many losses in a row there were, says the caller does something else.
 */
export function followEvents(daemon: Daemon, signal: AbortSignal, on: { batch(events: unknown[]): void; connection(up: boolean): void; lost?(times: number): boolean }): void {
	let batch: unknown[] = [];
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		timer = undefined;
		if (batch.length && !signal.aborted) on.batch(batch);
		batch = [];
	};
	const loop = async () => {
		let down = 0;
		// One listener for the whole loop: it closes the stream open at the time, if any.
		let open: Channel | undefined;
		signal.addEventListener("abort", () => void open?.close().catch(() => {}), { once: true });
		while (!signal.aborted) {
			try {
				const channel = (open = await daemon.connection.forward(daemon.host, daemon.port));
				if (signal.aborted) void channel.close().catch(() => {});
				let buf = "";
				const decoder = new TextDecoder();
				await exchange(
					channel,
					{ method: "GET", path: "/events/stream?topic=%23", host: hostHeader(daemon), headers: { Authorization: `Bearer ${daemon.token}` } },
					(head) => {
						if (head.status !== 200) throw new Error(`HTTP ${head.status}`);
						down = 0;
						if (!signal.aborted) on.connection(true);
					},
					(data) => {
						buf += decoder.decode(data, { stream: true });
						for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
							const block = buf.slice(0, i);
							buf = buf.slice(i + 2);
							if (!block.startsWith("data: ")) continue;
							try {
								batch.push(JSON.parse(block.slice(6)));
								timer ??= setTimeout(flush, 24);
							} catch {
								// A malformed frame is skipped; the stream goes on.
							}
						}
					},
				);
			} catch {
				// fall through to the retry
			}
			open = undefined;
			if (signal.aborted) return;
			on.connection(false);
			if (on.lost?.(++down)) return;
			await new Promise((r) => setTimeout(r, 1000));
		}
	};
	void loop();
}
