// The desktop page, built for the web client's iframe: desktop's own configuration (its plugins,
// its alias, the preview's stand-in left out), with web/page as the root so that its index.html
// loads src/page-main.ts, which installs the page's bridge before the page. The build goes to
// dist/page, beside the bridge's document that scripts/build.ts writes.
import path from "node:path";
import { mergeConfig, type Plugin } from "vite";
import { pageCsp } from "../desktop/electron/daemon.ts";
import desktop from "../desktop/vite.config.ts";

const here = import.meta.dirname;
const page = path.resolve(here, "../desktop");

// Tailwind finds the classes in use by reading the files under Vite's root, which is web/page here:
// the page's style sheet is told to read desktop/ too, as it does when desktop/ is the root.
const sources: Plugin = {
	name: "pine-web-sources",
	enforce: "pre",
	transform: (code, id) => (id === path.join(page, "src/index.css") ? `${code}\n@source "${page}";\n` : undefined),
};

// The desktop page's policy, written into the page (a static deployment sends no header of
// pine's): it loads nothing from the web, and pictures, video and sound only from blob: and data:
// addresses it makes itself, since under an opaque origin it fetches nothing.
const charset = '<meta charset="utf-8" />';
const csp: Plugin = {
	name: "pine-web-csp",
	transformIndexHtml: {
		order: "post",
		handler: (html) => {
			if (!html.includes(charset)) throw new Error(`web/page/index.html has no ${charset}: the content security policy goes after it.`);
			return html.replace(charset, `${charset}\n\t\t<meta http-equiv="Content-Security-Policy" content="${pageCsp({ media: [] })}" />`);
		},
	},
};

const config = mergeConfig(desktop, {
	root: path.join(here, "page"),
	build: { outDir: path.join(here, "dist", "page"), emptyOutDir: true },
});

// Ahead of desktop's plugins, so that Tailwind reads the style sheet with its added source.
export default { ...config, plugins: [sources, ...(desktop.plugins ?? []), csp] };
