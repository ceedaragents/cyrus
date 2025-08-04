#!/usr/bin/env node

/**
 * Test if working directory is causing the hang
 */

import { ClaudeRunner } from "../dist/index.js";

async function testWorkingDir(workingDirectory, testName) {
	console.log(`\n🧪 Testing: ${testName}`);
	console.log(`📁 Working directory: ${workingDirectory}`);
	console.log("═".repeat(60));

	const config = {
		workingDirectory,
		workspaceName: "workdir-test",
		allowedTools: ["Read", "Edit", "Bash"],
		onMessage: (message) => {
			if (message.type === "system") {
				console.log("✅ Got system message - Claude is responding!");
			}
		},
		onError: (error) => console.error("❌ Error:", error.message),
		onComplete: () => console.log("✅ Session completed"),
	};

	const runner = new ClaudeRunner(config);
	const start = Date.now();

	try {
		console.log("🔄 Starting streaming session...");

		const _sessionInfo = await Promise.race([
			runner.startStreaming(
				"Hello, please tell me what directory you are in and list the files.",
			),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("TIMEOUT")), 20000),
			),
		]);

		// Wait for completion
		await new Promise((resolve) => {
			runner.on("complete", resolve);
			setTimeout(resolve, 10000); // 10 second timeout
		});

		const elapsed = Date.now() - start;
		console.log(`✅ ${testName} SUCCESS in ${elapsed}ms`);
		return true;
	} catch (error) {
		const elapsed = Date.now() - start;
		if (error.message === "TIMEOUT") {
			console.log(`❌ ${testName} HUNG after ${elapsed}ms`);
		} else {
			console.log(`❌ ${testName} failed: ${error.message}`);
		}
		return false;
	}
}

async function main() {
	console.log("🔍 Working Directory Test");
	console.log("Testing if specific working directory causes hang...");

	// Test 1: Simple temp directory (should work)
	await testWorkingDir("/tmp/claude-test-simple", "Simple temp directory");

	// Test 2: The production directory that hangs
	await testWorkingDir(
		"/Users/agentops/code/ceedar-new-workspaces/CEE-739",
		"Production directory (CEE-739)",
	);

	// Test 3: Different CEE directory
	await testWorkingDir(
		"/Users/agentops/code/ceedar-new-workspaces/CEE-test",
		"Different CEE directory",
	);

	// Test 4: Parent ceedar-new-workspaces directory
	await testWorkingDir(
		"/Users/agentops/code/ceedar-new-workspaces",
		"Parent workspaces directory",
	);

	console.log("\n🎯 Working directory test complete!");
}

main().catch((error) => {
	console.error("💥 Test failed:", error);
	process.exit(1);
});
