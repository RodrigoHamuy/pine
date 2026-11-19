// Development: the page from Vite's server (it reloads as you edit), the main process built once.
// The page is served at this checkout's own port (scripts/launch-json.mjs; $PORT wins, and the next
// free one is taken when it is in use). Electron, and the daemon it started, end with this process,
// and this process ends with whatever started it (scripts/leash.mjs).
//   npm run dev
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createServer } from "vite";
import { buildMain } from "./build.mjs";
import { ports } from "./launch-json.mjs";
import { whenParentGone } from "./leash.mjs";

const root = path.resolve(import.meta.dirname, "..");
await buildMain();
const server = await createServer({ root, server: { port: Number(process.env.PORT ?? ports().dev), strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];
const electron = createRequire(import.meta.url)("electron");
const child = spawn(electron, [root, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, PINE_DESKTOP_DEV_URL: url } });
child.on("close", async (code) => {
	await server.close();
	process.exit(code ?? 0);
});
// Electron quits on SIGTERM and stops the daemon it started; one that does not is ended.
whenParentGone(() => {
	if (child.exitCode !== null) return void server.close().finally(() => process.exit(0));
	child.kill("SIGTERM");
	setTimeout(() => child.kill("SIGKILL"), 15_000).unref();
});
