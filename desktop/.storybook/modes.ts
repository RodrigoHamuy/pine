// Chromatic takes every story once per mode. Each mode sets the `theme` global that the preview's
// decorator reads, so every story is snapshotted in light and in dark and no story is written twice.
export const allModes = {
	light: { theme: "light" },
	dark: { theme: "dark" },
} as const;
