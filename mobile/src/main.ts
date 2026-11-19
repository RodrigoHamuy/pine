// The mobile app's page: the desktop app's, with the mobile bridge installed first. ES modules are
// evaluated in the order they are imported, so `window.pine` is set before the page's bridge.ts
// reads it (the same order desktop/src/main.tsx keeps for the preview's stand-in).
import "./install.ts";
import "../../desktop/src/main.tsx";
