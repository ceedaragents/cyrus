import { beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter.js";

describe("RateLimiter", () => {
	let rateLimiter: RateLimiter;

	beforeEach(() => {
		rateLimiter = new RateLimiter({
			windowMs: 1000, // 1 second window
			maxRequests: 3, // Max 3 requests per second
		});
	});

	describe("isAllowed", () => {
		it("should allow requests within the limit", () => {
			expect(rateLimiter.isAllowed("client1")).toBe(true);
			expect(rateLimiter.isAllowed("client1")).toBe(true);
			expect(rateLimiter.isAllowed("client1")).toBe(true);
		});

		it("should block requests that exceed the limit", () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");

			// Fourth request should be blocked
			expect(rateLimiter.isAllowed("client1")).toBe(false);
		});

		it("should track requests separately for different clients", () => {
			expect(rateLimiter.isAllowed("client1")).toBe(true);
			expect(rateLimiter.isAllowed("client1")).toBe(true);
			expect(rateLimiter.isAllowed("client1")).toBe(true);

			// client2 should have their own limit
			expect(rateLimiter.isAllowed("client2")).toBe(true);
			expect(rateLimiter.isAllowed("client2")).toBe(true);
			expect(rateLimiter.isAllowed("client2")).toBe(true);

			// Both should be blocked now
			expect(rateLimiter.isAllowed("client1")).toBe(false);
			expect(rateLimiter.isAllowed("client2")).toBe(false);
		});

		it("should allow requests after the window expires", async () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");

			// Fourth request should be blocked
			expect(rateLimiter.isAllowed("client1")).toBe(false);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 1100));

			// Should be allowed again
			expect(rateLimiter.isAllowed("client1")).toBe(true);
		});

		it("should implement sliding window correctly", async () => {
			const limiter = new RateLimiter({
				windowMs: 500,
				maxRequests: 2,
			});

			// First request at t=0
			expect(limiter.isAllowed("client1")).toBe(true);

			// Wait 250ms
			await new Promise((resolve) => setTimeout(resolve, 250));

			// Second request at t=250ms
			expect(limiter.isAllowed("client1")).toBe(true);

			// Third request should be blocked (still within window)
			expect(limiter.isAllowed("client1")).toBe(false);

			// Wait another 300ms (total 550ms from start)
			await new Promise((resolve) => setTimeout(resolve, 300));

			// First request is now outside the 500ms window
			// So we should be able to make one more request
			expect(limiter.isAllowed("client1")).toBe(true);
		});
	});

	describe("getRequestCount", () => {
		it("should return 0 for a client with no requests", () => {
			expect(rateLimiter.getRequestCount("client1")).toBe(0);
		});

		it("should return the correct count of requests", () => {
			rateLimiter.isAllowed("client1");
			expect(rateLimiter.getRequestCount("client1")).toBe(1);

			rateLimiter.isAllowed("client1");
			expect(rateLimiter.getRequestCount("client1")).toBe(2);

			rateLimiter.isAllowed("client1");
			expect(rateLimiter.getRequestCount("client1")).toBe(3);
		});

		it("should not count requests outside the window", async () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 1100));

			// Old requests should not be counted
			expect(rateLimiter.getRequestCount("client1")).toBe(0);
		});

		it("should track counts separately for different clients", () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");

			rateLimiter.isAllowed("client2");

			expect(rateLimiter.getRequestCount("client1")).toBe(2);
			expect(rateLimiter.getRequestCount("client2")).toBe(1);
		});
	});

	describe("reset", () => {
		it("should clear all request records", () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client2");

			rateLimiter.reset();

			expect(rateLimiter.getRequestCount("client1")).toBe(0);
			expect(rateLimiter.getRequestCount("client2")).toBe(0);

			// Should be able to make requests again
			expect(rateLimiter.isAllowed("client1")).toBe(true);
		});
	});

	describe("resetClient", () => {
		it("should clear request records for a specific client", () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client2");

			rateLimiter.resetClient("client1");

			expect(rateLimiter.getRequestCount("client1")).toBe(0);
			expect(rateLimiter.getRequestCount("client2")).toBe(1);
		});

		it("should allow requests again after reset", () => {
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");
			rateLimiter.isAllowed("client1");

			// Fourth request should be blocked
			expect(rateLimiter.isAllowed("client1")).toBe(false);

			rateLimiter.resetClient("client1");

			// Should be allowed again
			expect(rateLimiter.isAllowed("client1")).toBe(true);
		});
	});

	describe("custom configuration", () => {
		it("should respect custom window size", async () => {
			const limiter = new RateLimiter({
				windowMs: 200,
				maxRequests: 2,
			});

			limiter.isAllowed("client1");
			limiter.isAllowed("client1");

			// Third request should be blocked
			expect(limiter.isAllowed("client1")).toBe(false);

			// Wait for window to expire
			await new Promise((resolve) => setTimeout(resolve, 250));

			// Should be allowed again
			expect(limiter.isAllowed("client1")).toBe(true);
		});

		it("should respect custom max requests", () => {
			const limiter = new RateLimiter({
				windowMs: 1000,
				maxRequests: 5,
			});

			// Should allow 5 requests
			expect(limiter.isAllowed("client1")).toBe(true);
			expect(limiter.isAllowed("client1")).toBe(true);
			expect(limiter.isAllowed("client1")).toBe(true);
			expect(limiter.isAllowed("client1")).toBe(true);
			expect(limiter.isAllowed("client1")).toBe(true);

			// Sixth request should be blocked
			expect(limiter.isAllowed("client1")).toBe(false);
		});

		it("should handle very small windows", async () => {
			const limiter = new RateLimiter({
				windowMs: 50,
				maxRequests: 1,
			});

			expect(limiter.isAllowed("client1")).toBe(true);
			expect(limiter.isAllowed("client1")).toBe(false);

			await new Promise((resolve) => setTimeout(resolve, 60));

			expect(limiter.isAllowed("client1")).toBe(true);
		});
	});

	describe("edge cases", () => {
		it("should handle empty client IDs", () => {
			expect(rateLimiter.isAllowed("")).toBe(true);
			expect(rateLimiter.isAllowed("")).toBe(true);
			expect(rateLimiter.isAllowed("")).toBe(true);
			expect(rateLimiter.isAllowed("")).toBe(false);
		});

		it("should handle special characters in client IDs", () => {
			const specialId = "client@123#$%";
			expect(rateLimiter.isAllowed(specialId)).toBe(true);
			expect(rateLimiter.isAllowed(specialId)).toBe(true);
		});

		it("should handle concurrent requests from the same client", () => {
			// Simulate concurrent requests
			const results = [
				rateLimiter.isAllowed("client1"),
				rateLimiter.isAllowed("client1"),
				rateLimiter.isAllowed("client1"),
				rateLimiter.isAllowed("client1"),
			];

			// First 3 should be true, 4th should be false
			expect(results).toEqual([true, true, true, false]);
		});

		it("should handle maxRequests of 1", () => {
			const limiter = new RateLimiter({
				windowMs: 1000,
				maxRequests: 1,
			});

			expect(limiter.isAllowed("client1")).toBe(true);
			expect(limiter.isAllowed("client1")).toBe(false);
		});

		it("should handle large maxRequests", () => {
			const limiter = new RateLimiter({
				windowMs: 1000,
				maxRequests: 1000,
			});

			for (let i = 0; i < 1000; i++) {
				expect(limiter.isAllowed("client1")).toBe(true);
			}

			expect(limiter.isAllowed("client1")).toBe(false);
		});
	});
});
