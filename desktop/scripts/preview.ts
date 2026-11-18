// The app's page in an ordinary browser (an editor's preview pane), reloading as you edit, on a
// throwaway pine: a home in a temp folder with two agents and the scripted model server of pine's
// tests, removed when the preview stops. With --home, on that pine home instead: the daemon that
// runs there, or one started for the preview and stopped with it; the home is never removed.
//   npm run dev:preview                     (the port from $PORT, 5173 by default)
//   npm run dev:preview -- --home ~/.pine
//   npm run dev:preview:home                (the same, at port 5174: beside the throwaway one)
//
// Vite's server stands where the app's main process stands: it holds the daemon's token and makes
// every call for the page (electron/daemon.ts, the same module as the app), and the page holds no
// token. The page gets a stand-in for the preload's bridge (src/preview-bridge.ts) that calls the
// routes below, all under /__pine/.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseArgs } from "node:util";
import { createServer, type Plugin } from "vite";
import { startMock } from "../../baseline/tests/mock.mjs";
import { callDaemon, followEvents, mediaFromDaemon, pageCsp } from "../electron/daemon.ts";
import { connect, type Service } from "../electron/service.ts";

const root = path.resolve(import.meta.dirname, "..");

// ---- the throwaway pine ------------------------------------------------------------------------

const write = (file: string, content: string) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

/** A pine home on the scripted model server, as desktop/test/app.test.ts writes its own: a main agent and a second one. */
function throwawayHome(modelServer: string): string {
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pine-preview-")));
	write(path.join(home, "models.json"), JSON.stringify({ providers: { mock: { name: "Mock", baseUrl: modelServer, api: "openai-completions", apiKey: "sk-mock", models: [{ id: "m", name: "Mock", contextWindow: 128000, maxTokens: 4096, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
	// Port 0: the system picks one, so that a pine the developer has running is left alone.
	write(path.join(home, "pine.json"), JSON.stringify({ http: { host: "127.0.0.1", port: 0 }, main: "main", defaults: { model: "mock/m", mode: "safe" }, security: { askAccess: false } }, null, 2));
	write(path.join(home, "agents", "main", "agent.json"), JSON.stringify({ description: "The main agent: it administers pine", delegates: ["scout"] }));
	write(path.join(home, "agents", "main", "workspace", "AGENTS.md"), "You are the main agent.\n");
	write(path.join(home, "agents", "scout", "agent.json"), JSON.stringify({ description: "Looks things up on the web" }));
	write(path.join(home, "agents", "scout", "workspace", "AGENTS.md"), "You are scout.\n");
	return home;
}

// ---- the routes the page's stand-in calls ------------------------------------------------------

/**
 * The names the preview is reached by: the loopback only, so that no other name (a rebound one)
 * passes for the page. Vite refuses such a name before this (`server.allowedHosts`); this holds
 * when somebody opens that up to reach the preview from another machine.
 */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** The page's own origin, from the address it was asked for; none for a name that is not the loopback. */
const ownOrigin = (req: IncomingMessage) => (LOOPBACK.test(req.headers.host ?? "") ? `http://${req.headers.host}` : undefined);

/**
 * A call is the page's when it is a POST of JSON from the page's own origin: a page elsewhere can
 * send neither that content type nor that `Origin` without the browser asking first, which nothing
 * here answers. A GET (the event stream, media) is refused when an `Origin` names another page.
 */
function fromPage(req: IncomingMessage, kind: "call" | "get"): boolean {
	const own = ownOrigin(req);
	if (!own) return false;
	if (kind === "get") return req.method === "GET" && (req.headers.origin === undefined || req.headers.origin === own);
	return req.method === "POST" && /^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "") && req.headers.origin === own;
}

/** A call's body: an attachment travels inside it, so the limit is a large one. */
async function readJson(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<unknown> {
	let size = 0;
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const json = (res: ServerResponse, status: number, data: unknown) => void res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(data));

function previewServer(service: Service, nonce: string): Plugin {
	const streams = new Set<AbortController>();
	return {
		name: "pine-preview",
		configureServer(server) {
			server.httpServer?.once("close", () => streams.forEach((s) => s.abort()));
			// A route that throws answers 500 and the preview goes on: a rejection that escaped would end Node.
			server.middlewares.use((req, res, next) => {
				answer(req, res, next).catch((e) => {
					console.error(`preview: ${req.method} ${req.url} failed: ${e instanceof Error ? e.message : e}`);
					if (!res.headersSent) json(res, 500, { error: "the preview failed on this call: its terminal says why" });
					else res.destroy();
				});
			});
			async function answer(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
				const url = new URL(req.url ?? "/", "http://preview");
				if (!url.pathname.startsWith("/__pine/")) {
					// The page and everything Vite serves for it: the app's policy, with the nonce of the
					// scripts Vite writes into the page and its socket for reloading.
					const host = req.headers.host ?? "localhost";
					res.setHeader("content-security-policy", pageCsp({ media: [], connect: [`ws://${host}`], script: [`'nonce-${nonce}'`] }));
					return next();
				}
				const route = url.pathname.slice("/__pine".length);
				if (route === "/call") {
					if (!fromPage(req, "call")) return json(res, 403, { error: "not from the page" });
					const notACall = () => json(res, 400, { error: "not a call of the control API: send a JSON object with method, url and body" });
					let parsed: unknown;
					try {
						parsed = await readJson(req);
					} catch {
						return notACall();
					}
					if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return notACall();
					const asked = parsed as { method?: unknown; url?: unknown; body?: unknown };
					return json(res, 200, await callDaemon(service, String(asked.method), String(asked.url), asked.body));
				}
				if (!fromPage(req, "get")) return json(res, 403, { error: "not from the page" });
				if (route === "/state") return json(res, 200, { state: { status: "ready", mode: service.mode, started: service.started, home: service.home, version: service.version, from: "the preview" }, platform: process.platform });
				if (route === "/events") {
					res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
					res.write(": open\n\n");
					const stream = new AbortController();
					streams.add(stream);
					req.once("close", () => (stream.abort(), streams.delete(stream)));
					followEvents(service, stream.signal, {
						batch: (events) => res.write(`data: ${JSON.stringify(events)}\n\n`),
						connection: (up) => res.write(`event: connection\ndata: ${up}\n\n`),
					});
					return;
				}
				if (route.startsWith("/media/")) {
					const media = await mediaFromDaemon(service, req.method ?? "GET", route.slice("/media".length), url.search);
					res.writeHead(media.status, Object.fromEntries(media.headers));
					// The daemon can drop the answer halfway: that ends this one response, not the preview.
					if (media.body) await pipeline(Readable.fromWeb(media.body as any), res).catch(() => res.destroy());
					else res.end();
					return;
				}
				json(res, 404, { error: "no such route" });
			}
		},
	};
}

// ---- start, and stop everything together -------------------------------------------------------

/**
 * The home `--home` names, as the developer typed it: from the folder `npm run` was typed in
 * (npm itself runs this in desktop/), with `~` for their home folder.
 */
function chosenHome(): string | undefined {
	const { values } = parseArgs({ options: { home: { type: "string" } } });
	if (!values.home) return undefined;
	const typed = values.home.replace(/^~(?=$|\/)/, os.homedir());
	return path.resolve(process.env.INIT_CWD ?? process.cwd(), typed);
}

const chosen = chosenHome();
// Only the throwaway pine needs the scripted model server: a chosen home has its own models.
const mock = chosen ? undefined : await startMock({ strip: /<pine-note>[\s\S]*?<\/pine-note>\s*/g });
const home = chosen ?? throwawayHome(mock!.baseUrl);
let service: Service | undefined;
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let stopping = false;

async function stop(code = 0): Promise<never> {
	if (!stopping) {
		stopping = true;
		await server?.close().catch(() => {});
		// A daemon that ran before the preview goes on: `stop` ends only one that `pine service` started.
		await service?.stop().catch(() => {});
		await mock?.close?.().catch(() => {});
		// A chosen home is the developer's: it is never removed.
		if (!chosen) fs.rmSync(home, { recursive: true, force: true });
	}
	process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => void stop());
// Whatever goes wrong, the throwaway home and the scripted model server go with the preview.
const crashed = (e: unknown) => {
	console.error("The preview stopped on an error:", e);
	void stop(1);
};
process.on("uncaughtException", crashed);
process.on("unhandledRejection", crashed);

try {
	// pine's command line of this checkout, on this Node. `connect` holds its input open: that is
	// how `pine service` knows its caller is alive.
	service = await connect({ argv: [process.execPath, path.join(root, "..", "bin", "pine.js")], env: { ...process.env }, from: "this checkout" }, { home });
	const nonce = randomBytes(16).toString("base64");
	server = await createServer({
		root,
		server: { host: "localhost", port: Number(process.env.PORT ?? 5173), strictPort: true },
		// The page's stand-in for the bridge exists only where this is true (vite.config.ts sets it false).
		define: { __PINE_PREVIEW__: "true" },
		html: { cspNonce: nonce },
		plugins: [previewServer(service, nonce)],
	});
	await server.listen();
	console.log(`preview  ${server.resolvedUrls?.local[0]}`);
	if (!chosen) console.log(`pine     ${service.base} on a throwaway home in ${home} (removed when the preview stops)`);
	else console.log(`pine     ${service.base} on ${home} (${service.started ? "started for the preview, stopped with it" : "the daemon that runs there, left running"})`);
} catch (e) {
	console.error(`The preview could not start: ${e instanceof Error ? e.message : e}`);
	await stop(1);
}
