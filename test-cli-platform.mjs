#!/usr/bin/env node

/**
 * Test script for CLI IssueTracker platform
 *
 * This script:
 * 1. Starts an EdgeWorker with CLI platform
 * 2. Makes RPC calls to create issues and agent sessions
 * 3. Verifies the CLI platform works end-to-end
 */

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdgeWorker } from "./packages/edge-worker/dist/EdgeWorker.js";

const TEST_PORT = 3457;
const RPC_URL = `http://localhost:${TEST_PORT}/cli/rpc`;

async function makeRPCCall(method, params = {}) {
	const response = await fetch(RPC_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ method, params }),
	});
	return await response.json();
}

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	console.log("🧪 Testing CLI IssueTracker Platform\n");

	// Create temporary directories
	const cyrusHome = join(tmpdir(), "cyrus-cli-test-" + Date.now());
	await mkdir(cyrusHome, { recursive: true });
	await mkdir(join(cyrusHome, "worktrees"), { recursive: true });

	console.log(`📁 Using temp directory: ${cyrusHome}\n`);

	// Configure EdgeWorker with CLI platform
	const config = {
		cyrusHome,
		serverPort: TEST_PORT,
		repositories: [
			{
				id: "test-repo",
				name: "Test Repository",
				repositoryPath: process.cwd(),
				baseBranch: "main",
				workspaceBaseDir: join(cyrusHome, "worktrees"),
				platform: "cli",
				linearWorkspaceId: "test-workspace",
				teamKeys: ["TEST"],
			},
		],
		agentHandle: "cyrus",
		agentUserId: "agent-user-1",
	};

	console.log("🚀 Starting EdgeWorker with CLI platform...\n");

	const edgeWorker = new EdgeWorker(config);
	await edgeWorker.start();

	console.log("✅ EdgeWorker started successfully!\n");
	console.log(`📡 RPC endpoint: ${RPC_URL}\n`);

	// Wait a moment for server to be ready
	await sleep(500);

	try {
		// Test 1: Create an issue
		console.log("📝 Test 1: Creating an issue...");
		const createIssueResult = await makeRPCCall("createIssue", {
			title: "Test CLI Issue",
			description: "This is a test issue created via CLI RPC",
		});
		console.log("   Result:", JSON.stringify(createIssueResult, null, 2));

		if (!createIssueResult.success) {
			throw new Error("Failed to create issue: " + createIssueResult.error);
		}

		const issueId = createIssueResult.data.id;
		console.log(`   ✅ Created issue: ${issueId}\n`);

		// Test 2: Create a comment
		console.log("💬 Test 2: Creating a comment...");
		const createCommentResult = await makeRPCCall("createComment", {
			issueId,
			body: "Test comment from CLI RPC",
			mentionAgent: false,
		});
		console.log("   Result:", JSON.stringify(createCommentResult, null, 2));

		if (!createCommentResult.success) {
			throw new Error("Failed to create comment: " + createCommentResult.error);
		}
		console.log("   ✅ Created comment\n");

		// Test 3: Start agent session
		console.log("🤖 Test 3: Starting agent session on issue...");
		const startSessionResult = await makeRPCCall("startAgentSessionOnIssue", {
			issueId,
		});
		console.log("   Result:", JSON.stringify(startSessionResult, null, 2));

		if (!startSessionResult.success) {
			throw new Error(
				"Failed to start agent session: " + startSessionResult.error,
			);
		}

		const sessionId = startSessionResult.data.agentSessionId;
		console.log(`   ✅ Started agent session: ${sessionId}\n`);

		// Test 4: View agent session
		console.log("👀 Test 4: Viewing agent session...");
		const viewSessionResult = await makeRPCCall("viewAgentSession", {
			sessionId,
		});
		console.log("   Result:", JSON.stringify(viewSessionResult, null, 2));

		if (!viewSessionResult.success) {
			throw new Error(
				"Failed to view agent session: " + viewSessionResult.error,
			);
		}
		console.log("   ✅ Viewed agent session\n");

		// Test 5: Fetch labels
		console.log("🏷️  Test 5: Fetching labels...");
		const labelsResult = await makeRPCCall("fetchLabels");
		console.log("   Result:", JSON.stringify(labelsResult, null, 2));

		if (!labelsResult.success) {
			throw new Error("Failed to fetch labels: " + labelsResult.error);
		}
		console.log("   ✅ Fetched labels\n");

		// Test 6: Fetch members
		console.log("👥 Test 6: Fetching members...");
		const membersResult = await makeRPCCall("fetchMembers");
		console.log("   Result:", JSON.stringify(membersResult, null, 2));

		if (!membersResult.success) {
			throw new Error("Failed to fetch members: " + membersResult.error);
		}
		console.log("   ✅ Fetched members\n");

		console.log("🎉 All tests passed!\n");
	} catch (error) {
		console.error("❌ Test failed:", error.message);
		console.error(error.stack);
		process.exit(1);
	} finally {
		console.log("🛑 Stopping EdgeWorker...");
		await edgeWorker.stop();
		console.log("✅ EdgeWorker stopped\n");
	}
}

main().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});
