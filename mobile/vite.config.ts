// The desktop page, built for the mobile app: desktop's own configuration (its plugins, its alias,
// the preview's stand-in left out), with mobile/ as the root so that index.html loads src/main.ts,
// which installs the mobile bridge before the page. The build goes to dist/, Capacitor's webDir.
//
// One build per platform: `vite build` is Android's, `vite build --mode ios` is iOS's (the scripts
// `sync` and `sync:ios` build the one they sync). The two differ in what the page's policy lets
// media come from, so that neither allows the other's origin, and in the engine the code is written
// for: Chromium on Android, WebKit on iOS. The page and its bridge are the same JavaScript.
import path from "node:path";
import { defineConfig, mergeConfig, type Plugin } from "vite";
import { pageCsp } from "../desktop/electron/daemon.ts";
import desktop from "../desktop/vite.config.ts";
import { MEDIA_SOURCE, type Platform } from "./src/plugin.ts";

const here = import.meta.dirname;
const page = path.resolve(here, "../desktop");

// Tailwind finds the classes in use by reading the files under Vite's root, which is mobile/ here:
// the page's style sheet is told to read desktop/ too, as it does when desktop/ is the root.
// On iOS the web view covers the whole screen (`contentInset: "never"`, `viewport-fit=cover`) and
// the page keeps out of what lies over it: the status bar and the Dynamic Island at the top, the
// home indicator at the bottom, and the keyboard while it is up (PineViewController adds it to the
// safe area). The sheets at a side are fixed to the screen, outside #root, and keep out too: above
// and below, and in landscape on their own side, where the sensor housing lies. The side bar on a
// phone is such a sheet, whose data-slot the side bar names "sidebar".
// Android needs none of it: there Capacitor pads the WebView by the system bars.
const safeArea = `
#root {
	padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
:is([data-slot="sheet-content"], [data-slot="sidebar"][data-mobile])[data-side="left"],
:is([data-slot="sheet-content"], [data-slot="sidebar"][data-mobile])[data-side="right"] {
	top: env(safe-area-inset-top);
	bottom: env(safe-area-inset-bottom);
	height: auto;
}
:is([data-slot="sheet-content"], [data-slot="sidebar"][data-mobile])[data-side="left"] {
	padding-left: env(safe-area-inset-left);
}
:is([data-slot="sheet-content"], [data-slot="sidebar"][data-mobile])[data-side="right"] {
	padding-right: env(safe-area-inset-right);
}
`;
const sources = (platform: Platform): Plugin => ({
	name: "pine-mobile-sources",
	enforce: "pre",
	transform: (code, id) => (id === path.join(page, "src/index.css") ? `${code}\n@source "${page}";\n${platform === "ios" ? safeArea : ""}` : undefined),
});

// Capacitor's local server serves the page and sends no header of pine's, so the policy the app's
// main process sends is written into the page, right after its charset, before any of its scripts.
const charset = '<meta charset="utf-8" />';
const csp = (platform: Platform): Plugin => ({
	name: "pine-mobile-csp",
	transformIndexHtml: {
		order: "post",
		handler: (html) => {
			if (!html.includes(charset)) throw new Error(`mobile/index.html has no ${charset}: the content security policy goes after it.`);
			return html.replace(charset, `${charset}\n\t\t<meta http-equiv="Content-Security-Policy" content="${pageCsp({ media: [MEDIA_SOURCE[platform]] })}" />`);
		},
	},
});

// WebKit on iOS zooms into a field the page focuses when its text is smaller than 16px (the
// message box, the host field), and leaves the page zoomed and shifted under the status bar. A
// page of the app is laid out for the phone's width: it is never zoomed. It covers the screen, and
// keeps itself inside the safe area (`safeArea`).
const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
const unzoomed: Plugin = {
	name: "pine-mobile-ios-viewport",
	transformIndexHtml: {
		order: "post",
		handler: (html) => {
			if (!html.includes(viewport)) throw new Error(`mobile/index.html has no ${viewport}: the iOS page's viewport is made from it.`);
			return html.replace(viewport, viewport.replace("initial-scale=1", "initial-scale=1, maximum-scale=1, viewport-fit=cover"));
		},
	},
};

export default defineConfig(({ mode }) => {
	const platform: Platform = mode === "ios" ? "ios" : "android";
	const config = mergeConfig(desktop, {
		root: here,
		// The page's sources lie in desktop/, and so does the one file it takes from pine's own code.
		server: { fs: { allow: [here, page, path.resolve(here, "../src/tui/levels.ts")] } },
		// Android: desktop's target (chrome140) holds, the WebView is Chromium, kept up to date by the
		// Play Store. iOS: the WKWebView is the system's Safari, as old as the iOS the app supports (17).
		build: { outDir: path.join(here, "dist"), ...(platform === "ios" ? { target: "safari17" } : {}) },
	});
	// Ahead of desktop's plugins, so that Tailwind reads the style sheet with its added source.
	return { ...config, plugins: [sources(platform), ...(desktop.plugins ?? []), csp(platform), ...(platform === "ios" ? [unzoomed] : [])] };
});
