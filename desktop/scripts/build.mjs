// Builds the app into dist/ (the page) and dist-electron/ (main process and preload).
//   node scripts/build.mjs            everything
//   node scripts/build.mjs --main     only the main process and the preload (what `dev` needs)
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

export async function buildMain() {
	const common = { bundle: true, platform: "node", target: "node24", external: ["electron", "node-pty"], sourcemap: true, logLevel: "warning", absWorkingDir: root };
	await build({ ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.js", format: "esm" });
	// A sandboxed preload is loaded as a classic script.
	await build({ ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs", format: "cjs" });
}

if (import.meta.filename === process.argv[1]) {
	await buildMain();
	if (!process.argv.includes("--main")) execFileSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build"], { cwd: root, stdio: "inherit" });
}
