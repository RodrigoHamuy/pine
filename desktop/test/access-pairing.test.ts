// Pairing (electron/access/pairing.ts) through the door a browser comes through: a real SSH client
// (ssh2's) over an in-memory stream to the real access server, the store with a memory vault, and
// the owner's decision answered by the test. No network, no window.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import ssh2 from "ssh2";
import type { Client, ClientChannel, ConnectConfig } from "ssh2";
import { remoteCommand } from "../../src/remote.ts";
import { type AccessServer, createAccessServer } from "../electron/access/server.ts";
import { AccessStore, memoryVault, newEd25519Key } from "../electron/access/store.ts";
import { type Ask, createPairing, NEARBY_PAUSE_MS, NEARBY_SUSPEND_MS, NEARBY_USER, NEARBY_WINDOW_MS, type Pairing, type PairingOptions } from "../electron/access/pairing.ts";
import { duplexPair } from "../electron/access/stand-in.ts";

const SERVICE = "https://pine.example.workers.dev";
const serviceLine = JSON.stringify({ base: "http://127.0.0.1:1", token: "the-token" });

interface Setup {
	store: AccessStore;
	server: AccessServer;
	pairing: Pairing;
	browser: { private: string; public: Buffer };
	/** What the owner was asked, in order. */
	asked: Array<{ name: string; code: string; kind?: string; signal: AbortSignal }>;
	/** Answers the owner's next question (or the pending one). */
	answer(yes: boolean): void;
	connect(username: string, privateKey?: string): Promise<Client>;
}

const live: Setup[] = [];
after(() => {
	for (const s of live) {
		s.pairing.cancel();
		s.server.close();
	}
});

async function setup(options: Partial<PairingOptions> = {}): Promise<Setup> {
	const store = await AccessStore.open(memoryVault());
	const asked: Setup["asked"] = [];
	const answers: Array<(yes: boolean) => void> = [];
	const ask: Ask = (request, signal) =>
		new Promise((resolve) => {
			asked.push({ ...request, signal });
			answers.push(resolve);
		});
	let server!: AccessServer;
	const pairing = createPairing({ store, service: SERVICE, ask, computerName: () => "Studio Mac", cut: (id) => server.cut(id), ...options });
	server = createAccessServer({ hostKey: store.hostKey(), admit: pairing.admit, daemon: async () => serviceLine });
	const s: Setup = {
		store,
		server,
		pairing,
		browser: newEd25519Key(),
		asked,
		answer(yes) {
			const next = answers.shift();
			assert.ok(next, "the owner was asked");
			next(yes);
		},
		connect(username, privateKey = s.browser.private) {
			const [sock, end] = duplexPair();
			server.accept(end);
			const client = new ssh2.Client();
			return new Promise<Client>((resolve, reject) => {
				client.once("ready", () => resolve(client));
				client.once("error", reject);
				client.once("close", () => reject(new Error("closed before it was ready")));
				client.connect({ sock, username, privateKey, readyTimeout: 5000 } as ConnectConfig);
			});
		},
	};
	live.push(s);
	return s;
}

/** The code of a pairing link, checked to be of the link's form. */
const codeOf = (link: string, machineId: string) => {
	const match = link.match(/^(.+)\/#pair=([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{22})$/);
	assert.ok(match, `a pairing link: ${link}`);
	assert.equal(match[1], SERVICE);
	assert.equal(match[2], machineId);
	return match[3];
};

const exec = (client: Client, command: string) =>
	new Promise<ClientChannel>((resolve, reject) => client.exec(command, (err, channel) => (err ? reject(err) : resolve(channel))));

const request = (name: unknown) => `pine-pair ${Buffer.from(JSON.stringify({ name })).toString("base64url")}`;

/** Reads a channel's JSON lines as they come, and its exit code. */
function lines(channel: ClientChannel) {
	const got: any[] = [];
	const waiting: Array<() => void> = [];
	let text = "";
	let code: number | undefined;
	channel.on("data", (data: Buffer) => {
		text += data.toString();
		let end: number;
		while ((end = text.indexOf("\n")) >= 0) {
			got.push(JSON.parse(text.slice(0, end)));
			text = text.slice(end + 1);
		}
		for (const w of waiting.splice(0)) w();
	});
	const closed = new Promise<void>((resolve) => channel.once("close", () => resolve()));
	channel.once("exit", (c: number) => (code = c));
	return {
		async next(): Promise<any> {
			while (got.length === 0) {
				const more = new Promise<void>((r) => waiting.push(r));
				const gone = closed.then(() => {
					if (got.length === 0) throw new Error("the channel closed");
				});
				await Promise.race([more, gone]);
			}
			return got.shift();
		},
		async exit() {
			await closed;
			return code;
		},
	};
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (what: () => boolean) => {
	for (let i = 0; i < 200 && !what(); i++) await sleep(10);
	assert.ok(what());
};

test("pairing: the link's code lets a new key ask; the browser and the owner see the same four digits; Allow pairs it and it connects as pine", async () => {
	const s = await setup();
	const opened = s.pairing.open();
	const code = codeOf(opened.link, s.store.machineId());
	assert.ok(opened.expires instanceof Date);

	const client = await s.connect(`pair.${code}`);
	const answers = lines(await exec(client, request("Chrome on Android")));
	const shown = await answers.next();
	assert.match(shown.code, /^\d{4}$/);
	await until(() => s.asked.length === 1);
	assert.equal(s.asked[0].name, "Chrome on Android");
	assert.equal(s.asked[0].code, shown.code);
	assert.equal(s.store.devices().length, 0, "nothing is stored before the owner's yes");

	s.answer(true);
	assert.deepEqual(await answers.next(), { ok: true, name: "Studio Mac" });
	assert.equal(await answers.exit(), 0);
	const devices = s.store.devices();
	assert.equal(devices.length, 1);
	assert.equal(devices[0].name, "Chrome on Android");
	assert.equal(devices[0].key, s.browser.public.toString("base64"));
	assert.ok(Math.abs(Date.parse(devices[0].paired) - Date.now()) < 10_000);
	client.end();

	const paired = await s.connect("pine");
	const service = lines(await exec(paired, remoteCommand()));
	assert.deepEqual(await service.next(), JSON.parse(serviceLine));
	paired.end();
});

/** A request made on a new pairing session, up to the four digits. */
async function asking(s: Setup, name = "Safari on iPhone") {
	const client = await s.connect(`pair.${codeOf(s.pairing.open().link, s.store.machineId())}`);
	const answers = lines(await exec(client, request(name)));
	const shown = await answers.next();
	await until(() => s.asked.length > 0);
	return { client, answers, shown, question: s.asked[s.asked.length - 1] };
}

test("pairing: a code works for one connection only; a second one with it is refused", async () => {
	const s = await setup();
	const code = codeOf(s.pairing.open().link, s.store.machineId());
	const first = await s.connect(`pair.${code}`);
	assert.equal(s.pairing.current(), undefined, "the link no longer works once used");
	await assert.rejects(s.connect(`pair.${code}`, newEd25519Key().private));
	// The first one is still there and can ask.
	const answers = lines(await exec(first, request("phone")));
	assert.match((await answers.next()).code, /^\d{4}$/);
	first.end();
});

test("pairing: a code stops working when its time is over", async () => {
	const s = await setup({ pairingMs: 50 });
	const opened = s.pairing.open();
	assert.ok(opened.expires.getTime() - Date.now() <= 50);
	await sleep(80);
	assert.equal(s.pairing.current(), undefined);
	await assert.rejects(s.connect(`pair.${codeOf(opened.link, s.store.machineId())}`));
});

test("pairing: one pairing is open at a time; opening another makes the first link worthless", async () => {
	const s = await setup();
	const first = codeOf(s.pairing.open().link, s.store.machineId());
	const second = codeOf(s.pairing.open().link, s.store.machineId());
	assert.notEqual(first, second);
	await assert.rejects(s.connect(`pair.${first}`));
	(await s.connect(`pair.${second}`)).end();
});

test("pairing: a user name with a pairing code but no pairing open is refused", async () => {
	const s = await setup();
	await assert.rejects(s.connect(`pair.${"A".repeat(22)}`));
	const code = codeOf(s.pairing.open().link, s.store.machineId());
	s.pairing.cancel();
	assert.equal(s.pairing.current(), undefined);
	await assert.rejects(s.connect(`pair.${code}`));
});

test("pairing: a wrong code closes the connection, so that it gets no second guess", async () => {
	const s = await setup();
	const code = codeOf(s.pairing.open().link, s.store.machineId());
	const [sock, end] = duplexPair();
	s.server.accept(end);
	const client = new ssh2.Client();
	let tried = 0;
	const closed = new Promise<string>((resolve) => {
		client.once("ready", () => resolve("ready"));
		client.once("close", () => resolve("closed"));
	});
	client.on("error", () => {});
	client.connect({
		sock,
		username: "pine",
		// One wrong code, and then a client that stays and says nothing more: only the server can end it.
		authHandler: (_methods: unknown, _partial: unknown, next: (m: unknown) => void) => {
			if (tried++ === 0) next({ type: "publickey", username: `pair.${"B".repeat(22)}`, key: s.browser.private });
		},
	} as any);
	const outcome = await Promise.race([closed, sleep(1000).then(() => "still open")]);
	assert.equal(outcome, "closed");
	// And it did not use up the code: the pairing is still open for the next connection.
	assert.ok(s.pairing.current());
	(await s.connect(`pair.${code}`)).end();
});

test("pairing: five wrong codes close the pairing; four do not", async () => {
	const s = await setup();
	let code = codeOf(s.pairing.open().link, s.store.machineId());
	for (let i = 0; i < 4; i++) await assert.rejects(s.connect(`pair.${"C".repeat(22)}`));
	(await s.connect(`pair.${code}`)).end();

	code = codeOf(s.pairing.open().link, s.store.machineId());
	for (let i = 0; i < 5; i++) await assert.rejects(s.connect(`pair.${"D".repeat(22)}`));
	assert.equal(s.pairing.current(), undefined);
	await assert.rejects(s.connect(`pair.${code}`));
});

/** What a pairing session asks for that it must not get. */
const NOT_FOR_PAIRING: Array<[string, (client: Client) => Promise<unknown>]> = [
	["the remote command", (client) => exec(client, remoteCommand())],
	["another command", (client) => exec(client, "ls")],
	["a pairing request that is not one", (client) => exec(client, "pine-pair not-json!")],
	["a pairing request without a name", (client) => exec(client, `pine-pair ${Buffer.from("{}").toString("base64url")}`)],
	["a shell", (client) => new Promise((resolve, reject) => client.shell((err, ch) => (err ? reject(err) : resolve(ch))))],
	["sftp", (client) => new Promise((resolve, reject) => client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp))))],
	["a channel to the daemon", (client) => new Promise((resolve, reject) => client.forwardOut("127.0.0.1", 0, "127.0.0.1", 1, (err, ch) => (err ? reject(err) : resolve(ch))))],
	["remote forwarding", (client) => new Promise((resolve, reject) => client.forwardIn("127.0.0.1", 0, (err, port) => (err ? reject(err) : resolve(port))))],
];

for (const [what, ask] of NOT_FOR_PAIRING) {
	test(`pairing: on a pairing session, ${what} is refused`, async () => {
		const s = await setup();
		const client = await s.connect(`pair.${codeOf(s.pairing.open().link, s.store.machineId())}`);
		await assert.rejects(ask(client));
		client.end();
	});
}

test("pairing: a pairing session makes one request, not two", async () => {
	const s = await setup();
	const { client } = await asking(s);
	await assert.rejects(exec(client, request("again")));
	assert.equal(s.asked.length, 1);
	client.end();
});

test("pairing: the device's name reaches the owner as plain text of at most 60 characters", async () => {
	const s = await setup();
	const { client, question } = await asking(s, `\u001b[31mRed\u001b[0m\u0007 Phone‮${"x".repeat(100)}`);
	assert.equal(question.name, `Red Phone${"x".repeat(51)}`);
	s.answer(true);
	await until(() => s.store.devices().length === 1);
	assert.equal(s.store.devices()[0].name, question.name);
	client.end();
});

test("pairing: Refuse stores nothing and tells the browser why", async () => {
	const s = await setup();
	const { client, answers } = await asking(s);
	s.answer(false);
	assert.deepEqual(await answers.next(), { ok: false, reason: "refused" });
	assert.equal(await answers.exit(), 1);
	assert.deepEqual(s.store.devices(), []);
	await assert.rejects(s.connect("pine"));
	client.end();
});

test("pairing: an owner who does not answer in time stores nothing; the browser and the question are told it expired", async () => {
	const s = await setup({ answerMs: 60 });
	const { client, answers, question } = await asking(s);
	assert.deepEqual(await answers.next(), { ok: false, reason: "expired" });
	assert.equal(await answers.exit(), 1);
	assert.equal(question.signal.aborted, true);
	assert.equal(question.signal.reason, "expired");
	s.answer(true);
	await sleep(30);
	assert.deepEqual(s.store.devices(), [], "a yes after the time is over pairs nothing");
	client.end();
});

test("pairing: a device that leaves before the answer withdraws the question and stores nothing", async () => {
	const s = await setup();
	const { client, question } = await asking(s);
	client.end();
	await until(() => question.signal.aborted);
	assert.equal(question.signal.reason, "closed");
	s.answer(true);
	await sleep(30);
	assert.deepEqual(s.store.devices(), []);
});

test("pairing: cancelling it withdraws the question and closes its session", async () => {
	const s = await setup();
	const { client, question } = await asking(s);
	const gone = new Promise<void>((resolve) => client.once("close", () => resolve()));
	s.pairing.cancel();
	await gone;
	assert.equal(question.signal.reason, "cancelled");
	s.answer(true);
	await sleep(30);
	assert.deepEqual(s.store.devices(), []);
});

test("pairing: the caller hears of a device that was paired, and the used pairing is over", async () => {
	const added: string[] = [];
	const s = await setup({ paired: (device) => added.push(device.name) });
	const { client, answers } = await asking(s, "Firefox on Linux");
	s.answer(true);
	assert.equal((await answers.next()).ok, true);
	assert.deepEqual(added, ["Firefox on Linux"]);
	assert.equal(s.pairing.current(), undefined);
	client.end();
});

// ---- codeless requests from the network (ADR 0005) ----------------------------------------------

/** A clock the test moves: the pause and the suspension are counted on it. */
function clockAt(start = 1_000_000) {
	let now = start;
	return { now: () => now, move: (ms: number) => void (now += ms) };
}

/** A codeless request on a new session, up to the four digits; rejects when the session is refused. */
async function nearbyAsking(s: Setup, name = "Pine on Pixel 9") {
	const before = s.asked.length;
	const client = await s.connect(NEARBY_USER, newEd25519Key().private);
	const answers = lines(await exec(client, request(name)));
	const shown = await answers.next();
	await until(() => s.asked.length > before);
	return { client, answers, shown, question: s.asked[s.asked.length - 1] };
}

/** A codeless request the owner refuses, to its end. */
async function refusedNearby(s: Setup) {
	const r = await nearbyAsking(s);
	s.answer(false);
	assert.deepEqual(await r.answers.next(), { ok: false, reason: "refused" });
	r.client.end();
}

test("nearby: without a code, a device asks while visible; the owner sees its name and the digits, with this computer's name told to the device; Allow pairs it", async () => {
	const s = await setup({ nearby: () => true });
	const r = await nearbyAsking(s, "Pine on iPhone");
	assert.match(r.shown.code, /^\d{4}$/);
	assert.equal(r.shown.computer, "Studio Mac");
	assert.equal(r.question.name, "Pine on iPhone");
	assert.equal(r.question.code, r.shown.code);
	assert.equal(r.question.kind, "nearby");
	s.answer(true);
	assert.deepEqual(await r.answers.next(), { ok: true, name: "Studio Mac" });
	assert.equal(s.store.devices().length, 1);
	r.client.end();
});

test("nearby: refused while this computer is not visible, without asking the owner", async () => {
	let visible = false;
	const s = await setup({ nearby: () => visible });
	await assert.rejects(s.connect(NEARBY_USER));
	assert.equal(s.asked.length, 0);
	visible = true;
	(await s.connect(NEARBY_USER)).end();
});

test("nearby: one request at a time; another while one is pending is refused without being shown", async () => {
	const s = await setup({ nearby: () => true });
	const first = await nearbyAsking(s);
	await assert.rejects(s.connect(NEARBY_USER, newEd25519Key().private));
	assert.equal(s.asked.length, 1, "the second was never shown");
	s.answer(true);
	await first.answers.next();
	first.client.end();
	// Once the first is answered, the next may ask.
	const next = await nearbyAsking(s);
	next.client.end();
});

test("nearby: no request while the owner is asked about a pairing's code", async () => {
	const s = await setup({ nearby: () => true });
	const coded = await asking(s);
	await assert.rejects(s.connect(NEARBY_USER, newEd25519Key().private));
	assert.equal(s.asked.length, 1);
	coded.client.end();
});

test("nearby: a session that leaves without asking gives its place back", async () => {
	const s = await setup({ nearby: () => true });
	const quiet = await s.connect(NEARBY_USER, newEd25519Key().private);
	quiet.end();
	await sleep(50);
	(await nearbyAsking(s)).client.end();
});

test("nearby: after a refusal every codeless request is refused for 30 seconds", async () => {
	const clock = clockAt();
	const s = await setup({ nearby: () => true, now: clock.now });
	await refusedNearby(s);
	await sleep(30);
	await assert.rejects(s.connect(NEARBY_USER, newEd25519Key().private));
	clock.move(NEARBY_PAUSE_MS - 1);
	await assert.rejects(s.connect(NEARBY_USER, newEd25519Key().private));
	assert.equal(s.asked.length, 1);
	clock.move(1);
	(await nearbyAsking(s)).client.end();
});

test("nearby: three refusals within ten minutes suspend visibility for an hour, said once; resume ends it", async () => {
	const clock = clockAt();
	const said: Date[] = [];
	const s = await setup({ nearby: () => true, now: clock.now, suspended: (until) => said.push(until) });
	for (let i = 0; i < 3; i++) {
		await refusedNearby(s);
		await sleep(30);
		clock.move(NEARBY_PAUSE_MS);
	}
	assert.equal(said.length, 1);
	assert.equal(s.pairing.suspendedUntil()?.getTime(), said[0].getTime());
	await assert.rejects(s.connect(NEARBY_USER, newEd25519Key().private));
	clock.move(NEARBY_SUSPEND_MS - 2 * NEARBY_PAUSE_MS - 1);
	await assert.rejects(s.connect(NEARBY_USER, newEd25519Key().private));
	assert.equal(s.asked.length, 3);
	s.pairing.resume();
	assert.equal(s.pairing.suspendedUntil(), undefined);
	(await nearbyAsking(s)).client.end();
});

test("nearby: refusals further apart than ten minutes do not suspend", async () => {
	const clock = clockAt();
	const said: Date[] = [];
	const s = await setup({ nearby: () => true, now: clock.now, suspended: (until) => said.push(until) });
	for (let i = 0; i < 3; i++) {
		await refusedNearby(s);
		await sleep(30);
		clock.move(NEARBY_WINDOW_MS / 2 + 1);
	}
	assert.equal(said.length, 0);
	assert.equal(s.pairing.suspendedUntil(), undefined);
});

test("nearby: a request the owner lets expire is no refusal", async () => {
	const clock = clockAt();
	const s = await setup({ nearby: () => true, now: clock.now, answerMs: 50 });
	const r = await nearbyAsking(s);
	assert.deepEqual(await r.answers.next(), { ok: false, reason: "expired" });
	r.client.end();
	await sleep(30);
	(await nearbyAsking(s)).client.end();
});
