import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react(), tailwindcss()],
	// "@/": the page's sources, the alias shadcn's components are written with.
	resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
	// PINE_DESKTOP_DEBUG=1: a build that can be read, for an error that only says where it is in the bundle.
	build: { outDir: "dist", emptyOutDir: true, target: "chrome140", chunkSizeWarningLimit: 4000, minify: !process.env.PINE_DESKTOP_DEBUG },
});
