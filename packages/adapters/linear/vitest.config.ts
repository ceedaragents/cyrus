import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			exclude: [
				"node_modules/**",
				"dist/**",
				"test/**",
				"**/*.d.ts",
				"**/*.config.*",
				"**/mockData/**",
			],
		},
	},
	resolve: {
		alias: {
			"cyrus-interfaces": path.resolve(
				__dirname,
				"../../interfaces/dist/index.js",
			),
			"cyrus-core": path.resolve(__dirname, "../../core/dist/index.js"),
			"cyrus-linear-webhook-client": path.resolve(
				__dirname,
				"../../linear-webhook-client/dist/index.js",
			),
		},
	},
});
