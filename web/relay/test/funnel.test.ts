// A Tailscale Funnel name (.ts.net) is reached through TLS, by its name; everything else as before.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CLOSE, relay, type Deps, type TcpSocket } from "../src/relay.ts";
import { connectTo, limiter, names, pairs, request, server, sshEcho, type Call } from "./support.ts";

const stops: (() => Promise<unknown>)[] = [];
after(async () => {
	for (const stop of stops) await stop();
});

const TABLE = {
	"pine.example-tailnet.ts.net": ["198.51.100.20"],
	"ssh.example.org": ["198.51.100.7"],
	"notts.net": ["198.51.100.8"],
	"tailnet-only.example-tailnet.ts.net": ["100.101.102.103"],
	"home.example-tailnet.ts.net": ["192.168.1.20"],
	"edge.example-tailnet.ts.net": ["104.16.1.1"],
	"localhost.example-tailnet.ts.net": ["127.0.0.1"],
};

async function setup(connect?: Deps["connect"]) {
	const received: Buffer[] = [];
	const srv = await server(sshEcho(received));
	stops.push(srv.stop);
	const calls: Call[] = [];
	const { clients, upgrade } = pairs();
	const handle = relay({ connect: connect ?? connectTo(srv.port, calls), resolve: names(TABLE), upgrade, timeoutMs: 2000 });
	return { received, calls, clients, fetch: (req: Request) => handle(req, { LIMITER: limiter() }) };
}

/** A connect() whose TLS handshake fails, as it opens or at the first read. */
function tlsFails(at: "open" | "read"): Deps["connect"] {
	return (): TcpSocket => {
		const opened = at === "open" ? Promise.reject(new Error("handshake failed")) : Promise.resolve();
		opened.catch(() => {});
		return {
			readable: new ReadableStream({ start: (c) => c.error(new Error("handshake failed")) }),
			writable: new WritableStream(),
			opened,
			closed: Promise.resolve(),
			close: async () => {},
		};
	};
}

test("a Funnel name is connected to by its name, with TLS, and SSH passes both ways inside it", async () => {
	const t = await setup();
	await t.fetch(request("pine.example-tailnet.ts.net", 10000));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	client.send("after the banner");
	await client.sees("after the banner");
	assert.deepEqual(t.calls, [{ hostname: "pine.example-tailnet.ts.net", port: 10000, secureTransport: "on" }]);
	client.end.close(1000);
});

test("a Funnel name written with capitals or a final dot is the same name for TLS", async () => {
	const t = await setup();
	await t.fetch(request("Pine.Example-Tailnet.TS.NET.", 443));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	assert.deepEqual(t.calls, [{ hostname: "pine.example-tailnet.ts.net", port: 443, secureTransport: "on" }]);
	client.end.close(1000);
});

test("any other host is connected to by its checked address, without TLS", async () => {
	for (const [host, address] of [["ssh.example.org", "198.51.100.7"], ["notts.net", "198.51.100.8"], ["198.51.100.9", "198.51.100.9"]]) {
		const t = await setup();
		await t.fetch(request(host, 10000));
		const [client] = t.clients;
		client.send("SSH-2.0-pine-web\r\n");
		await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
		assert.deepEqual(t.calls, [{ hostname: address, port: 10000 }], host);
		client.end.close(1000);
	}
});

test("a Funnel name on a port Funnel does not serve is refused before anything is connected", async () => {
	for (const port of [22, 80, 2222, 8080]) {
		const t = await setup();
		const response = await t.fetch(request("pine.example-tailnet.ts.net", port));
		assert.equal(response.status, 400, String(port));
		assert.match(await response.text(), /443, 8443, 10000/);
		assert.equal(t.clients.length, 0);
		assert.deepEqual(t.calls, []);
	}
});

test("a Funnel name that has a tailnet, private, loopback or Cloudflare address, or none, is refused", async () => {
	for (const host of ["tailnet-only.example-tailnet.ts.net", "home.example-tailnet.ts.net", "edge.example-tailnet.ts.net", "localhost.example-tailnet.ts.net", "unknown.example-tailnet.ts.net"]) {
		const t = await setup();
		const response = await t.fetch(request(host, 10000));
		assert.ok(response.status === 403 || response.status === 502, `${host}: ${response.status}`);
		assert.equal(t.clients.length, 0, host);
		assert.deepEqual(t.calls, [], host);
	}
});

test("a server that does not speak SSH inside the TLS is closed, and none of its bytes reach the client", async () => {
	const srv = await server((socket) => socket.write("HTTP/1.1 400 Bad Request\r\n\r\n"));
	stops.push(srv.stop);
	const t = await setup(connectTo(srv.port));
	await t.fetch(request("pine.example-tailnet.ts.net", 443));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.serverNotSsh);
	assert.equal(client.received.length, 0);
});

test("a TLS handshake that fails closes with the TLS code for a Funnel name, as it opens or at the first read", async () => {
	for (const at of ["open", "read"] as const) {
		const t = await setup(tlsFails(at));
		await t.fetch(request("pine.example-tailnet.ts.net", 10000));
		const [client] = t.clients;
		client.send("SSH-2.0-pine-web\r\n");
		assert.equal((await client.closes()).code, CLOSE.tls, at);
	}
	// Any other host that cannot be reached is still "unreachable".
	const t = await setup(tlsFails("open"));
	await t.fetch(request("ssh.example.org", 22));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.unreachable);
});
