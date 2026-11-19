// The relay of pine's web client: a WebSocket from the browser becomes a TCP connection to the
// owner's server, and the bytes go back and forth. SSH is end to end, so the relay sees no key
// and no token. It carries SSH and nothing else, to public addresses only, and keeps no state.
// To a Tailscale Funnel name (.ts.net) it opens TLS first, the only way Funnel lets a
// connection in; the SSH inside it is still end to end.
// It logs nothing of what it carries.
//
// Everything that is Cloudflare's own (connect(), the WebSocket pair, the name lookup) is handed
// in, so that the handler can be tested in Node against a server on a loopback port.

/** A TCP socket as Cloudflare's `connect()` returns it. */
export type TcpSocket = {
	readable: ReadableStream<Uint8Array>;
	writable: WritableStream<Uint8Array>;
	opened: Promise<unknown>;
	closed: Promise<unknown>;
	close(): Promise<void>;
};

/** The Worker's end of a WebSocket pair. */
export type RelayWebSocket = {
	/** How a binary message arrives: workerd's default is the standard's, a Blob. */
	binaryType: "blob" | "arraybuffer";
	accept(): void;
	addEventListener(type: "message" | "close" | "error", listener: (event: any) => void): void;
	send(data: ArrayBuffer | ArrayBufferView | string): void;
	close(code?: number, reason?: string): void;
};

/** The Worker's end of a new WebSocket pair, and the response that hands the other end to the browser. */
export type RelaySocket = { socket: RelayWebSocket; response: Response };

export type Deps = {
	/** With `secureTransport: "on"` the connection is TLS, its certificate checked for the hostname. */
	connect(address: { hostname: string; port: number }, options?: { secureTransport: "on" }): TcpSocket;
	/** The addresses a name has (A and AAAA), or none. */
	resolve(name: string): Promise<string[]>;
	upgrade(): RelaySocket;
	/** How long each side has to say it speaks SSH. */
	timeoutMs: number;
};

export type Env = {
	/** The Workers rate-limiting binding, keyed by the client's IP. */
	LIMITER: { limit(options: { key: string }): Promise<{ success: boolean }> };
	/**
	 * "1" lets a relay that is itself served on the loopback reach the loopback, and nothing else
	 * besides. For the web client's smoke alone, which passes it to `wrangler dev` on its command
	 * line; no configuration that is deployed sets it (test/loopback.test.ts), and a deployed
	 * Worker is never served on the loopback.
	 */
	RELAY_ALLOW_LOOPBACK?: string;
};

import { allowed, format, FUNNEL_PORTS, isFunnel, isLoopback, isName, parse } from "./addresses.ts";

const CLIENT_HELLO ="SSH-2.0-";
const SERVER_HELLO = "SSH-";
/** RFC 4253 caps the identification line at 255 bytes, CR LF included. */
const MAX_LINE = 255;

/** WebSocket close codes the browser's bridge reads. */
export const CLOSE = {
	notSsh: 4400,
	serverNotSsh: 4502,
	unreachable: 4504,
	timeout: 4408,
	/** No TLS from a Funnel name: Funnel is off for that port, or the certificate is not that name's. */
	tls: 4525,
};

export function relay(deps: Deps) {
	return async function fetch(request: Request, env: Env): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return refuse(426, "A WebSocket upgrade is needed.");
		const url = new URL(request.url);
		const host = url.searchParams.get("host") ?? "";
		const port = Number(url.searchParams.get("port") ?? "22");
		if (!host) return refuse(400, "Name the host: ?host=<name or address>&port=<port>.");
		if (!Number.isInteger(port) || port < 1 || port > 65535) return refuse(400, "The port is a number from 1 to 65535.");
		const funnel = isFunnel(host);
		if (funnel && !FUNNEL_PORTS.includes(port)) return refuse(400, `${host} is a Tailscale Funnel name, and Funnel serves only ports ${FUNNEL_PORTS.join(", ")}. Turn Funnel on for one of them and use that port.`);

		const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
		const { success } = await env.LIMITER.limit({ key: ip });
		if (!success) return refuse(429, "Too many connections from this address. Wait a minute and try again.");

		// The relay connects to an address it checked, never to a name, so that a name cannot
		// answer one address to the check and another to the connection (a Funnel name aside, below).
		const literal = parse(host);
		let found: string[];
		if (literal) found = [host];
		else if (isName(host)) found = await deps.resolve(funnel ? funnelName(host) : host).catch(() => []);
		else return refuse(400, "The host is a name or an IP address.");
		if (found.length === 0) return refuse(502, `${host} has no address.`);
		const addresses = found.map(parse);
		const loopback = env.RELAY_ALLOW_LOOPBACK === "1" && servedOnLoopback(url.hostname);
		if (addresses.some((a) => a === null || !(allowed(a) || (loopback && isLoopback(a))))) {
			return refuse(403, `${host} is not a public address. The relay reaches only servers on the internet${funnel ? ": turn Tailscale Funnel on for it" : ""}.`);
		}
		// TLS is checked against a name, and Funnel finds the machine by the name the client asks
		// for, so a Funnel host is connected to by its name, not by the address checked above. The
		// name could answer another address by then only if Tailscale, who alone answers for
		// ts.net, made it; and nothing passes before TLS proves the server is that name.
		const target = funnel ? funnelName(host) : format(addresses[0]!);

		const { socket, response } = deps.upgrade();
		socket.accept();
		// Bytes as they come, in order: a Blob would have to be read, and could be read out of order.
		socket.binaryType = "arraybuffer";
		carry(socket, target, port, funnel, deps);
		return response;
	};
}

/** A Funnel name as its certificate has it: lower case, no final dot. The same one is looked up and connected to. */
function funnelName(host: string) {
	return host.replace(/\.$/, "").toLowerCase();
}

/** Whether the relay's own address is this computer's: a deployment never is. */
function servedOnLoopback(hostname: string) {
	if (hostname === "localhost") return true;
	const address = parse(hostname);
	return address !== null && isLoopback(address);
}

function refuse(status: number, message: string) {
	return new Response(message + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function bytesOf(data: unknown): Uint8Array | null {
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	return null;
}

/** Joins the WebSocket and a TCP connection once the client has said it speaks SSH. */
function carry(ws: RelayWebSocket, hostname: string, port: number, tls: boolean, deps: Deps) {
	let tcp: TcpSocket | null = null;
	let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
	let done = false;
	let waiting: Uint8Array[] = [];

	const end = (code: number, reason: string) => {
		if (done) return;
		done = true;
		clearTimeout(timer);
		try {
			ws.close(code, reason);
		} catch {}
		tcp?.close().catch(() => {});
	};
	const timer = setTimeout(() => end(CLOSE.timeout, "No SSH identification in time."), deps.timeoutMs);

	// A TLS handshake that fails may show when the connection opens, or at the first write or read.
	const failed = () => (tls ? end(CLOSE.tls, "No TLS from the server: Tailscale Funnel may be off for this port.") : end(CLOSE.unreachable, "The server could not be reached."));
	let identified = false;

	const open = async (first: Uint8Array[]) => {
		try {
			tcp = tls ? deps.connect({ hostname, port }, { secureTransport: "on" }) : deps.connect({ hostname, port });
			await tcp.opened;
			writer = tcp.writable.getWriter();
			for (const chunk of first) await writer.write(chunk);
			for (const chunk of waiting) await writer.write(chunk);
			waiting = [];
		} catch {
			failed();
			return;
		}
		pump(tcp);
	};

	const pump = async (socket: TcpSocket) => {
		let line = "";
		const reader = socket.readable.getReader();
		try {
			while (!done) {
				const { value, done: finished } = await reader.read();
				if (finished) break;
				if (!identified) {
					// Nothing that does not begin like "SSH-" reaches the browser.
					line += new TextDecoder("latin1").decode(value);
					if (!SERVER_HELLO.startsWith(line.slice(0, SERVER_HELLO.length))) return end(CLOSE.serverNotSsh, "The server does not speak SSH.");
					if (line.includes("\n")) {
						identified = true;
						clearTimeout(timer);
					} else if (line.length > MAX_LINE) return end(CLOSE.serverNotSsh, "The server does not speak SSH.");
				}
				ws.send(value);
			}
			end(1000, "The server closed the connection.");
		} catch {
			if (tls && !identified) failed();
			else end(1011, "The connection to the server failed.");
		}
	};

	let hello: Uint8Array[] = [];
	let helloLength = 0;
	ws.addEventListener("message", (event) => {
		if (done) return;
		const bytes = bytesOf(event.data);
		if (!bytes) return end(CLOSE.notSsh, "Only binary messages are carried.");
		if (tcp) {
			if (writer) writer.write(bytes).catch(() => end(1011, "The connection to the server failed."));
			else waiting.push(bytes);
			return;
		}
		hello.push(bytes);
		helloLength += bytes.length;
		const head = new TextDecoder("latin1").decode(concat(hello).slice(0, CLIENT_HELLO.length));
		if (!CLIENT_HELLO.startsWith(head)) return end(CLOSE.notSsh, "Only SSH is carried.");
		if (helloLength >= CLIENT_HELLO.length) {
			const first = hello;
			hello = [];
			open(first);
		}
	});
	ws.addEventListener("close", () => end(1000, "The client closed the connection."));
	ws.addEventListener("error", () => end(1011, "The WebSocket failed."));
}

function concat(chunks: Uint8Array[]) {
	const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
}
