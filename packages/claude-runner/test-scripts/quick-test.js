#!/usr/bin/env node

/**
 * Quick test with minimal prompt to prove streaming works
 */

import { ClaudeRunner } from "../dist/index.js";

async function main() {
	console.log("🚀 Quick Streaming Test - Should complete in seconds");

	const config = {
		workingDirectory: "/tmp/quick-test",
		allowedTools: [], // No tools = faster
		workspaceName: "quick-test",
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

	const runner = new ClaudeRunner(config);

	try {
		const start = Date.now();
		console.log("🔄 Starting with super simple prompt...");

		// Super simple prompt that should complete immediately
		const sessionInfo = await runner.startStreaming(
			'Say "Hello" and nothing else.',
		);

		console.log(`📊 Session started: ${sessionInfo.sessionId}`);

		// Wait for completion
		await new Promise((resolve) => {
			runner.on("complete", () => {
				const elapsed = Date.now() - start;
				console.log(`🎉 Completed in ${elapsed}ms!`);
				resolve();
			});

			// Safety timeout
			setTimeout(() => {
				console.log("⏰ Timeout after 10 seconds");
				resolve();
			}, 10000);
		});

		// Show final state
		const messages = runner.getMessages();
		console.log(`\n📊 Final Results:`);
		console.log(`- Total messages: ${messages.length}`);
		console.log(`- Is still streaming: ${runner.isStreaming()}`);
		console.log(`- Is still running: ${runner.isRunning()}`);

		// Show the actual response
		const assistantMessages = messages.filter((m) => m.type === "assistant");
		if (assistantMessages.length > 0) {
			console.log(`\n🤖 Assistant said:`);
			assistantMessages.forEach((msg) => {
				if (msg.message?.content) {
					const content = Array.isArray(msg.message.content)
						? msg.message.content.map((c) => c.text || "").join("")
						: msg.message.content;
					console.log(`"${content}"`);
				}
			});
		}
	} catch (error) {
		console.error("💥 Error:", error);
	}
}

main().catch(console.error);
