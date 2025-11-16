import { describe, it, expect, beforeEach, vi } from "vitest";
import { RateLimiter, createRateLimiter } from "./rateLimiter";

describe("RateLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it("should allow calls under the limit", () => {
		const limiter = new RateLimiter({ maxCalls: 3, timeWindowMs: 1000 });

		const result1 = limiter.checkLimit();
		expect(result1.allowed).toBe(true);
		expect(result1.remainingCalls).toBe(2);

		const result2 = limiter.checkLimit();
		expect(result2.allowed).toBe(true);
		expect(result2.remainingCalls).toBe(1);

		const result3 = limiter.checkLimit();
		expect(result3.allowed).toBe(true);
		expect(result3.remainingCalls).toBe(0);
	});

	it("should block calls over the limit", () => {
		const limiter = new RateLimiter({ maxCalls: 2, timeWindowMs: 1000 });

		limiter.checkLimit(); // Call 1
		limiter.checkLimit(); // Call 2

		const result = limiter.checkLimit(); // Call 3 - should be blocked
		expect(result.allowed).toBe(false);
		expect(result.remainingCalls).toBe(0);
	});

	it("should allow calls after time window expires", () => {
		const limiter = new RateLimiter({ maxCalls: 2, timeWindowMs: 1000 });

		limiter.checkLimit(); // Call 1
		limiter.checkLimit(); // Call 2

		// Third call blocked
		expect(limiter.checkLimit().allowed).toBe(false);

		// Advance time past the window
		vi.advanceTimersByTime(1001);

		// Now should be allowed again
		const result = limiter.checkLimit();
		expect(result.allowed).toBe(true);
		expect(result.remainingCalls).toBe(1);
	});

	it("should clean up old timestamps automatically", () => {
		const limiter = new RateLimiter({ maxCalls: 3, timeWindowMs: 1000 });

		limiter.checkLimit(); // Call 1 at t=0
		vi.advanceTimersByTime(500);
		limiter.checkLimit(); // Call 2 at t=500

		// Move past first call's window
		vi.advanceTimersByTime(600); // Now at t=1100

		const status = limiter.getStatus();
		expect(status.callsInWindow).toBe(1); // Only call 2 should remain
		expect(status.remainingCalls).toBe(2);
	});

	it("should provide accurate reset time", () => {
		const now = Date.now();
		vi.setSystemTime(now);

		const limiter = new RateLimiter({ maxCalls: 2, timeWindowMs: 1000 });

		const result = limiter.checkLimit();
		expect(result.resetTime).toBe(now + 1000);
	});

	it("should reset all calls", () => {
		const limiter = new RateLimiter({ maxCalls: 2, timeWindowMs: 1000 });

		limiter.checkLimit();
		limiter.checkLimit();

		// Should be blocked
		expect(limiter.checkLimit().allowed).toBe(false);

		// Reset
		limiter.reset();

		// Should work again
		const result = limiter.checkLimit();
		expect(result.allowed).toBe(true);
		expect(result.remainingCalls).toBe(1);
	});

	it("should handle getStatus without affecting call count", () => {
		const limiter = new RateLimiter({ maxCalls: 3, timeWindowMs: 1000 });

		limiter.checkLimit(); // One call

		const status1 = limiter.getStatus();
		expect(status1.callsInWindow).toBe(1);
		expect(status1.remainingCalls).toBe(2);

		// getStatus shouldn't add a call
		const status2 = limiter.getStatus();
		expect(status2.callsInWindow).toBe(1);
		expect(status2.remainingCalls).toBe(2);
	});

	it("should work with createRateLimiter convenience function", () => {
		const limiter = createRateLimiter(5, 2000);

		for (let i = 0; i < 5; i++) {
			expect(limiter.checkLimit().allowed).toBe(true);
		}

		// 6th call should fail
		expect(limiter.checkLimit().allowed).toBe(false);
	});
});
