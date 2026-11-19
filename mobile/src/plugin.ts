// The native plugin's interface: what the mobile bridge (mobile-bridge.ts) asks of the Android
// side, registered with Capacitor under the name `Pine`. It is the contract the Kotlin plugin
// implements (ticket 06): the counterpart of what Electron's main process does for the desktop page
// (desktop/electron/main.ts, service.ts, daemon.ts and src/remote.ts). The plugin holds the SSH
// session and the daemon's token, and makes every call; the page never sees either.
//
// Capacitor's rules shape it: a method takes one object and resolves with one object (or nothing),
// and what the plugin tells the page arrives through `addListener(name, fn)` with one object each.
import type { PluginListenerHandle } from "@capacitor/core";
import type { CallResult } from "../../desktop/electron/daemon.ts";
import type { PineEvent } from "../../desktop/src/api.ts";
import type { ServiceState } from "../../desktop/src/bridge.ts";
import type { Palette } from "../../desktop/src/theme.ts";

/** The name the plugin is registered under, on both sides. */
export const PLUGIN_NAME = "Pine";

/**
 * The app's own origin (Capacitor's local server on Android), and where on it the page fetches the
 * daemon's pictures, video and sound: the plugin intercepts the requests under this path and answers
 * them from the daemon with the rules of `mediaFromDaemon` (daemon.ts).
 */
export const APP_ORIGIN = "https://localhost";
export const MEDIA_BASE = `${APP_ORIGIN}/_pine_media`;

/**
 * The page's own preferences, which the plugin stores as they are given and gives back. The bridge
 * has checked every value before (as main.ts does), so the plugin keeps the object whole: it reads
 * nothing in it.
 */
export interface PagePrefs {
	theme: "system" | "light" | "dark";
	notify: boolean;
	updates: boolean;
	keepRunning: boolean;
	codeFollowsPalette: boolean;
	palette?: Palette;
}

/** What the plugin has stored: the page's preferences, the machines and the one in use. */
export interface StoredPrefs {
	/** None before the first save: the bridge then uses its defaults. */
	prefs?: Partial<PagePrefs>;
	/** Each a host for ssh, as `addHost` accepted it, at most 20. */
	hosts: string[];
	/** The host in use, one of `hosts`, or none. */
	use?: string;
}

/**
 * The Kotlin plugin. Every method rejects with an error whose message the page can show as it is
 * (it reads like the desktop's: what happened, and what to do next).
 */
export interface PinePlugin {
	/** How the connection to the machine in use is (the desktop's `ServiceState`: only `starting`, `ready`, and `error` with kind `ssh` or `failed` here), whether the event stream is up, and the app's version. */
	state(): Promise<{ state: ServiceState; connected: boolean; version: string }>;
	/** The page has started: send `service` with the state as it is now, and follow the daemon's events (once). */
	ready(): Promise<void>;
	/**
	 * One call of the control API in the owner's name, exactly as `callDaemon` (daemon.ts) makes it:
	 * `{ok, status, data}`, with `data` the JSON answer or `{mime, base64}` for bytes; 503 "pine is not
	 * running yet" before a daemon; 400 "not a call of the control API" for a method other than GET or
	 * POST or a url that does not start with one "/"; status 0 when the daemon does not answer.
	 */
	call(options: { method: "GET" | "POST"; url: string; body?: unknown }): Promise<CallResult>;
	/** Connect again to the machine in use (after an error). */
	retry(): Promise<void>;
	/** Use the pine of a machine of the list: rejects a host that is not in it; stores it as the one in use; connects. */
	use(options: { host: string }): Promise<void>;
	/** Add a machine (checked as `sshHost` of src/remote.ts checks it; at most 20). Resolves with the list as it is now. */
	addHost(options: { host: string }): Promise<{ hosts: string[] }>;
	/** Take a machine out of the list and let go of its connection; rejects the one in use. Resolves with the list as it is now. */
	forgetHost(options: { host: string }): Promise<{ hosts: string[] }>;
	/** What the plugin has stored. */
	loadPrefs(): Promise<StoredPrefs>;
	/** Store the page's preferences, whole, in place of the ones stored. */
	savePrefs(options: { prefs: PagePrefs }): Promise<void>;
	/** Open an address in the phone's browser. The bridge sends only http(s); the plugin checks it again. */
	openExternal(options: { url: string }): Promise<void>;
	/** Hand a text to the system's share sheet (a conversation exported, the phone's key). Resolves once the sheet is shown. */
	share(options: { title: string; text: string }): Promise<void>;
	/** Put a text on the phone's clipboard (the phone's key). */
	copy(options: { text: string }): Promise<void>;
	/** Leave the app (the back button with nothing open in the page): it goes to the back, as Android's own apps do. */
	leave(): Promise<void>;
	// The phone's key and the machines' host keys.
	/** This phone's public key, in OpenSSH's format (`ssh-ed25519 AAAA... pine-android`), made on first use. */
	publicKey(): Promise<{ key: string }>;
	/**
	 * Trust the host key a connection stopped at. Until then the connection is an `error` of kind `ssh`
	 * whose message names the fingerprint (SHA256, as OpenSSH prints it), and which carries it
	 * (`fingerprint`, with `changed` false; a changed key is never trusted: the machine is forgotten
	 * and added again). The page's Trust this key button calls it, through the bridge's `trustHostKey`. Rejects a fingerprint that is not the one the host showed. The plugin then
	 * connects again.
	 */
	trustHostKey(options: { host: string; fingerprint: string }): Promise<void>;
	/** Forget the stored host key of a machine (after it changed for a reason the owner knows). */
	forgetHostKey(options: { host: string }): Promise<void>;

	/** The page's state of the connection changed (as `pine:service` on the desktop). */
	addListener(event: "service", fn: (data: { state: ServiceState }) => void): Promise<PluginListenerHandle>;
	/** A batch of the daemon's events, in order (as `pine:events`). */
	addListener(event: "events", fn: (data: { events: PineEvent[] }) => void): Promise<PluginListenerHandle>;
	/** The event stream came up or was lost (as `pine:connection`). */
	addListener(event: "connection", fn: (data: { connected: boolean }) => void): Promise<PluginListenerHandle>;
	/** The app came to the front (true, after the plugin checked the connection) or went to the back (false). */
	addListener(event: "focus", fn: (data: { focused: boolean }) => void): Promise<PluginListenerHandle>;
	/** A command for the page, as the desktop's menu sends it (`pine:menu`): the back button sends "back", which the bridge handles itself. */
	addListener(event: "menu", fn: (data: { command: string }) => void): Promise<PluginListenerHandle>;
}
