import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RequestQueue } from "../src/RequestQueue.js";
import { RateLimitTracker } from "../src/RateLimitTracker.js";

describe("RequestQueue", () => {
	let requestQueue: RequestQueue;
	let rateLimitTracker: RateLimitTracker;

	beforeEach(() => {
		vi.restoreAllMocks();
		vi.useFakeTimers();
		rateLimitTracker = new RateLimitTracker();
		requestQueue = new RequestQueue(rateLimitTracker);
	});

	afterEach(() => {
		// Ensure no pending requests/timers leak across tests
		requestQueue.clear();
		vi.runOnlyPendingTimers();
		// Restore real timers and mocks
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("Basic Functionality", () => {
		it("should enqueue and process a single request", async () => {
			let executed = false;
			const execute = async () => {
				executed = true;
				return "result";
			};

			const promise = requestQueue.enqueue(execute, "normal");
			
			// Advance timers to trigger processing
			vi.runAllTimers();
			
			const result = await promise;

			expect(executed).toBe(true);
			expect(result).toBe("result");
		});

		it("should handle priority ordering", async () => {
			const executionOrder: string[] = [];
			
			const lowPriorityExec = async () => {
				executionOrder.push("low");
				return "low";
			};
			
			const criticalExec = async () => {
				executionOrder.push("critical");
				return "critical";
			};
			
			const normalExec = async () => {
				executionOrder.push("normal");
				return "normal";
			};

			// Enqueue in mixed order
			const promises = [
				requestQueue.enqueue(lowPriorityExec, "low"),
				requestQueue.enqueue(criticalExec, "critical"),
				requestQueue.enqueue(normalExec, "normal")
			];

			// Advance timers to trigger processing
			vi.runAllTimers();

			await Promise.all(promises);

			// Should process in priority order: critical > normal > low
			expect(executionOrder).toEqual(["critical", "normal", "low"]);
		});
	});

	describe("Rate Limiting Integration", () => {
		it("should defer low-priority requests when rate limited", async () => {
			// Set up rate limiting to deny low-priority requests (conservative mode)
			rateLimitTracker.updateFromHeaders({
				"x-ratelimit-requests-remaining": "250", // Between conservative (300) and emergency (100)
				"x-ratelimit-requests-reset": String(Math.floor((Date.now() + 60000) / 1000))
			});

			// Verify low priority requests should be denied
			expect(rateLimitTracker.shouldAllowRequest('low')).toBe(false);
			expect(rateLimitTracker.shouldAllowRequest('critical')).toBe(true);

			let lowPriorityExecuted = false;
			let criticalExecuted = false;

			const lowExecute = async () => {
				lowPriorityExecuted = true;
				return "low";
			};

			const criticalExecute = async () => {
				criticalExecuted = true;
				return "critical";
			};

			// Enqueue both types
			const lowPromise = requestQueue.enqueue(lowExecute, "low");
			const criticalPromise = requestQueue.enqueue(criticalExecute, "critical");

			// Run a single batch window to process the critical task
			await vi.advanceTimersByTimeAsync(rateLimitTracker.getRecommendedBatchWindow());

			// Critical should execute quickly
			await criticalPromise;
			expect(criticalExecuted).toBe(true);

			// Low will be deferred; clear to avoid dangling timers/promises
			requestQueue.clear();
			await expect(lowPromise).rejects.toThrow("Queue cleared");
		});
	});

	describe("Error Handling", () => {
		it("should handle rate limit errors with retry", async () => {
			// Switch to real timers for this complex retry test
			vi.useRealTimers();
			
			let attemptCount = 0;
			const execute = async () => {
				attemptCount++;
				if (attemptCount < 3) {
					throw new Error("rate limit exceeded"); // Rate limit error triggers retry
				}
				return "success";
			};

			const result = await requestQueue.enqueue(execute, "normal");
			
			expect(result).toBe("success");
			expect(attemptCount).toBe(3); // Should retry on rate limit errors
			
			// Restore fake timers for next tests
			vi.useFakeTimers();
		});

		it("should not retry non-rate-limit errors", async () => {
			let attemptCount = 0;
			const execute = async () => {
				attemptCount++;
				throw new Error("Regular error"); // Non-rate limit error
			};

			const promise = requestQueue.enqueue(execute, "normal");
			
			// Advance timers to trigger processing
			vi.runAllTimers();
			
			await expect(promise).rejects.toThrow("Regular error");
			
			// Should not retry non-rate-limit errors
			expect(attemptCount).toBe(1);
		});
	});

	describe("Statistics", () => {
		it("should provide queue statistics", () => {
			const stats = requestQueue.getStatus();
			
			// Should have the expected structure
			expect(stats).toHaveProperty('queueLength');
			expect(stats).toHaveProperty('criticalCount');
			expect(stats).toHaveProperty('normalCount');
			expect(stats).toHaveProperty('lowCount');
			expect(stats).toHaveProperty('processing');
			// And expected default values for an idle queue
			expect(stats.queueLength).toBe(0);
			expect(stats.criticalCount).toBe(0);
			expect(stats.normalCount).toBe(0);
			expect(stats.lowCount).toBe(0);
			expect(stats.processing).toBe(false);
		});
	});

	describe("Infinite Loop Prevention (Critical Fix)", () => {
		it("should break out of processing loop when deferring low-priority requests", async () => {
			// This is a unit test of the specific logic fix, not an integration test
			// We're testing that the `break` statement is reached instead of `continue`
			
			// Set up rate limiting to conservative mode
			rateLimitTracker.updateFromHeaders({
				"x-ratelimit-requests-remaining": "250", // Conservative mode
				"x-ratelimit-requests-reset": String(Math.floor((Date.now() + 60000) / 1000))
			});

			// Verify low priority should be denied
			expect(rateLimitTracker.shouldAllowRequest('low')).toBe(false);

			let executed = false;
			const lowPromise = requestQueue.enqueue(async () => {
				executed = true;
				return "low";
			}, "low");

			// Advance exactly one batch window
			await vi.advanceTimersByTimeAsync(rateLimitTracker.getRecommendedBatchWindow());

			// Should have yielded after deferring the low-priority item
			const { queueLength, processing } = requestQueue.getStatus();
			expect(processing).toBe(false);
			expect(queueLength).toBe(1);
			expect(executed).toBe(false);

			// Clean up the deferred work to avoid dangling timers/promises
			requestQueue.clear();
			await expect(lowPromise).rejects.toThrow("Queue cleared");
		});
	});
});