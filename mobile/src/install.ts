// The mobile bridge on `window.pine`, on Capacitor's handle of the native plugin. Imported first by
// main.ts, so that it is in place before the desktop page's bridge.ts reads it.
import { registerPlugin } from "@capacitor/core";
import { mobileBridge } from "./mobile-bridge.ts";
import { PLUGIN_NAME, type PinePlugin } from "./plugin.ts";

window.pine = mobileBridge(registerPlugin<PinePlugin>(PLUGIN_NAME));
