/**
 * Configuration options for RateLimitTracker
 */
export interface RateLimitTrackerOptions {
	emergencyThreshold?: number;
	conservativeThreshold?: number;
	criticalOperationReserve?: number;
	historyWindowMs?: number;
}

/**
 * Rate Limit Tracker for Linear API
 * Tracks rate limit headers and provides intelligent request management
 */
export class RateLimitTracker {
	private requestsRemaining: number = 1200; // Default Linear limit
	private requestsLimit: number = 1200;
	private resetTimestamp: number = Date.now() + 3600000; // 1 hour from now as default
	private complexityRemaining: number = 50000; // Default complexity limit
	private complexityLimit: number = 50000;
	
	// Track request patterns for predictive limiting
	private requestHistory: number[] = []; // Timestamps of recent requests
	private readonly HISTORY_WINDOW_MS: number;
	
	// Thresholds for different operation modes
	private readonly EMERGENCY_THRESHOLD: number;
	private readonly CONSERVATIVE_THRESHOLD: number;
	private readonly CRITICAL_OPERATION_RESERVE: number;

	constructor(options: RateLimitTrackerOptions = {}) {
		this.EMERGENCY_THRESHOLD = options.emergencyThreshold ?? 100;
		this.CONSERVATIVE_THRESHOLD = options.conservativeThreshold ?? 300;
		this.CRITICAL_OPERATION_RESERVE = options.criticalOperationReserve ?? 50;
		this.HISTORY_WINDOW_MS = options.historyWindowMs ?? 60000;
	}
	
	/**
	 * Update rate limit info from Linear response headers
	 */
	updateFromHeaders(headers: Record<string, string | string[]>): void {
		// Handle both single string and array values for headers
		const getHeaderValue = (key: string): string | undefined => {
			const value = headers[key];
			if (Array.isArray(value)) {
				return value[0];
			}
			return value;
		};
		
		// Update request limits
		const requestsRemaining = getHeaderValue('x-ratelimit-requests-remaining');
		const requestsLimit = getHeaderValue('x-ratelimit-requests-limit');
		const requestsReset = getHeaderValue('x-ratelimit-requests-reset');
		
		if (requestsRemaining !== undefined) {
			this.requestsRemaining = parseInt(requestsRemaining, 10);
		}
		if (requestsLimit !== undefined) {
			this.requestsLimit = parseInt(requestsLimit, 10);
		}
		if (requestsReset !== undefined) {
			this.resetTimestamp = parseInt(requestsReset, 10) * 1000; // Convert to milliseconds
		}
		
		// Update complexity limits
		const complexityRemaining = getHeaderValue('x-ratelimit-complexity-remaining');
		const complexityLimit = getHeaderValue('x-ratelimit-complexity-limit');
		
		if (complexityRemaining !== undefined) {
			this.complexityRemaining = parseInt(complexityRemaining, 10);
		}
		if (complexityLimit !== undefined) {
			this.complexityLimit = parseInt(complexityLimit, 10);
		}
		
		// Track request timestamp
		this.trackRequest();
		
		// Log current state
		console.debug(`[RateLimitTracker] Updated limits - Requests: ${this.requestsRemaining}/${this.requestsLimit}, Reset in: ${this.getTimeUntilReset()}ms`);
	}
	
	/**
	 * Track a request timestamp for pattern analysis
	 */
	private trackRequest(): void {
		const now = Date.now();
		this.requestHistory.push(now);
		
		// Clean old entries outside the window
		const cutoff = now - this.HISTORY_WINDOW_MS;
		this.requestHistory = this.requestHistory.filter(ts => ts > cutoff);
	}
	
	/**
	 * Get current request rate (requests per second in the last minute)
	 */
	getCurrentRequestRate(): number {
		if (this.requestHistory.length < 2) return 0;
		
		const now = Date.now();
		const cutoff = now - this.HISTORY_WINDOW_MS;
		const recentRequests = this.requestHistory.filter(ts => ts > cutoff);
		
		if (recentRequests.length === 0) return 0;
		
		const firstRequest = recentRequests[0];
		if (!firstRequest) return 0;
		
		const timeSpan = (now - firstRequest) / 1000; // Convert to seconds
		return recentRequests.length / Math.max(timeSpan, 1);
	}
	
	/**
	 * Predict remaining time at current rate before hitting limit
	 */
	getPredictedTimeToLimit(): number {
		const rate = this.getCurrentRequestRate();
		if (rate === 0) return Infinity;
		
		const effectiveRemaining = Math.max(0, this.requestsRemaining - this.CRITICAL_OPERATION_RESERVE);
		return (effectiveRemaining / rate) * 1000; // Convert to milliseconds
	}
	
	/**
	 * Get time until rate limit reset
	 */
	getTimeUntilReset(): number {
		return Math.max(0, this.resetTimestamp - Date.now());
	}
	
	/**
	 * Check if we should allow a request based on priority
	 */
	shouldAllowRequest(priority: 'critical' | 'normal' | 'low'): boolean {
		// Always allow if we have plenty of requests
		if (this.requestsRemaining > this.CONSERVATIVE_THRESHOLD) {
			return true;
		}
		
		// In emergency mode, only allow critical operations
		if (this.requestsRemaining <= this.EMERGENCY_THRESHOLD) {
			return priority === 'critical';
		}
		
		// In conservative mode, allow critical and normal
		if (this.requestsRemaining <= this.CONSERVATIVE_THRESHOLD) {
			return priority !== 'low';
		}
		
		return true;
	}
	
	/**
	 * Get recommended batch window based on current limits
	 */
	getRecommendedBatchWindow(): number {
		if (this.requestsRemaining > this.CONSERVATIVE_THRESHOLD) {
			return 500; // Normal mode: 500ms batching
		}
		
		if (this.requestsRemaining > this.EMERGENCY_THRESHOLD) {
			return 2000; // Conservative mode: 2s batching
		}
		
		return 5000; // Emergency mode: 5s aggressive batching
	}
	
	/**
	 * Get current operation mode
	 */
	getOperationMode(): 'normal' | 'conservative' | 'emergency' {
		if (this.requestsRemaining > this.CONSERVATIVE_THRESHOLD) {
			return 'normal';
		}
		if (this.requestsRemaining > this.EMERGENCY_THRESHOLD) {
			return 'conservative';
		}
		return 'emergency';
	}
	
	/**
	 * Check if we're approaching rate limit
	 */
	isApproachingLimit(): boolean {
		return this.requestsRemaining < this.CONSERVATIVE_THRESHOLD ||
			this.getPredictedTimeToLimit() < 300000; // Less than 5 minutes at current rate
	}
	
	/**
	 * Get current status for monitoring
	 */
	getStatus(): {
		requestsRemaining: number;
		requestsLimit: number;
		complexityRemaining: number;
		complexityLimit: number;
		resetIn: number;
		currentRate: number;
		predictedTimeToLimit: number;
		operationMode: 'normal' | 'conservative' | 'emergency';
		batchWindow: number;
	} {
		return {
			requestsRemaining: this.requestsRemaining,
			requestsLimit: this.requestsLimit,
			complexityRemaining: this.complexityRemaining,
			complexityLimit: this.complexityLimit,
			resetIn: this.getTimeUntilReset(),
			currentRate: this.getCurrentRequestRate(),
			predictedTimeToLimit: this.getPredictedTimeToLimit(),
			operationMode: this.getOperationMode(),
			batchWindow: this.getRecommendedBatchWindow()
		};
	}
	
	/**
	 * Manually decrement request count (for operations without immediate response)
	 */
	consumeRequest(): void {
		this.requestsRemaining = Math.max(0, this.requestsRemaining - 1);
		this.trackRequest();
	}
}
