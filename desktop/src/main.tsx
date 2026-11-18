// First: in the preview (`npm run dev:preview`) the page's stand-in for the bridge, which
// bridge.ts reads when it is first evaluated. Nothing anywhere else.
import "./preview-bridge.ts";
import { Mtb } from "material-theme-builder/react";
import { type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { store, useModel } from "./model.ts";
import { DEFAULT_PALETTE, followAppearance } from "./theme.ts";
import { Toaster } from "@/components/ui/toast";

/**
 * <Mtb> writes the M3 scheme of the owner's palette into the page (index.css draws every colour from
 * it): the one kept in the app's preferences, or pine's default. A change in Settings redraws it at once.
 * Code in dark follows it too, unless the owner keeps poimandres for it (`data-code` on the root element).
 */
function Themed({ children }: { children: ReactNode }) {
	const s = useModel(store);
	const code = s.prefs.codeFollowsPalette === false ? "poimandres" : "palette";
	useEffect(() => {
		document.documentElement.dataset.code = code;
	}, [code]);
	return <Mtb {...(s.prefs.palette ?? DEFAULT_PALETTE)}>{children}</Mtb>;
}

followAppearance();
// The notices sit beside the app, not in it: the app draws again on every change of the store, and
// the toaster measures its pile each time it is drawn, which would slow every key typed. (Themed
// draws again too, but its children are the same elements each time, which React leaves alone.)
createRoot(document.getElementById("root")!).render(
	<Themed>
		<App />
		<Toaster />
	</Themed>,
);
