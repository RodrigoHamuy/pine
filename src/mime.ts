import fs from "node:fs";
import path from "node:path";
import { pageText } from "./watching.ts";

// An e-mail message read into what an agent can use: who it says it is from, its subject, its text
// as a reader sees it, and the files that came with it. What the `mail` and `smtp` sources share.
// A message is outside content from the first byte to the last: nothing here trusts a header, a
// length or a name, and every loop has an end that the message cannot move.

export interface MailLimits {
	/** How many parts of a message are looked at; the rest is left out. */
	parts?: number;
	/** How deep parts may lie inside parts. */
	depth?: number;
	/** How many characters of text are kept. */
	text?: number;
	/** The largest attachment that is kept, in bytes. A larger one is named, without its bytes. */
	attachmentBytes?: number;
	/** How many attachments are kept. */
	attachments?: number;
}

export interface MailFile {
	/** A plain file name: no folders, no control characters. */
	name: string;
	type: string;
	size: number;
	/** What it holds; empty for one that was larger than the limit (`skipped`). */
	bytes: Buffer;
	skipped?: boolean;
}

export interface Mail {
	/** The address the message says it is from. Anyone can write any address there. */
	from: string;
	fromName?: string;
	to: string[];
	cc?: string[];
	subject: string;
	/** When it says it was written, as an ISO time. */
	date?: string;
	messageId?: string;
	text: string;
	attachments: MailFile[];
}

const HEADER_BYTES = 256 * 1024;
const HEADER_VALUE = 2000;

/** Bytes in a character set a message names. One that nobody knows is read byte by byte. */
export function decodeText(bytes: Buffer, charset?: string): string {
	const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
	try {
		return new TextDecoder(label === "us-ascii" || label === "ascii" ? "utf-8" : label).decode(bytes);
	} catch {
		return bytes.toString("latin1");
	}
}

/** Quoted-printable, on text that holds one byte per character. */
function unquote(text: string, header = false): Buffer {
	const s = header ? text.replace(/_/g, " ") : text.replace(/[ \t]+(\r?\n)/g, "$1").replace(/=\r?\n/g, "");
	const out = Buffer.allocUnsafe(s.length);
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 61 && i + 2 < s.length && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
			out[n++] = Number.parseInt(s.slice(i + 1, i + 3), 16);
			i += 2;
		} else out[n++] = c & 255;
	}
	return out.subarray(0, n);
}

/** A header value as it was meant: "=?utf-8?B?...?=" words decoded, raw UTF-8 read as such. */
export function decodeWords(value: string): string {
	let v = value;
	// Bytes above 127 in a header are UTF-8 where they can be.
	if (/[\x80-\xff]/.test(v)) {
		const utf = Buffer.from(v, "latin1").toString("utf8");
		if (!utf.includes("�")) v = utf;
	}
	return v
		.replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)/g, "$1")
		.replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_all, charset: string, kind: string, text: string) => decodeText(kind.toLowerCase() === "b" ? Buffer.from(text, "base64") : unquote(text, true), charset.split("*")[0]));
}

/** One line of a header as a person reads it: no line breaks, no control characters, a sensible length. */
const tidy = (s: string, max = HEADER_VALUE) => {
	const t = s.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, max)}…` : t;
};

/** The addresses in a header such as To: or From:, with the names beside them. */
export function addresses(value: string | undefined): Array<{ address: string; name?: string }> {
	if (!value) return [];
	const out: Array<{ address: string; name?: string }> = [];
	// Commas separate, except inside quotes, angle brackets and comments.
	const items: string[] = [];
	let depth = 0;
	let quoted = false;
	let start = 0;
	const v = value.slice(0, 20_000);
	for (let i = 0; i < v.length; i++) {
		const c = v[i];
		if (c === "\\" && quoted) i++;
		else if (c === '"') quoted = !quoted;
		else if (!quoted && (c === "<" || c === "(")) depth++;
		else if (!quoted && (c === ">" || c === ")")) depth = Math.max(0, depth - 1);
		else if (!quoted && depth === 0 && (c === "," || c === ";")) {
			items.push(v.slice(start, i));
			start = i + 1;
		}
	}
	items.push(v.slice(start));
	for (const item of items.slice(0, 100)) {
		const angle = /<([^<>\s]*)>/.exec(item);
		const bare = /[^\s<>()",:;]+@[^\s<>()",:;]+/.exec(item.replace(/"(?:[^"\\]|\\.)*"/g, " "));
		const address = (angle?.[1] || bare?.[0] || "").trim().toLowerCase();
		if (!address) continue;
		const comment = /\(([^()]*)\)/.exec(item);
		const name = tidy(decodeWords(angle ? item.slice(0, angle.index).replace(/^\s*"|"\s*$/g, "").replace(/\\(.)/g, "$1") : (comment?.[1] ?? "")), 200);
		out.push({ address: tidy(address, 320), ...(name && name.toLowerCase() !== address ? { name } : {}) });
	}
	return out;
}

interface Headers {
	get(name: string): string | undefined;
}

/** The header block of a message or a part, unfolded, by lowercase name. The first of a name counts. */
function headersOf(block: string): Headers {
	const map = new Map<string, string>();
	const lines = block.slice(0, HEADER_BYTES).replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/);
	for (const line of lines.slice(0, 500)) {
		const i = line.indexOf(":");
		if (i < 1) continue;
		const name = line.slice(0, i).trim().toLowerCase();
		if (!map.has(name)) map.set(name, line.slice(i + 1).trim());
	}
	return { get: (name) => map.get(name) };
}

/** "text/plain; charset=utf-8; name*=utf-8''a%20b" → the value and its parameters. */
export function headerParams(value: string | undefined): { value: string; params: Record<string, string> } {
	const params: Record<string, string> = {};
	if (!value) return { value: "", params };
	const parts: string[] = [];
	let quoted = false;
	let start = 0;
	const v = value.slice(0, 8000);
	for (let i = 0; i < v.length; i++) {
		if (v[i] === "\\" && quoted) i++;
		else if (v[i] === '"') quoted = !quoted;
		else if (v[i] === ";" && !quoted) {
			parts.push(v.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(v.slice(start));
	// A long or non-ASCII value comes in pieces (name*0*=, name*1*=), percent-encoded with a charset in front.
	const pieces = new Map<string, Array<{ n: number; text: string; encoded: boolean }>>();
	for (const p of parts.slice(1, 40)) {
		const i = p.indexOf("=");
		if (i < 1) continue;
		const key = p.slice(0, i).trim().toLowerCase();
		let text = p.slice(i + 1).trim();
		if (text.startsWith('"')) text = text.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
		const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(key);
		if (!m) continue;
		if (m[2] === undefined && !m[3]) params[m[1]] ??= text;
		else pieces.set(m[1], [...(pieces.get(m[1]) ?? []), { n: Number(m[2] ?? 0), text, encoded: Boolean(m[3]) }]);
	}
	for (const [key, list] of pieces) {
		list.sort((a, b) => a.n - b.n);
		let charset = "utf-8";
		const bytes: Buffer[] = [];
		for (const [i, piece] of list.entries()) {
			let text = piece.text;
			if (piece.encoded) {
				if (i === 0) {
					const m = /^([^']*)'[^']*'(.*)$/.exec(text);
					if (m) {
						charset = m[1] || charset;
						text = m[2];
					}
				}
				bytes.push(unquote(text.replace(/%([0-9A-Fa-f]{2})/g, "=$1"), false));
			} else bytes.push(Buffer.from(text, "latin1"));
		}
		params[key] = decodeText(Buffer.concat(bytes), charset);
	}
	return { value: parts[0].trim().toLowerCase(), params };
}

/** A name a file can have: no folders, nothing that is not a visible character, no dot in front. */
export function fileName(given: string | undefined, fallback: string): string {
	const name = (given ?? "")
		.replace(/[\x00-\x1f\x7f]+/g, "")
		.split(/[\\/]/)
		.pop()!
		.replace(/[<>:"|?*]+/g, "_")
		.replace(/^[.\s]+/, "")
		.trim()
		.slice(-120);
	return name || fallback;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "application/pdf": "pdf", "text/plain": "txt", "text/html": "html", "text/csv": "csv", "text/calendar": "ics", "message/rfc822": "eml", "application/zip": "zip", "application/json": "json" };

/**
 * Read a message. `raw` is what was sent, headers and body; a message that was cut off (only its
 * first megabytes were fetched) is read as far as it goes.
 */
export function parseMail(raw: Buffer, limits: MailLimits = {}): Mail {
	const max = { parts: limits.parts ?? 60, depth: limits.depth ?? 8, text: limits.text ?? 100_000, attachmentBytes: limits.attachmentBytes ?? 10 * 1024 * 1024, attachments: limits.attachments ?? 20 };
	// One character per byte: positions in the text are positions in the message.
	const all = raw.toString("latin1");
	const plain: string[] = [];
	const html: string[] = [];
	const attachments: MailFile[] = [];
	let parts = 0;
	let textLeft = max.text;

	const split = (text: string): [Headers, string] => {
		// A message without headers begins with the empty line.
		if (/^\r?\n/.test(text)) return [headersOf(""), text.replace(/^\r?\n/, "")];
		const m = /\r?\n\r?\n/.exec(text);
		return m ? [headersOf(text.slice(0, m.index)), text.slice(m.index + m[0].length)] : [headersOf(text), ""];
	};

	const bodyBytes = (body: string, encoding: string, limit: number): { bytes: Buffer; size: number; skipped: boolean } => {
		if (encoding === "base64") {
			// What it would hold is known before it is decoded: three bytes for every four characters that are not line breaks.
			let breaks = 0;
			for (let i = body.indexOf("\n"); i >= 0; i = body.indexOf("\n", i + 1)) breaks += body.charCodeAt(i - 1) === 13 ? 2 : 1;
			const size = Math.floor(((body.length - breaks) * 3) / 4) - (body.trimEnd().endsWith("==") ? 2 : body.trimEnd().endsWith("=") ? 1 : 0);
			if (size > limit) return { bytes: Buffer.alloc(0), size, skipped: true };
			const bytes = Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
			return bytes.length > limit ? { bytes: Buffer.alloc(0), size: bytes.length, skipped: true } : { bytes, size: bytes.length, skipped: false };
		}
		if (body.length > limit * 3.1) return { bytes: Buffer.alloc(0), size: body.length, skipped: true };
		const bytes = encoding === "quoted-printable" ? unquote(body) : Buffer.from(body, "latin1");
		return bytes.length > limit ? { bytes: Buffer.alloc(0), size: bytes.length, skipped: true } : { bytes, size: bytes.length, skipped: false };
	};

	const walk = (headers: Headers, body: string, depth: number) => {
		if (++parts > max.parts) return;
		const type = headerParams(headers.get("content-type") ?? "text/plain");
		const kind = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(type.value) ? type.value : "text/plain";
		if (kind.startsWith("multipart/")) {
			const boundary = type.params.boundary;
			if (!boundary || depth >= max.depth) return;
			const delim = `--${boundary}`;
			let at = body.startsWith(delim) ? 0 : body.indexOf(`\n${delim}`);
			if (at < 0) return;
			if (at > 0) at += 1;
			while (at >= 0 && parts <= max.parts) {
				const after = at + delim.length;
				if (body.startsWith("--", after)) break;
				const lineEnd = body.indexOf("\n", after);
				if (lineEnd < 0) break;
				const next = body.indexOf(`\n${delim}`, lineEnd);
				const piece = body.slice(lineEnd + 1, next < 0 ? body.length : next).replace(/\r$/, "");
				const [h, b] = split(piece);
				walk(h, b, depth + 1);
				at = next < 0 ? -1 : next + 1;
			}
			return;
		}
		const disposition = headerParams(headers.get("content-disposition"));
		const encoding = (headers.get("content-transfer-encoding") ?? "").trim().toLowerCase();
		const named = disposition.params.filename ?? type.params.name;
		const isText = kind === "text/plain" || kind === "text/html";
		if (isText && disposition.value !== "attachment" && !named) {
			if (textLeft <= 0) return;
			const { bytes, skipped } = bodyBytes(body, encoding, 4 * 1024 * 1024);
			if (skipped) return;
			const text = decodeText(bytes, type.params.charset);
			(kind === "text/html" ? html : plain).push(text.slice(0, kind === "text/html" ? 1_000_000 : textLeft));
			if (kind === "text/plain") textLeft -= text.length;
			return;
		}
		if (attachments.length >= max.attachments) return;
		const got = bodyBytes(body, encoding, max.attachmentBytes);
		const name = fileName(named === undefined ? undefined : decodeWords(named), `attachment-${attachments.length + 1}.${EXT[kind] ?? "bin"}`);
		attachments.push({ name, type: kind, size: got.size, bytes: got.bytes, ...(got.skipped ? { skipped: true } : {}) });
	};

	const [top, body] = split(all);
	walk(top, body, 0);

	const text = plain.some((p) => p.trim()) ? plain.join("\n\n") : pageText(html.join("\n"));
	const head = (name: string) => {
		const v = top.get(name);
		return v === undefined ? undefined : tidy(decodeWords(v));
	};
	const from = addresses(top.get("from"))[0];
	const cc = addresses(top.get("cc")).map((a) => a.address);
	const when = head("date");
	const time = when ? new Date(when) : undefined;
	const id = head("message-id");
	return {
		from: from?.address ?? "",
		...(from?.name ? { fromName: from.name } : {}),
		to: addresses(top.get("to")).map((a) => a.address),
		...(cc.length ? { cc } : {}),
		subject: head("subject") ?? "",
		...(time && Number.isFinite(time.getTime()) ? { date: time.toISOString() } : {}),
		...(id ? { messageId: id.slice(0, 300) } : {}),
		text: text.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+/g, "").trim().slice(0, max.text),
		attachments,
	};
}

/** The types of picture a model can be shown, by what a message says a file is. */
export const PICTURES: Record<string, string> = { "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp", "image/gif": "image/gif" };

// ---- what a source that received a message keeps of it -------------------------------------------

/** A file that came with a message, as an event names it: `path` is where pine put it; one without was too large to keep. */
export interface KeptFile {
	file: string;
	path?: string;
	type: string;
	size: number;
}

let counter = 0;

/**
 * Put the files of a message into a source's own folder, each under a name pine makes (a new
 * one every time, with the cleaned name the message gave at its end). Nothing a message says
 * decides where a file lands, and nothing that exists is written over.
 */
export function keepFiles(dir: string, mail: Mail): { attachments: KeptFile[]; images?: Array<{ path: string; mimeType: string }> } {
	const attachments: KeptFile[] = [];
	const images: Array<{ path: string; mimeType: string }> = [];
	for (const a of mail.attachments) {
		if (a.skipped || !a.bytes.length) {
			attachments.push({ file: a.name, type: a.type, size: a.size });
			continue;
		}
		const clean = a.name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80) || "file";
		const target = path.join(dir, `${Date.now().toString(36)}${(counter++).toString(36)}-${clean}`);
		try {
			// "wx": the name is new; an existing file or link at that name is an error, not a target.
			fs.writeFileSync(target, a.bytes, { flag: "wx", mode: 0o600 });
		} catch {
			attachments.push({ file: a.name, type: a.type, size: a.size });
			continue;
		}
		attachments.push({ file: a.name, path: target, type: a.type, size: a.size });
		const mimeType = PICTURES[a.type] ?? PICTURES[`image/${path.extname(clean).slice(1).toLowerCase()}`];
		if (mimeType && a.size < 10 * 1024 * 1024 && images.length < 4) images.push({ path: target, mimeType });
	}
	return { attachments, ...(images.length ? { images } : {}) };
}

/** Delete what a source kept for longer than `keepMs`. */
export function pruneFiles(dir: string, keepMs: number): void {
	let names: string[] = [];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const file = path.join(dir, name);
		try {
			if (Date.now() - fs.lstatSync(file).mtimeMs > keepMs) fs.rmSync(file, { force: true });
		} catch {
			// gone already
		}
	}
}
