import { LinearClient, type Issue as LinearIssue } from "@linear/sdk";
import { RateLimitTracker } from './RateLimitTracker.js';
import { RequestQueue, type RequestPriority } from './RequestQueue.js';
import { IssueCache } from './IssueCache.js';

/**
 * Shared instances across all LinearClientWrapper instances
 * Since Linear rate limits are per account, not per repository
 */
let sharedRateLimitTracker: RateLimitTracker | null = null;
let sharedRequestQueue: RequestQueue | null = null;
let sharedIssueCache: IssueCache | null = null;

/**
 * Get or create shared instances
 */
function getSharedInstances() {
	if (!sharedRateLimitTracker) {
		sharedRateLimitTracker = new RateLimitTracker();
		sharedRequestQueue = new RequestQueue(sharedRateLimitTracker);
		sharedIssueCache = new IssueCache();
		console.log('[LinearClientWrapper] Initialized shared rate limiter and cache');
	}
	return {
		rateLimitTracker: sharedRateLimitTracker,
		requestQueue: sharedRequestQueue!,
		issueCache: sharedIssueCache!
	};
}

/**
 * Decorator/Wrapper for Linear SDK client with automatic rate limiting, caching, and request prioritization
 * Extends LinearClient for compatibility but uses the same instance to avoid duplication
 */
export class LinearClientWrapper extends LinearClient {
	private rateLimitTracker: RateLimitTracker;
	private requestQueue: RequestQueue;
	private issueCache: IssueCache;
	
	// Activity batching
	private activityBatch: Map<string, any[]> = new Map(); // sessionId -> activities
	private batchTimers: Map<string, NodeJS.Timeout> = new Map();
	
	constructor(config: { accessToken: string }) {
		// Call parent constructor - this creates the single client instance
		super(config);
		
		// Use shared instances for rate limiting and caching
		const shared = getSharedInstances();
		this.rateLimitTracker = shared.rateLimitTracker;
		this.requestQueue = shared.requestQueue;
		this.issueCache = shared.issueCache;
	}
	
	
	/**
	 * Automatically determine priority based on method/operation type
	 */
	private determinePriority(methodName: string, args?: any[]): RequestPriority {
		// Critical operations - user-facing, initial loads
		if (methodName === 'issue' && args?.[0]) {
			// First time fetching an issue is critical
			const issueId = args[0] as string;
			if (!this.issueCache.get(issueId)) {
				return 'critical';
			}
		}
		
		// Agent activities that are user-facing responses
		if (methodName === 'createAgentActivity') {
			const input = args?.[0];
			if (input?.content?.type === 'response' || input?.content?.type === 'error') {
				return 'normal';
			}
			// Thoughts and other activities are low priority
			return 'low';
		}
		
		// State updates are normal priority
		if (methodName === 'updateIssue' || methodName === 'createComment') {
			return 'normal';
		}
		
		// Default to normal for most operations
		return 'normal';
	}
	
	/**
	 * Execute a Linear API call with rate limit tracking
	 */
	private async executeWithTracking<T>(
		operation: () => Promise<T>,
		methodName: string,
		args?: any[]
	): Promise<T> {
		const priority = this.determinePriority(methodName, args);
		
		// Queue the request
		const result = await this.requestQueue.enqueue(async () => {
			try {
				// Execute the operation
				const response = await operation();
				
				// Track request consumption
				// In a real implementation, we'd parse response headers
				this.rateLimitTracker.consumeRequest();
				
				return response;
			} catch (error: any) {
				// Check for rate limit error
				if (error.message?.includes('rate limit') || error.message?.includes('429') || error.status === 429) {
					console.error(`[LinearClientWrapper] Rate limit exceeded`);
					
					// Update tracker to emergency mode using available headers
					const resetHeader =
						(error as any)?.response?.headers?.get?.('x-ratelimit-requests-reset')
						?? (error as any)?.headers?.['x-ratelimit-requests-reset'];
					const resetSeconds = resetHeader
						? String(resetHeader)
						: String(Math.floor((Date.now() + 3600000) / 1000));
					this.rateLimitTracker.updateFromHeaders({
						'x-ratelimit-requests-remaining': '0',
						'x-ratelimit-requests-reset': resetSeconds
					});
				}
				throw error;
			}
		}, priority);
		
		return result;
	}
	
	/**
	 * Override issue method to add caching
	 */
	async issue(issueId: string): Promise<LinearIssue> {
		// Check cache first
		const cached = this.issueCache.get(issueId);
		if (cached) {
			return cached;
		}
		
		// Check if we're rate limited
		const priority = this.determinePriority('issue', [issueId]);
		if (priority !== 'critical' && !this.rateLimitTracker.shouldAllowRequest(priority)) {
			const stale = this.issueCache.get(issueId, true);
			if (stale) {
				console.log(`[LinearClientWrapper] Returning stale cached data for issue ${issueId} due to rate limits`);
				return stale;
			}
		}
		
		// Fetch from API
		try {
			const issue = await this.executeWithTracking(
				() => super.issue(issueId),
				'issue',
				[issueId]
			);
			
			// Cache the result
			if (issue) {
				this.issueCache.set(issueId, issue);
			}
			
			return issue;
		} catch (error) {
			// On error, try to return stale cached data
			const stale = this.issueCache.get(issueId, true);
			if (stale) {
				console.log(`[LinearClientWrapper] API error, returning stale cached data for issue ${issueId}`);
				return stale;
			}
			throw error;
		}
	}
	
	/**
	 * Override updateIssue to invalidate cache
	 */
	async updateIssue(issueId: string, input: any): Promise<any> {
		// Invalidate cache when updating
		this.issueCache.invalidate(issueId);
		
		return this.executeWithTracking(
			() => super.updateIssue(issueId, input),
			'updateIssue',
			[issueId, input]
		);
	}
	
	/**
	 * Override createComment
	 */
	async createComment(input: any): Promise<any> {
		return this.executeWithTracking(
			() => super.createComment(input),
			'createComment',
			[input]
		);
	}
	
	/**
	 * Override createAgentActivity with intelligent batching
	 */
	async createAgentActivity(input: any): Promise<any> {
		const sessionId = input.agentSessionId;
		const batchWindow = this.rateLimitTracker.getRecommendedBatchWindow();
		const operationMode = this.rateLimitTracker.getOperationMode();
		
		// Determine if we should batch based on content type and operation mode
		const shouldBatch = this.shouldBatchActivity(input, operationMode);
		
		if (shouldBatch) {
			return this.batchAgentActivity(sessionId, input, batchWindow);
		}
		
		// Send immediately for important activities
		return this.executeWithTracking(
			() => super.createAgentActivity(input),
			'createAgentActivity',
			[input]
		);
	}
	
	/**
	 * Determine if an activity should be batched
	 */
	private shouldBatchActivity(input: any, operationMode: ReturnType<RateLimitTracker['getOperationMode']>): boolean {
		// Always batch in emergency mode
		if (operationMode === 'emergency') {
			return true;
		}
		
		// Batch thoughts in conservative mode
		if (operationMode === 'conservative' && input.content?.type === 'thought') {
			return true;
		}
		
		// Never batch responses or errors
		if (input.content?.type === 'response' || input.content?.type === 'error') {
			return false;
		}
		
		// Batch thoughts in normal mode with shorter window
		if (input.content?.type === 'thought') {
			return true;
		}
		
		return false;
	}
	
	/**
	 * Batch agent activities
	 */
	private async batchAgentActivity(sessionId: string, activity: any, batchWindow: number): Promise<any> {
		return new Promise((resolve, reject) => {
			// Add to batch
			if (!this.activityBatch.has(sessionId)) {
				this.activityBatch.set(sessionId, []);
			}
			this.activityBatch.get(sessionId)!.push({
				activity,
				resolve,
				reject
			});
			
			// Clear existing timer for this session
			const existingTimer = this.batchTimers.get(sessionId);
			if (existingTimer) {
				clearTimeout(existingTimer);
			}
			
			// Schedule batch processing for this session
			const timer = setTimeout(() => {
				this.processBatchedActivities(sessionId);
				this.batchTimers.delete(sessionId);
			}, batchWindow);
			
			this.batchTimers.set(sessionId, timer);
		});
	}
	
	/**
	 * Process batched activities for a specific session
	 */
	private async processBatchedActivities(sessionId: string): Promise<void> {
		const items = this.activityBatch.get(sessionId);
		if (!items || items.length === 0) {
			return;
		}
		
		// Clear the batch for this session
		this.activityBatch.delete(sessionId);
		
		// Combine multiple thoughts into one
		const thoughts: string[] = [];
		const otherActivities: any[] = [];
		const thoughtCallbacks: { resolve: Function; reject: Function }[] = [];
		const otherCallbacks: { resolve: Function; reject: Function }[] = [];
		
		for (const item of items) {
			if (item.activity.content?.type === 'thought') {
				thoughts.push(item.activity.content.body);
				thoughtCallbacks.push({ resolve: item.resolve, reject: item.reject });
			} else {
				otherActivities.push(item.activity);
				otherCallbacks.push({ resolve: item.resolve, reject: item.reject });
			}
		}
		
		try {
			// Send combined thought if any
			if (thoughts.length > 0) {
				const combinedBody = thoughts.length === 1 
					? thoughts[0] 
					: thoughts.map((t, i) => `${i + 1}. ${t}`).join('\n');
				
				const result = await this.executeWithTracking(
					() => super.createAgentActivity({
						agentSessionId: sessionId,
						content: {
							type: 'thought',
							body: combinedBody
						}
					}),
					'createAgentActivity',
					[{ agentSessionId: sessionId, content: { type: 'thought' }}]
				);
				
				// Resolve all thought callbacks
				thoughtCallbacks.forEach(cb => cb.resolve(result));
			}
			
			// Send other activities individually
			for (let i = 0; i < otherActivities.length; i++) {
				const result = await this.executeWithTracking(
					() => super.createAgentActivity(otherActivities[i]),
					'createAgentActivity',
					[otherActivities[i]]
				);
				const callback = otherCallbacks[i];
				if (callback) {
					callback.resolve(result);
				}
			}
		} catch (error) {
			// Reject all callbacks on error
			[...thoughtCallbacks, ...otherCallbacks].forEach(cb => cb.reject(error));
		}
	}
	
	/**
	 * Override methods that need tracking but don't need special handling
	 * These delegate to the wrapped client with rate limit tracking
	 */
	async comments(variables?: any): Promise<any> {
		return this.executeWithTracking(
			() => super.comments(variables),
			'comments',
			[variables]
		);
	}
	
	async workflowStates(variables?: any): Promise<any> {
		return this.executeWithTracking(
			() => super.workflowStates(variables),
			'workflowStates',
			[variables]
		);
	}
	
	async comment(variables: any): Promise<any> {
		return this.executeWithTracking(
			() => super.comment(variables),
			'comment',
			[variables]
		);
	}
	
	/**
	 * Get rate limit status
	 */
	getRateLimitStatus(): ReturnType<RateLimitTracker['getStatus']> {
		return this.rateLimitTracker.getStatus();
	}
	
	/**
	 * Get queue status
	 */
	getQueueStatus(): ReturnType<RequestQueue['getStatus']> {
		return this.requestQueue.getStatus();
	}
	
	/**
	 * Get cache statistics
	 */
	getCacheStats(): ReturnType<IssueCache['getStats']> {
		return this.issueCache.getStats();
	}
	
	/**
	 * Warm cache with issues
	 */
	warmCache(issues: LinearIssue[]): void {
		this.issueCache.warm(issues);
	}
	
	/**
	 * Cleanup resources (instance-specific)
	 */
	cleanup(): void {
		// Clear all batch timers for this instance
		for (const timer of this.batchTimers.values()) {
			clearTimeout(timer);
		}
		this.batchTimers.clear();
		this.activityBatch.clear();
	}
	
	/**
	 * Static method to reset shared instances (for testing)
	 */
	static resetSharedInstances(): void {
		sharedRateLimitTracker = null;
		sharedRequestQueue = null;
		sharedIssueCache = null;
	}
}