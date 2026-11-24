// The page's bridge on `window.pine`: its parent is the web bridge, and only its parent is heard.
import { frameBridge, MEDIA_BASE } from "./frame-bridge.ts";
import { installMedia, mediaUrls } from "./page-media.ts";
import { keptStorage } from "./page-storage.ts";

const pine = frameBridge(window.parent, window);
window.pine = pine;
installMedia(window, mediaUrls({ base: MEDIA_BASE, media: pine.media, createObjectURL: (blob) => URL.createObjectURL(blob), revokeObjectURL: (url) => URL.revokeObjectURL(url) }));

// Under its opaque origin the page has no Web Storage: reading `localStorage` throws. What the
// page keeps there (the side bar's width, what is folded) is kept by the web bridge with the
// preferences, and is here before the page's modules read it: they wait for this module.
const kept = (await pine.state().catch(() => undefined))?.prefs.storage ?? {};
const save = (storage: Record<string, string>) => void pine.prefs({ storage }).catch(() => {});
Object.defineProperty(window, "localStorage", { value: keptStorage(kept, save), configurable: true });
Object.defineProperty(window, "sessionStorage", { value: keptStorage({}, () => {}), configurable: true });
