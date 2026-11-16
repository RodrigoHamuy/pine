import { ProcessTerminal } from "@earendil-works/pi-tui";
import { loadConfig, type PineConfig } from "../config.ts";
import { findServer, listServers, piMcp, serverStates } from "../mcp-config.ts";
import { ensureDaemon } from "../service.ts";
import { PineTui } from "./app.ts";
import { Client } from "./client.ts";

/**
 * Open the terminal UI. It attaches to a running daemon; if none answers, it starts one inside
 * this process (logging to data/pine.log) and stops it again on exit.
 */
export async function runTui(cfg: PineConfig, opts: { folder?: string } = {}): Promise<void> {
	if (!cfg.http) throw new Error("the terminal UI needs the control API; remove \"http\": false from pine.json");
	if (!process.stdout.isTTY || !process.stdin.isTTY) throw new Error("the terminal UI needs an interactive terminal");
	const service = await ensureDaemon(cfg);
	const { base, token, mode } = service;
	const cleanup: Array<() => Promise<void> | void> = [() => service.stop()];

	const done = Promise.withResolvers<void>();
	const app = new PineTui({
		client: new Client(base, token),
		terminal: new ProcessTerminal(),
		mode,
		mcp: {
			// Read the files again each time: the daemon may have added a server since this UI started.
			list: async (states = true) => {
				const now = loadConfig(cfg.home);
				if (!states) return listServers(now).map((s) => ({ ...s, state: s.enabled ? undefined : "disabled" }));
				const found = await serverStates(now);
				return listServers(now).map((s) => ({ ...s, state: s.enabled ? (found[s.name] ?? (s.remote ? "unknown" : "local")) : "disabled" }));
			},
			login: async (name, onOutput) => {
				const now = loadConfig(cfg.home);
				const server = findServer(now, name);
				if (!server?.url) return onOutput(server ? `"${name}" is a local server and has no sign-in` : `no server "${name}"`), 1;
				return (await piMcp(now, { [name]: server }, ["login", name], { capture: true, onOutput })).code;
			},
		},
		onQuit: async () => {
			for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
			done.resolve();
		},
	});
	process.on("SIGTERM", () => void app.stop());
	try {
		await app.start();
		// Started as "pine <folder>": the same tabs as always, and one on that folder.
		if (opts.folder) await app.openFolder(opts.folder);
	} catch (e) {
		await app.stop();
		throw e;
	}
	await done.promise;
	process.exit(0);
}
