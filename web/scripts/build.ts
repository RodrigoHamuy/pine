// `npm run build`: the web client into dist/, which the relay's Worker serves (web/relay,
// wrangler.jsonc). dist/page/ is the desktop page built by Vite (vite.config.ts); dist/index.html
// and dist/bridge.js are the web bridge, the top-level document, bundled with the SSH core.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build as vite } from "vite";
import { bundle } from "./bundle.ts";

const here = path.resolve(import.meta.dirname, "..");
const dist = path.join(here, "dist");
const version = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8")).version as string;

await vite({ configFile: path.join(here, "vite.config.ts"), logLevel: "warn" });

const script = await bundle(path.join(here, "src", "bridge-main.ts"), { define: { global: "globalThis", __PINE_WEB_VERSION__: JSON.stringify(version) }, minify: true });
writeFileSync(path.join(dist, "bridge.js"), script);

// The bridge's own policy: its script, its relay on the same host, and the page's frame; nothing from elsewhere.
const csp = ["default-src 'none'", "script-src 'self'", "style-src 'unsafe-inline'", "connect-src 'self'", "frame-src 'self'", "base-uri 'none'", "form-action 'none'", "object-src 'none'"].join("; ");
writeFileSync(
	path.join(dist, "index.html"),
	`<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta http-equiv="Content-Security-Policy" content="${csp}" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="color-scheme" content="light dark" />
		<title>Pine</title>
		<style>
			html, body { margin: 0; height: 100%; background: #1b1e28; color: #e4e6ee; font: 16px system-ui, sans-serif; }
			iframe { display: block; border: 0; width: 100%; height: 100%; }
			.unsupported { max-width: 32rem; margin: 20vh auto; padding: 0 16px; line-height: 1.5; }
		</style>
	</head>
	<body>
		<script src="bridge.js"></script>
	</body>
</html>
`,
);
console.log(`web client ${version} built into ${path.relative(process.cwd(), dist) || "."}`);
