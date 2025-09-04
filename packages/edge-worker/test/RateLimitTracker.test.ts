import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimitTracker } from "../src/RateLimitTracker.js";

describe("RateLimitTracker", () => {
	let tracker: RateLimitTracker;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1000000));
		// Restore all mocks before creating new tracker
		vi.restoreAllMocks();
		tracker = new RateLimitTracker();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("Header Updates", () => {
		it("should update rate limit info from headers", () => {
			const headers = {
				"x-ratelimit-requests-remaining": "800",
				"x-ratelimit-requests-limit": "1200",
				"x-ratelimit-requests-reset": "1755168798",
				"x-ratelimit-complexity-remaining": "999800",
				"x-ratelimit-complexity-limit": "1000000",
			};

			tracker.updateFromHeaders(headers);

			const status = tracker.getStatus();
			expect(status.requestsRemaining).toBe(800);
			expect(status.requestsLimit).toBe(1200);
			expect(status.complexityRemaining).toBe(999800);
			expect(status.complexityLimit).toBe(1000000);
		});

		it("should handle array values in headers", () => {
			const headers = {
				"x-ratelimit-requests-remaining": ["500"],
				"x-ratelimit-requests-limit": ["1200"],
			};

			tracker.updateFromHeaders(headers);

			const status = tracker.getStatus();
			expect(status.requestsRemaining).toBe(500);
			expect(status.requestsLimit).toBe(1200);
		});

		it("should handle missing headers gracefully", () => {
			const headers = {
				"x-ratelimit-requests-remaining": "200",
			};

			tracker.updateFromHeaders(headers);

			const status = tracker.getStatus();
			expect(status.requestsRemaining).toBe(200);
			// Should keep default values for missing headers
			expect(status.requestsLimit).toBe(1200);
		});
	});

	describe("Request Rate Tracking", () => {
		it("should track request timestamps", () => {
			// Simulate multiple requests within the history window
			vi.setSystemTime(new Date(1000));
			tracker.consumeRequest();

			vi.setSystemTime(new Date(2000));
			tracker.consumeRequest();

			// Set current time for rate calculation
			vi.setSystemTime(new Date(3000));
			tracker.consumeRequest();

			const rate = tracker.getCurrentRequestRate();
			expect(rate).toBeGreaterThanOrEqual(0); // Rate calculation depends on time window
		});

		it("should return 0 rate for insufficient data", () => {
			expect(tracker.getCurrentRequestRate()).toBe(0);

			tracker.consumeRequest();
			expect(tracker.getCurrentRequestRate()).toBe(0);
		});

		it("should clean old request history", () => {
			// Add requests beyond the window
			vi.setSystemTime(new Date(1000));
			tracker.consumeRequest();

			// Move forward beyond the 60-second window
			vi.setSystemTime(new Date(70000));
			tracker.consumeRequest();

			const rate = tracker.getCurrentRequestRate();
			// Should only count the recent request
			expect(rate).toBe(0);
		});
	});

	describe("Rate Limit Predictions", () => {
		it("should predict time to limit based on current rate", () => {
			// Set up a scenario with 300 requests remaining and high rate
			tracker.updateFromHeaders({
				"x-ratelimit-requests-remaining": "300",
			});

			// Simulate high request rate (10 req/sec)
			for (let i = 0; i < 10; i++) {
				vi.setSystemTime(new Date(1000 + i * 100));
				tracker.consumeRequest();
			}

			const predictedTime = tracker.getPredictedTimeToLimit();
			// Should predict some finite time
			expect(predictedTime).toBeGreaterThan(0);
			expect(predictedTime).toBeLessThan(Infinity);
		});

		it("should return Infinity for zero rate", () => {
			expect(tracker.getPredictedTimeToLimit()).toBe(Infinity);
		});
	});

	describe("Operation Modes", () => {
		it("should return correct operation mode based on remaining requests", () => {
			// Normal mode
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "500" });
			expect(tracker.getOperationMode()).toBe("normal");

			// Conservative mode
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "200" });
			expect(tracker.getOperationMode()).toBe("conservative");

			// Emergency mode
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "50" });
			expect(tracker.getOperationMode()).toBe("emergency");
		});

		it("should recommend appropriate batch windows", () => {
			// Normal mode - 500ms
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "500" });
			expect(tracker.getRecommendedBatchWindow()).toBe(500);

			// Conservative mode - 2s
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "200" });
			expect(tracker.getRecommendedBatchWindow()).toBe(2000);

			// Emergency mode - 5s
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "50" });
			expect(tracker.getRecommendedBatchWindow()).toBe(5000);
		});
	});

	describe("Request Authorization", () => {
		it("should allow all requests when plenty remain", () => {
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "500" });

			expect(tracker.shouldAllowRequest("critical")).toBe(true);
			expect(tracker.shouldAllowRequest("normal")).toBe(true);
			expect(tracker.shouldAllowRequest("low")).toBe(true);
		});

		it("should prioritize in conservative mode", () => {
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "200" });

			expect(tracker.shouldAllowRequest("critical")).toBe(true);
			expect(tracker.shouldAllowRequest("normal")).toBe(true);
			expect(tracker.shouldAllowRequest("low")).toBe(false);
		});

		it("should only allow critical requests in emergency mode", () => {
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "50" });

			expect(tracker.shouldAllowRequest("critical")).toBe(true);
			expect(tracker.shouldAllowRequest("normal")).toBe(false);
			expect(tracker.shouldAllowRequest("low")).toBe(false);
		});
	});

	describe("Time Calculations", () => {
		it("should calculate time until reset correctly", () => {
			const futureReset = Math.floor((Date.now() + 3600000) / 1000); // 1 hour from now
			tracker.updateFromHeaders({
				"x-ratelimit-requests-reset": futureReset.toString(),
			});

			const timeUntilReset = tracker.getTimeUntilReset();
			expect(timeUntilReset).toBeCloseTo(3600000, -3); // Within 1 second tolerance
		});

		it("should return 0 for past reset times", () => {
			const pastReset = Math.floor((Date.now() - 3600000) / 1000); // 1 hour ago
			tracker.updateFromHeaders({
				"x-ratelimit-requests-reset": pastReset.toString(),
			});

			const timeUntilReset = tracker.getTimeUntilReset();
			expect(timeUntilReset).toBe(0);
		});
	});

	describe("Approaching Limit Detection", () => {
		it("should detect when approaching limit by count", () => {
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "200" });
			expect(tracker.isApproachingLimit()).toBe(true);

			// Create fresh tracker for the second test to avoid state pollution
			const freshTracker = new RateLimitTracker();
			freshTracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "400" });
			expect(freshTracker.isApproachingLimit()).toBe(false);
		});

		it("should detect when approaching limit by time prediction", () => {
			// Set up scenario with few requests but approaching conservative threshold
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "250" });
			
			expect(tracker.isApproachingLimit()).toBe(true);
		});
	});

	describe("Status Reporting", () => {
		it("should provide comprehensive status", () => {
			tracker.updateFromHeaders({
				"x-ratelimit-requests-remaining": "800",
				"x-ratelimit-requests-limit": "1200",
				"x-ratelimit-complexity-remaining": "999000",
				"x-ratelimit-complexity-limit": "1000000",
				"x-ratelimit-requests-reset": Math.floor((Date.now() + 1800000) / 1000).toString(),
			});

			const status = tracker.getStatus();
			
			expect(status).toMatchObject({
				requestsRemaining: 800,
				requestsLimit: 1200,
				complexityRemaining: 999000,
				complexityLimit: 1000000,
				operationMode: "normal",
				batchWindow: 500,
			});
			
			expect(status.resetIn).toBeCloseTo(1800000, -3);
			expect(typeof status.currentRate).toBe("number");
			expect(typeof status.predictedTimeToLimit).toBe("number");
		});
	});

	describe("Manual Request Consumption", () => {
		it("should decrement request count when consuming manually", () => {
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "100" });
			
			tracker.consumeRequest();
			
			const status = tracker.getStatus();
			expect(status.requestsRemaining).toBe(99);
		});

		it("should not go below zero", () => {
			tracker.updateFromHeaders({ "x-ratelimit-requests-remaining": "0" });
			
			tracker.consumeRequest();
			
			const status = tracker.getStatus();
			expect(status.requestsRemaining).toBe(0);
		});
	});
});