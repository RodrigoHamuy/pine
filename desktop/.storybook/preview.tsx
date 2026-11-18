import type { Decorator, Preview } from "@storybook/react-vite";
import { Mtb } from "material-theme-builder/react";
import { useLayoutEffect } from "react";
import "../src/index.css";
import { DEFAULT_PALETTE, followAppearance } from "../src/theme.ts";
import { allModes, viewports } from "./modes.ts";

// No preload script here: the bridge is a stand-in whose every call does nothing (a listener it
// is given is never called), so that a piece which listens to the app (the Composer) can be drawn.
// A story that needs answers from the daemon puts a call of its own on it (`window.pine.call = ...`,
// as Settings.stories.tsx does): what is set on it is used, everything else still does nothing.
window.pine ??= new Proxy({} as Record<PropertyKey, unknown>, { get: (own, key) => own[key] ?? (() => () => {}) }) as unknown as typeof window.pine;

// The page is dark when its root element has the `.dark` class. The toolbar's theme stands for
// the app's Appearance setting, and theme.ts decides from it as it does in the app.
const withTheme: Decorator = (Story, context) => {
	const theme = context.globals.theme ?? "system";
	useLayoutEffect(() => followAppearance(() => theme, () => () => {}), [theme]);
	// The colours are the M3 scheme of pine's palette, as in the app (main.tsx).
	return (
		<Mtb {...DEFAULT_PALETTE}>
			<Story />
		</Mtb>
	);
};

const preview: Preview = {
	globalTypes: {
		theme: {
			description: "Light or dark, as the system would choose it",
			toolbar: {
				title: "Theme",
				icon: "mirror",
				items: [
					{ value: "system", title: "System" },
					{ value: "light", title: "Light" },
					{ value: "dark", title: "Dark" },
				],
				dynamicTitle: true,
			},
		},
	},
	initialGlobals: { theme: "light" },
	decorators: [withTheme],
	parameters: {
		layout: "centered",
		// The toolbar's Viewport menu offers the widths Chromatic takes; by default a story fills the pane.
		viewport: { options: viewports },
		// Chromatic snapshots each story in every mode; the toolbar above still flips theme and width by hand.
		chromatic: { modes: allModes },
	},
	tags: ["autodocs"],
};

export default preview;
