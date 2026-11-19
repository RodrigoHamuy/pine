// The web bridge: the top-level document's part of the web client, the counterpart of the desktop
// app's main process (desktop/electron/main.ts) and of the mobile app's native plugin. It holds the browser's
// SSH key, the machines and their trusted host keys, the SSH connection and the daemon's token, and
// makes every call to the control API for the page, which asks through serve.ts and never sees
// the token. The browser has no pine of its own (`local: false`).
import { MEDIA } from "../../desktop/electron/daemon.ts";
import type { AppState, Prefs, ServiceState } from "../../desktop/src/bridge.ts";
import { cleanLook, type Look } from "../../desktop/src/theme.ts";
import type { BridgeEvent } from "./protocol.ts";
import { REMOTE_COMMAND } from "./remote-command.ts";
import { generateKey, publicKeyLine, RelayClosed, SshRefused, type Channel, type Connection, type ConnectOptions } from "./ssh.ts";
import { callDaemon, followEvents, loopbackEnd, mediaOf, runService, ServiceTrouble, type Daemon } from "./tunnel.ts";

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
	/** Waits between attempts to connect again (the tests make them short); none: a timer. */
	wait?(ms: number): Promise<void>;
	/** How long `pine service` has to say where its daemon answers; none: a minute. */
	serviceMs?: number;
	/** Opens an address of the web in a new tab of the browser, with nothing of this document handed to it (`noopener`). */
	open?(url: string): void;
	/** Hands a text to the browser as a file to save (a download), under that name. */
	save?(name: string, text: string): void;
};

/** How long to wait before the attempt after the `n`th failed one to connect again: doubling from a second, at most half a minute. */
export const backoff = (n: number) => Math.min(1000 * 2 ** n, 30_000);
/** Failed attempts to connect again before the page is told what is wrong; until then it stays in its conversations, shown as not connected. */
const QUIET_TRIES = 3;
/** Losses of the event stream in a row, with SSH still up, after which pine there is taken for gone and the connection is made again (as desktop/electron/main.ts does). */
const STREAM_LOSSES = 5;

/** A picture, video or sound of the daemon's, by its path and query: one of `MEDIA`'s paths, nothing that could be read as another request. */
function mediaTarget(target: string): string {
	const q = target.indexOf("?");
	const path = q < 0 ? target : target.slice(0, q);
	if (!target.startsWith("/") || target.startsWith("//") || /[\s\0-\x1f\x7f#]/.test(target) || !MEDIA.some((m) => m.test(path))) throw new Error(`That is not a picture, a video or a sound of pine's: ${target.slice(0, 80)}`);
	return target;
}

/** Only pages on the web open, as desktop/electron/main.ts's `openOutside`: a link never starts a program, opens a file or runs a script. */
function webAddress(url: string): string {
	let u: URL | undefined;
	try {
		u = new URL(url);
	} catch {}
	if (!u || (u.protocol !== "http:" && u.protocol !== "https:")) throw new Error(`Only an address of the web (http or https) opens: ${url.slice(0, 80)}`);
	return u.href;
}

/** The last part of a file's name, so that a name never says where the file goes. */
function fileName(name: string): string {
	return (name.split(/[\\/]/).pop() ?? "").replace(/[\0-\x1f\x7f]/g, "").slice(0, 200) || "pine.txt";
}

/** The page's own preferences, as the bridge keeps them. */
type PagePrefs = { notify: boolean; updates: boolean; keepRunning: boolean; look?: Look; storage?: PageStorage };

/**
 * What the page keeps in its Web Storage (the side panel's widths, what is folded), which its
 * opaque origin does not keep across a reload: the page hands all of it over with `prefs`
 * (page-storage.ts) and is given it back with the state. Only the page's own keys, as text.
 */
type PageStorage = Record<string, string>;
const STORAGE_KEY = /^pine\.[A-Za-z0-9._-]{1,80}$/;
const STORAGE_KEYS = 64;
const STORAGE_VALUE = 8192;

/** The page's storage as it may be kept: entries that are not its keys or not text within bounds are left out; too many keys is refused. */
function cleanStorage(value: unknown): PageStorage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const entries = Object.entries(value).filter(([k, v]) => STORAGE_KEY.test(k) && typeof v === "string" && v.length <= STORAGE_VALUE);
	if (entries.length > STORAGE_KEYS) throw new Error(`The page asked to keep too much: at most ${STORAGE_KEYS} entries.`);
	return Object.fromEntries(entries) as PageStorage;
}
type Kept = { prefs: PagePrefs; hosts: string[]; use?: string };

const DEFAULTS: PagePrefs = { notify: false, updates: false, keepRunning: false };
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
	if (e.message === "timeout") return `pine on ${host} is not answering: "pine service" there said nothing within a minute. Look at what it does there with "pine status", or restart it, then try again.`;
	if (e.message === "ended") return e.stderr.trim() || `The command on ${host} ended (exit ${e.exitStatus ?? "unknown"}) without saying why.`;
	return `${host} ${e.message}`;
}

/** What the relay's closing means for the machine, in words that say what to check (codes: web/relay/src/relay.ts `CLOSE`). */
function relayTrouble(host: string, e: RelayClosed): string {
	const { hostname, port } = parseHost(host);
	if (e.code === 0) return `The relay did not open a connection to ${hostname}. It may be down, or it refused: it reaches only machines with a public address, and allows a browser a few connections a minute. Check the address, wait a minute, and try again.`;
	if (e.code === 4504) return `${hostname} could not be reached on port ${port}. Check that the machine is on, that SSH listens on that port, and that its firewall lets connections in from the internet.`;
	if (e.code === 4502) return `${hostname} answers on port ${port}, but not with SSH. Check the port.`;
	if (e.code === 4408) return `${hostname} did not answer with SSH on port ${port} within a few seconds.`;
	if (e.code === 4400) return "The relay carries only SSH, and refused what this browser sent.";
	return `The connection to ${host} was closed: ${e.message}`;
}

/** How an attempt to connect ended: ready, a trouble that may pass by itself (the network, the relay, a slow pine), one only the owner can fix, or another attempt took its place. */
type Outcome = "ready" | "passing" | "final" | "superseded";

export function webBridge(deps: WebBridgeDeps) {
	const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
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

	/**
	 * Connects to `host`, runs pine service there and follows its events. `again`: the connection in
	 * use was lost, so the page stays where it is (state "ready", not connected) and is told a
	 * trouble that may pass only when `say`. A trouble only the owner can fix is always told.
	 */
	const connectTo = async (host: string, again?: { say: boolean }): Promise<Outcome> => {
		const mine = ++round;
		await letGo();
		const say = !again || again.say;
		const passing = (message: string): Outcome => {
			if (say) setState({ status: "error", kind: "ssh", host, message });
			return "passing";
		};
		const final = (next: ServiceState): Outcome => (setState(next), "final");
		if (!again) setState({ status: "starting", host });
		const known = hostKeys[host];
		let connection: Connection;
		try {
			const { user, hostname, port } = parseHost(host);
			// With no key trusted yet, a fingerprint no key has: the core stops at the host key and says which it saw, before the browser's key is offered.
			connection = await deps.connect({ url: deps.relay(hostname, port), user, key: await key(), hostFingerprint: known ?? "none" });
		} catch (e) {
			if (mine !== round) return "superseded";
			if (e instanceof SshRefused && e.reason === "host-key" && e.hostFingerprint) {
				const seen = e.hostFingerprint;
				if (known)
					return final({ status: "error", kind: "ssh", host, fingerprint: seen, changed: true, message: `The host key of ${host} changed: it was ${known}, it is now ${seen}. Someone may stand between this browser and the machine, or the machine was set up anew. If you know why, forget the machine and add it again.` });
				return final({ status: "error", kind: "ssh", host, fingerprint: seen, changed: false, message: `This browser does not know ${host} yet. Its host key's fingerprint is ${seen}. If that is what the machine shows (ssh-keygen -lf on its /etc/ssh/ssh_host_*_key.pub), trust it and connect.` });
			}
			if (e instanceof SshRefused && e.reason === "not-authorized")
				return final({ status: "error", kind: "ssh", host, message: `${host} did not accept this browser's key. Add it as a line of ~/.ssh/authorized_keys of that user there: ${await keyLine()}` });
			if (e instanceof RelayClosed) return passing(relayTrouble(host, e));
			return passing(`Could not connect to ${host} over SSH. ${e instanceof Error ? e.message : String(e)}`);
		}
		if (mine !== round) return void connection.close().catch(() => {}), "superseded";
		let dropped = false;
		void connection.closed.then(() => (dropped = true));
		const held: NonNullable<typeof current> = (current = { connection });
		const { label } = parseHost(host);
		try {
			const { said, channel } = await runService(connection, REMOTE_COMMAND, deps.serviceMs);
			if (mine !== round) return void channel.close().catch(() => {}), "superseded";
			held.service = channel;
			if (said.error) throw new Error(`The pine on ${label} did not start: ${said.error}`);
			const far = loopbackEnd(said.base);
			held.daemon = { connection, host: far.host, port: far.port, token: String(said.token) };
			setState({ status: "ready", mode: `on ${label}`, started: said.started === true, home: `${label}:${String(said.home ?? "~/.pine")}`, version: typeof said.version === "string" ? said.version : undefined, from: `ssh ${host}`, host, label });
			const events = (held.events = new AbortController());
			// Lost: the connection ended, or pine there stopped answering with SSH still up. Either way it is made again.
			const lost = () => {
				if (current === held) void reconnect(host);
			};
			void connection.closed.then(lost);
			followEvents(held.daemon, events.signal, { batch: (b) => emit("events", b), connection: setConnected, lost: (times) => (times >= STREAM_LOSSES ? (lost(), true) : false) });
			return "ready";
		} catch (e) {
			if (mine !== round) return "superseded";
			const cut = dropped;
			await letGo();
			if (e instanceof ServiceTrouble && e.message === "timeout") return passing(serviceTrouble(host, e));
			// The connection went while pine service was asked: the network, not the machine.
			if (cut) return passing(`The connection to ${host} was lost while pine there was asked to start.`);
			if (e instanceof ServiceTrouble) return final({ status: "error", kind: "ssh", host, message: serviceTrouble(host, e) });
			return final({ status: "error", kind: "failed", host, message: e instanceof Error ? e.message : String(e) });
		}
	};

	// Connecting again after a loss: at once, then after each failure a longer wait (`backoff`),
	// cut short by `wake()`. It ends when connected, at a trouble only the owner can fix, or when
	// anything else connects or lets go (`round` moved on).
	let nudge: (() => void) | undefined;
	let reconnecting = false;
	const reconnect = async (host: string) => {
		if (reconnecting) return;
		reconnecting = true;
		try {
			for (let n = 0; ; n++) {
				const outcome = await connectTo(host, { say: n >= QUIET_TRIES - 1 });
				if (outcome !== "passing") return;
				const before = round;
				await Promise.race([wait(backoff(n)), new Promise<void>((r) => (nudge = r))]);
				nudge = undefined;
				if (round !== before) return;
			}
		} finally {
			reconnecting = false;
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
			const flag = (k: "notify" | "updates" | "keepRunning") => (typeof change[k] === "boolean" ? (change[k] as boolean) : kept.prefs[k]);
			const next: PagePrefs = { notify: flag("notify"), updates: flag("updates"), keepRunning: flag("keepRunning") };
			const look = "look" in change ? cleanLook(change.look) : kept.prefs.look;
			if (look) next.look = look;
			const storage = "storage" in change ? cleanStorage(change.storage) : kept.prefs.storage;
			if (storage) next.storage = storage;
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
		/** One of the daemon's pictures, videos or sounds, as bytes the page makes its own object URL of. */
		async media(target: string) {
			const checked = mediaTarget(target);
			const daemon = state.status === "ready" ? current?.daemon : undefined;
			if (!daemon) throw new Error("not found: pine is not connected");
			return mediaOf(daemon, checked);
		},
		async open(url: string) {
			const href = webAddress(url);
			if (!deps.open) throw new Error("This browser cannot open another tab.");
			deps.open(href);
		},
		/** What the page saves goes to the browser's downloads: the page is told the name it was given. */
		async saveText(name: string, text: string) {
			const named = fileName(name);
			if (!deps.save) throw new Error("This browser cannot save a file.");
			deps.save(named, text);
			return named;
		},
		deviceKey: () => keyLine(),
		copyKey: async () => deps.clipboard(await keyLine()),
		shareKey: async () => {
			const line = await keyLine();
			return deps.share ? deps.share("This browser's SSH key", line) : deps.clipboard(line);
		},
		/** The network is back or the tab is shown again: a connection being made again is tried now, not after its wait. */
		wake() {
			nudge?.();
		},
		/** Lets go of the connection (the tests; a closed tab ends it anyway). */
		stop() {
			round++;
			void letGo();
		},
	};
	return bridge;
}
