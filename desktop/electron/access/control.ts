// Browser access as the app holds it: the owner's preferences (on or off, the meeting service's
// address, open at login), the file of the host key and the paired devices, the access host while
// it is on, the pairing that is open and the question to the owner, all read by the page as one
// state and changed by its calls. No Electron here, so that the tests drive it without a window:
// the app's main process hands it the keychain as the cipher, its notifications, the login item
// and the daemon of this computer.
import path from "node:path";
import { ACCESS_FILE, type AccessHost, type AccessHostOptions, type Cipher, fileVault, type HostStatus, startAccessHost } from "./host.ts";
import { createPairing, type Pairing, type PairingRequest } from "./pairing.ts";
import type { PeerPath } from "./peer.ts";
import { AccessStore, type Device } from "./store.ts";

/**
 * The address of the project's own service (the web client and the meeting service), which the
 * app uses unless the owner names another: the Worker `pine` of web/relay (`--env official`) on
 * the project's workers.dev account. A browser's key and its paired Macs belong to this address, so
 * changing it makes every owner pair again.
 */
export const OFFICIAL_SERVICE = "https://pine.drcmda.workers.dev";

/** The owner's choices, kept in the app's preferences. No `service`: the official one. */
export interface AccessPrefs {
	enabled: boolean;
	service?: string;
	openAtLogin: boolean;
}

/** The longest address taken. */
const ADDRESS_LENGTH = 200;

/** A meeting service's address as the owner wrote it, checked: `http(s)`, a host, no name or password. Its origin. */
export function serviceAddress(value: string): string {
	const text = value.trim();
	let url: URL;
	try {
		if (text.length > ADDRESS_LENGTH) throw new Error("too long");
		url = new URL(text);
	} catch {
		throw new Error("Write the address of the service as it opens in a browser, starting with https://");
	}
	if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) throw new Error("Write the address of the service as it opens in a browser, starting with https://");
	return url.origin;
}

/** The preferences as prefs.json keeps them: what is not one of them is left out. Off by default. */
export function readAccessPrefs(raw: unknown): AccessPrefs {
	const said = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	let service: string | undefined;
	try {
		service = typeof said.service === "string" && said.service ? serviceAddress(said.service) : undefined;
	} catch {
		// an address that is not one is not used
	}
	return { enabled: said.enabled === true, service, openAtLogin: said.openAtLogin === true };
}

/** A paired device as the page shows it. `connected`: it is connected now, by this kind of path (unknown while the path is being chosen). */
export interface AccessDevice {
	id: string;
	name: string;
	paired: string;
	seen?: string;
	connected?: { path?: PeerPath };
}

/**
 * Why browser access cannot be on: `keychain`, the system's keychain cannot encrypt the host key
 * here; `address`, no service address is known; `replaced`, another copy of this Mac's key waits
 * at the service; `failed`, the host could not start (`message` says why).
 */
export interface AccessProblem {
	kind: "keychain" | "address" | "replaced" | "failed";
	message: string;
}

/** What the page reads: the contract's state, and `problem` when there is one. */
export interface AccessState {
	enabled: boolean;
	/** The address in use: the owner's, or the official one (empty while there is none). */
	service: string;
	openAtLogin: boolean;
	/** `off` while no host runs; `waiting` at the meeting service; `unreachable` otherwise (also while it first connects). */
	status: "off" | "waiting" | "unreachable";
	devices: AccessDevice[];
	/** The open pairing: the link the QR code encodes, and when it stops working (an ISO date). */
	pairing?: { link: string; expires: string };
	/** The question to the owner: the device's name and the four digits its screen shows. */
	request?: PairingRequest;
	problem?: AccessProblem;
}

/** A change the page asks for. `service`: an address, or empty for the official one. */
export interface AccessChange {
	enabled?: boolean;
	service?: string;
	openAtLogin?: boolean;
}

/** The access host as the control drives it. `opened` is the stand-in's alone: it tells a stand-in phone the link. */
export type Host = AccessHost & { opened?(link: string): void };

export interface AccessControlOptions {
	/** The app's data folder: the file of browser access lies there. */
	folder: string;
	/** The keychain's encryption, or undefined where it cannot be used. */
	cipher: () => Cipher | undefined;
	prefs: { read(): AccessPrefs; write(prefs: AccessPrefs): void };
	/** The address used when the owner named none (`OFFICIAL_SERVICE`). */
	official?: string;
	/** This computer's daemon, as the app's own window gets it: `pine service`'s line. */
	daemon: () => Promise<string>;
	/** Sets or clears the app's login item. */
	loginItem: (open: boolean) => void;
	/** A device was added (the app's notification). Not called for a device that connects again. */
	paired: (device: Device) => void;
	/** The state changed. */
	changed: (state: AccessState) => void;
	/** The name a paired browser stores for this Mac. */
	computerName?: () => string;
	/** Starts the access host (`startAccessHost`; a test's stand-in). */
	start?: (options: AccessHostOptions) => Promise<Host>;
}

export interface AccessControl {
	state(): Promise<AccessState>;
	set(change: AccessChange): Promise<AccessState>;
	/** Opens a pairing (closing the one that was open): the link, and when it stops working. */
	openPairing(): Promise<{ link: string; expires: string }>;
	cancelPairing(): Promise<void>;
	/** The owner's answer to the question about a device. */
	answer(yes: boolean): Promise<void>;
	remove(id: string): Promise<boolean>;
	/** At the app's start: the host starts when browser access was left on. */
	start(): Promise<void>;
	/** At the app's end: the host stops. */
	stop(): Promise<void>;
}

const NO_KEYCHAIN = "This Mac's keychain cannot be used here, and browser access keeps this Mac's key encrypted by it: browser access cannot be turned on.";
const NO_ADDRESS = "Browser access needs the address of the service a browser opens: write the address of your own deployment of pine's web client.";
const REPLACED = "Another copy of Pine with this Mac's key waits at the service now, so this one stopped. Turn browser access off and on again to wait here.";

export function createAccessControl(options: AccessControlOptions): AccessControl {
	const official = options.official ?? OFFICIAL_SERVICE;
	const file = path.join(options.folder, ACCESS_FILE.sealed);
	const startHost = options.start ?? startAccessHost;

	let host: Host | undefined;
	let pairing: Pairing | undefined;
	let asking: { request: PairingRequest; resolve: (yes: boolean) => void } | undefined;
	let failure: AccessProblem | undefined;
	let expiry: ReturnType<typeof setTimeout> | undefined;
	/** Starting and stopping the host, one after the other. */
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		const next = queue.then(work, work);
		queue = next.catch(() => {});
		return next;
	};

	let scheduled = false;
	const emit = () => {
		if (scheduled) return;
		scheduled = true;
		setImmediate(() => {
			scheduled = false;
			void state().then(options.changed, () => {});
		});
	};

	const serviceOf = (prefs: AccessPrefs) => prefs.service ?? official;

	/** What keeps browser access from being turned on, whatever the owner chose. */
	const blocked = (prefs: AccessPrefs): AccessProblem | undefined => {
		if (!options.cipher()) return { kind: "keychain", message: NO_KEYCHAIN };
		if (!serviceOf(prefs)) return { kind: "address", message: NO_ADDRESS };
		return undefined;
	};

	/** The kept devices while no host runs: read from the file when there is one; none is made. */
	async function kept(): Promise<AccessStore | undefined> {
		const cipher = options.cipher();
		if (!cipher) return undefined;
		const vault = fileVault(file, cipher);
		if ((await vault.load()) === undefined) return undefined;
		return AccessStore.open(vault);
	}

	async function state(): Promise<AccessState> {
		const prefs = options.prefs.read();
		let devices: Device[] = [];
		try {
			devices = host ? host.store.devices() : ((await kept())?.devices() ?? []);
		} catch {
			// a file that cannot be read shows no devices; starting the host says why
		}
		const live = new Map((host?.connected() ?? []).map((c) => [c.id, c.path]));
		const status = host?.status();
		const problem = blocked(prefs) ?? (status === "replaced" ? { kind: "replaced" as const, message: REPLACED } : failure);
		const opened = pairing?.current();
		return {
			enabled: prefs.enabled,
			service: serviceOf(prefs),
			openAtLogin: prefs.openAtLogin,
			status: !host ? "off" : status === "waiting" ? "waiting" : "unreachable",
			devices: devices.map((d) => ({ id: d.id, name: d.name, paired: d.paired, ...(d.seen ? { seen: d.seen } : {}), ...(live.has(d.id) ? { connected: { path: live.get(d.id) } } : {}) })),
			...(opened ? { pairing: { link: opened.link, expires: opened.expires.toISOString() } } : {}),
			...(asking ? { request: { ...asking.request } } : {}),
			...(problem ? { problem } : {}),
		};
	}

	/** The owner is asked about a device: the question stands until answered or withdrawn. */
	const ask = (request: PairingRequest, signal: AbortSignal) =>
		new Promise<boolean>((resolve) => {
			const mine = { request: { name: request.name, code: request.code }, resolve };
			asking = mine;
			signal.addEventListener(
				"abort",
				() => {
					if (asking === mine) asking = undefined;
					resolve(false);
					emit();
				},
				{ once: true },
			);
			emit();
		});

	async function up(prefs: AccessPrefs): Promise<void> {
		if (host || !prefs.enabled || blocked(prefs)) return;
		failure = undefined;
		try {
			host = await startHost({
				service: serviceOf(prefs),
				vault: fileVault(file, options.cipher()!),
				daemon: options.daemon,
				admit: ({ store, service, cut }) =>
					(pairing = createPairing({
						store,
						service,
						cut,
						ask,
						computerName: options.computerName,
						paired: (device) => {
							options.paired(device);
							emit();
						},
					})).admit,
				onStatus: (_status: HostStatus) => emit(),
				report: () => emit(),
			});
		} catch (e) {
			failure = { kind: "failed", message: `Browser access could not start: ${e instanceof Error ? e.message : String(e)}` };
		}
		emit();
	}

	async function down(): Promise<void> {
		clearTimeout(expiry);
		pairing?.cancel();
		pairing = undefined;
		asking = undefined;
		const was = host;
		host = undefined;
		await was?.stop();
		emit();
	}

	return {
		state,
		async set(change) {
			const prefs = { ...options.prefs.read() };
			if (change.service !== undefined) prefs.service = String(change.service).trim() ? serviceAddress(String(change.service)) : undefined;
			if (typeof change.enabled === "boolean") prefs.enabled = change.enabled;
			if (prefs.enabled && change.enabled === true) {
				const problem = blocked(prefs);
				if (problem) throw new Error(problem.message);
			}
			const moved = serviceOf(prefs) !== serviceOf(options.prefs.read());
			// Set every time it is asked: the owner may have taken the item out in the system's settings.
			if (typeof change.openAtLogin === "boolean") {
				options.loginItem(change.openAtLogin);
				prefs.openAtLogin = change.openAtLogin;
			}
			options.prefs.write(prefs);
			await serial(async () => {
				if (host && (!prefs.enabled || moved)) await down();
				await up(prefs);
			});
			emit();
			return state();
		},
		async openPairing() {
			if (!host || !pairing) throw new Error("Turn browser access on first.");
			const opened = pairing.open();
			clearTimeout(expiry);
			// The page is told when the code stops working.
			expiry = setTimeout(emit, Math.max(0, opened.expires.getTime() - Date.now()) + 50);
			host.opened?.(opened.link);
			emit();
			return { link: opened.link, expires: opened.expires.toISOString() };
		},
		async cancelPairing() {
			clearTimeout(expiry);
			pairing?.cancel();
			emit();
		},
		async answer(yes) {
			const now = asking;
			if (!now) throw new Error("No device is waiting for an answer now.");
			asking = undefined;
			now.resolve(yes === true);
			emit();
		},
		async remove(id) {
			let removed: boolean;
			if (host) removed = await host.remove(id);
			else removed = (await (await kept())?.remove(id)) ?? false;
			emit();
			return removed;
		},
		start: () => serial(() => up(options.prefs.read())),
		stop: () => serial(down),
	};
}
