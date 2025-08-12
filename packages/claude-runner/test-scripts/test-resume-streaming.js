#!/usr/bin/env node

/**
 * Test script to verify resume functionality with streaming mode
 */

import { ClaudeRunner } from "../dist/ClaudeRunner.js";

async function testResumeWithStreaming() {
	console.log("=== Testing Resume with Streaming Mode ===\n");

	// Test configuration
	const testSessionId = "test-session-12345";
	const config = {
		workingDirectory: process.cwd(),
		resumeSessionId: testSessionId,
		workspaceName: "test-workspace",
	};

	console.log("Test config:", JSON.stringify(config, null, 2));

	try {
		// Create runner instance
		const runner = new ClaudeRunner(config);

		// Start streaming session
		console.log("\nStarting streaming session...");
		const sessionInfo = await runner.startStreaming("Test prompt");

		console.log("\nSession info:", sessionInfo);

		// Give it a moment to log
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Stop the runner
		runner.stop();
	} catch (error) {
		console.error("Test error:", error);
	}
}

// Run the test
testResumeWithStreaming().catch(console.error);
