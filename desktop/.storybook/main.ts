import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
	framework: "@storybook/react-vite",
	stories: ["../src/**/*.stories.tsx"],
	addons: ["@storybook/addon-docs"],
	core: { disableTelemetry: true },
	// Storybook leaves out vite.config.ts's `build`: CSS is minified by esbuild here too, for the reason given there.
	viteFinal: (config) => ({ ...config, build: { ...config.build, cssMinify: "esbuild" } }),
};

export default config;
