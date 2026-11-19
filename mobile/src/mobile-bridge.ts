// The preload's bridge on a phone: what the desktop page asks of Electron's main process, asked of
// the native plugin instead (src/plugin.ts), which holds the SSH session and the daemon's token as
// the main process does. The phone has no pine of its own (`local: false`), so the page offers only
// other machines. What only the desktop app can do refuses or does nothing, as the preview's
// stand-in does (desktop/src/preview-bridge.ts).
import type { AppState, PageBridge, Prefs } from "../../desktop/src/bridge.ts";
import { cleanPalette } from "../../desktop/src/theme.ts";
import { MEDIA_BASE, type PagePrefs, type PinePlugin } from "./plugin.ts";

const DEFAULTS: PagePrefs = { theme: "system", notify: false, updates: false, keepRunning: false, codeFollowsPalette: true };

/** What is open over the page: a sheet, a dialog, a menu (Base UI's popups, mounted only while open; a listbox is not one: the side bar's list of agents is always there). */
const OPEN = '[role="dialog"], [role="alertdialog"], [role="menu"]';

/**
 * Android's back button: what is open over the page is closed as Escape closes it on the desktop,
 * and with nothing open the app is left, as Android's own apps do.
 */
function back(leave: () => void): void {
	const doc = typeof document === "undefined" ? undefined : document;
	if (!doc?.querySelector(OPEN)) return leave();
	(doc.activeElement ?? doc.body)?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
}

/** The page's bridge, on the plugin it is given (Capacitor's in the app, a fake in the tests). */
export function mobileBridge(plugin: PinePlugin): PageBridge {
	// The page's preferences and the machines, as the plugin last gave them.
	let prefs: Prefs = { ...DEFAULTS, hosts: [] };

	const load = async () => {
		const stored = await plugin.loadPrefs();
		prefs = { ...DEFAULTS, ...stored.prefs, hosts: stored.hosts, ...(stored.use ? { use: stored.use } : {}) };
	};

	// The page's listeners of each kind. The plugin is listened to once per kind, on the first page
	// listener, and each of its messages is unwrapped into what Electron's channel carries.
	type Listener = (value: any) => void;
	const heard = new Map<string, Set<Listener>>();
	// `own` takes a message for the bridge itself, which the page then never hears (the back button).
	const on =
		(event: "service" | "events" | "connection" | "focus" | "menu", unwrap: (data: any) => unknown, own: (value: unknown) => boolean = () => false) =>
		(fn: Listener) => {
			let set = heard.get(event);
			if (!set) {
				heard.set(event, (set = new Set()));
				const all = set;
				void plugin.addListener(event as any, (data: unknown) => {
					const value = unwrap(data);
					if (!own(value)) all.forEach((f) => f(value));
				});
			}
			set.add(fn);
			return () => void set.delete(fn);
		};
	const never = () => () => undefined;

	return {
		mediaBase: MEDIA_BASE,
		onService: on("service", (d) => d.state),
		onEvents: on("events", (d) => d.events),
		onConnection: on("connection", (d) => d.connected),
		onFocus: on("focus", (d) => d.focused),
		onMenu: on(
			"menu",
			(d) => d.command,
			(command) => command === "back" && (back(() => void plugin.leave()), true),
		),
		// Only the desktop app starts pine, has a terminal or listens to the microphone.
		onInitLine: never,
		onVoice: never,
		onTermData: never,
		onTermExit: never,
		onTermRun: never,
		state: async (): Promise<AppState> => {
			const [s] = await Promise.all([plugin.state(), load()]);
			return { state: s.state, connected: s.connected, home: s.state.status === "ready" ? s.state.home : undefined, prefs: { ...prefs }, platform: "android", focused: true, updates: false, versions: { app: s.version, electron: "none" }, local: false };
		},
		// As Electron's `send`, nothing to wait for: a plugin that cannot start says so as a connection that failed.
		ready: () =>
			void plugin.ready().catch((e: unknown) => {
				const state = { status: "error", kind: "failed", message: e instanceof Error ? e.message : String(e) };
				heard.get("service")?.forEach((fn) => fn(state));
			}),
		// Checked as main.ts checks the owner's change; the machines are changed by their own methods only.
		prefs: async (change: Record<string, unknown>) => {
			const next: PagePrefs = {
				theme: change.theme === "system" || change.theme === "light" || change.theme === "dark" ? change.theme : prefs.theme,
				notify: typeof change.notify === "boolean" ? change.notify : prefs.notify,
				updates: typeof change.updates === "boolean" ? change.updates : prefs.updates,
				keepRunning: typeof change.keepRunning === "boolean" ? change.keepRunning : prefs.keepRunning,
				codeFollowsPalette: typeof change.codeFollowsPalette === "boolean" ? change.codeFollowsPalette : prefs.codeFollowsPalette,
			};
			// A reset sends none: nothing is stored, and the page draws pine's default.
			const palette = "palette" in change ? cleanPalette(change.palette) : prefs.palette;
			if (palette) next.palette = palette;
			await plugin.savePrefs({ prefs: next });
			prefs = { ...next, hosts: prefs.hosts, ...(prefs.use ? { use: prefs.use } : {}) };
			return { ...prefs };
		},
		call: (method: "GET" | "POST", url: string, body?: unknown) => plugin.call({ method, url, body }),
		// After a host key the phone does not know yet, the page's Try again is the owner's yes to the
		// fingerprint its message showed: exactly that key is trusted. A changed key is never trusted here.
		retry: async () => {
			const { state } = await plugin.state();
			if (state.status === "error" && state.host && state.fingerprint && state.changed === false) await plugin.trustHostKey({ host: state.host, fingerprint: state.fingerprint });
			else await plugin.retry();
		},
		use: async (host?: string) => {
			// The page never asks for it when `local` is false; a stray call is refused here, not sent.
			if (!host) throw new Error("This phone has no pine of its own: choose one of your machines.");
			await plugin.use({ host });
			prefs = { ...prefs, use: host };
		},
		addHost: async (host: string) => {
			prefs = { ...prefs, hosts: (await plugin.addHost({ host })).hosts };
			return { ...prefs };
		},
		// A machine forgotten takes its host key along: added again, it is asked about as a new one.
		forgetHost: async (host: string) => {
			prefs = { ...prefs, hosts: (await plugin.forgetHost({ host })).hosts };
			if (prefs.use === host) delete prefs.use;
			await plugin.forgetHostKey({ host });
			return { ...prefs };
		},
		deviceKey: async () => {
			const { key } = await plugin.publicKey();
			return { key, copy: () => plugin.copy({ text: key }), share: () => plugin.share({ title: "This phone's SSH key", text: key }) };
		},
		// Only an address of the web, as main.ts's openOutside: the plugin checks it again.
		open: async (url: string) => {
			if (/^https?:\/\//i.test(url)) await plugin.openExternal({ url });
		},
		// No files to save into on a phone: the share sheet says where it goes.
		saveText: async (name: string, text: string) => {
			await plugin.share({ title: name, text });
			return name;
		},
		// No context menus on a phone yet: the page's right-click actions do nothing.
		contextMenu: async () => undefined,
		reveal: async () => {},
		notify: async () => {},
		badge: async () => {},
		// What only the desktop app has, refused or done nothing as desktop/src/preview-bridge.ts does.
		update: async () => undefined,
		restart: async () => {
			throw new Error("The phone does not start pine: restart it on its machine.");
		},
		init: async () => 1,
		browserInstall: async () => 1,
		command: async () => ({ state: "unavailable", text: "" }),
		voiceStart: async () => {
			throw new Error("Voice input needs a Mac: it uses the speech recognition macOS has on the device.");
		},
		voiceStop: async () => {},
		pickFolder: async () => undefined,
		pathOf: () => "",
		termOpen: async () => {
			throw new Error("The terminal is in the desktop app only.");
		},
		termWrite: async () => {},
		termRun: async () => ({ reports: false }),
		termResize: async () => {},
		termClose: async () => {},
	};
}
