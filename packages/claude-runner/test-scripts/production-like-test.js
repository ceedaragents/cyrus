#!/usr/bin/env node

/**
 * Production-like streaming test with MCP servers
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ClaudeRunner } from "../dist/index.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

async function main() {
	console.log("🚀 Starting Production-like Streaming Test");

	// Mimic production EdgeWorker configuration
	const config = {
		workingDirectory:
			"/Users/agentops/code/ceedar-new-workspaces/test-streaming",
		workspaceName: "test-streaming",

		// Use similar MCP config paths as production
		mcpConfigPath: ["/Users/agentops/code/ceedarmcpconfig.json"],

		// Add Linear MCP server like production
		mcpConfig: {
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: {
					Authorization: `Bearer ${process.env.LINEAR_API_TOKEN}`,
				},
			},
		},

		allowedTools: ["Read", "Edit", "Bash", "Task"],
		systemPrompt: "You are a helpful assistant.",

		onMessage: (message) => {
			console.log(`📧 Message: ${message.type}`);
			if (message.type === "system") {
				console.log("🔌 MCP servers loaded:", message.mcp_servers);
			}
		},

		onError: (error) => {
			console.error("❌ Error:", error.message);
		},

		onComplete: (messages) => {
			console.log(`✅ Completed with ${messages.length} messages`);
		},
	};

	const runner = new ClaudeRunner(config);

	try {
		console.log("🔄 Starting streaming session with MCP servers...");

		const sessionInfo = await runner.startStreaming(
			"Hello! Please tell me what MCP servers and tools you have available.",
		);

		console.log(`📊 Session ID: ${sessionInfo.sessionId}`);
		console.log(`🌊 Is streaming: ${runner.isStreaming()}`);

		// Wait and check if it hangs like production
		let completed = false;
		runner.on("complete", () => {
			completed = true;
			console.log("✅ Session completed successfully!");
		});

		// Wait up to 60 seconds
		for (let i = 0; i < 60; i++) {
			if (completed) break;
			console.log(`⏳ Waiting... ${i + 1}s`);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		if (!completed) {
			console.log(
				"⏰ Session appears to be hanging - completing stream manually",
			);
			runner.completeStream();

			// Wait another 10 seconds
			for (let i = 0; i < 10; i++) {
				if (completed) break;
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		}

		if (!completed) {
			console.log("❌ Session is definitely hanging");
			process.exit(1);
		}
	} catch (error) {
		console.error("💥 Test failed:", error.message);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("💥 Unhandled error:", error);
	process.exit(1);
});
