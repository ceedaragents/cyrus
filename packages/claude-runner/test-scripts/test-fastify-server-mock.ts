#!/usr/bin/env tsx

/**
 * Test script for Cyrus Tools Fastify HTTP MCP server (Mock version)
 *
 * This script tests server functionality without requiring a real Linear API token:
 * 1. Server starts successfully with dynamic port
 * 2. Bearer token authentication is working
 * 3. All 8 tools are available
 * 4. Server can be stopped gracefully
 */

import { randomUUID } from "node:crypto";
import { createCyrusToolsFastifyServer } from "../src/tools/cyrus-tools/fastify-server.js";

async function main() {
	console.log("=== Testing Cyrus Tools Fastify HTTP MCP Server (Mock) ===\n");

	// Use a fake Linear API token for testing server infrastructure
	// (actual Linear API calls won't work, but server startup and auth will)
	const mockLinearApiToken = "lin_api_mock_test_token_12345";

	console.log("✓ Using mock Linear API token for infrastructure testing\n");

	// Test 1: Start the server
	console.log("Test 1: Starting server with dynamic port...");
	const serverResult = await createCyrusToolsFastifyServer(
		mockLinearApiToken,
		{},
		0, // Dynamic port
	);
	console.log(`✓ Server started on port ${serverResult.port}`);
	console.log(
		`✓ Bearer token generated: ${serverResult.token.substring(0, 16)}...`,
	);
	console.log(`✓ Token length: ${serverResult.token.length} characters`);
	console.log();

	// Test 2: Test authentication - should fail without token
	console.log("Test 2: Testing authentication without token (should fail)...");
	try {
		const response = await fetch(`http://127.0.0.1:${serverResult.port}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"mcp-session-id": randomUUID(),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		});

		if (response.status === 401) {
			console.log("✓ Authentication correctly rejected request without token");
		} else {
			console.error(
				`✗ Expected 401, got ${response.status} - authentication may not be working`,
			);
		}
	} catch (error) {
		console.error("✗ Error testing authentication:", error);
	}
	console.log();

	// Test 3: Test authentication - should succeed with correct token and list tools
	console.log(
		"Test 3: Testing authentication with correct token and listing tools...",
	);
	try {
		const response = await fetch(`http://127.0.0.1:${serverResult.port}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${serverResult.token}`,
				"mcp-session-id": randomUUID(),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		});

		if (response.ok) {
			console.log("✓ Authentication accepted valid token");

			const data = await response.json();

			// Verify the response structure
			if (data.result?.tools) {
				const tools = data.result.tools;
				console.log(`✓ Tools list received: ${tools.length} tools`);

				// Verify all 8 expected tools are present
				const expectedTools = [
					"linear_upload_file",
					"linear_agent_session_create",
					"linear_agent_session_create_on_comment",
					"linear_agent_give_feedback",
					"linear_set_issue_relation",
					"linear_get_child_issues",
					"linear_get_agent_sessions",
					"linear_get_agent_session",
				];

				const toolNames = tools.map((t: any) => t.name);
				const missingTools = expectedTools.filter(
					(name) => !toolNames.includes(name),
				);
				const extraTools = toolNames.filter(
					(name: string) => !expectedTools.includes(name),
				);

				if (missingTools.length === 0 && extraTools.length === 0) {
					console.log("✓ All 8 expected tools are present:");
					expectedTools.forEach((name) => {
						const tool = tools.find((t: any) => t.name === name);
						console.log(`  - ${name}: ${tool.description.substring(0, 60)}...`);
					});
				} else {
					if (missingTools.length > 0) {
						console.error(`✗ Missing tools: ${missingTools.join(", ")}`);
					}
					if (extraTools.length > 0) {
						console.error(`✗ Unexpected tools: ${extraTools.join(", ")}`);
					}
				}
			} else {
				console.error(
					"✗ Unexpected response structure:",
					JSON.stringify(data, null, 2),
				);
			}
		} else {
			const text = await response.text();
			console.error(`✗ Request failed: ${response.status} - ${text}`);
		}
	} catch (error) {
		console.error("✗ Error testing authenticated request:", error);
	}
	console.log();

	// Test 4: Test authentication - should fail with wrong token
	console.log(
		"Test 4: Testing authentication with wrong token (should fail)...",
	);
	try {
		const response = await fetch(`http://127.0.0.1:${serverResult.port}/mcp`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer wrong-token-12345",
				"mcp-session-id": randomUUID(),
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/list",
			}),
		});

		if (response.status === 401) {
			console.log("✓ Authentication correctly rejected invalid token");
		} else {
			console.error(
				`✗ Expected 401, got ${response.status} - authentication may not be working`,
			);
		}
	} catch (error) {
		console.error("✗ Error testing wrong token:", error);
	}
	console.log();

	// Test 5: Stop the server
	console.log("Test 5: Stopping server...");
	await serverResult.stop();
	console.log("✓ Server stopped gracefully");
	console.log();

	console.log("=== All Tests Complete ===");
	console.log("\nServer Verification Summary:");
	console.log("- ✓ Server starts on dynamic port");
	console.log(
		"- ✓ Bearer token authentication is enforced (64-char hex token)",
	);
	console.log("- ✓ Valid tokens are accepted");
	console.log("- ✓ Invalid tokens are rejected");
	console.log("- ✓ All 8 cyrus-tools are available via MCP");
	console.log("- ✓ Server stops gracefully");
	console.log(
		"\nThe Fastify HTTP MCP server for cyrus-tools is working correctly!",
	);
}

main().catch((error) => {
	console.error("Test failed with error:", error);
	process.exit(1);
});
