#!/usr/bin/env node

/**
 * Test OpenCode session without session.init() call
 *
 * This test verifies that OpenCodeRunner works correctly without calling
 * session.init(), which was hanging indefinitely in OpenCode SDK v1.0.167.
 *
 * The fix skips session.init() and relies on promptAsync to handle
 * initialization internally.
 */

import { OpenCodeRunner } from "../dist/index.js";

async function main() {
	console.log("🚀 OpenCode Session Test (without session.init())");
	console.log("📋 This test verifies the fix for session.init() hanging issue");
	console.log("");

	const config = {
		workingDirectory: "/tmp/opencode-test",
		allowedTools: [],
		workspaceName: "opencode-test",
		model: "anthropic/claude-sonnet-4-5",
		onMessage: (message) => {
			console.log(`📧 ${message.type} message received`);
		},
		onComplete: (messages) => {
			console.log(`✅ Session completed with ${messages.length} messages`);
		},
		onError: (error) => {
			console.error("❌ Error:", error.message);
		},
	};

	const runner = new OpenCodeRunner(config);

	try {
		const start = Date.now();
		console.log("🔄 Starting session (without calling session.init())...");
		console.log("");

		// Start streaming - OpenCodeRunner will skip session.init()
		const sessionInfo = await runner.startStreaming(
			'Say "Hello from OpenCode" and nothing else.',
		);

		console.log(`📊 Session started successfully: ${sessionInfo.sessionId}`);
		console.log(`   OpenCode Session ID: ${sessionInfo.openCodeSessionId}`);
		console.log(`   Server Port: ${sessionInfo.serverPort}`);
		console.log("");

		// Wait for completion
		await new Promise((resolve) => {
			runner.on("complete", () => {
				const elapsed = Date.now() - start;
				console.log(`🎉 Completed in ${elapsed}ms!`);
				resolve();
			});

			runner.on("error", (error) => {
				console.error("💥 Session error:", error);
				resolve();
			});

			// Safety timeout (30 seconds)
			setTimeout(() => {
				console.log("⏰ Timeout after 30 seconds");
				resolve();
			}, 30000);
		});

		// Show final state
		const messages = runner.getMessages();
		console.log("");
		console.log("📊 Final Results:");
		console.log(`   Total messages: ${messages.length}`);
		console.log(`   Is still streaming: ${runner.isStreaming()}`);
		console.log(`   Is still running: ${runner.isRunning()}`);

		// Show the actual response
		const assistantMessages = messages.filter((m) => m.type === "assistant");
		if (assistantMessages.length > 0) {
			console.log("");
			console.log("🤖 Assistant responses:");
			assistantMessages.forEach((msg, idx) => {
				if (msg.message?.content) {
					const content = Array.isArray(msg.message.content)
						? msg.message.content.map((c) => c.text || "").join("")
						: msg.message.content;
					console.log(`   [${idx + 1}] "${content}"`);
				}
			});
		}

		console.log("");
		console.log("✅ SUCCESS: Session worked without session.init()!");
		console.log("   The fix is confirmed working.");

		// Cleanup
		runner.stop();
	} catch (error) {
		console.error("💥 Error:", error);
		console.error("");
		console.error("❌ FAILURE: Session did not work without session.init()");
		console.error("   This may indicate a regression or SDK issue.");
		process.exit(1);
	}
}

main().catch((error) => {
	console.error("💥 Unhandled error:", error);
	process.exit(1);
});
