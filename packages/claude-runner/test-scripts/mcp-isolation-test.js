#!/usr/bin/env node

/**
 * Test to isolate which MCP server is causing the hang
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ClaudeRunner } from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, "..", ".env") });

async function testMCPConfig(testName, mcpConfig, mcpConfigPath = null) {
	console.log(`\n🧪 Testing: ${testName}`);
	console.log("═".repeat(50));

	const config = {
		workingDirectory: "/Users/agentops/code/ceedar-new-workspaces/CEE-739",
		workspaceName: "mcp-test",
		allowedTools: ["Read", "Edit", "Bash"],

		...(mcpConfigPath && { mcpConfigPath }),
		...(mcpConfig && { mcpConfig }),

		onMessage: (message) => {
			if (message.type === "system" && message.mcp_servers) {
				console.log(
					"✅ MCP servers loaded:",
					message.mcp_servers.map((s) => s.name),
				);
			}
		},

		onError: (error) => console.error("❌ Error:", error.message),
		onComplete: () => console.log("✅ Session completed"),
	};

	const runner = new ClaudeRunner(config);

	const start = Date.now();

	try {
		console.log("🔄 Starting session...");

		const _sessionInfo = await Promise.race([
			runner.startStreaming("Hello, what tools do you have?"),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("TIMEOUT")), 30000),
			),
		]);

		const elapsed = Date.now() - start;
		console.log(`✅ ${testName} completed in ${elapsed}ms`);

		// Wait for completion
		await new Promise((resolve) => {
			runner.on("complete", resolve);
			setTimeout(resolve, 5000); // 5 second timeout
		});

		return true;
	} catch (error) {
		const elapsed = Date.now() - start;
		if (error.message === "TIMEOUT") {
			console.log(
				`❌ ${testName} HUNG after ${elapsed}ms - THIS IS THE CULPRIT!`,
			);
		} else {
			console.log(`❌ ${testName} failed: ${error.message}`);
		}
		return false;
	}
}

async function main() {
	console.log("🔍 MCP Server Isolation Test");
	console.log("Finding which MCP server causes the hang...");

	// Test 1: No MCP servers
	await testMCPConfig("No MCP servers", null, null);

	// Test 2: Only Linear MCP server
	await testMCPConfig("Only Linear MCP", {
		linear: {
			type: "http",
			url: "https://mcp.linear.app/mcp",
			headers: {
				Authorization: `Bearer ${process.env.LINEAR_API_TOKEN}`,
			},
		},
	});

	// Test 3: Only file-based MCP servers (ceedardb, ceedar_linear)
	await testMCPConfig("Only file-based MCP servers", null, [
		"/Users/agentops/code/ceedarmcpconfig.json",
	]);

	// Test 4: All MCP servers (should hang)
	await testMCPConfig(
		"All MCP servers (production config)",
		{
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: {
					Authorization: `Bearer ${process.env.LINEAR_API_TOKEN}`,
				},
			},
		},
		["/Users/agentops/code/ceedarmcpconfig.json"],
	);

	console.log("\n🎯 Isolation test complete!");
}

main().catch((error) => {
	console.error("💥 Test failed:", error);
	process.exit(1);
});
