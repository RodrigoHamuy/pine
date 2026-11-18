// The browser of a conversation, for a window of the owner's own that shows it (the Pine app,
// beside the conversation). The bundled browser server (mcp/browser.ts) is another process; it
// has a door on the loopback for the daemon alone and says where that is in a file in pine's
// data, which no agent reads. Here the daemon goes through that door, in the owner's name: the
// control API calls this, and nothing else does. No agent has a tool for it.
//
// What comes back is outside content of the plainest kind: a picture of a page, and the page's
// address and title as one line each. The daemon passes it on and reads nothing into it.
import fs from "node:fs";
import path from "node:path";

export interface BrowserState {
	/** A page is open, and there is a picture of it. */
	open: boolean;
	tabs: Array<{ title: string; url: string }>;
	current: number;
	/** The browser is a window on the owner's screen as well. */
	window: boolean;
	error?: string;
	/** The addresses the agent opened in this conversation, newest first: what a browser with no page open offers again. The daemon's own note, not the door's. */
	visited?: string[];
}

const CLOSED: BrowserState = { open: false, tabs: [], current: 0, window: false };

/** A line of a page's own (a title, an address) as the daemon hands it on: text, one line, bounded. */
const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").slice(0, max) : "");

/** How many addresses a conversation keeps of those its agent opened. */
export const VISITED = 12;

/**
 * An address the agent opened, as it is kept and offered to the owner again: one of the web,
 * written out with its scheme, one bounded line, and without a name and password in it.
 */
export function keptAddress(given: unknown): string | undefined {
	const text = typeof given === "string" ? given.trim() : "";
	if (!text || text.length > 2000 || !/^https?:\/\//i.test(text)) return undefined;
	try {
		const url = new URL(text);
		url.username = url.password = "";
		return line(url.href, 2000) || undefined;
	} catch {
		return undefined;
	}
}

/** What the door answered, taken for nothing but what it has to be. */
function stateOf(raw: any): BrowserState {
	const tabs = Array.isArray(raw?.tabs) ? raw.tabs.slice(0, 100).map((t: any) => ({ title: line(t?.title, 200), url: line(t?.url, 2000) })) : [];
	const error = line(raw?.error, 300);
	return { open: raw?.open === true, tabs, current: Number.isInteger(raw?.current) && raw.current >= 0 && raw.current < Math.max(1, tabs.length) ? raw.current : 0, window: raw?.window === true, ...(error ? { error } : {}) };
}

export class BrowserViews {
	private readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	/** Where the browser of a conversation says how its door is reached. */
	file(perm: string): string {
		return path.join(this.dir, `${encodeURIComponent(perm)}.json`);
	}

	/** Nothing is left over from the last run of the daemon: a door that was noted then is gone. */
	clear(): void {
		fs.rmSync(this.dir, { recursive: true, force: true });
	}

	/** The door of a conversation's browser, if that conversation has a browser running. Always the loopback. */
	private door(perm: string): { base: string; token: string } | undefined {
		try {
			const said = JSON.parse(fs.readFileSync(this.file(perm), "utf8"));
			if (!Number.isInteger(said.port) || said.port < 1 || said.port > 65535 || typeof said.token !== "string" || !/^[0-9a-f]{64}$/.test(said.token)) return undefined;
			return { base: `http://127.0.0.1:${said.port}`, token: said.token };
		} catch {
			return undefined;
		}
	}

	private async ask(perm: string, method: "GET" | "POST", at: string, body?: unknown, ms = 60_000): Promise<Response | undefined> {
		const door = this.door(perm);
		if (!door) return undefined;
		try {
			return await fetch(door.base + at, {
				method,
				headers: { authorization: `Bearer ${door.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
				body: body !== undefined ? JSON.stringify(body) : undefined,
				redirect: "error",
				signal: AbortSignal.timeout(ms),
			});
		} catch {
			// A browser that ended a moment ago, or one that is busy for longer than anybody waits.
			return undefined;
		}
	}

	private async said(res: Response | undefined): Promise<BrowserState> {
		if (!res?.ok) return CLOSED;
		return stateOf(await res.json().catch(() => undefined));
	}

	/** Whether this conversation has a browser at all (its session is live and has the bundled browser). */
	has(perm: string): boolean {
		return this.door(perm) !== undefined;
	}

	async state(perm: string): Promise<BrowserState> {
		return this.said(await this.ask(perm, "GET", "/state", undefined, 20_000));
	}

	/** The page as a picture, or nothing: no browser, no page, or no picture this time. */
	async frame(perm: string): Promise<Buffer | undefined> {
		const res = await this.ask(perm, "GET", "/frame", undefined, 20_000);
		if (!res || res.status !== 200 || res.headers.get("content-type") !== "image/jpeg") return undefined;
		const bytes = Buffer.from(await res.arrayBuffer());
		// A JPEG, and of a size a picture of a page has.
		return bytes.length > 3 && bytes.length < 20_000_000 && bytes[0] === 0xff && bytes[1] === 0xd8 ? bytes : undefined;
	}

	async input(perm: string, ops: unknown): Promise<BrowserState> {
		return this.said(await this.ask(perm, "POST", "/input", { ops }));
	}

	async open(perm: string, url: string): Promise<BrowserState> {
		return this.said(await this.ask(perm, "POST", "/open", { url }, 90_000));
	}

	/** Tell a conversation's browser that the owner's own window shows it (or no longer does). */
	async embed(perm: string, on: boolean): Promise<void> {
		await this.ask(perm, "POST", "/embed", { on }, 5000);
	}
}
