// The web bridge: the top-level document's part of the web client, the counterpart of the desktop
// app's main process (desktop/electron/main.ts) and of the Android plugin. It holds the browser's
// SSH key, the machines and their trusted host keys, the SSH connection and the daemon's token, and
// makes every call to the control API for the page, which asks through serve.ts and never sees
// the token. The browser has no pine of its own (`local: false`).
import type { AppState, Prefs, ServiceState } from "../../desktop/src/bridge.ts";
import { cleanLook, type Look } from "../../desktop/src/theme.ts";
import type { BridgeEvent } from "./protocol.ts";
import { REMOTE_COMMAND } from "./remote-command.ts";
import { generateKey, publicKeyLine, SshRefused, type Channel, type Connection, type ConnectOptions } from "./ssh.ts";
import { callDaemon, followEvents, loopbackEnd, runService, ServiceTrouble, type Daemon } from "./tunnel.ts";

/** Where the bridge keeps what it remembers: IndexedDB in a browser (idb-store.ts), a map in the tests. Values are structured-cloned, CryptoKeys included. */
export type Store = {
	get(name: string): Promise<unknown>;
	set(name: string, value: unknown): Promise<void>;
};

export type WebBridgeDeps = {
	/** The SSH core's `connect` (ssh.ts), or a stand-in. */
	connect(options: ConnectOptions): Promise<Connection>;
	store: Store;
	/** The relay's WebSocket address for a host and port. */
	relay(host: string, port: number): string;
	/** Puts a text on the clipboard. */
	clipboard(text: string): Promise<void>;
	/** Hands a text to the system's share sheet; none: the clipboard. */
	share?(title: string, text: string): Promise<void>;
	/** The web client's version. */
	version: string;
};

/** The page's own preferences, as the bridge keeps them. */
type PagePrefs = { notify: boolean; updates: boolean; keepRunning: boolean; agentAccent: boolean; look?: Look };
type Kept = { prefs: PagePrefs; hosts: string[]; use?: string };

const DEFAULTS: PagePrefs = { notify: false, updates: false, keepRunning: false, agentAccent: true };
const MAX_HOSTS = 20;
const KEY_COMMENT = "pine-web";

/** A machine as the owner names it: user@host or user@host:port. The host is a name, an IPv4 address or an IPv6 one in brackets. */
export function parseHost(value: string): { user: string; hostname: string; port: number; label: string } {
	const m = /^([A-Za-z0-9_][A-Za-z0-9_.-]{0,31})@([A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})|\[[0-9A-Fa-f:.]{2,45}\])(?::(\d{1,5}))?$/.exec(value);
	const port = m?.[3] ? Number(m[3]) : 22;
	if (!m || port < 1 || port > 65535) throw new Error(`"${value.slice(0, 80)}" is not a machine for this browser. Write it as user@host, or user@host:port.`);
	const hostname = m[2].replace(/^\[|\]$/g, "");
	const label = /^[\d.]+$/.test(hostname) || hostname.includes(":") ? hostname : hostname.split(".")[0];
	return { user: m[1], hostname, port, label };
}

const NO_MACHINE: ServiceState = {
	status: "error",
	kind: "ssh",
	message: "Add the machine whose pine this browser is to use, as user@host or user@host:port. Put this browser's key into ~/.ssh/authorized_keys there first.",
};

/** What `pine service` there could not do, in words that say what to do. */
function serviceTrouble(host: string, e: ServiceTrouble): string {
	if (/unknown command "service"/.test(e.stderr)) return `The pine on ${host} is too old to be reached this way: it has no "service" command. Update it there with "pine update", then try again.`;
	if (e.exitStatus === 127) return `pine is not installed on ${host}, or not on the PATH of its login shell. ${e.stderr.trim()}`;
	if (e.message === "timeout") return `${host} did not answer within a minute.`;
	if (e.message === "ended") return e.stderr.trim() || `The command on ${host} ended (exit ${e.exitStatus ?? "unknown"}) without saying why.`;
	return `${host} ${e.message}`;
}

export function webBridge(deps: WebBridgeDeps) {
	const listeners = new Map<BridgeEvent, Set<(value: unknown) => void>>();
	const emit = (event: BridgeEvent, value: unknown) => listeners.get(event)?.forEach((fn) => fn(value));

	let kept: Kept = { prefs: { ...DEFAULTS }, hosts: [] };
	let hostKeys: Record<string, string> = {};
	let loaded: Promise<void> | undefined;
	const load = () =>
		(loaded ??= (async () => {
			const stored = (await deps.store.get("prefs")) as Partial<Kept> | undefined;
			kept = { prefs: { ...DEFAULTS, ...stored?.prefs }, hosts: Array.isArray(stored?.hosts) ? stored.hosts : [], ...(stored?.use ? { use: stored.use } : {}) };
			hostKeys = ((await deps.store.get("hostKeys")) as Record<string, string> | undefined) ?? {};
			if (!kept.use) state = NO_MACHINE;
		})());
	const save = () => deps.store.set("prefs", kept);
	const saveKeys = () => deps.store.set("hostKeys", hostKeys);
	const prefsOut = (): Prefs => ({ ...kept.prefs, hosts: [...kept.hosts], ...(kept.use ? { use: kept.use } : {}) });

	// The browser's key: made once, kept in the store as CryptoKeys that WebCrypto will not hand out.
	let pair: Promise<CryptoKeyPair> | undefined;
	const key = () =>
		(pair ??= (async () => {
			const stored = (await deps.store.get("key")) as CryptoKeyPair | undefined;
			if (stored?.privateKey && stored.publicKey) return stored;
			const made = await generateKey();
			await deps.store.set("key", made);
			return made;
		})());
	const keyLine = async () => publicKeyLine((await key()).publicKey, KEY_COMMENT);

	let state: ServiceState = { status: "starting" };
	let connected = false;
	const setState = (next: ServiceState) => {
		state = next;
		emit("service", state);
	};
	const setConnected = (up: boolean) => {
		if (up === connected) return;
		connected = up;
		emit("connection", up);
	};

	// The connection in use: its SSH, the channel that holds pine service, the daemon, the event stream.
	let current: { connection: Connection; service?: Channel; daemon?: Daemon; events?: AbortController } | undefined;
	let round = 0;
	const letGo = async () => {
		const c = current;
		current = undefined;
		c?.events?.abort();
		setConnected(false);
		await c?.service?.close().catch(() => {});
		await c?.connection.close().catch(() => {});
	};

	const connectTo = async (host: string) => {
		const mine = ++round;
		await letGo();
		setState({ status: "starting", host });
		const known = hostKeys[host];
		let connection: Connection;
		try {
			const { user, hostname, port } = parseHost(host);
			// With no key trusted yet, a fingerprint no key has: the core stops at the host key and says which it saw, before the browser's key is offered.
			connection = await deps.connect({ url: deps.relay(hostname, port), user, key: await key(), hostFingerprint: known ?? "none" });
		} catch (e) {
			if (mine !== round) return;
			if (e instanceof SshRefused && e.reason === "host-key" && e.hostFingerprint) {
				const seen = e.hostFingerprint;
				if (known)
					return setState({ status: "error", kind: "ssh", host, fingerprint: seen, changed: true, message: `The host key of ${host} changed: it was ${known}, it is now ${seen}. Someone may stand between this browser and the machine, or the machine was set up anew. If you know why, forget the machine and add it again.` });
				return setState({ status: "error", kind: "ssh", host, fingerprint: seen, changed: false, message: `This browser does not know ${host} yet. Its host key's fingerprint is ${seen}. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), trust it and connect.` });
			}
			if (e instanceof SshRefused && e.reason === "not-authorized")
				return setState({ status: "error", kind: "ssh", host, message: `${host} did not accept this browser's key. Add it as a line of ~/.ssh/authorized_keys of that user there: ${await keyLine()}` });
			return setState({ status: "error", kind: "ssh", host, message: `Could not connect to ${host} over SSH. ${e instanceof Error ? e.message : String(e)}` });
		}
		if (mine !== round) return void connection.close().catch(() => {});
		current = { connection };
		const { label } = parseHost(host);
		try {
			const { said, channel } = await runService(connection, REMOTE_COMMAND);
			if (mine !== round) return void channel.close().catch(() => {});
			current.service = channel;
			if (said.error) throw new Error(`The pine on ${label} did not start: ${said.error}`);
			const far = loopbackEnd(said.base);
			current.daemon = { connection, host: far.host, port: far.port, token: String(said.token) };
			setState({ status: "ready", mode: `on ${label}`, started: said.started === true, home: `${label}:${String(said.home ?? "~/.pine")}`, version: typeof said.version === "string" ? said.version : undefined, from: `ssh ${host}`, host, label });
			const events = (current.events = new AbortController());
			followEvents(current.daemon, events.signal, { batch: (b) => emit("events", b), connection: setConnected });
		} catch (e) {
			if (mine !== round) return;
			await letGo();
			if (e instanceof ServiceTrouble) return setState({ status: "error", kind: "ssh", host, message: serviceTrouble(host, e) });
			setState({ status: "error", kind: "failed", host, message: e instanceof Error ? e.message : String(e) });
		}
	};

	let started = false;
	const bridge = {
		on(event: BridgeEvent, fn: (value: unknown) => void) {
			let set = listeners.get(event);
			if (!set) listeners.set(event, (set = new Set()));
			set.add(fn);
		},
		async state(): Promise<AppState> {
			await load();
			return { state, connected, home: state.status === "ready" ? state.home : undefined, prefs: prefsOut(), platform: "web", focused: true, updates: false, versions: { app: deps.version, electron: "none" }, local: false };
		},
		/** The page has started: it is told the state as it is now, and the machine in use is connected to (once). */
		async ready() {
			await load();
			emit("service", state);
			if (started) return;
			started = true;
			if (kept.use) void connectTo(kept.use);
		},
		async retry() {
			await load();
			if (kept.use) void connectTo(kept.use);
			else setState(NO_MACHINE);
		},
		async call(method: string, url: string, body?: unknown) {
			return callDaemon(state.status === "ready" ? current?.daemon : undefined, method, url, body);
		},
		/** Checked as main.ts checks the owner's change; the machines change by their own methods only. */
		async prefs(change: Record<string, unknown>) {
			await load();
			const flag = (k: "notify" | "updates" | "keepRunning" | "agentAccent") => (typeof change[k] === "boolean" ? (change[k] as boolean) : kept.prefs[k]);
			const next: PagePrefs = { notify: flag("notify"), updates: flag("updates"), keepRunning: flag("keepRunning"), agentAccent: flag("agentAccent") };
			const look = "look" in change ? cleanLook(change.look) : kept.prefs.look;
			if (look) next.look = look;
			kept = { ...kept, prefs: next };
			await save();
			return prefsOut();
		},
		async use(host?: string) {
			await load();
			if (!host) throw new Error("This browser has no pine of its own: choose one of your machines.");
			if (!kept.hosts.includes(host)) throw new Error(`${host} is not one of your machines: add it first.`);
			kept = { ...kept, use: host };
			await save();
			void connectTo(host);
		},
		async addHost(host: string) {
			await load();
			parseHost(host);
			if (!kept.hosts.includes(host)) {
				if (kept.hosts.length >= MAX_HOSTS) throw new Error(`There are ${MAX_HOSTS} machines already: forget one first.`);
				kept = { ...kept, hosts: [...kept.hosts, host] };
				await save();
			}
			return prefsOut();
		},
		/** A machine forgotten takes its host key along, and its connection when it is the one in use. */
		async forgetHost(host: string) {
			await load();
			kept = { ...kept, hosts: kept.hosts.filter((h) => h !== host) };
			delete hostKeys[host];
			if (kept.use === host) {
				const { use: _gone, ...rest } = kept;
				kept = rest;
				round++;
				await letGo();
				setState(NO_MACHINE);
			}
			await save();
			await saveKeys();
			return prefsOut();
		},
		/** The owner's yes to exactly the fingerprint the page was shown for that host; never to a key that changed. */
		async trustHostKey(host: string, fingerprint: string) {
			const s = state;
			if (s.status !== "error" || s.host !== host || s.fingerprint !== fingerprint || s.changed !== false) throw new Error(`That is not the key ${host} showed: nothing was trusted.`);
			hostKeys[host] = fingerprint;
			await saveKeys();
			void connectTo(host);
		},
		deviceKey: () => keyLine(),
		copyKey: async () => deps.clipboard(await keyLine()),
		shareKey: async () => {
			const line = await keyLine();
			return deps.share ? deps.share("This browser's SSH key", line) : deps.clipboard(line);
		},
		/** Lets go of the connection (the tests; a closed tab ends it anyway). */
		stop() {
			round++;
			void letGo();
		},
	};
	return bridge;
}
