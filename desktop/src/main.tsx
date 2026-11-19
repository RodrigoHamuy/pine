// First: in the preview (`npm run dev:preview`) the page's stand-in for the bridge, which
// bridge.ts reads when it is first evaluated. Nothing anywhere else.
import "./preview-bridge.ts";
import { Mtb } from "material-theme-builder/react";
import { type ReactNode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { store, useModel } from "./model.ts";
import { type AgentScheme, agentScheme, agentVariables, DEFAULT_FAMILIES, DEFAULT_PALETTE, type Family, followAppearance } from "./theme.ts";
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
	const palette = s.prefs.palette ?? DEFAULT_PALETTE;
	const front = s.agentInFront();
	const color = front ? s.agent(front)?.color : undefined;
	const families = s.prefs.agentFamilies ?? DEFAULT_FAMILIES;
	useEffect(() => (color && families.length ? followAgent(agentScheme(color, palette, families), families) : undefined), [color, palette, families]);
	return <Mtb {...palette}>{children}</Mtb>;
}

/**
 * While an agent with a colour is in front, the root element carries the variables of the ticked
 * families from that agent's scheme, as inline style: it wins over <Mtb>'s `:root` and `.dark` and
 * over index.css's own light roles, and every shadcn token that reads them follows. Light and dark
 * each have their values, so the root's `.dark` is watched. The returned function takes them away,
 * which gives the owner's palette back.
 */
function followAgent(scheme: AgentScheme, families: readonly Family[]): () => void {
	const root = document.documentElement;
	let set: string[] = [];
	const clear = () => {
		for (const name of set) root.style.removeProperty(name);
		set = [];
	};
	const apply = () => {
		clear();
		for (const [name, value] of Object.entries(agentVariables(scheme, families, root.classList.contains("dark") ? "dark" : "light"))) {
			root.style.setProperty(name, value);
			set.push(name);
		}
	};
	apply();
	const watch = new MutationObserver(apply);
	watch.observe(root, { attributes: true, attributeFilter: ["class"] });
	return () => {
		watch.disconnect();
		clear();
	};
}

followAppearance(() => store.prefs.theme, store.subscribe);
// The notices sit beside the app, not in it: the app draws again on every change of the store, and
// the toaster measures its pile each time it is drawn, which would slow every key typed. (Themed
// draws again too, but its children are the same elements each time, which React leaves alone.)
createRoot(document.getElementById("root")!).render(
	<Themed>
		<App />
		<Toaster />
	</Themed>,
);
