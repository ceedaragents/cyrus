/**
 * Simple rate limiter utility
 * Tracks API call counts and enforces rate limits based on time windows
 */

interface RateLimiterOptions {
	maxCalls: number; // Maximum calls allowed in the time window
	timeWindowMs: number; // Time window in milliseconds
}

interface RateLimiterResult {
	allowed: boolean; // Whether the call is allowed
	remainingCalls: number; // How many calls remain in current window
	resetTime: number; // Timestamp when the window resets
}

export class RateLimiter {
	private callTimestamps: number[] = [];
	private readonly maxCalls: number;
	private readonly timeWindowMs: number;

	constructor(options: RateLimiterOptions) {
		this.maxCalls = options.maxCalls;
		this.timeWindowMs = options.timeWindowMs;
	}

	/**
	 * Check if a call is allowed under the rate limit
	 * Automatically cleans up old timestamps outside the time window
	 */
	checkLimit(): RateLimiterResult {
		const now = Date.now();
		const windowStart = now - this.timeWindowMs;

		// Clean up timestamps outside the current window
		this.callTimestamps = this.callTimestamps.filter(
			(timestamp) => timestamp > windowStart,
		);

		// Check if we're under the limit
		const allowed = this.callTimestamps.length < this.maxCalls;

		if (allowed) {
			// Record this call
			this.callTimestamps.push(now);
		}

		// Calculate remaining calls and reset time
		const remainingCalls = Math.max(0, this.maxCalls - this.callTimestamps.length);
		const oldestTimestamp = this.callTimestamps[0] || now;
		const resetTime = oldestTimestamp + this.timeWindowMs;

		return {
			allowed,
			remainingCalls,
			resetTime,
		};
	}

	/**
	 * Reset the rate limiter (clear all recorded calls)
	 */
	reset(): void {
		this.callTimestamps = [];
	}

	/**
	 * Get current status without making a call
	 */
	getStatus(): {
		callsInWindow: number;
		remainingCalls: number;
	} {
		const now = Date.now();
		const windowStart = now - this.timeWindowMs;

		// Clean up old timestamps
		this.callTimestamps = this.callTimestamps.filter(
			(timestamp) => timestamp > windowStart,
		);

		return {
			callsInWindow: this.callTimestamps.length,
			remainingCalls: Math.max(0, this.maxCalls - this.callTimestamps.length),
		};
	}
}

/**
 * Convenience function for simple rate limiting
 */
export function createRateLimiter(
	maxCalls: number,
	timeWindowMs: number,
): RateLimiter {
	return new RateLimiter({ maxCalls, timeWindowMs });
}
