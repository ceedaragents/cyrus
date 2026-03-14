import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	// When VITE_BASE_PATH env var is set (e.g. /dashboard/), assets are built
	// with that prefix so the app can be served from a sub-path via a reverse proxy.
	base: process.env.VITE_BASE_PATH ?? "/",
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:3457",
				changeOrigin: true,
			},
		},
	},
});
