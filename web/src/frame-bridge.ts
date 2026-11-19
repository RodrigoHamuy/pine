// The page's `window.pine` inside its iframe: every call that needs the owner's machine is asked of
// the web bridge at the top by message (protocol.ts), which holds the SSH connection and the
// daemon's token; the page holds neither. What only the desktop app can do refuses or does
// nothing here, as the preview's stand-in does (desktop/src/preview-bridge.ts), without asking.
import type { PageBridge } from "../../desktop/src/bridge.ts";
import type { Ask, BridgeEvent, Method } from "./protocol.ts";

type Target = { postMessage(data: unknown, targetOrigin: string): void };
type MessageSource = { addEventListener(type: "message", fn: (event: { data: unknown; source: unknown }) => void): void };

/** The page's bridge, talking to `parent` (the top's window) and hearing it on `self`. */
export function frameBridge(parent: Target, self: MessageSource): PageBridge {
	let next = 1;
	const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	const heard = new Map<BridgeEvent, Set<(value: any) => void>>();

	self.addEventListener("message", (e) => {
		if (e.source !== parent) return;
		const data = e.data as { pine?: string; id?: number; value?: unknown; error?: string; event?: BridgeEvent };
		if (data?.pine === "reply" && typeof data.id === "number") {
			const w = waiting.get(data.id);
			waiting.delete(data.id);
			if (typeof data.error === "string") w?.reject(new Error(data.error));
			else w?.resolve(data.value);
		} else if (data?.pine === "event" && data.event) heard.get(data.event)?.forEach((fn) => fn(data.value));
	});

	const ask = <T = any>(method: Method, ...args: unknown[]): Promise<T> =>
		new Promise((resolve, reject) => {
			const id = next++;
			waiting.set(id, { resolve, reject });
			// Trailing arguments left out are not sent as `undefined`: the bridge counts them.
			while (args.length && args[args.length - 1] === undefined) args.pop();
			parent.postMessage({ pine: "call", id, method, args } satisfies Ask, "*");
		});
	const on = (event: BridgeEvent) => (fn: (value: any) => void) => {
		let set = heard.get(event);
		if (!set) heard.set(event, (set = new Set()));
		set.add(fn);
		return () => void set.delete(fn);
	};
	const never = () => () => undefined;

	return {
		onService: on("service"),
		onEvents: on("events"),
		onConnection: on("connection"),
		onFocus: on("focus"),
		onMenu: never,
		onInitLine: never,
		onVoice: never,
		onTermData: never,
		onTermExit: never,
		onTermRun: never,
		state: () => ask("state"),
		ready: () => void ask("ready").catch(() => undefined),
		call: (method: "GET" | "POST", url: string, body?: unknown) => ask("call", method, url, body),
		retry: () => ask("retry"),
		prefs: (change: Record<string, unknown>) => ask("prefs", change),
		use: (host?: string) => ask("use", host),
		addHost: (host: string) => ask("addHost", host),
		forgetHost: (host: string) => ask("forgetHost", host),
		trustHostKey: (host: string, fingerprint: string) => ask("trustHostKey", host, fingerprint),
		deviceKey: async () => {
			const key = await ask<string>("deviceKey");
			return { key, copy: () => ask("copyKey"), share: () => ask("shareKey") };
		},
		// What only the desktop app has, refused or done nothing.
		open: async () => {},
		saveText: async () => {
			throw new Error("Saving a file is not in the web client yet.");
		},
		contextMenu: async () => undefined,
		reveal: async () => {},
		notify: async () => {},
		badge: async () => {},
		update: async () => undefined,
		restart: async () => {
			throw new Error("The browser does not start pine: restart it on its machine.");
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
	} as PageBridge;
}
