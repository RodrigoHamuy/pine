import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	// No lightningcss on the CSS, neither Tailwind's pass nor Vite's minifier: lightningcss (1.33) folds
	// `animation-timeline` into the `animation` shorthand, which Chromium drops whole, and shadcn's
	// `scroll-fade` then never fades in a build (it does with `vite dev`). esbuild keeps the longhand.
	plugins: [react(), tailwindcss({ optimize: false })],
	// "@/": the page's sources, the alias shadcn's components are written with.
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
	// PINE_DESKTOP_DEBUG=1: a build that can be read, for an error that only says where it is in the bundle.
	build: { outDir: "dist", emptyOutDir: true, target: "chrome140", chunkSizeWarningLimit: 4000, minify: !process.env.PINE_DESKTOP_DEBUG, cssMinify: process.env.PINE_DESKTOP_DEBUG ? false : "esbuild" },
});
