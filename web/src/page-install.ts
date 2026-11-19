// The page's bridge on `window.pine`: its parent is the web bridge, and only its parent is heard.
import { frameBridge, MEDIA_BASE } from "./frame-bridge.ts";
import { installMedia, mediaUrls } from "./page-media.ts";

// Under its opaque origin the page has no Web Storage: reading `localStorage` throws. What the
// page keeps there (the side bar's width, what is folded) is kept for as long as the page is open.
function memoryStorage(): Storage {
	const kept = new Map<string, string>();
	return {
		get length() {
			return kept.size;
		},
		key: (i) => [...kept.keys()][i] ?? null,
		getItem: (k) => kept.get(String(k)) ?? null,
		setItem: (k, v) => void kept.set(String(k), String(v)),
		removeItem: (k) => void kept.delete(String(k)),
		clear: () => kept.clear(),
	};
}
for (const name of ["localStorage", "sessionStorage"] as const) Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });

const pine = frameBridge(window.parent, window);
window.pine = pine;
installMedia(window, mediaUrls({ base: MEDIA_BASE, media: pine.media, createObjectURL: (blob) => URL.createObjectURL(blob), revokeObjectURL: (url) => URL.revokeObjectURL(url) }));
