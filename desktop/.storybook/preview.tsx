import type { Decorator, Preview } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import "../src/index.css";
import { followAppearance } from "../src/theme.ts";

// No preload script here: the bridge is a stand-in whose every call does nothing (a listener it
// is given is never called), so that a piece which listens to the app (the Composer) can be drawn.
// A story that needs answers from the daemon puts a call of its own on it (`window.pine.call = ...`,
// as Settings.stories.tsx does): what is set on it is used, everything else still does nothing.
window.pine ??= new Proxy({} as Record<PropertyKey, unknown>, { get: (own, key) => own[key] ?? (() => () => {}) }) as unknown as typeof window.pine;

// The page is dark when its root element has the `.dark` class. In the app that class follows the
// system (theme.ts); here the toolbar sets it, or lets it follow the system as the app does.
function applyTheme(theme: string): (() => void) | undefined {
	if (theme === "system") return followAppearance();
	document.documentElement.classList.toggle("dark", theme === "dark");
	return undefined;
}

const withTheme: Decorator = (Story, context) => {
	const theme = context.globals.theme ?? "system";
	useLayoutEffect(() => applyTheme(theme), [theme]);
	return <Story />;
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
	parameters: { layout: "centered" },
	tags: ["autodocs"],
};

export default preview;
