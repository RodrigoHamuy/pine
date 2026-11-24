// The page of the web client: the desktop app's, with its bridge talking to the web bridge at the
// top by message. ES modules are evaluated in the order they are imported, so `window.pine` is set
// before the page's bridge.ts reads it.
import "./page-install.ts";
import "../../desktop/src/main.tsx";
