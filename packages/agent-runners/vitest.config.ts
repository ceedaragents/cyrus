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
				"**/index.ts",
			],
			// Note: This is an adapter package that wraps ClaudeRunner.
			// Most functionality requires a live ClaudeRunner instance (which requires Claude SDK/API).
			// Unit tests verify: API contracts, error handling, type safety, and structure.
			// Full coverage would require integration tests with actual Claude API access.
			// The implementation follows the adapter pattern with minimal logic - mostly delegation.
			// Type safety is enforced at compile time via TypeScript.
		},
	},
});
