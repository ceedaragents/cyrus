#!/usr/bin/env bun
/**
 * Test to demonstrate the stdin logic works correctly
 *
 * This test uses a mock "stdin reader" that simulates gemini-cli's readStdin behavior:
 * 1. 500ms timeout - if no data arrives, resolves with empty
 * 2. Once data arrives, cancels timeout and waits for stdin to close
 * 3. Accumulates all chunks until stdin closes
 *
 * Then we simulate GeminiRunner's behavior:
 * 1. Write initial prompt immediately (cancels timeout)
 * 2. Keep stdin open for addStreamMessage() calls
 * 3. Close stdin in completeStream()
 *
 * Run with: bun run test-scripts/test-stdin-logic.ts
 */

import { Readable, Writable } from "node:stream";

console.log("🧪 Testing GeminiRunner stdin logic (simulated)\n");

// Simulate gemini-cli's readStdin() behavior
function simulateReadStdin(stdin: Readable): Promise<string> {
	const MAX_STDIN_SIZE = 8 * 1024 * 1024;
	return new Promise((resolve, reject) => {
		let data = "";
		let totalSize = 0;
		stdin.setEncoding("utf8");

		const pipedInputShouldBeAvailableInMs = 500;
		let pipedInputTimerId: NodeJS.Timeout | null = setTimeout(() => {
			console.log("   ⏱️  500ms timeout fired - no data received");
			onEnd();
		}, pipedInputShouldBeAvailableInMs);

		const onReadable = () => {
			let chunk: Buffer | string | null;
			// biome-ignore lint/suspicious/noAssignInExpressions: Standard Node.js pattern for reading streams
			while ((chunk = stdin.read()) !== null) {
				if (pipedInputTimerId) {
					console.log("   ✅ Data arrived - canceling 500ms timeout");
					clearTimeout(pipedInputTimerId);
					pipedInputTimerId = null;
				}

				if (totalSize + chunk.length > MAX_STDIN_SIZE) {
					const remainingSize = MAX_STDIN_SIZE - totalSize;
					data += chunk.slice(0, remainingSize);
					console.warn(`   ⚠️  stdin truncated to ${MAX_STDIN_SIZE} bytes`);
					stdin.destroy();
					break;
				}
				data += chunk;
				totalSize += chunk.length;
				console.log(`   📝 Read ${chunk.length} bytes (total: ${totalSize})`);
			}
		};

		const onEnd = () => {
			console.log("   🏁 stdin closed - resolving with accumulated data");
			cleanup();
			resolve(data);
		};

		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const cleanup = () => {
			if (pipedInputTimerId) {
				clearTimeout(pipedInputTimerId);
				pipedInputTimerId = null;
			}
			stdin.removeListener("readable", onReadable);
			stdin.removeListener("end", onEnd);
			stdin.removeListener("error", onError);
		};

		stdin.on("readable", onReadable);
		stdin.on("end", onEnd);
		stdin.on("error", onError);
	});
}

// Simulate GeminiRunner behavior
async function testGeminiRunnerLogic() {
	console.log("📋 Simulating GeminiRunner with multiple stdin writes:\n");

	// Create a readable/writable stream pair
	const readable = new Readable({ read() {} });
	const writable = new Writable({
		write(chunk, _encoding, callback) {
			readable.push(chunk);
			callback();
		},
		final(callback) {
			readable.push(null); // Signal end
			callback();
		},
	});

	// Start the stdin reader (simulating gemini-cli)
	const readerPromise = simulateReadStdin(readable);

	console.log("1️⃣  Writing initial prompt immediately (simulating line 249)...");
	writable.write("What is 2+2?\n");
	console.log("   ✓ Initial prompt written\n");

	// Wait a bit (simulating async operation)
	await new Promise((resolve) => setTimeout(resolve, 100));

	console.log(
		"2️⃣  Calling addStreamMessage() - writing to stdin (simulating line 105)...",
	);
	writable.write("Also, what is 3+3?\n");
	console.log("   ✓ Second message written\n");

	// Wait a bit
	await new Promise((resolve) => setTimeout(resolve, 100));

	console.log("3️⃣  Calling addStreamMessage() again - writing to stdin...");
	writable.write("Finally, what is 5+5?\n");
	console.log("   ✓ Third message written\n");

	// Wait a bit
	await new Promise((resolve) => setTimeout(resolve, 100));

	console.log(
		"4️⃣  Calling completeStream() - closing stdin (simulating line 118)...",
	);
	writable.end();
	console.log("   ✓ stdin.end() called\n");

	console.log("⏳ Waiting for reader to accumulate all data...\n");

	// Wait for reader to finish
	const result = await readerPromise;

	console.log("📊 Results:\n");
	console.log(`   Total data received: ${result.length} bytes`);
	console.log(`   Data content:\n${result}`);

	// Verify we got all three messages
	const expectedMessages = [
		"What is 2+2?",
		"Also, what is 3+3?",
		"Finally, what is 5+5?",
	];

	const allMessagesPresent = expectedMessages.every((msg) =>
		result.includes(msg),
	);

	if (allMessagesPresent) {
		console.log("\n✅ SUCCESS: All three messages were received!");
		console.log("   This proves:");
		console.log("   1. Initial write canceled the 500ms timeout");
		console.log("   2. stdin stayed open for additional writes");
		console.log("   3. All data was accumulated until stdin closed");
		console.log("   4. The GeminiRunner stdin logic is correct! ✨");
		process.exit(0);
	} else {
		console.error("\n❌ FAILED: Not all messages were received");
		console.error(`   Expected: ${expectedMessages.join(", ")}`);
		console.error(`   Got: ${result}`);
		process.exit(1);
	}
}

// Run the test
testGeminiRunnerLogic().catch((error) => {
	console.error(`\n❌ Test error: ${error.message}`);
	console.error(error.stack);
	process.exit(1);
});
