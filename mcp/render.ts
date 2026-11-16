// Helper program "render": one look at a web page with the browser pine ships, for the `http`
// event source with "render" (src/sources/http.ts, `rendered` in src/watching.ts). Not an MCP
// server: no agent ever talks to it. The daemon starts it for one look and ends it afterwards.
//
//   in   one line of JSON on its input:   { url, select?, attr?, timeout, localFile? }
//   out  one line of JSON on its output:  { ok: true, text | value, final }  or  { ok: false, error }
//
// What it does: starts the guard proxy of the browser server (mcp/browser.ts), starts Chromium
// without a window behind it, loads the address, waits until the page has loaded and the network
// is quiet, and takes what a reader sees: the text of the page, or of the first element a CSS
// selector matches, or an attribute of that element.
//
// What keeps the page where it belongs:
//   - Every connection the browser makes goes through the guard proxy, loopback included. The
//     proxy refuses private and local addresses, for the page and for everything the page loads.
//     The one exception is in `localFile`: the host and port the owner confirmed for this source,
//     written by the daemon into pine's data, where no agent writes.
//   - What could go around a proxy is switched off: QUIC, WebRTC outside the proxy, the browser's
//     own name lookups.
//   - A fresh profile for every look, no downloads, no service workers, no permissions.
//   - The selector and the attribute go to the page as values. No text from the job is ever run
//     as a script there.
import { createRequire } from "node:module";
import { sameSite } from "../src/watching.ts";
import { NO_WAY_AROUND, startGuardProxy } from "./browser.ts";

interface Job {
	url: string;
	select?: string;
	attr?: string;
	/** How long the whole look may take, in milliseconds. */
	timeout: number;
	localFile?: string;
}

type Answer = { ok: true; text?: string; value?: string | null; final: string } | { ok: false; error: string };

/** The most text one look hands back. */
const MAX_TEXT = 200_000;
/** How long the page is given to become quiet after it has loaded. A page that never does is taken as it is then. */
const QUIET = 5000;

const NOT_INSTALLED = "pine's browser is not installed on this computer. Your owner installs it by typing this into a terminal: pine browser-install";

/** Why the guard refused an address, as the status of a source says it. */
function whyRefused(line: string, host: string): string {
	if (/ is a (local name|private address)\b|resolves to a private address/.test(line)) return `${host} leads to an address on your own network. With "render" only an address that says by itself that it is local is opened there: localhost, a .local name or an IP address`;
	const dns = /\b(ENOTFOUND|EAI_AGAIN)\b/.exec(line) || /does not resolve/.exec(line);
	return dns ? `${host} was not found (no such name, or no network)` : `${host} could not be reached`;
}

const sentOn = (to: URL) => (/^https?:$/.test(to.protocol) ? `it sends on to ${to.host}, which is not the address that was confirmed. If that is the right one, set the source up with it` : "it leaves for something that is not a web page");

/** What Chromium's and Playwright's words for a failed load mean. Never the page's own words. */
function whyNot(e: unknown, seconds: number): string {
	const text = e instanceof Error ? e.message : String(e);
	if (/Timeout \d+ms exceeded/.test(text)) return `the page did not finish loading within ${seconds} s`;
	if (/Download is starting/.test(text)) return "it is a file to download, not a page";
	const net = /net::(ERR_[A-Z0-9_]+)/.exec(text)?.[1];
	if (net) return `the browser could not load it (${net.replace(/^ERR_/, "").toLowerCase().replace(/_/g, " ")})`;
	return "the browser could not load it";
}

/** One line from the input, and no more than a job can be. */
function readJob(): Promise<Job> {
	return new Promise((resolve, reject) => {
		let text = "";
		const done = () => {
			process.stdin.pause();
			try {
				const j = JSON.parse(text.split("\n")[0]);
				const url = new URL(String(j.url));
				if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("not a web address");
				if (j.select !== undefined && (typeof j.select !== "string" || !j.select.trim() || j.select.length > 1000)) throw new Error("not a selector");
				if (j.attr !== undefined && (typeof j.attr !== "string" || !/^[A-Za-z_:][\w:.-]*$/.test(j.attr))) throw new Error("not an attribute name");
				if (j.localFile !== undefined && typeof j.localFile !== "string") throw new Error("not a file");
				const timeout = Math.max(1000, Math.min(Number(j.timeout) || 30_000, 120_000));
				resolve({ url: url.href, select: j.select, attr: j.attr, timeout, localFile: j.localFile });
			} catch (e) {
				reject(new Error(`the job cannot be read (${e instanceof Error ? e.message : e})`));
			}
		};
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (d: string) => {
			text += d;
			if (text.includes("\n") || text.length > 64 * 1024) done();
		});
		process.stdin.on("end", done);
	});
}

/** What the page is asked for. It runs inside the page and gets the selector as a value. */
function take({ select, attr, max }: { select?: string; attr?: string; max: number }): { at: string; text?: string; value?: string | null; bad?: boolean } {
	const at = String(location.href);
	if (select === undefined) return { at, text: String(document.body ? document.body.innerText : (document.documentElement?.textContent ?? "")).slice(0, max) };
	let el: Element | null;
	try {
		el = document.querySelector(select);
	} catch {
		return { at, bad: true };
	}
	if (!el) return { at, value: null };
	if (attr !== undefined) {
		const v = el.getAttribute(attr);
		return { at, value: v === null ? null : String(v).slice(0, max) };
	}
	// An element that is not laid out as text (inside an svg) has no innerText.
	const inner = (el as HTMLElement).innerText;
	return { at, value: String(typeof inner === "string" ? inner : (el.textContent ?? "")).slice(0, max) };
}

/** Taken out of every page before its own scripts run: connections of this kind are made by the browser itself, past any proxy. */
const NO_PEERS = "for (const k of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceTransport', 'WebTransport']) { try { delete window[k]; Object.defineProperty(window, k, { value: undefined, configurable: false, writable: false }); } catch {} }";

async function look(job: Job): Promise<Answer> {
	const start = new URL(job.url);
	const seconds = Math.round(job.timeout / 100) / 10;
	const proxy = await startGuardProxy({ localFile: job.localFile });
	/** What the guard said about the page's own address, if it refused it. */
	const refusedPage = (url: URL) => {
		const port = url.port || (url.protocol === "https:" ? "443" : "80");
		const line = proxy.refused.find((r) => r.startsWith(`${url.hostname}:${port}: `) || r.startsWith(`${url.origin}/`));
		return line ? whyRefused(line, url.hostname) : undefined;
	};
	// Playwright's own copy that the browser server brought along: the browser that `pine browser-install` fetched fits it.
	const require = createRequire(createRequire(import.meta.url).resolve("@playwright/mcp"));
	const { chromium } = require("playwright-core");
	let browser: any;
	try {
		browser = await chromium.launch({
			headless: true,
			// The browser the browser server uses, so that a page reads the same in both.
			channel: "chrome-for-testing",
			// As Playwright's server has it: Chromium's own sandbox, except where Linux does not let a program make one.
			chromiumSandbox: process.platform !== "linux",
			// "<-loopback>": localhost and 127.0.0.1 go through the proxy too, where Chromium would connect to them directly.
			proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: "<-loopback>" },
			// What leads around a proxy is closed in the browser itself, as for the browser server.
			args: [
				...NO_WAY_AROUND,
				"--mute-audio",
			],
			timeout: Math.min(job.timeout, 30_000),
			// This program ends by process.exit, and Playwright ends the browser and removes its profile on the way out.
			handleSIGINT: false,
			handleSIGTERM: false,
			handleSIGHUP: false,
		});
	} catch (e) {
		const text = e instanceof Error ? e.message : String(e);
		if (/Executable doesn't exist|playwright install|is not found at/i.test(text)) return { ok: false, error: NOT_INSTALLED };
		return { ok: false, error: `pine's browser could not be started (${text.split("\n")[0].slice(0, 200)})` };
	}
	const context = await browser.newContext({ serviceWorkers: "block", acceptDownloads: false, permissions: [] });
	await context.addInitScript(NO_PEERS);
	const page = await context.newPage();
	// A window the page opens is not looked at, and does not stay.
	context.on("page", (other: any) => other !== page && void other.close().catch(() => {}));
	// Where the page itself was last asked for: after a load that failed, the browser no longer says.
	let asked = job.url;
	page.on("request", (r: any) => {
		if (r.isNavigationRequest() && r.frame() === page.mainFrame()) asked = r.url();
	});
	let status = 0;
	try {
		const response = await page.goto(job.url, { waitUntil: "load", timeout: job.timeout });
		status = response?.status() ?? 0;
	} catch (e) {
		const refused = refusedPage(start);
		if (refused) return { ok: false, error: refused };
		const at = URL.parse(asked) ?? start;
		if (!sameSite(start, at)) return { ok: false, error: sentOn(at) };
		return { ok: false, error: whyNot(e, seconds) };
	}
	// What a script fills in comes after the load. Quiet means no request for half a second.
	await page.waitForLoadState("networkidle", { timeout: QUIET }).catch(() => {});
	let got: ReturnType<typeof take>;
	try {
		got = await page.evaluate(take, { select: job.select, attr: job.attr, max: MAX_TEXT });
	} catch (e) {
		// A page that moved on while it was read: once more, on the page it is now.
		await page.waitForLoadState("load", { timeout: QUIET }).catch(() => {});
		try {
			got = await page.evaluate(take, { select: job.select, attr: job.attr, max: MAX_TEXT });
		} catch {
			return { ok: false, error: /Timeout \d+ms exceeded/.test(String(e)) ? whyNot(e, seconds) : "the page could not be read" };
		}
	}
	let final: URL;
	try {
		final = new URL(String(got?.at));
	} catch {
		return { ok: false, error: "the page could not be read" };
	}
	// The owner confirmed one host. Where the page went from there is another decision.
	if (!sameSite(start, final)) return { ok: false, error: sentOn(final) };
	const refused = refusedPage(start);
	if (refused && status === 403) return { ok: false, error: refused };
	if (status >= 400) return { ok: false, error: `it answered ${status}` };
	if (got.bad) return { ok: false, error: '"select" is not a CSS selector the browser can read' };
	// The page says what it likes about itself, also how long its text is: cut here once more.
	if (job.select !== undefined) return { ok: true, value: typeof got.value === "string" ? got.value.slice(0, MAX_TEXT) : null, final: final.href };
	return { ok: true, text: String(got.text ?? "").slice(0, MAX_TEXT), final: final.href };
}

if (import.meta.main) {
	// The one line this program says. Leaving through process.exit ends the browser with it.
	let said = false;
	const say = (a: Answer) => {
		if (said) return;
		said = true;
		process.stdout.write(`${JSON.stringify(a)}\n`, () => process.exit(0));
	};
	for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => process.exit(1));
	// Whatever goes wrong in here is a failed look, said as one.
	for (const event of ["uncaughtException", "unhandledRejection"] as const) process.on(event, () => say({ ok: false, error: "the browser could not load it" }));
	// Whoever started it is gone: nobody waits for an answer.
	process.stdout.on("error", () => process.exit(1));
	try {
		const job = await readJob();
		const seconds = Math.round(job.timeout / 100) / 10;
		setTimeout(() => say({ ok: false, error: `the page did not finish loading within ${seconds} s` }), job.timeout);
		say(await look(job));
	} catch (e) {
		say({ ok: false, error: e instanceof Error ? e.message.split("\n")[0].slice(0, 300) : "the look failed" });
	}
}
