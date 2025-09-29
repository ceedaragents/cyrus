#!/usr/bin/env node

/**
 * Minimal test to check if AsyncIterable implementation is correct
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// Test 1: Simple async generator (this should work)
async function* simpleAsyncGenerator() {
	console.log("[Generator] Yielding first message");
	yield {
		type: "user",
		message: {
			role: "user",
			content: "Hello! What tools do you have?",
		},
		parent_tool_use_id: null,
		session_id: "test-session",
	};

	console.log("[Generator] Generator complete");
}

// Test 2: Our StreamingPrompt-like implementation
class TestStreamingPrompt {
	constructor() {
		this.messageQueue = [];
		this.resolvers = [];
		this.isComplete = false;

		// Add initial message
		this.messageQueue.push({
			type: "user",
			message: {
				role: "user",
				content: "Hello! What tools do you have?",
			},
			parent_tool_use_id: null,
			session_id: "test-session",
		});
	}

	[Symbol.asyncIterator]() {
		return {
			next: () => {
				return new Promise((resolve) => {
					console.log(
						`[TestStreaming] next() called - queue: ${this.messageQueue.length}, complete: ${this.isComplete}`,
					);
					if (this.messageQueue.length > 0) {
						const message = this.messageQueue.shift();
						console.log(`[TestStreaming] Returning queued message`);
						resolve({ value: message, done: false });
					} else if (this.isComplete) {
						console.log(`[TestStreaming] Complete, ending`);
						resolve({ value: undefined, done: true });
					} else {
						console.log(`[TestStreaming] Waiting for more...`);
						this.resolvers.push(resolve);
					}
				});
			},
		};
	}

	complete() {
		this.isComplete = true;
		while (this.resolvers.length > 0) {
			const resolver = this.resolvers.shift();
			resolver({ value: undefined, done: true });
		}
	}
}

async function testAsyncIterable(name, prompt, shouldComplete = false) {
	console.log(`\n🧪 Testing: ${name}`);
	console.log("═".repeat(50));

	const abortController = new AbortController();
	const timeout = setTimeout(() => {
		console.log("⏰ Timeout - aborting test");
		abortController.abort();
	}, 15000);

	try {
		let messageCount = 0;

		if (shouldComplete && prompt.complete) {
			// Complete the stream after 2 seconds
			setTimeout(() => {
				console.log("[Test] Completing stream after 2s");
				prompt.complete();
			}, 2000);
		}

		for await (const message of query({
			prompt,
			abortController,
			options: {
				cwd: "/tmp",
				allowedTools: ["Read", "Edit"],
			},
		})) {
			messageCount++;
			console.log(`📨 Message ${messageCount}: ${message.type}`);

			if (message.type === "result") {
				console.log("✅ Got result message - session complete");
				break;
			}
		}

		console.log(`✅ ${name} completed with ${messageCount} messages`);
	} catch (error) {
		if (error.name === "AbortError") {
			console.log(`❌ ${name} timed out - AsyncIterable might be blocking`);
		} else {
			console.log(`❌ ${name} failed: ${error.message}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}

async function main() {
	console.log("🔍 Testing AsyncIterable implementations");

	// Test 1: Simple generator (should work)
	await testAsyncIterable("Simple async generator", simpleAsyncGenerator());

	// Test 2: Our implementation without completion (should hang)
	const streaming1 = new TestStreamingPrompt();
	await testAsyncIterable("Streaming without completion", streaming1);

	// Test 3: Our implementation with completion (should work)
	const streaming2 = new TestStreamingPrompt();
	await testAsyncIterable("Streaming with completion", streaming2, true);
}

main().catch(console.error);
