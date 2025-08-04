#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ClaudeRunner } from "./packages/claude-runner/dist/ClaudeRunner.js";

async function main() {
	try {
		// Read MCP config from parent directory
		const mcpConfigPath = resolve("../ceedardbmcpconfig.json");
		console.log("Reading MCP config from:", mcpConfigPath);

		// Read edge config to get allowed tools for 'ceedar'
		const edgeConfigPath = resolve("../.edge-config.json");
		console.log("Reading edge config from:", edgeConfigPath);

		let allowedTools = [];
		try {
			const edgeConfig = JSON.parse(readFileSync(edgeConfigPath, "utf8"));
			// Find the ceedar repository config
			const ceedarRepo = edgeConfig.repositories?.find(
				(repo) => repo.name === "ceedar",
			);
			allowedTools = ceedarRepo?.allowedTools || [];
			console.log("Found allowed tools for ceedar:", allowedTools);
		} catch (err) {
			console.log(
				"Could not read edge config, using default tools:",
				err.message,
			);
			// Default tools that might work with ceedar MCP
			allowedTools = ["mcp__ceedardb__query"];
		}

		// Create Claude runner with MCP config
		const runner = new ClaudeRunner({
			workingDirectory: process.cwd(),
			mcpConfigPath,
			allowedTools,
			onMessage: (message) => {
				console.log("📧 Message:", message.type);
				if (message.type === "assistant" && message.message?.content) {
					console.log(
						"🤖 Assistant:",
						JSON.stringify(message.message.content, null, 2),
					);
				} else if (message.type === "user" && message.message?.content) {
					console.log(
						"👤 User:",
						JSON.stringify(message.message.content, null, 2),
					);
				} else if (message.type === "system") {
					console.log("⚙️ System:", JSON.stringify(message.message, null, 2));
				} else {
					console.log("📄 Content:", JSON.stringify(message, null, 2));
				}
			},
			onError: (error) => {
				console.error("❌ Error:", error.message);
			},
			onComplete: (messages) => {
				console.log("✅ Complete with", messages.length, "messages");
			},
		});

		// Start session with the test prompt that explicitly mentions the MCP tool
		const prompt =
			"Use the mcp__ceedardb__query tool to look up business id 113 in the ceedardb database";
		console.log("\n🚀 Starting Claude session with prompt:", prompt);

		const sessionInfo = await runner.start(prompt);
		console.log("\n📊 Session completed:", sessionInfo);
	} catch (error) {
		console.error("💥 Test failed:", error.message);
		process.exit(1);
	}
}

main();
