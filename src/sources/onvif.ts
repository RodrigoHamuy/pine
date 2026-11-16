import crypto from "node:crypto";
import net from "node:net";
import { Type } from "typebox";
import { type Agent, fetch } from "undici";
import { isLocalHost, publicOnlyAgent } from "../net.ts";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { errText } from "../util.ts";
import { capped, clip } from "../watching.ts";

/**
 * A network camera's own detections, as it reports them through ONVIF: motion, a person, a
 * vehicle, tampering, a line crossed, a doorbell's button. For cameras and recorders that speak
 * ONVIF (most that are not tied to a cloud do).
 *
 * options: { host, user, password, port?, path?, topics?, perMinute?, local? }
 *   port       the camera's ONVIF port (80 by default; 8000, 8080, 8899 or 2020 on some makes)
 *   path       where its device service is ("/onvif/device_service" by default)
 *   topics     only events whose topic contains one of these words: ["Motion", "Person"]
 *   perMinute  at most this many reports a minute (20 by default)
 *
 * event "event": { topic, source, data, time?, active?, dropped? }
 *
 * pine asks the camera for a subscription and then keeps asking it what happened (a "pull
 * point"): the camera needs no way to reach pine. Every request goes to the host and port that
 * were confirmed, whatever address the camera names in its answers. A camera says which state
 * each thing is in when a subscription starts; that is the starting point, and only a change
 * from it is reported. Nothing on the camera is changed.
 */
const NS = {
	soap: "http://www.w3.org/2003/05/soap-envelope",
	wsa: "http://www.w3.org/2005/08/addressing",
	wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
	wsu: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
	digest: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest",
	base64: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary",
	tds: "http://www.onvif.org/ver10/device/wsdl",
	tev: "http://www.onvif.org/ver10/events/wsdl",
	wsnt: "http://docs.oasis-open.org/wsn/b-2",
};
const ACTION = {
	time: `${NS.tds}/GetSystemDateAndTime`,
	capabilities: `${NS.tds}/GetCapabilities`,
	create: `${NS.tev}/EventPortType/CreatePullPointSubscriptionRequest`,
	pull: `${NS.tev}/PullPointSubscription/PullMessagesRequest`,
	renew: "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest",
	unsubscribe: "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest",
};
/**
 * The pauses and waits, in one place. A test shortens them.
 *   retryMs, retryMaxMs  before a new subscription after a failure: the first pause, and the longest
 *   waitSec              how long the camera may hold one question open when nothing happens
 *   leaseSec             how long a subscription lives unless it is renewed (it is, at half that time)
 *   idleMs               the pause after an answer that came at once and was empty
 */
export const timing = { retryMs: 2000, retryMaxMs: 5 * 60_000, waitSec: 30, leaseSec: 600, idleMs: 1000 };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) =>
	s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (all, name: string) => {
		const n = name.toLowerCase();
		if (n[0] !== "#") return ENTITIES[n] ?? all;
		const code = n[1] === "x" ? Number.parseInt(n.slice(2), 16) : Number.parseInt(n.slice(1), 10);
		return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
	});
/** Text from a camera as an event carries it: one line, no control characters, not longer than `n`. */
const clean = (s: string, n: number) => clip(unesc(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim(), n);

/** The first element with this local name, whatever prefix the camera gives its namespace: its attributes and what is inside. */
export function element(xml: string, name: string): { attrs: string; inner: string } | undefined {
	const m = new RegExp(`<(?:[\\w.-]+:)?${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>)`).exec(xml);
	return m ? { attrs: m[1] ?? "", inner: m[2] ?? "" } : undefined;
}

const attrs = (text: string): Record<string, string> => Object.fromEntries([...text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].replace(/^.*:/, ""), m[2] ?? m[3] ?? ""]));

/** The name → value pairs of a part of a notification (its Source, its Data). A few of them, each of a sensible length. */
function items(xml: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	for (const m of (xml ?? "").matchAll(/<(?:[\w.-]+:)?SimpleItem\b([^>]*?)\/?>/g)) {
		const a = attrs(m[1]);
		if (!a.Name || Object.keys(out).length >= 12) continue;
		out[clean(a.Name, 80)] = clean(a.Value ?? "", 200);
	}
	return out;
}

export interface Notification {
	topic: string;
	source: Record<string, string>;
	data: Record<string, string | number | boolean>;
	time?: string;
	/** "Initialized" (the state when the subscription began), "Changed", "Deleted", or nothing for something that just happened. */
	operation?: string;
}

/** The notifications in an answer to PullMessages. */
export function notifications(xml: string): Notification[] {
	const out: Notification[] = [];
	for (const m of xml.matchAll(/<(?:[\w.-]+:)?NotificationMessage\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?NotificationMessage\s*>/g)) {
		const body = m[1];
		// "tns1:RuleEngine/CellMotionDetector/Motion": the prefixes say nothing to a reader.
		const topic = clean(element(body, "Topic")?.inner ?? "", 200)
			.split("/")
			.map((p) => p.replace(/^[\w.-]+:/, "").replace(/[^\w.-]/g, ""))
			.filter(Boolean)
			.join("/");
		if (!topic) continue;
		const message = /<(?:[\w.-]+:)?Message\b([^>]*\b(?:UtcTime|PropertyOperation)\s*=[^>]*)>/.exec(body);
		const a = attrs(message?.[1] ?? "");
		const data: Notification["data"] = {};
		for (const [k, v] of Object.entries(items(element(body, "Data")?.inner))) data[k] = v === "true" ? true : v === "false" ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
		out.push({ topic, source: items(element(body, "Source")?.inner), data, ...(a.UtcTime ? { time: clean(a.UtcTime, 40) } : {}), ...(a.PropertyOperation ? { operation: clean(a.PropertyOperation, 20) } : {}) });
		if (out.length >= 50) break;
	}
	return out;
}

/** The WS-Security header a camera checks: the password is never sent, only a digest over a nonce, the time and the password. */
export function security(user: string, password: string, now: Date, nonce: Buffer = crypto.randomBytes(16)): string {
	const created = now.toISOString().replace(/\.\d+Z$/, "Z");
	const digest = crypto.createHash("sha1").update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)])).digest("base64");
	return `<Security s:mustUnderstand="1" xmlns="${NS.wsse}"><UsernameToken><Username>${esc(user)}</Username><Password Type="${NS.digest}">${digest}</Password><Nonce EncodingType="${NS.base64}">${nonce.toString("base64")}</Nonce><Created xmlns="${NS.wsu}">${created}</Created></UsernameToken></Security>`;
}

const hostOk = (host: string) => net.isIP(host) !== 0 || /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(host);
const pathOk = (p: string) => /^\/[A-Za-z0-9_./~%-]{0,199}$/.test(p);
const words = (raw: unknown): string[] => (Array.isArray(raw) ? raw : raw === undefined || raw === "" ? [] : String(raw).split(",")).map((w) => String(w).trim()).filter(Boolean);

export const type: SourceType = {
	summary: "a network camera's own detections over ONVIF: motion, a person, a vehicle, tampering, a doorbell's button. For cameras and recorders that speak ONVIF. It only listens",
	options: Type.Object(
		{
			host: Type.String({ description: "the camera's address on the network, e.g. 192.168.1.40" }),
			user: Type.String({ description: "the user name of an account on the camera" }),
			password: Type.String({ description: "that account's password", secret: true }),
			port: Type.Optional(Type.Number({ description: "the camera's ONVIF port. Default 80; some makes use 8000 (Reolink, Dahua), 8899 or 2020 (Tapo)" })),
			path: Type.Optional(Type.String({ description: 'where the camera\'s ONVIF device service is. Default "/onvif/device_service", which nearly all use' })),
			topics: Type.Optional(Type.Array(Type.String(), { description: 'only events whose topic contains one of these words, capitals do not matter, e.g. ["Motion", "Person", "Tamper"]. Without it everything the camera reports' })),
			perMinute: Type.Optional(Type.Number({ description: "at most this many reports a minute; the rest are dropped and counted. Default 20" })),
			local: Type.Optional(Type.Boolean({ description: "true if the address is a name on your owner's own network that does not say so (camera.lan). Not needed for an IP address or a .local name" })),
		},
		{ additionalProperties: false },
	),
	plan(o) {
		const host = String(o.host ?? "").trim();
		if (!hostOk(host)) throw new Error(`"${host}" is not an address. A camera's looks like 192.168.1.40 (without http:// and without a port: that is "port")`);
		const port = o.port ?? 80;
		if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('"port" must be a port number. ONVIF is on 80 for most cameras, on 8000, 8899 or 2020 for some');
		if (o.path !== undefined && !pathOk(String(o.path))) throw new Error('"path" is a path on the camera, e.g. "/onvif/device_service"');
		if (o.user !== undefined && !String(o.user).trim()) throw new Error('needs "user": the name of an account on the camera');
		const topics = words(o.topics);
		if (topics.length > 20 || topics.some((t) => t.length > 60)) throw new Error('"topics" is up to 20 short words, e.g. ["Motion", "Person"]');
		if (o.perMinute !== undefined && !(Number.isInteger(o.perMinute) && o.perMinute >= 1 && o.perMinute <= 120)) throw new Error('"perMinute" is a whole number from 1 to 120');
		return {
			options: { ...o, host, ...(topics.length ? { topics } : {}) },
			does: [
				`connect to the camera at ${host}:${port}${o.local || isLocalHost(host) ? " (an address on your own network or this computer)" : ""} as ${o.user} and report what it detects${topics.length ? ` (topics with ${topics.join(", ")})` : ""}, at most ${o.perMinute ?? 20} times a minute`,
				"with the password given, sent only to that camera and never in the clear",
				"it only listens: nothing on the camera is changed",
			],
			opens: true,
			tell: "The state the camera is in now is the starting point; it reports from the next change on. The sources tool shows whether the camera took the subscription.",
		};
	},
};

export default function onvif(source: SourceApi): void {
	const o = source.options;
	const host = String(o.host ?? "").trim();
	if (!hostOk(host)) throw new Error(`needs "host": the camera's address, e.g. 192.168.1.40`);
	const port = Number(o.port ?? 80);
	const user = String(o.user ?? "");
	const password = String(o.password ?? "");
	const devicePath = String(o.path ?? "/onvif/device_service");
	if (!pathOk(devicePath)) throw new Error('"path" is a path on the camera, e.g. "/onvif/device_service"');
	source.secret(password || undefined);
	const wanted = words(o.topics).map((t) => t.toLowerCase());
	const cap = capped(Number(o.perMinute ?? 20));
	const stop = new AbortController();
	const guard: Agent | undefined = o.local === true || isLocalHost(host) ? undefined : publicOnlyAgent((timing.waitSec + 20) * 1000);
	const base = `http://${net.isIPv6(host) ? `[${host}]` : host}:${port}`;
	/** A pause that ends with the source. */
	const pause = (ms: number) =>
		new Promise<void>((resolve) => {
			const done = () => {
				clearTimeout(timer);
				stop.signal.removeEventListener("abort", done);
				resolve();
			};
			const timer = setTimeout(done, ms);
			stop.signal.addEventListener("abort", done, { once: true });
		});
	/** How far the camera's clock is from this one: a camera refuses a digest made with a time that is not its own. */
	let skew = 0;
	let reported = 0;

	/** Where an address the camera named is asked: on the host that was confirmed, at the path the camera gave. */
	const here = (address: string | undefined, fallback: string): string => {
		try {
			const u = new URL(unesc(String(address ?? "").trim()), base);
			const p = `${u.pathname}${u.search}`;
			return p.length <= 400 && /^\/[\x21-\x7e]*$/.test(p) ? p : fallback;
		} catch {
			return fallback;
		}
	};

	const call = async (at: string, action: string, body: string, opts: { auth?: boolean; reference?: string; timeoutMs?: number } = {}): Promise<string> => {
		const header = `<a:Action s:mustUnderstand="1">${action}</a:Action><a:MessageID>urn:uuid:${crypto.randomUUID()}</a:MessageID><a:ReplyTo><a:Address>${NS.wsa}/anonymous</a:Address></a:ReplyTo><a:To s:mustUnderstand="1">${esc(base + at)}</a:To>${opts.reference ?? ""}${opts.auth !== false && user ? security(user, password, new Date(Date.now() + skew)) : ""}`;
		const res = await fetch(base + at, {
			method: "POST",
			headers: { "content-type": `application/soap+xml; charset=utf-8; action="${action}"` },
			body: `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${NS.soap}" xmlns:a="${NS.wsa}"><s:Header>${header}</s:Header><s:Body>${body}</s:Body></s:Envelope>`,
			redirect: "manual",
			signal: AbortSignal.any([stop.signal, AbortSignal.timeout(opts.timeoutMs ?? 15_000)]),
			...(guard ? { dispatcher: guard } : {}),
		});
		const text = (await res.text()).slice(0, 512 * 1024);
		const fault = element(text, "Fault");
		if (fault || !res.ok) {
			// What the camera says in a fault is its own text: it goes into the log, and a sentence of pine's into the status.
			const said = clean((fault ? (element(fault.inner, "Text")?.inner ?? element(fault.inner, "faultstring")?.inner ?? "") : "").replace(/<[^>]+>/g, " "), 200);
			source.log.debug(`${action.split("/").pop()} failed: HTTP ${res.status} ${said}`);
			if (res.status === 401 || /not\s*authori[sz]ed|unauthori[sz]ed|authentication|FailedAuthentication/i.test(text)) throw Object.assign(new Error("the camera refused the user name or the password"), { auth: true });
			throw new Error(fault ? "the camera answered with a fault" : `the camera answered ${res.status}`);
		}
		return text;
	};

	/** One subscription, from asking for it until it fails or the source stops. `alive` is called when the camera has answered a question about events. */
	const session = async (alive: () => void) => {
		// Without the password: every camera tells the time to anyone, so that a digest can be made at all.
		try {
			const t = element(await call(devicePath, ACTION.time, `<GetSystemDateAndTime xmlns="${NS.tds}"/>`, { auth: false }), "UTCDateTime")?.inner ?? "";
			const n = (name: string) => Number(element(t, name)?.inner ?? Number.NaN);
			const utc = Date.UTC(n("Year"), n("Month") - 1, n("Day"), n("Hour"), n("Minute"), n("Second"));
			skew = Number.isFinite(utc) ? utc - Date.now() : 0;
		} catch {
			if (stop.signal.aborted) return;
			skew = 0;
		}
		const caps = await call(devicePath, ACTION.capabilities, `<GetCapabilities xmlns="${NS.tds}"><Category>Events</Category></GetCapabilities>`);
		const events = here(element(element(caps, "Events")?.inner ?? "", "XAddr")?.inner, "/onvif/Events");
		const made = await call(events, ACTION.create, `<CreatePullPointSubscription xmlns="${NS.tev}"><InitialTerminationTime>PT${timing.leaseSec}S</InitialTerminationTime></CreatePullPointSubscription>`);
		const ref = element(made, "SubscriptionReference")?.inner ?? "";
		const at = here(element(ref, "Address")?.inner, events);
		// Some cameras tell subscriptions apart by a parameter they want back in every header.
		const params = element(ref, "ReferenceParameters")?.inner.trim() ?? "";
		const reference = params.length <= 2000 ? params : "";
		alive();
		let renewAt = Date.now() + (timing.leaseSec * 1000) / 2;
		try {
			while (!stop.signal.aborted) {
				const asked = Date.now();
				const answer = await call(at, ACTION.pull, `<PullMessages xmlns="${NS.tev}"><Timeout>PT${timing.waitSec}S</Timeout><MessageLimit>10</MessageLimit></PullMessages>`, { reference, timeoutMs: (timing.waitSec + 15) * 1000 });
				alive();
				const got = notifications(answer);
				for (const n of got) take(n);
				source.status(`subscribed to the camera, ${reported} event${reported === 1 ? "" : "s"} reported`);
				if (Date.now() >= renewAt) {
					await call(at, ACTION.renew, `<Renew xmlns="${NS.wsnt}"><TerminationTime>PT${timing.leaseSec}S</TerminationTime></Renew>`, { reference });
					renewAt = Date.now() + (timing.leaseSec * 1000) / 2;
				}
				// A camera that answers at once with nothing is not asked in a tight loop.
				if (!got.length && Date.now() - asked < timing.idleMs) await pause(timing.idleMs);
			}
		} finally {
			// Told that nobody listens any more, where there is still time to say so; it runs out by itself otherwise.
			if (stop.signal.aborted) void fetchQuietly(at, reference);
		}
	};

	const fetchQuietly = async (at: string, reference: string) => {
		try {
			const header = `<a:Action s:mustUnderstand="1">${ACTION.unsubscribe}</a:Action><a:MessageID>urn:uuid:${crypto.randomUUID()}</a:MessageID><a:To s:mustUnderstand="1">${esc(base + at)}</a:To>${reference}${user ? security(user, password, new Date(Date.now() + skew)) : ""}`;
			await fetch(base + at, {
				method: "POST",
				headers: { "content-type": `application/soap+xml; charset=utf-8; action="${ACTION.unsubscribe}"` },
				body: `<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="${NS.soap}" xmlns:a="${NS.wsa}"><s:Header>${header}</s:Header><s:Body><Unsubscribe xmlns="${NS.wsnt}"/></s:Body></s:Envelope>`,
				redirect: "manual",
				signal: AbortSignal.timeout(2000),
				...(guard ? { dispatcher: guard } : {}),
			}).then((r) => r.body?.cancel());
		} catch {
			// it runs out by itself
		}
	};

	const take = (n: Notification) => {
		if (wanted.length && !wanted.some((w) => n.topic.toLowerCase().includes(w))) return;
		// A state (the camera says so with an operation) is kept per topic and thing, and only a change of it is a report.
		if (n.operation) {
			const slot = `state:${crypto.createHash("sha1").update(`${n.topic}\n${JSON.stringify(Object.entries(n.source).sort())}`).digest("hex").slice(0, 20)}`;
			if (/^deleted$/i.test(n.operation)) return void source.kv.set(slot, null);
			const now = JSON.stringify(Object.entries(n.data).sort());
			const was = source.kv.get<string | null>(slot) ?? undefined;
			if (was === now) return;
			source.kv.set(slot, now);
			// What it says when the subscription begins is where things stand, not something that happened;
			// unless pine knew it otherwise, and it changed while nobody listened.
			if (/^initiali[sz]ed$/i.test(n.operation) && was === undefined) return;
		}
		if (!cap.ok()) return;
		const dropped = cap.dropped();
		const flags = Object.values(n.data).filter((v) => typeof v === "boolean");
		reported++;
		source.emit("event", { topic: n.topic, source: n.source, data: n.data, ...(n.time ? { time: n.time } : {}), ...(flags.length === 1 ? { active: flags[0] } : {}), ...(dropped ? { dropped } : {}) });
	};

	source.status("connecting to the camera");
	let wait = timing.retryMs;
	const run = async () => {
		while (!stop.signal.aborted) {
			try {
				await session(() => (wait = timing.retryMs));
			} catch (e) {
				if (stop.signal.aborted) return;
				source.log.warn("lost the camera", errText(e));
				source.status(`${(e as any)?.auth ? "the camera refused the user name or the password" : "no connection to the camera"}; trying again every ${Math.round(wait / 1000)} s`);
			}
			await pause(wait);
			wait = Math.min(wait * 2, timing.retryMaxMs);
		}
	};
	void run();
	source.onStop(() => stop.abort());
}
