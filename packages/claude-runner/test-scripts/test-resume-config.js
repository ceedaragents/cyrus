#!/usr/bin/env node

/**
 * Test script to verify config is passed correctly through ClaudeRunner
 */

import { ClaudeRunner } from "../dist/ClaudeRunner.js";

async function testResumeConfig() {
	console.log("=== Testing Resume Config Propagation ===\n");

	// Test configuration with resumeSessionId
	const testSessionId = "test-session-12345";
	const config = {
		workingDirectory: process.cwd(),
		resumeSessionId: testSessionId,
		workspaceName: "test-workspace",
	};

	console.log(
		"Creating ClaudeRunner with config:",
		JSON.stringify(config, null, 2),
	);

	// Create runner instance - this will log the constructor message
	const _runner = new ClaudeRunner(config);

	console.log(
		"\nClaudeRunner instance created. Check the logs above for resumeSessionId.",
	);
}

// Run the test
testResumeConfig().catch(console.error);
