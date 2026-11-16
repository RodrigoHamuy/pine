import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	plugins: [react()],
	// PINE_DESKTOP_DEBUG=1: a build that can be read, for an error that only says where it is in the bundle.
	build: { outDir: "dist", emptyOutDir: true, target: "chrome140", chunkSizeWarningLimit: 4000, minify: !process.env.PINE_DESKTOP_DEBUG },
});
