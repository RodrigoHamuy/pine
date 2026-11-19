// How the SSH core is bundled for a browser, by the build (scripts/build.ts) and the tests alike.
//
// The SSH library loads Node's own modules on paths a browser never takes (it picks WebCrypto
// when `self` exists, and the TCP package's listeners are not used for direct-tcpip). Its
// SshStream is a Node Duplex: the core reads channels directly and never makes one, so `stream`
// gets a Duplex that says so if anything ever does. Its Node implementations of the algorithms
// (`./node/...`) are only required where there is no WebCrypto. Parts of it use Node's global
// `Buffer`: in the bundle it is the `buffer` package's.
import { fileURLToPath } from "node:url";
import { build, type BuildOptions, type Plugin } from "esbuild";

const NODE_ONLY = /^(net|crypto|os|path|fs|child_process|stream|node-rsa|\.\/node\/.*)$/;

const nodeOnlyStubs: Plugin = {
	name: "node-only-stubs",
	setup(b) {
		b.onResolve({ filter: NODE_ONLY }, (args) => ({ path: args.path, namespace: "node-only" }));
		b.onLoad({ filter: /.*/, namespace: "node-only" }, (args) => ({
			contents:
				args.path === "stream"
					? 'module.exports = { Duplex: class Duplex { constructor() { throw new Error("Node streams are not in the browser build."); } } };'
					: "module.exports = {};",
			loader: "js",
		}));
	},
};

/** The options that make the SSH core run in a browser. */
export const browserOptions: BuildOptions = {
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2022",
	plugins: [nodeOnlyStubs],
	inject: [fileURLToPath(new URL("./buffer-shim.ts", import.meta.url))],
	define: { global: "globalThis" },
	logLevel: "silent",
};

/** `entry` bundled for a browser, as one script's text. */
export async function bundle(entry: string, options: BuildOptions = {}): Promise<string> {
	const out = await build({ ...browserOptions, ...options, entryPoints: [entry], write: false });
	return out.outputFiles![0].text;
}
