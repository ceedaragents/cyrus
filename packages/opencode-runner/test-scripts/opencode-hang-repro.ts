/**
 * OpenCode SDK Error Handling Test
 *
 * This script demonstrates how the OpenCode SDK handles missing provider credentials.
 *
 * FINDING: The SDK does NOT hang - it throws ProviderModelNotFoundError internally
 * and logs it as "Unhandled rejection", then publishes session.idle WITHOUT
 * emitting session.error. This means:
 *
 * 1. The error IS detected internally (visible in ~/.local/share/opencode/log/)
 * 2. The error is NOT propagated via SSE events (no session.error)
 * 3. session.idle is emitted after the failed prompt
 * 4. No content events are received (no assistant response)
 *
 * The stall detection in OpenCodeRunner catches this by detecting
 * "heartbeats without content" which indicates the prompt failed silently.
 *
 * To test:
 *   cd packages/opencode-runner
 *   bun run test-scripts/opencode-hang-repro.ts
 *
 * Check logs at: ~/.local/share/opencode/log/
 */

import { createOpencode } from "@opencode-ai/sdk";

async function main() {
	console.log("=".repeat(60));
	console.log("OpenCode SDK Hang Reproduction");
	console.log("=".repeat(60));
	console.log("");
	console.log(
		`ANTHROPIC_API_KEY is ${process.env.ANTHROPIC_API_KEY ? "SET" : "NOT SET"}`,
	);
	console.log("");

	// Create OpenCode server and client
	console.log("[1] Creating OpenCode server...");
	const { client, server } = await createOpencode({
		port: 0, // Let OS assign port
		config: {
			model: "anthropic/claude-sonnet-4-5",
		},
	});
	console.log(`[2] Server started at ${server.url}`);

	// Subscribe to events
	console.log("[3] Subscribing to events...");
	const { stream } = await client.event.subscribe();
	console.log("[4] Event subscription established");

	// Process events in background
	const eventPromise = (async () => {
		let eventCount = 0;
		const startTime = Date.now();

		console.log("[5] Starting event loop...");
		console.log("");

		for await (const event of stream as AsyncIterable<{
			type: string;
			properties: Record<string, unknown>;
		}>) {
			eventCount++;
			const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

			console.log(`[Event #${eventCount} @ ${elapsed}s] ${event.type}`);

			// Log content for message events
			if (event.type === "message.part.updated") {
				const part = event.properties.part as { type: string; text?: string };
				if (part?.type === "text" && part.text) {
					console.log(`  Content: ${part.text.slice(0, 100)}...`);
				}
			}

			// Break on session completion or after 5 events
			if (event.type === "session.idle" || event.type === "session.error") {
				console.log("");
				console.log("Session completed!");
				break;
			}

			// Continue until we hit a terminal event or enough events
			if (eventCount >= 10) {
				console.log("");
				console.log("Stopping after 10 events.");
				break;
			}
		}
	})();

	// Create session
	console.log("[6] Creating session...");
	const sessionResponse = await client.session.create({});
	if (sessionResponse.error) {
		console.error("Failed to create session:", sessionResponse.error);
		server.close();
		return;
	}

	const session = sessionResponse.data;
	console.log(`[7] Session created: ${session?.id}`);

	// Send prompt using synchronous endpoint
	console.log("[8] Sending prompt...");
	const promptResponse = await client.session.prompt({
		path: { id: session!.id },
		body: {
			parts: [{ type: "text", text: "Say hello in exactly 3 words." }],
			model: { providerID: "anthropic", modelID: "claude-sonnet-4-5" },
		},
	});

	if (promptResponse.error) {
		console.error("Prompt error:", promptResponse.error);
	} else {
		console.log("[9] Prompt completed successfully");
	}

	// Wait for events
	await eventPromise;

	// Cleanup
	console.log("");
	console.log("Closing server...");
	server.close();
	console.log("Done.");
}

main().catch(console.error);
