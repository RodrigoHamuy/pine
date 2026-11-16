import fs from "node:fs";
import path from "node:path";
import type { PineConfig } from "./config.ts";

// A UI is a client of the daemon (the terminal UI, an app of its own). Before it can be one,
// there has to be a daemon: this finds the one that runs for this home, or starts one inside
// the process that asks. The terminal UI asks in its own process; another program asks through
// `pine service`, which is this function with its answer on one line.

export interface Service {
	/** Where the control API answers. */
	base: string;
	token: string;
	mode: "attached" | "embedded daemon" | "embedded daemon + claude -p";
	/** Whether this process started the daemon, and so is the one that stops it. */
	started: boolean;
	/** Stops what was started here. A daemon that was only attached to goes on. */
	stop(): Promise<void>;
}

const reachable = async (url: string, headers?: Record<string, string>) => {
	try {
		return (await fetch(url, { signal: AbortSignal.timeout(800), headers })).ok;
	} catch {
		return false;
	}
};

/** Where a home's control API is reached from the same machine. */
export const controlBase = (cfg: PineConfig) => `http://${cfg.http && cfg.http.host !== "0.0.0.0" ? cfg.http.host : "127.0.0.1"}:${cfg.http ? cfg.http.port : 0}`;

/**
 * The daemon of this home: the one that runs, or one started in this process (logging to
 * data/pine.log), which `stop` ends again.
 */
export async function ensureDaemon(cfg: PineConfig): Promise<Service> {
	if (!cfg.http) throw new Error('a UI needs the control API; remove "http": false from pine.json');
	const base = controlBase(cfg);
	if (await reachable(`${base}/health`)) {
		// Something answers. It is this home's daemon only if it takes this home's token: a second
		// home with the same port has a pine of its own there, and that one is not to be driven.
		const tokenFile = path.join(cfg.dataDir, "http-token");
		const token = cfg.http.token ?? (fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, "utf8").trim() : "");
		if (!token || !(await reachable(`${base}/status`, { authorization: `Bearer ${token}` }))) {
			throw new Error(`something answers on ${base}, but it is not the pine of ${cfg.home}: it does not take this home's token. Another pine home uses the same port. Stop that one, or give this home a port of its own ("http": { "port": ... } in ${path.join(cfg.home, "pine.json")}).`);
		}
		return { base, token, mode: "attached", started: false, stop: async () => {} };
	}
	const cleanup: Array<() => Promise<void> | void> = [];
	let mode: Service["mode"] = "embedded daemon";
	// A provider called "dev" is the claude -p stand-in; bring it up too if nothing serves it.
	try {
		const models = JSON.parse(fs.readFileSync(path.join(cfg.home, "models.json"), "utf8"));
		const dev = models.providers?.dev?.baseUrl as string | undefined;
		const uses = [cfg.defaults.model, ...Object.values(cfg.agents).map((a) => a.model)].some((m) => m?.startsWith("dev/"));
		if (dev && uses && !(await reachable(`${dev}/models`))) {
			const { startClaudeModel } = await import("./dev/claude-model.ts");
			const server = await startClaudeModel({ port: Number(new URL(dev).port) });
			cleanup.push(() => server.close());
			mode = "embedded daemon + claude -p";
		}
	} catch {
		// No models.json or no dev provider: nothing to start.
	}
	try {
		const { startPine } = await import("./pine.ts");
		const pine = await startPine({ config: cfg, logFile: path.join(cfg.dataDir, "pine.log") });
		cleanup.push(() => pine.stop());
		// (With port 0 the system picked one, and the configuration has it now.)
		return {
			base: controlBase(cfg),
			token: pine.token,
			mode,
			started: true,
			stop: async () => {
				for (const fn of cleanup.splice(0).reverse()) await Promise.resolve(fn()).catch(() => {});
			},
		};
	} catch (e) {
		for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
		throw e;
	}
}
