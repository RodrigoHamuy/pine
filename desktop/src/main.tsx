// First: in the preview (`npm run dev:preview`) the page's stand-in for the bridge, which
// bridge.ts reads when it is first evaluated. Nothing anywhere else.
import "./preview-bridge.ts";
import { Mtb } from "material-theme-builder/react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { DEFAULT_PALETTE, followAppearance } from "./theme.ts";
import { Toaster } from "@/components/ui/toast";

followAppearance();
// The notices sit beside the app, not in it: the app draws again on every change of the store, and
// the toaster measures its pile each time it is drawn, which would slow every key typed.
// <Mtb> writes the M3 scheme of the palette into the page (index.css draws every colour from it).
createRoot(document.getElementById("root")!).render(
	<Mtb {...DEFAULT_PALETTE}>
		<App />
		<Toaster />
	</Mtb>,
);
