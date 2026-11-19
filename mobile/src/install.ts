// The mobile bridge on `window.pine`, on Capacitor's handle of the native plugin. Imported first by
// main.ts, so that it is in place before the desktop page's bridge.ts reads it.
import { Capacitor, registerPlugin } from "@capacitor/core";
import { mobileBridge } from "./mobile-bridge.ts";
import { PLUGIN_NAME, type PinePlugin } from "./plugin.ts";

// The page runs in Capacitor's app on one of the two; "web" is only `vite dev`, taken for Android.
window.pine = mobileBridge(registerPlugin<PinePlugin>(PLUGIN_NAME), Capacitor.getPlatform() === "ios" ? "ios" : "android");
