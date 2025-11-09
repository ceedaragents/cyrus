import { EventEmitter } from "node:events";
import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";

/**
 * Reproduction test for CYPACK-360: Critical 'Cyrus stopped responding issue'
 *
 * This test reproduces the race condition that occurs when:
 * 1. A ClaudeRunner receives a result message and completes the streaming prompt
 * 2. The message handler asynchronously calls resumeNextSubroutine
 * 3. resumeClaudeSession checks isStreaming() which returns false (stream just completed)
 * 4. resumeClaudeSession calls stop() on the runner while it's still completing
 * 5. The runner is aborted before it can emit the "complete" event
 *
 * Root cause: EventEmitter.emit() does not wait for async listeners, creating a timing
 * window where the streaming prompt is marked as complete but the runner is still active.
 */
describe("EdgeWorker - Subroutine Transition Race Condition (CYPACK-360)", () => {
	/**
	 * Mock ClaudeRunner that simulates the real ClaudeRunner's state transitions
	 */
	class MockClaudeRunner extends EventEmitter {
		private streamingPrompt: { completed: boolean } | null = null;
		private sessionInfo: { isRunning: boolean } = { isRunning: false };
		private abortController: AbortController | null = null;
		private messageProcessingDelay: number;

		constructor(messageProcessingDelay = 0) {
			super();
			this.messageProcessingDelay = messageProcessingDelay;
		}

		/**
		 * Simulate starting a streaming session
		 */
		async startStreaming(): Promise<void> {
			this.sessionInfo.isRunning = true;
			this.streamingPrompt = { completed: false };
			this.abortController = new AbortController();
		}

		/**
		 * Simulate receiving a result message
		 * This is where the race condition occurs
		 */
		async simulateResultMessage(): Promise<void> {
			if (!this.streamingPrompt) {
				throw new Error("Not streaming");
			}

			// Step 1: Complete streaming prompt BEFORE emitting
			// (This matches the real ClaudeRunner.ts line 469)
			console.log("[MockRunner] Completing streaming prompt");
			this.streamingPrompt.completed = true;

			// Step 2: Emit message event
			const resultMessage: SDKResultMessage = {
				type: "result",
				result: "Task completed",
				session_id: "test-session",
			};

			// Collect promises from async listeners to simulate the real async behavior
			const listenerPromises: Promise<void>[] = [];
			const listeners = this.listeners("message");
			for (const listener of listeners) {
				const result = listener(resultMessage);
				if (result instanceof Promise) {
					listenerPromises.push(result);
				}
			}

			// Step 3: Simulate processing delay before completion
			// In the real ClaudeRunner, there's work between completing the stream
			// and emitting the "complete" event (lines 469-478)
			// This is the critical window where the race can occur!
			if (this.messageProcessingDelay > 0) {
				await new Promise((resolve) =>
					setTimeout(resolve, this.messageProcessingDelay),
				);
			}

			// Step 4: Check if we've been aborted before we can complete
			// The abort could have been triggered by any of the async listeners
			if (this.abortController?.signal.aborted) {
				console.log("[MockRunner] Session was aborted!");
				this.sessionInfo.isRunning = false;
				throw new Error("AbortError: Claude Code process aborted by user");
			}

			// Step 5: Complete successfully
			console.log("[MockRunner] Session completed successfully");
			this.sessionInfo.isRunning = false;
			this.emit("complete", ["message1", "message2"]);
		}

		/**
		 * Check if streaming (mimics ClaudeRunner.isStreaming())
		 */
		isStreaming(): boolean {
			return (
				this.streamingPrompt !== null &&
				!this.streamingPrompt.completed &&
				this.isRunning()
			);
		}

		/**
		 * Check if running (mimics ClaudeRunner.isRunning())
		 */
		isRunning(): boolean {
			return this.sessionInfo.isRunning;
		}

		/**
		 * Stop the runner (mimics ClaudeRunner.stop())
		 */
		stop(): void {
			if (this.abortController) {
				console.log("[MockRunner] Stopping session - aborting!");
				this.abortController.abort();
				this.abortController = null;
			}

			if (this.streamingPrompt) {
				this.streamingPrompt.completed = true;
				this.streamingPrompt = null;
			}

			this.sessionInfo.isRunning = false;
		}
	}

	/**
	 * Mock EdgeWorker's resumeClaudeSession logic
	 */
	async function _mockResumeClaudeSession(
		existingRunner: MockClaudeRunner | null,
		nextPrompt: string,
	): Promise<void> {
		// This is the buggy code from EdgeWorker.ts lines 4619-4632
		if (existingRunner?.isStreaming()) {
			console.log("[EdgeWorker] Adding to existing stream");
			return;
		}

		// BUG: This stops the runner even if it's still completing!
		if (existingRunner) {
			console.log("[EdgeWorker] Stopping existing runner (NOT streaming)");
			existingRunner.stop();
		}

		console.log(
			"[EdgeWorker] Would start new session with prompt:",
			nextPrompt,
		);
	}

	describe("Race Condition Reproduction", () => {
		it("should demonstrate the race condition when stop() is called synchronously", async () => {
			// This test demonstrates the bug without relying on timing
			// It shows that if stop() is called after streamingPrompt.complete()
			// but before the runner finishes, an abort occurs

			const runner = new MockClaudeRunner(50);
			await runner.startStreaming();

			// Verify initial state
			expect(runner.isStreaming()).toBe(true);
			expect(runner.isRunning()).toBe(true);

			// Simulate what happens when a result message arrives:
			// 1. streamingPrompt.complete() is called
			(runner as any).streamingPrompt.completed = true;

			// 2. Now isStreaming() returns false (but isRunning() is still true!)
			expect(runner.isStreaming()).toBe(false);
			expect(runner.isRunning()).toBe(true);

			// 3. If EdgeWorker's resumeClaudeSession checks isStreaming(), it will call stop()
			// This is the BUG - we're stopping a runner that's still active!
			runner.stop();

			// 4. The runner is now aborted
			expect(runner.isRunning()).toBe(false);
			expect((runner as any).abortController).toBeNull(); // Abort controller was cleared
		});

		it("should show that isStreaming() returns false before runner completes", async () => {
			const runner = new MockClaudeRunner(0);
			await runner.startStreaming();

			// Before result message: isStreaming() is true
			expect(runner.isStreaming()).toBe(true);
			expect(runner.isRunning()).toBe(true);

			// Register handler to check state during message processing
			let isStreamingDuringMessage = false;
			let isRunningDuringMessage = false;
			runner.on("message", () => {
				// At this point, streamingPrompt.complete() has been called
				// So isStreaming() returns false even though isRunning() is still true
				isStreamingDuringMessage = runner.isStreaming();
				isRunningDuringMessage = runner.isRunning();
			});

			try {
				await runner.simulateResultMessage();
			} catch {
				// Ignore errors
			}

			// During message handling: isStreaming() was FALSE but isRunning() was TRUE
			// This is the state that causes the bug!
			expect(isStreamingDuringMessage).toBe(false); // Stream completed
			expect(isRunningDuringMessage).toBe(true); // But runner still active!
		});

		it("should demonstrate the proper fix using isRunning() check", async () => {
			const runner = new MockClaudeRunner(50);
			await runner.startStreaming();

			// The FIXED version of resumeClaudeSession
			async function fixedResumeClaudeSession(
				existingRunner: MockClaudeRunner | null,
				nextPrompt: string,
			): Promise<void> {
				if (existingRunner?.isStreaming()) {
					console.log("[EdgeWorker] Adding to existing stream");
					return;
				}

				// FIX: Check isRunning() instead of just relying on isStreaming()
				// Only stop if the runner is truly finished
				if (existingRunner && !existingRunner.isRunning()) {
					console.log("[EdgeWorker] Stopping finished runner");
					existingRunner.stop();
				} else if (existingRunner?.isRunning()) {
					console.log(
						"[EdgeWorker] Runner still active, waiting for completion",
					);
					// Wait for the runner to finish before starting new session
					await new Promise<void>((resolve) => {
						existingRunner.once("complete", () => resolve());
						existingRunner.once("error", () => resolve());
					});
				}

				console.log(
					"[EdgeWorker] Would start new session with prompt:",
					nextPrompt,
				);
			}

			// Setup message handler with FIXED logic
			runner.on("message", async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				await fixedResumeClaudeSession(runner, "Next subroutine prompt");
			});

			let completeCalled = false;
			runner.on("complete", () => {
				completeCalled = true;
			});

			// Execute: With the fix, this should complete successfully
			await runner.simulateResultMessage();

			// Verify: Complete event WAS emitted (no abort!)
			expect(completeCalled).toBe(true);
		});
	});

	describe("Real-world Scenario: Subroutine Transitions", () => {
		it("should document the exact scenario from the CYPACK-360 logs", async () => {
			// This test documents the race condition from CYPACK-360:
			// 1. Subroutine completes (result message received)
			// 2. streamingPrompt.complete() is called
			// 3. Message handler triggers async subroutine transition
			// 4. resumeClaudeSession checks isStreaming() → returns FALSE
			// 5. resumeClaudeSession calls stop() on the still-running runner
			// 6. Runner is aborted before it can emit "complete" event

			const runner = new MockClaudeRunner(0);
			await runner.startStreaming();

			// Document the state progression
			const states: string[] = [];

			// State 1: Initial streaming
			states.push(
				`isStreaming=${runner.isStreaming()}, isRunning=${runner.isRunning()}`,
			);
			expect(runner.isStreaming()).toBe(true);

			// State 2: After streamingPrompt.complete() (line 469 in ClaudeRunner.ts)
			(runner as any).streamingPrompt.completed = true;
			states.push(
				`After complete(): isStreaming=${runner.isStreaming()}, isRunning=${runner.isRunning()}`,
			);
			expect(runner.isStreaming()).toBe(false); // Stream complete
			expect(runner.isRunning()).toBe(true); // But still running!

			// State 3: EdgeWorker's resumeClaudeSession (line 4619) checks isStreaming()
			// It sees false and decides to stop the runner (line 4631)
			const shouldStopBasedOnIsStreaming = !runner.isStreaming();
			states.push(
				`Should stop? ${shouldStopBasedOnIsStreaming} (based on isStreaming)`,
			);
			expect(shouldStopBasedOnIsStreaming).toBe(true); // BUG: Should be false!

			// State 4: The FIX - check isRunning() instead
			const shouldStopBasedOnIsRunning = !runner.isRunning();
			states.push(
				`Should stop? ${shouldStopBasedOnIsRunning} (based on isRunning)`,
			);
			expect(shouldStopBasedOnIsRunning).toBe(false); // Correct!

			// This demonstrates why the fix works:
			// - isStreaming() returns false too early (after streamingPrompt.complete())
			// - isRunning() correctly reflects that the runner is still active
			// - We should check isRunning() to avoid stopping an active runner
		});
	});
});
