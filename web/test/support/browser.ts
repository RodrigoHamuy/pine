// A headless Chrome for Testing on a page of the test's own that carries the browser build of
// `entry`. Launched with a throwaway profile and no access to the login keychain; never a
// visible window.

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { chromium, type BrowserContext, type Page } from "playwright-core";

// The SSH library loads Node's own modules on paths a browser never takes (it picks WebCrypto
// when `self` exists, and the TCP package's listeners are not used for direct-tcpip).
// Its SshStream is a Node Duplex: the core reads channels directly and never makes one, so
// `stream` gets a Duplex that says so if anything ever does.
// Its Node implementations of the algorithms (`./node/...`) are only required where there is no
// WebCrypto.
const NODE_ONLY = /^(net|crypto|os|path|fs|child_process|stream|node-rsa|\.\/node\/.*)$/;
const nodeOnlyStubs: Plugin = {
	name: "node-only-stubs",
	setup(b) {
		b.onResolve({ filter: NODE_ONLY }, (args) => ({ path: args.path, namespace: "node-only" }));
		b.onLoad({ filter: /.*/, namespace: "node-only" }, (args) => ({
			contents: args.path === "stream"
				? 'module.exports = { Duplex: class Duplex { constructor() { throw new Error("Node streams are not in the browser build."); } } };'
				: "module.exports = {};",
			loader: "js",
		}));
	},
};

/** Chrome for Testing as Playwright installed it, the newest build there is. */
function chromeForTesting(): string {
	if (process.env.PINE_CHROME) return process.env.PINE_CHROME;
	const own = chromium.executablePath();
	if (existsSync(own)) return own;
	const cache = join(homedir(), "Library", "Caches", "ms-playwright");
	const builds = existsSync(cache) ? readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9))) : [];
	for (const name of builds) {
		for (const arch of ["chrome-mac-arm64", "chrome-mac"]) {
			const path = join(cache, name, arch, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing");
			if (existsSync(path)) return path;
		}
	}
	throw new Error("No Chrome for Testing: run `npx playwright-core install chromium` in web/, or set PINE_CHROME to its executable.");
}

export type Browser = { page: Page; stop(): Promise<void> };

export async function openPage(entry: string): Promise<Browser> {
	const bundle = await build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: "iife",
		platform: "browser",
		target: "es2022",
		plugins: [nodeOnlyStubs],
		inject: [fileURLToPath(new URL("./buffer-shim.ts", import.meta.url))],
		define: { global: "globalThis" },
		logLevel: "silent",
	});
	const script = bundle.outputFiles[0].text;
	const server: Server = createServer((req, res) => {
		if (req.url === "/bundle.js") {
			res.writeHead(200, { "content-type": "text/javascript" });
			res.end(script);
			return;
		}
		res.writeHead(200, { "content-type": "text/html" });
		res.end('<!doctype html><meta charset="utf-8"><script src="/bundle.js"></script>');
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const userDataDir = mkdtempSync(join(tmpdir(), "pine-web-chrome-"));
	const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
		headless: true,
		executablePath: chromeForTesting(),
		args: ["--use-mock-keychain", "--password-store=basic"],
	});
	const page = context.pages()[0] ?? (await context.newPage());
	page.on("pageerror", (error) => console.error("page error:", error));
	await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
	return {
		page,
		async stop() {
			await context.close();
			server.close();
			rmSync(userDataDir, { recursive: true, force: true });
		},
	};
}
