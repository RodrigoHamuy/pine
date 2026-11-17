import type { Decorator, Preview } from "@storybook/react-vite";
import { useLayoutEffect } from "react";
import "../src/styles.css";

// The app has no theme switch of its own: styles.css follows the system with
// `@media (prefers-color-scheme: dark)`. To show either theme whatever the system says, the
// toolbar rewrites those rules' media: "all" forces dark, "not all" forces light, and "system"
// puts the original query back.
const DARK = /prefers-color-scheme:\s*dark/;
const original = new WeakMap<CSSMediaRule, string>();

function darkRules(): CSSMediaRule[] {
	const found: CSSMediaRule[] = [];
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // another origin's sheet
		}
		for (const rule of Array.from(rules)) {
			if (!(rule instanceof CSSMediaRule)) continue;
			const media = original.get(rule) ?? rule.media.mediaText;
			if (DARK.test(media)) found.push(rule);
		}
	}
	return found;
}

function applyTheme(theme: string) {
	for (const rule of darkRules()) {
		if (!original.has(rule)) original.set(rule, rule.media.mediaText);
		rule.media.mediaText = theme === "dark" ? "all" : theme === "light" ? "not all" : original.get(rule)!;
	}
	document.documentElement.style.colorScheme = theme === "system" ? "" : theme;
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
};

export default preview;
