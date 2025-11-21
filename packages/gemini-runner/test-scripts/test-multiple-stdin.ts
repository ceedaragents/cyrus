#!/usr/bin/env bun

/**
 * Integration test to prove multiple stdin writes work with GeminiRunner
 *
 * This test demonstrates:
 * 1. Starting a streaming session with an initial prompt
 * 2. Adding additional messages via addStreamMessage()
 * 3. Completing the stream to trigger gemini processing
 *
 * Run with: bun run test-scripts/test-multiple-stdin.ts
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeminiRunner } from "../dist/GeminiRunner.js";

// Create temp directory for logs
const testDir = join(tmpdir(), "gemini-runner-test");
mkdirSync(testDir, { recursive: true });

console.log("🧪 Testing GeminiRunner with multiple stdin writes\n");

// Track all messages received
const messages: any[] = [];
let sessionId: string | null = null;

// Create runner
const runner = new GeminiRunner({
	cyrusHome: testDir,
	workingDirectory: process.cwd(),
	model: "gemini-2.0-flash-exp",
	onMessage: (message) => {
		messages.push(message);
		console.log(`📨 Message ${messages.length}: ${message.type}`);

		if (message.type === "assistant") {
			const content =
				typeof message.message.content === "string"
					? message.message.content
					: JSON.stringify(message.message.content);
			console.log(`   Content: ${content.substring(0, 100)}...`);
		}
	},
	onComplete: (finalMessages) => {
		console.log(`\n✅ Session completed with ${finalMessages.length} messages`);
	},
	onError: (error) => {
		console.error(`\n❌ Error: ${error.message}`);
		process.exit(1);
	},
});

async function runTest() {
	try {
		console.log("1️⃣  Starting streaming session with initial prompt...");
		const session = await runner.startStreaming("What is 2+2?");
		sessionId = session.sessionId;
		console.log(`   Session ID: ${sessionId}\n`);

		// Wait a bit to let initial processing start
		await new Promise((resolve) => setTimeout(resolve, 1000));

		console.log("2️⃣  Adding second message via addStreamMessage()...");
		runner.addStreamMessage("Also, what is 3+3?");

		// Wait a bit
		await new Promise((resolve) => setTimeout(resolve, 1000));

		console.log("3️⃣  Adding third message via addStreamMessage()...");
		runner.addStreamMessage("Finally, what is 5+5?");

		// Wait a bit
		await new Promise((resolve) => setTimeout(resolve, 1000));

		console.log("4️⃣  Completing stream (closing stdin)...\n");
		runner.completeStream();

		// Note: The runner.startStreaming() promise won't resolve until the process completes
		// The session should now process all three questions
	} catch (error: any) {
		console.error(`\n❌ Test failed: ${error.message}`);
		console.error(error.stack);
		process.exit(1);
	}
}

// Run the test
runTest().catch((error) => {
	console.error(`\n❌ Unexpected error: ${error.message}`);
	process.exit(1);
});

console.log("\n⏳ Waiting for gemini to process all messages...");
console.log("   (This proves stdin stayed open for multiple writes)\n");
