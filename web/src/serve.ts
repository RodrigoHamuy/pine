// The web bridge's door: messages from the page's iframe, and from it alone, become calls of the
// bridge, one method of the fixed list at a time with its arguments checked (protocol.ts); the
// answers and what the bridge tells go back to that iframe and nowhere else.
//
// The page runs under an opaque origin (sandboxed with scripts only), so a message to it cannot
// name its origin: it is addressed to the iframe's window by the object itself, and a message is
// taken from it by comparing its `source` with that object.
import { EVENTS, isMethod, METHODS, type BridgeEvent, type Method, type Reply, type Tell } from "./protocol.ts";

/** The bridge as the door uses it: one function per method of the list, and its events. */
export type Served = { [M in Method]: (...args: any[]) => unknown } & { on(event: BridgeEvent, fn: (value: unknown) => void): void };

type Target = { postMessage(data: unknown, targetOrigin: string): void };
type MessageSource = { addEventListener(type: "message", fn: (event: { data: unknown; source: unknown }) => void): void };

/** What an error says to the page: its message, which the page shows as it is. */
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Serves `bridge` to the window `frame()` returns (the iframe's, or nothing while there is none):
 * messages that arrive at `top` from it are answered; any other window is not heard, and never
 * answered.
 */
export function serve(bridge: Served, top: MessageSource, frame: () => Target | null | undefined): void {
	const post = (message: Reply | Tell) => frame()?.postMessage(message, "*");
	for (const event of EVENTS) bridge.on(event, (value) => post({ pine: "event", event, value }));
	top.addEventListener("message", (e) => {
		const page = frame();
		if (!page || e.source !== page) return;
		const data = e.data as { pine?: unknown; id?: unknown; method?: unknown; args?: unknown };
		if (!data || typeof data !== "object" || data.pine !== "call" || typeof data.id !== "number") return;
		const id = data.id;
		if (!isMethod(data.method)) return post({ pine: "reply", id, error: `"${String(data.method).slice(0, 40)}" is not something the web bridge does.` });
		const method = data.method;
		const args = data.args;
		if (!Array.isArray(args) || !METHODS[method](args)) return post({ pine: "reply", id, error: `The arguments of ${method} are not what it takes.` });
		void (async () => {
			try {
				post({ pine: "reply", id, value: await (bridge[method] as (...a: unknown[]) => unknown)(...args) });
			} catch (e) {
				post({ pine: "reply", id, error: said(e) });
			}
		})();
	});
}
