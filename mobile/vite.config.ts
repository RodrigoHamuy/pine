// The desktop page, built for the mobile app: desktop's own configuration (its plugins, its alias,
// the preview's stand-in left out), with mobile/ as the root so that index.html loads src/main.ts,
// which installs the mobile bridge before the page. The build goes to dist/, Capacitor's webDir.
import path from "node:path";
import { mergeConfig, type Plugin } from "vite";
import { pageCsp } from "../desktop/electron/daemon.ts";
import desktop from "../desktop/vite.config.ts";
import { APP_ORIGIN } from "./src/plugin.ts";

const here = import.meta.dirname;
const page = path.resolve(here, "../desktop");

// Tailwind finds the classes in use by reading the files under Vite's root, which is mobile/ here:
// the page's style sheet is told to read desktop/ too, as it does when desktop/ is the root.
const sources: Plugin = {
	name: "pine-mobile-sources",
	enforce: "pre",
	transform: (code, id) => (id === path.join(page, "src/index.css") ? `${code}\n@source "${page}";\n` : undefined),
};

// Capacitor's local server serves the page and sends no header of pine's, so the policy the app's
// main process sends is written into the page, right after its charset, before any of its scripts.
const charset = '<meta charset="utf-8" />';
const csp: Plugin = {
	name: "pine-mobile-csp",
	transformIndexHtml: {
		order: "post",
		handler: (html) => {
			if (!html.includes(charset)) throw new Error(`mobile/index.html has no ${charset}: the content security policy goes after it.`);
			return html.replace(charset, `${charset}\n\t\t<meta http-equiv="Content-Security-Policy" content="${pageCsp({ media: [APP_ORIGIN] })}" />`);
		},
	},
};

const config = mergeConfig(desktop, {
	root: here,
	// The page's sources lie in desktop/, and so does the one file it takes from pine's own code.
	server: { fs: { allow: [here, page, path.resolve(here, "../src/tui/levels.ts")] } },
	// desktop's target (chrome140) holds: the Android WebView is Chromium, kept up to date by the Play Store.
	build: { outDir: path.join(here, "dist") },
});

// Ahead of desktop's plugins, so that Tailwind reads the style sheet with its added source.
export default { ...config, plugins: [sources, ...(desktop.plugins ?? []), csp] };
