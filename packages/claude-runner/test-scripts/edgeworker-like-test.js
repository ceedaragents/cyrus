#!/usr/bin/env node

/**
 * EdgeWorker-like streaming test that mimics production exactly
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ClaudeRunner } from "../dist/index.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

async function main() {
	console.log("🚀 Starting EdgeWorker-like Streaming Test");

	// Mimic EXACT EdgeWorker configuration from the hanging scenario
	const issueId = "CEE-739"; // From your logs
	const workingDirectory = `/Users/agentops/code/ceedar-new-workspaces/${issueId}`;

	// Create working directory like EdgeWorker does
	if (!existsSync(workingDirectory)) {
		mkdirSync(workingDirectory, { recursive: true });
		console.log(
			`[EdgeWorker-like] Created working directory: ${workingDirectory}`,
		);
	} else {
		console.log(
			`[EdgeWorker-like] Using existing directory: ${workingDirectory}`,
		);
	}

	// Mimic exact ClaudeRunner config from EdgeWorker
	const config = {
		workingDirectory: workingDirectory,
		workspaceName: issueId,

		// Use EXACT MCP config paths from production
		mcpConfigPath: ["/Users/agentops/code/ceedarmcpconfig.json"],

		// Add Linear MCP server exactly like EdgeWorker does
		mcpConfig: {
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: {
					Authorization: `Bearer ${process.env.LINEAR_API_TOKEN}`,
				},
			},
		},

		// Use EdgeWorker's allowed tools (from buildAllowedTools)
		allowedTools: [
			"Read",
			"Edit",
			"MultiEdit",
			"Write",
			"Bash",
			"Glob",
			"Grep",
			"LS",
			"Task",
			"WebFetch",
			"WebSearch",
			"TodoWrite",
			"NotebookEdit",
			"Skill",
		],

		// Use EdgeWorker's system prompt pattern
		systemPrompt:
			"You are an expert software engineer. Focus on practical solutions.",

		onMessage: (message) => {
			console.log(`📧 Message: ${message.type}`);
			if (message.type === "system") {
				if (message.mcp_servers) {
					console.log("🔌 MCP servers loaded:", message.mcp_servers);
				}
			}
		},

		onError: (error) => {
			console.error("❌ Error:", error.message);
			console.error("📚 Stack:", error.stack);
		},

		onComplete: (messages) => {
			console.log(`✅ Completed with ${messages.length} messages`);
		},
	};

	const runner = new ClaudeRunner(config);

	console.log(
		"[EdgeWorker-like] Starting new streaming session for issue CEE-739",
	);

	try {
		// Mimic EdgeWorker's startStreaming call with a realistic prompt
		const streamingInitialPrompt = `I've been assigned to work on Linear issue CEE-739. Please help me understand the codebase and work on this issue.

Please start by:
1. Reading the current working directory structure to understand the project layout
2. Looking for any relevant files or documentation about this issue
3. Understanding what needs to be done

Let me know what you find and we can work together on implementing a solution.`;

		console.log("[EdgeWorker-like] Starting streaming session...");

		const sessionInfo = await runner.startStreaming(streamingInitialPrompt);

		console.log(`📊 Session ID: ${sessionInfo.sessionId}`);
		console.log(
			`🔄 Status: ${sessionInfo.isRunning ? "Running" : "Completed"}`,
		);
		console.log(`🌊 Is streaming: ${runner.isStreaming()}`);

		// Wait to see if it hangs like production
		let completed = false;
		let messageCount = 0;

		runner.on("complete", (messages) => {
			completed = true;
			messageCount = messages.length;
			console.log("✅ Session completed successfully!");
		});

		runner.on("message", (message) => {
			console.log(`📨 Received ${message.type} message`);
		});

		// Wait up to 2 minutes (like production timeout)
		console.log("⏳ Waiting for session to complete...");
		for (let i = 0; i < 120; i++) {
			if (completed) {
				console.log(
					`🎉 Session completed after ${i + 1} seconds with ${messageCount} messages`,
				);
				break;
			}

			// Show progress every 10 seconds
			if ((i + 1) % 10 === 0) {
				console.log(
					`⏳ Still waiting... ${i + 1}s (streaming: ${runner.isStreaming()}, running: ${runner.isRunning()})`,
				);
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		if (!completed) {
			console.log(
				"🚨 SESSION IS HANGING - This reproduces the production issue!",
			);
			console.log(
				`🔍 Final state: streaming=${runner.isStreaming()}, running=${runner.isRunning()}`,
			);

			// Try to get more debug info
			const messages = runner.getMessages();
			console.log(`📊 Messages so far: ${messages.length}`);
			messages.forEach((msg, i) => {
				console.log(`   ${i + 1}. ${msg.type}`);
			});

			process.exit(1);
		}
	} catch (error) {
		console.error("💥 Test failed:", error.message);
		console.error("📚 Full error:", error);
		process.exit(1);
	}
}

// Handle signals
process.on("SIGINT", () => {
	console.log("\n🛑 Received SIGINT, shutting down...");
	process.exit(0);
});

main().catch((error) => {
	console.error("💥 Unhandled error:", error);
	process.exit(1);
});
