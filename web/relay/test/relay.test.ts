import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CLOSE, relay } from "../src/relay.ts";
import { connectTo, limiter, names, pairs, request, server, sshEcho } from "./support.ts";

const stops: (() => Promise<unknown>)[] = [];
after(async () => {
	for (const stop of stops) await stop();
});

async function setup(options: { onConnection?: Parameters<typeof server>[0]; limit?: number; timeoutMs?: number } = {}) {
	const received: Buffer[] = [];
	const srv = await server(options.onConnection ?? sshEcho(received));
	stops.push(srv.stop);
	const calls: { hostname: string; port: number }[] = [];
	const { clients, upgrade } = pairs();
	const limits = limiter(options.limit);
	const handle = relay({
		connect: connectTo(srv.port, calls),
		resolve: names({ "ssh.example.org": ["198.51.100.7"] }),
		upgrade,
		timeoutMs: options.timeoutMs ?? 2000,
	});
	const env = { LIMITER: limits };
	return { received, calls, clients, limits, fetch: (req: Request) => handle(req, env) };
}

test("an SSH banner exchange passes bytes both ways", async () => {
	const t = await setup();
	const response = await t.fetch(request("ssh.example.org", 2222));
	assert.equal(response.headers.get("x-upgraded"), "1");
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	await client.sees("SSH-2.0-OpenSSH_9.9\r\n");
	client.send("after the banner");
	await client.sees("after the banner");
	assert.equal(Buffer.concat(t.received).toString("latin1"), "SSH-2.0-pine-web\r\nafter the banner");
	assert.deepEqual(t.calls, [{ hostname: "198.51.100.7", port: 2222 }]);
	client.end.close(1000);
});

test("a connection over the per-IP cap is refused, and another IP still gets through", async () => {
	const t = await setup({ limit: 2 });
	const statuses = [];
	for (const ip of ["203.0.113.9", "203.0.113.9", "203.0.113.9", "203.0.113.10"]) {
		statuses.push((await t.fetch(request("ssh.example.org", 22, ip))).status);
	}
	assert.deepEqual(statuses, [200, 200, 429, 200]);
	assert.equal(t.clients.length, 3);
	for (const client of t.clients) client.end.close(1000);
});

test("a client that does not open with an SSH identification is closed before anything is connected", async () => {
	const t = await setup();
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.send("GET / HTTP/1.1\r\n\r\n");
	const closed = await client.closes();
	assert.equal(closed.code, CLOSE.notSsh);
	assert.deepEqual(t.calls, []);
});

test("a client that sends text instead of bytes is closed", async () => {
	const t = await setup();
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.sendText("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.notSsh);
	assert.deepEqual(t.calls, []);
});

test("a server that does not speak SSH is closed, and none of its bytes reach the client", async () => {
	const t = await setup({ onConnection: (socket) => socket.write("HTTP/1.1 400 Bad Request\r\n\r\n") });
	await t.fetch(request("ssh.example.org", 80));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	assert.equal((await client.closes()).code, CLOSE.serverNotSsh);
	assert.equal(client.received.length, 0);
});

test("a server that says nothing is closed after the time limit", async () => {
	const t = await setup({ onConnection: () => {}, timeoutMs: 100 });
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	client.send("SSH-2.0-pine-web\r\n");
	const started = Date.now();
	assert.equal((await client.closes()).code, CLOSE.timeout);
	assert.ok(Date.now() - started < 1000);
});

test("a client that says nothing is closed after the time limit, without a connection", async () => {
	const t = await setup({ timeoutMs: 100 });
	await t.fetch(request("ssh.example.org"));
	const [client] = t.clients;
	assert.equal((await client.closes()).code, CLOSE.timeout);
	assert.deepEqual(t.calls, []);
});
