#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
	try {
		// Read configs (going up three levels from packages/claude-runner)
		const mcpConfigPath = resolve("../../../ceedardbmcpconfig.json");
		const edgeConfigPath = resolve("../../../.edge-config.json");

		console.log("📁 MCP Config Path:", mcpConfigPath);
		console.log("📁 Edge Config Path:", edgeConfigPath);

		// Extract allowed tools for ceedar
		let allowedTools = [];
		try {
			const edgeConfig = JSON.parse(readFileSync(edgeConfigPath, "utf8"));
			const ceedarRepo = edgeConfig.repositories?.find(
				(repo) => repo.name === "ceedar",
			);
			allowedTools = ceedarRepo?.allowedTools || [];
			console.log("🔧 Allowed Tools:", allowedTools);
		} catch (err) {
			console.log("⚠️ Could not read edge config:", err.message);
			allowedTools = ["mcp__ceedardb__query"];
		}

		// Read and parse MCP config for SDK
		let mcpServers = {};
		try {
			const mcpConfigContent = readFileSync(mcpConfigPath, "utf8");
			const mcpConfig = JSON.parse(mcpConfigContent);
			mcpServers = mcpConfig.mcpServers || {};
			console.log(
				"🔌 MCP Servers config:",
				JSON.stringify(mcpServers, null, 2),
			);
		} catch (err) {
			console.log("⚠️ Could not read MCP config:", err.message);
		}

		// Test direct SDK call
		const prompt =
			"Use the mcp__ceedardb__query tool to look up business id 113";

		console.log("\n🚀 Starting direct SDK query...");
		console.log("📝 Prompt:", prompt);

		const queryOptions = {
			prompt,
			options: {
				cwd: process.cwd(),
				mcpServers: mcpServers, // Use mcpServers instead of mcpConfig
				allowedTools: allowedTools,
			},
		};

		console.log("\n⚙️ Query Options:");
		console.log(JSON.stringify(queryOptions, null, 2));

		let messageCount = 0;
		console.log("\n📬 Messages:");

		for await (const message of query(queryOptions)) {
			messageCount++;
			console.log(`\n--- Message ${messageCount} (${message.type}) ---`);

			if (message.type === "assistant" && message.message?.content) {
				for (const block of message.message.content) {
					if (block.type === "text") {
						console.log("🤖 Text:", block.text);
					} else if (block.type === "tool_use") {
						console.log("🔧 Tool Use:", block.name);
						console.log("📥 Input:", JSON.stringify(block.input, null, 2));
					}
				}
			} else if (message.type === "user" && message.message?.content) {
				for (const block of message.message.content) {
					if (block.type === "tool_result") {
						console.log("📤 Tool Result for:", block.tool_use_id);
						console.log("✅ Content:", block.content);
					}
				}
			} else if (message.type === "result") {
				console.log("🏁 Final Result:", message);
				break;
			} else if (message.type === "system") {
				console.log("⚙️ System message");
			} else {
				console.log("📄 Other:", JSON.stringify(message, null, 2));
			}

			// Limit messages to prevent runaway
			if (messageCount > 20) {
				console.log("\n⏹️ Stopping after 20 messages");
				break;
			}
		}

		console.log(`\n✅ Completed with ${messageCount} messages`);
	} catch (error) {
		console.error("💥 Error:", error.message);
		console.error("📚 Stack:", error.stack);
		process.exit(1);
	}
}

main();
