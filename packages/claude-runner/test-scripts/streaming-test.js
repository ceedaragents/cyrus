#!/usr/bin/env node

/**
 * Streaming test script for claude-runner
 *
 * This script tests the streaming functionality that might be hanging.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ClaudeRunner } from "../dist/index.js";

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

async function main() {
	console.log("🚀 Starting Claude Runner Streaming Test");

	// Configure the runner
	const config = {
		workingDirectory: "/tmp/test-streaming",
		allowedTools: ["Read", "Edit", "Bash"],
		workspaceName: "streaming-test",
		systemPrompt: "You are a helpful assistant. Be concise.",

		onMessage: (message) => {
			console.log(`📧 Message received: ${message.type}`);
		},

		onError: (error) => {
			console.error("❌ Error occurred:", error.message);
		},

		onComplete: (messages) => {
			console.log(`✅ Session completed with ${messages.length} messages`);
		},
	};

	// Create the runner
	const runner = new ClaudeRunner(config);

	try {
		console.log("🔄 Starting streaming session...");

		// Start with streaming initial prompt
		const sessionInfo = await runner.startStreaming(
			"Hello! Please tell me what tools you have available.",
		);

		console.log(`📊 Session ID: ${sessionInfo.sessionId}`);
		console.log(
			`🔄 Status: ${sessionInfo.isRunning ? "Running" : "Completed"}`,
		);
		console.log(`🌊 Is streaming: ${runner.isStreaming()}`);

		// Wait a bit
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Add another message to the stream
		console.log("📝 Adding message to stream...");
		runner.addStreamMessage(
			'Now please create a simple hello.txt file with "Hello World" in it.',
		);

		// Wait a bit more
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Complete the stream
		console.log("🏁 Completing stream...");
		runner.completeStream();

		// Wait for completion
		await new Promise((resolve) => {
			runner.on("complete", () => {
				console.log("✅ Stream completed!");
				resolve();
			});

			// Timeout after 30 seconds
			setTimeout(() => {
				console.log("⏰ Timeout reached!");
				resolve();
			}, 30000);
		});
	} catch (error) {
		console.error("💥 Streaming test failed:", error.message);
		console.error("📚 Full error:", error);
		process.exit(1);
	}
}

// Handle process signals gracefully
process.on("SIGINT", () => {
	console.log("\n🛑 Received SIGINT, shutting down...");
	process.exit(0);
});

// Run the test
main().catch((error) => {
	console.error("💥 Unhandled error:", error);
	process.exit(1);
});
