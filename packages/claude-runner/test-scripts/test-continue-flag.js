#!/usr/bin/env node

/**
 * Test if continueSession flag is causing the hang
 */

import { ClaudeRunner } from "../dist/index.js";

async function testConfig(name, config) {
	console.log(`\n🧪 Testing: ${name}`);
	console.log("═".repeat(50));

	const runner = new ClaudeRunner(config);

	try {
		const start = Date.now();
		const timeout = new Promise((_, reject) =>
			setTimeout(() => reject(new Error("TIMEOUT")), 20000),
		);

		const _sessionInfo = await Promise.race([
			runner.startStreaming("Hello, what tools do you have?"),
			timeout,
		]);

		console.log(`✅ Started in ${Date.now() - start}ms`);

		// Wait a bit for messages
		await new Promise((resolve) => setTimeout(resolve, 5000));

		const messages = runner.getMessages();
		console.log(`📊 Messages received: ${messages.length}`);
		console.log(`🌊 Still streaming: ${runner.isStreaming()}`);
	} catch (error) {
		if (error.message === "TIMEOUT") {
			console.log(`❌ HUNG - This configuration causes the hang!`);
		} else {
			console.log(`❌ Error: ${error.message}`);
		}
	}
}

async function main() {
	const baseConfig = {
		workingDirectory: "/tmp/test-continue",
		allowedTools: ["Read", "Edit"],
		cyrusHome: "/tmp/test-cyrus-home",
		onMessage: (msg) => console.log(`  📧 ${msg.type}`),
	};

	// Test 1: Without continueConversation
	await testConfig("Without continueConversation", baseConfig);

	// Test 2: With continueConversation
	await testConfig("With continueConversation = true", {
		...baseConfig,
		continueConversation: true,
	});

	// Test 3: With MCP servers
	await testConfig("With MCP servers (no continue)", {
		...baseConfig,
		mcpConfigPath: ["/Users/agentops/code/ceedarmcpconfig.json"],
	});

	// Test 4: With both
	await testConfig("With MCP + continueConversation", {
		...baseConfig,
		continueConversation: true,
		mcpConfigPath: ["/Users/agentops/code/ceedarmcpconfig.json"],
	});
}

main().catch(console.error);
