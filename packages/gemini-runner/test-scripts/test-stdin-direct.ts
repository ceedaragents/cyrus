#!/usr/bin/env bun
/**
 * Direct integration test to prove multiple stdin writes work with gemini CLI
 *
 * This test spawns gemini directly and demonstrates:
 * 1. Writing an initial prompt to stdin immediately
 * 2. Keeping stdin open
 * 3. Writing additional prompts via stdin
 * 4. Closing stdin to trigger processing
 *
 * Run with: bun run test-scripts/test-stdin-direct.ts
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

console.log("🧪 Testing multiple stdin writes with gemini CLI\n");

// Spawn gemini in stream-json mode with stdin
const gemini = spawn("gemini", ["--output-format", "stream-json"], {
	stdio: ["pipe", "pipe", "pipe"],
	env: {
		...process.env,
		GEMINI_API_KEY: process.env.GEMINI_API_KEY,
	},
});

let messageCount = 0;
let sessionId: string | null = null;
let receivedResponse = false;

// Set up stdout line reader for JSON events
const rl = createInterface({
	input: gemini.stdout!,
	crlfDelay: Infinity,
});

rl.on("line", (line: string) => {
	try {
		const event = JSON.parse(line);

		if (event.type === "init") {
			sessionId = event.session_id;
			console.log(`📌 Session initialized: ${sessionId}`);
		} else if (event.type === "message") {
			messageCount++;
			if (event.role === "user") {
				console.log(
					`👤 User message ${messageCount}: ${event.content.substring(0, 50)}...`,
				);
			} else if (event.role === "assistant") {
				receivedResponse = true;
				console.log(
					`🤖 Assistant message ${messageCount}: ${event.content.substring(0, 100)}...`,
				);
			}
		} else if (event.type === "result") {
			console.log(`\n✅ Result: ${event.status}`);
			console.log(`   Stats: ${JSON.stringify(event.stats)}`);
		}
	} catch (_err) {
		console.error(`Failed to parse JSON: ${line}`);
	}
});

// Handle stderr
gemini.stderr!.on("data", (data: Buffer) => {
	console.error(`stderr: ${data.toString()}`);
});

// Handle process completion
gemini.on("close", (code: number) => {
	console.log(`\n🏁 Process exited with code ${code}`);

	if (code === 0 && receivedResponse) {
		console.log(`\n✅ SUCCESS: Multiple stdin writes worked!`);
		console.log(`   - Wrote 3 separate messages to stdin`);
		console.log(`   - Gemini processed all messages`);
		console.log(`   - Received ${messageCount} total messages`);
		process.exit(0);
	} else {
		console.error(`\n❌ FAILED: Did not receive expected response`);
		process.exit(1);
	}
});

// Execute the test
async function runTest() {
	console.log("1️⃣  Writing initial prompt to stdin immediately...");
	gemini.stdin!.write("What is 2+2?\n");
	console.log("   ✓ Written (this cancels the 500ms timeout)\n");

	// Wait a bit
	await new Promise((resolve) => setTimeout(resolve, 1000));

	console.log("2️⃣  Writing second message to stdin...");
	gemini.stdin!.write("Also, what is 3+3?\n");
	console.log("   ✓ Written (stdin still open)\n");

	// Wait a bit
	await new Promise((resolve) => setTimeout(resolve, 1000));

	console.log("3️⃣  Writing third message to stdin...");
	gemini.stdin!.write("Finally, what is 5+5?\n");
	console.log("   ✓ Written (stdin still open)\n");

	// Wait a bit
	await new Promise((resolve) => setTimeout(resolve, 1000));

	console.log("4️⃣  Closing stdin to trigger gemini processing...");
	gemini.stdin!.end();
	console.log("   ✓ stdin.end() called\n");

	console.log("⏳ Waiting for gemini to process all messages...\n");
}

runTest().catch((error) => {
	console.error(`\n❌ Test error: ${error.message}`);
	process.exit(1);
});
