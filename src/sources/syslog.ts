import dgram from "node:dgram";
import net from "node:net";
import { Type } from "typebox";
import type { SourceType } from "../source-types.ts";
import type { SourceApi } from "../sources.ts";
import { errText } from "../util.ts";
import { capped, clip, pattern } from "../watching.ts";

/**
 * A syslog listener: takes the log lines that routers, firewalls, switches, access points and NAS
 * boxes send when they are told a "remote log server", and reports the ones that matter.
 *
 * options: { port, host?, protocol?, allow?, match?, severity?, perMinute? }
 *   protocol   "udp" (default), "tcp" or "both"
 *   allow      only these sender addresses, as prefixes: ["192.168.1.1", "192.168.2."]
 *   match      only lines in which this regular expression finds something
 *   severity   the least severe level still reported (default "warning"): emerg, alert, crit,
 *              err, warning, notice, info, debug
 *   perMinute  at most this many reports a minute (default 20); the rest is counted and dropped
 *
 * event "line": { host, app?, severity, facility, message, from, time?, dropped? }
 *
 * Syslog has no login: whoever can reach the port can write a line, under any host name. `from`
 * is the address a line really came from; `host` is what the line says about itself.
 */
export const SEVERITIES = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug"];
const FACILITIES = ["kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news", "uucp", "cron", "authpriv", "ftp", "ntp", "audit", "alert", "clock", "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7"];
const ALIASES: Record<string, string> = { emergency: "emerg", panic: "emerg", critical: "crit", error: "err", warn: "warning", information: "info", informational: "info" };
const LINE_MAX = 8192;

export interface LogLine {
	host?: string;
	app?: string;
	severity: string;
	facility: string;
	message: string;
	time?: string;
}

/** A name a line gave (a host, a program): one word of sensible length, or nothing. */
const word = (s: string | undefined, max: number) => {
	const w = (s ?? "").replace(/[\x00-\x20\x7f]+/g, "");
	return w && w !== "-" ? w.slice(0, max) : undefined;
};

/** Read one syslog line: the newer format (RFC 5424), the older one (RFC 3164), or whatever else it is. */
export function parseLine(raw: string): LogLine {
	const line = raw.replace(/[\r\n\x00]+$/g, "").slice(0, LINE_MAX);
	const pri = /^<(\d{1,3})>/.exec(line);
	if (!pri || Number(pri[1]) > 191) return { severity: "notice", facility: "user", message: line.trim() };
	const n = Number(pri[1]);
	const base = { severity: SEVERITIES[n & 7], facility: FACILITIES[n >> 3] ?? "user" };
	const rest = line.slice(pri[0].length);
	// RFC 5424: version, time, host, program, process, message id, structured data, text.
	const v1 = /^1 (\S+) (\S+) (\S+) (\S+) (\S+) /.exec(rest);
	if (v1) {
		let text = rest.slice(v1[0].length);
		if (text.startsWith("[")) {
			// Structured data: elements in brackets, a bracket inside a value written as \].
			let i = 0;
			while (text[i] === "[") {
				i++;
				while (i < text.length && text[i] !== "]") i += text[i] === "\\" ? 2 : 1;
				i++;
			}
			text = text.slice(i);
		} else if (text.startsWith("-")) text = text.slice(1);
		const when = v1[1] === "-" ? undefined : new Date(v1[1]);
		return { ...base, host: word(v1[2], 100), app: word(v1[3], 64), message: text.replace(/^ /, "").replace(/^\ufeff|^\xef\xbb\xbf/, "").trim(), ...(when && Number.isFinite(when.getTime()) ? { time: when.toISOString() } : {}) };
	}
	// RFC 3164: "Oct 11 22:14:15 host program[123]: text". Many devices leave out the time, the host or both.
	const stamped = /^([A-Z][a-z]{2} [ \d]\d \d\d:\d\d:\d\d) /.exec(rest);
	let text = stamped ? rest.slice(stamped[0].length) : rest;
	let host: string | undefined;
	const tagged = (s: string) => /^([^\s:[\]]{1,48})(?:\[\d+\])?: ?/.exec(s);
	if (stamped && !tagged(text)) {
		const m = /^(\S+) /.exec(text);
		if (m) {
			host = word(m[1], 100);
			text = text.slice(m[0].length);
		}
	}
	const tag = tagged(text);
	if (tag) text = text.slice(tag[0].length);
	return { ...base, ...(host ? { host } : {}), ...(tag ? { app: word(tag[1], 64) } : {}), message: text.trim() };
}

const level = (v: unknown): number => {
	const name = String(v ?? "warning").trim().toLowerCase();
	return SEVERITIES.indexOf(ALIASES[name] ?? name);
};

export const type: SourceType = {
	summary: "a syslog listener: the log lines a router, firewall, switch, access point or NAS sends to a \"remote log server\"; reports those that are severe enough or match",
	options: Type.Object(
		{
			port: Type.Number({ description: "port to listen on, e.g. 5514 (514 is the usual one, which on many systems only root may open)" }),
			host: Type.Optional(Type.String({ description: 'address to listen on. Default "0.0.0.0", so that devices on the network reach it' })),
			protocol: Type.Optional(Type.String({ description: '"udp" (default, what most devices send), "tcp" or "both"' })),
			allow: Type.Optional(Type.Array(Type.String(), { description: 'only these sender addresses, as prefixes: ["192.168.1.1", "192.168.2."]. Give the device\'s address: syslog has no login' })),
			match: Type.Optional(Type.String({ description: 'only lines in which this regular expression finds something, e.g. "link down|login failed"' })),
			severity: Type.Optional(Type.String({ description: 'the least severe level still reported: emerg, alert, crit, err, warning, notice, info or debug. Default "warning"' })),
			perMinute: Type.Optional(Type.Number({ description: "at most this many reports a minute; what comes on top is counted and dropped. Default 20" })),
		},
		{ additionalProperties: false },
	),
	plan(o) {
		if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) throw new Error(`"port" must be a port number, for example 5514`);
		const protocol = String(o.protocol ?? "udp").toLowerCase();
		if (!["udp", "tcp", "both"].includes(protocol)) throw new Error('"protocol" is "udp", "tcp" or "both"');
		const floor = level(o.severity);
		if (floor < 0) throw new Error(`"severity" is one of ${SEVERITIES.join(", ")}`);
		if (o.match !== undefined) pattern(String(o.match));
		if (o.perMinute !== undefined && !(Number.isInteger(o.perMinute) && o.perMinute >= 1 && o.perMinute <= 600)) throw new Error('"perMinute" is a whole number from 1 to 600');
		const allow: string[] = (Array.isArray(o.allow) ? o.allow : []).map((a: unknown) => String(a).trim()).filter(Boolean);
		for (const a of allow) if (!/^[0-9a-fA-F.:]+$/.test(a)) throw new Error(`"${a}" in "allow" is not an address or the beginning of one. It looks like "192.168.1.1" or "192.168.2."`);
		const options: Record<string, unknown> = { ...o, protocol, severity: SEVERITIES[floor] };
		if (allow.length) options.allow = allow;
		else delete options.allow;
		return {
			options,
			does: [
				`listen on port ${o.port} (${protocol === "both" ? "UDP and TCP" : protocol.toUpperCase()}) of this computer for the log lines devices send (syslog)${allow.length ? `, from the addresses ${allow.join(", ")}` : ""}, and report those of severity "${SEVERITIES[floor]}" or worse${o.match ? ` in which /${o.match}/ finds something` : ""}`,
				...(allow.length ? [] : ['take lines from ANYONE who can reach the port, under any name: syslog has no login. "allow" with the device\'s address narrows it']),
				`report at most ${o.perMinute ?? 20} lines a minute; what comes on top is counted and dropped`,
			],
			opens: true,
			tell: `In the device, enter this computer's address as the remote log (syslog) server, port ${o.port}, protocol ${protocol === "tcp" ? "TCP" : "UDP"}.`,
		};
	},
};

export default async function syslog(source: SourceApi): Promise<void> {
	const o = source.options;
	const port = Number(o.port);
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`needs "port" (for example 5514)`);
	const host = String(o.host ?? "0.0.0.0");
	const protocol = String(o.protocol ?? "udp");
	const allow: string[] = (Array.isArray(o.allow) ? o.allow : []).map(String);
	const floor = Math.max(0, level(o.severity));
	const re = o.match ? pattern(String(o.match)) : undefined;
	const perMinute = Number(o.perMinute ?? 20);
	const cap = capped(perMinute);
	const plain = (addr: string | undefined) => (addr ?? "").replace(/^::ffff:/, "");
	const allowed = (remote: string) => !allow.length || allow.some((a) => remote === a || (/[.:]$/.test(a) && remote.startsWith(a)));

	let reported = 0;
	let quiet = 0;
	let over = 0;
	let turned = 0;
	const say = () =>
		source.status(`listening on port ${port} (${protocol}). ${reported} reported, ${quiet} not severe enough or not matching${over ? `, ${over} over the limit of ${perMinute} a minute` : ""}${turned ? `, ${turned} from addresses not allowed` : ""}`);
	source.status(`listening on port ${port} (${protocol})`);

	const take = (raw: string, remote: string) => {
		if (!raw.trim()) return;
		const line = parseLine(raw);
		if (SEVERITIES.indexOf(line.severity) > floor || (re && !re.test(line.message))) {
			quiet++;
			return say();
		}
		if (!cap.ok()) {
			over++;
			return say();
		}
		const dropped = cap.dropped();
		reported++;
		say();
		try {
			source.emit("line", { host: line.host ?? remote, ...(line.app ? { app: line.app } : {}), severity: line.severity, facility: line.facility, message: clip(line.message, 2000), from: remote, ...(line.time ? { time: line.time } : {}), ...(dropped ? { dropped } : {}) });
		} catch (e) {
			source.log.warn("could not report a line", errText(e));
		}
	};

	const hint = (e: unknown) => new Error(`could not listen on port ${port}: ${errText(e)}${port < 1024 ? ". Ports below 1024 often need root: use 5514 and enter that port in the device" : ""}`);

	if (protocol === "udp" || protocol === "both") {
		const socket = dgram.createSocket({ type: net.isIPv6(host) ? "udp6" : "udp4", reuseAddr: false });
		socket.on("message", (msg, info) => {
			const remote = plain(info.address);
			if (!allowed(remote)) return void (turned++, say());
			// One line a packet is the rule; a device that puts several into one is read all the same.
			for (const raw of msg.subarray(0, LINE_MAX * 4).toString("utf8").split("\n").slice(0, 20)) take(raw, remote);
		});
		await new Promise<void>((resolve, reject) => {
			socket.once("error", (e) => reject(hint(e)));
			socket.bind(port, host, () => {
				socket.removeAllListeners("error");
				socket.on("error", (e) => source.log.warn("syslog socket error", errText(e)));
				resolve();
			});
		});
		source.onStop(() => new Promise<void>((resolve) => socket.close(() => resolve())));
	}

	if (protocol === "tcp" || protocol === "both") {
		const open = new Set<net.Socket>();
		const server = net.createServer((sock) => {
			const remote = plain(sock.remoteAddress);
			if (open.size >= 20 || !allowed(remote)) {
				turned++;
				say();
				return void sock.destroy();
			}
			open.add(sock);
			// A device keeps its connection open and may have nothing to say for a long time.
			sock.setTimeout(3_600_000, () => sock.destroy());
			sock.setKeepAlive(true, 60_000);
			sock.on("close", () => open.delete(sock));
			sock.on("error", () => {});
			let buffer: Buffer = Buffer.alloc(0);
			sock.on("data", (chunk: Buffer) => {
				buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
				for (;;) {
					// Either a line ends with a line break, or its length stands in front of it ("83 <34>1 ...").
					const counted = /^(\d{1,5}) (?=<)/.exec(buffer.subarray(0, 8).toString("latin1"));
					if (counted) {
						const n = Number(counted[1]);
						if (n > LINE_MAX * 4) return void sock.destroy();
						if (buffer.length < counted[0].length + n) return;
						take(buffer.subarray(counted[0].length, counted[0].length + n).toString("utf8"), remote);
						buffer = buffer.subarray(counted[0].length + n);
						continue;
					}
					const i = buffer.indexOf("\n");
					if (i < 0) {
						if (buffer.length > LINE_MAX * 4) sock.destroy();
						return;
					}
					take(buffer.subarray(0, i).toString("utf8"), remote);
					buffer = buffer.subarray(i + 1);
				}
			});
		});
		await new Promise<void>((resolve, reject) => {
			server.once("error", (e) => reject(hint(e)));
			server.listen(port, host, () => (server.removeAllListeners("error"), resolve()));
		});
		source.onStop(
			() =>
				new Promise<void>((resolve) => {
					for (const s of open) s.destroy();
					server.close(() => resolve());
				}),
		);
	}
	source.log.info(`listening for syslog on ${host}:${port} (${protocol})`);
}
