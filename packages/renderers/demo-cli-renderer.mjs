#!/usr/bin/env node

/**
 * Demo script for CLIRenderer
 *
 * This script demonstrates the CLIRenderer with a mock agent session
 * that simulates real-time activity updates.
 *
 * Usage: node demo-cli-renderer.mjs
 */

import { CLIRenderer } from "./dist/cli/CLIRenderer.js";

// Mock sleep function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Create renderer instance
const renderer = new CLIRenderer({
	verboseFormatting: true,
	maxActivities: 100,
});

// Mock session data
const session = {
	id: "demo-session-1",
	issueId: "DEMO-123",
	issueTitle: "Implement user authentication feature",
	startedAt: new Date(),
};

// Mock activities to simulate
const mockActivities = [
	{
		type: "thought",
		content: {
			type: "thought",
			body: "Analyzing the requirements for user authentication...",
		},
	},
	{
		type: "action",
		content: {
			type: "action",
			action: "read_file",
			parameter: '{"path": "src/auth/login.ts"}',
			result: '{"lines": 45, "hasTests": true}',
		},
	},
	{
		type: "response",
		content: {
			type: "response",
			body: "I've analyzed the login module. It currently uses session-based auth. I'll add JWT support.",
		},
	},
	{
		type: "thought",
		content: { type: "thought", body: "Planning the implementation steps..." },
	},
	{
		type: "action",
		content: {
			type: "action",
			action: "write_file",
			parameter: '{"path": "src/auth/jwt.ts", "content": "..."}',
			result: '{"success": true, "bytesWritten": 1234}',
		},
	},
	{
		type: "response",
		content: {
			type: "response",
			body: "Created JWT authentication module with token generation and validation.",
		},
	},
	{
		type: "thought",
		content: {
			type: "thought",
			body: "Now adding tests for the new functionality...",
		},
	},
	{
		type: "action",
		content: {
			type: "action",
			action: "run_tests",
			parameter: '{"pattern": "**/*.test.ts"}',
			result: '{"passed": 12, "failed": 0, "total": 12}',
		},
	},
	{
		type: "response",
		content: {
			type: "response",
			body: "All tests passed! The JWT authentication feature is ready.",
		},
	},
];

/**
 * Simulate an agent session with activities
 */
async function simulateAgentSession() {
	console.log("\n🚀 Starting CLIRenderer Demo\n");
	console.log("This demo simulates a Cyrus agent working on an issue.");
	console.log("You can type messages and press Enter to send them.");
	console.log("Press Ctrl+S to stop the session, or Ctrl+C to exit.\n");

	await sleep(1000);

	// Start session
	await renderer.renderSessionStart(session);

	// Simulate activities with delays
	for (const activity of mockActivities) {
		await sleep(2000); // 2 second delay between activities
		await renderer.renderActivity(session.id, activity);
	}

	// Wait a bit before completing
	await sleep(2000);

	// Complete session
	const summary = {
		turns: 5,
		toolsUsed: 4,
		filesModified: [
			"src/auth/jwt.ts",
			"src/auth/index.ts",
			"test/auth.test.ts",
		],
		summary: "Successfully implemented JWT authentication feature with tests",
		exitCode: 0,
	};

	await renderer.renderComplete(session.id, summary);

	// Keep the UI running so user can interact
	console.log(
		"\n\n✅ Demo session completed! The UI is still running for interaction.",
	);
	console.log("   Type messages and press Enter to see user input handling.");
	console.log("   Press Ctrl+C to exit.\n");

	// Listen for user input and display it
	const userInputIterator = renderer.getUserInput(session.id);

	for await (const input of userInputIterator) {
		if (input.type === "message") {
			console.log(`\n📨 Received message: "${input.content}"`);

			// Send acknowledgment back to the activity panel
			await renderer.renderText(session.id, `Acknowledged: "${input.content}"`);
		} else if (input.type === "signal") {
			console.log(`\n🛑 Received signal: ${input.signal.type}`);
			if (input.signal.type === "stop") {
				console.log("   Stopping demo...\n");
				renderer.stop();
				process.exit(0);
			}
		}
	}
}

// Handle errors
process.on("uncaughtException", (error) => {
	console.error("\n❌ Error:", error.message);
	renderer.stop();
	process.exit(1);
});

process.on("SIGINT", () => {
	console.log("\n\n👋 Exiting demo...\n");
	renderer.stop();
	process.exit(0);
});

// Start the demo
simulateAgentSession().catch((error) => {
	console.error("\n❌ Demo failed:", error);
	renderer.stop();
	process.exit(1);
});
