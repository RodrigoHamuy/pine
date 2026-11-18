// The widths the app is drawn at: a phone, which is the window's smallest width (`minWidth` in
// electron/main.ts), and the window's width when it first opens. They are the toolbar's Viewport
// menu here, and Chromatic's widths below.
export const viewports = {
	phone: { name: "Phone (360)", styles: { width: "360px", height: "780px" }, type: "mobile" },
	desktop: { name: "Desktop (1280)", styles: { width: "1280px", height: "820px" }, type: "desktop" },
} as const;

// Chromatic takes every story once per mode. Each mode sets the `theme` global that the preview's
// decorator reads and one of the viewports above (by its key), so every story is snapshotted in
// light and dark at each width, and no story is written twice: two themes times two widths, four
// snapshots a story.
export const allModes = {
	"light phone": { theme: "light", viewport: "phone" },
	"light desktop": { theme: "light", viewport: "desktop" },
	"dark phone": { theme: "dark", viewport: "phone" },
	"dark desktop": { theme: "dark", viewport: "desktop" },
} as const;
