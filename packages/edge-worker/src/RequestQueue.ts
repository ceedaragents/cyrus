import { RateLimitTracker } from './RateLimitTracker.js';

export type RequestPriority = 'critical' | 'normal' | 'low';

export interface QueuedRequest {
	id: string;
	priority: RequestPriority;
	execute: () => Promise<any>;
	resolve: (value: any) => void;
	reject: (error: any) => void;
	timestamp: number;
	retryCount: number;
}

/**
 * Priority-based request queue with rate limit awareness
 */
export class RequestQueue {
	private queue: QueuedRequest[] = [];
	private processing = false;
	private rateLimitTracker: RateLimitTracker;
	private batchTimer: NodeJS.Timeout | null = null;
	private lastProcessTime = 0;
	
	// Configuration
	private readonly MAX_RETRIES = 3;
	private readonly BASE_RETRY_DELAY = 1000; // 1 second base delay for retries
	
	constructor(rateLimitTracker: RateLimitTracker) {
		this.rateLimitTracker = rateLimitTracker;
	}
	
	/**
	 * Add a request to the queue
	 */
	async enqueue<T>(
		execute: () => Promise<T>,
		priority: RequestPriority = 'normal'
	): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const request: QueuedRequest = {
				id: `${Date.now()}-${Math.random()}`,
				priority,
				execute,
				resolve,
				reject,
				timestamp: Date.now(),
				retryCount: 0
			};
			
			// Insert based on priority
			this.insertByPriority(request);
			
			// Start processing if not already running
			this.scheduleProcessing();
		});
	}
	
	/**
	 * Insert request in queue based on priority
	 */
	private insertByPriority(request: QueuedRequest): void {
		const priorityOrder = { critical: 0, normal: 1, low: 2 };
		const insertPriority = priorityOrder[request.priority];
		
		// Find insertion point
		let insertIndex = this.queue.length;
		for (let i = 0; i < this.queue.length; i++) {
			const queueItem = this.queue[i];
			if (queueItem && priorityOrder[queueItem.priority] > insertPriority) {
				insertIndex = i;
				break;
			}
		}
		
		this.queue.splice(insertIndex, 0, request);
		
		// Only log queuing when there are multiple items to reduce noise
		if (this.queue.length > 1) {
			console.log(`[RequestQueue] Queued ${request.priority} priority request. Queue size: ${this.queue.length}`);
		}
	}
	
	/**
	 * Schedule processing based on rate limit status
	 */
	private scheduleProcessing(): void {
		if (this.batchTimer) {
			return; // Already scheduled
		}
		
		const batchWindow = this.rateLimitTracker.getRecommendedBatchWindow();
		const timeSinceLastProcess = Date.now() - this.lastProcessTime;
		const delay = Math.max(0, batchWindow - timeSinceLastProcess);
		
		this.batchTimer = setTimeout(() => {
			this.batchTimer = null;
			this.processQueue();
		}, delay);
	}
	
	/**
	 * Process queued requests
	 */
	private async processQueue(): Promise<void> {
		if (this.processing || this.queue.length === 0) {
			return;
		}
		
		this.processing = true;
		this.lastProcessTime = Date.now();
		
		try {
			// Process requests based on current rate limit status
			const mode = this.rateLimitTracker.getOperationMode();
			let processedCount = 0;
			
			// Determine how many requests to process in this batch
			let maxBatchSize = 1;
			if (mode === 'normal') {
				maxBatchSize = 5; // Process up to 5 requests in normal mode
			} else if (mode === 'conservative') {
				maxBatchSize = 2; // Process up to 2 requests in conservative mode
			}
			// Emergency mode stays at 1
			
			while (this.queue.length > 0 && processedCount < maxBatchSize) {
				const request = this.queue[0];
				if (!request) break;
				
				// Check if this request should be allowed
				if (!this.rateLimitTracker.shouldAllowRequest(request.priority)) {
					// Skip low priority requests when rate limited
					if (request.priority === 'low') {
						console.log(`[RequestQueue] Deferring low priority request due to rate limits`);
						const removedRequest = this.queue.shift(); // Remove from queue
						if (removedRequest) {
							this.queue.push(removedRequest); // Add to end
						}
						// Break to avoid infinite loop when queue contains only low-priority items
						break;
					}
					
					// For higher priority, wait for rate limit reset
					const resetIn = this.rateLimitTracker.getTimeUntilReset();
					console.log(`[RequestQueue] Rate limited. Waiting ${resetIn}ms for reset`);
					break;
				}
				
				// Process the request
				this.queue.shift();
				await this.executeRequest(request);
				processedCount++;
			}
			
			// Schedule next batch if there are more requests
			if (this.queue.length > 0) {
				this.scheduleProcessing();
			}
		} finally {
			this.processing = false;
		}
	}
	
	/**
	 * Execute a single request with retry logic
	 */
	private async executeRequest(request: QueuedRequest): Promise<void> {
		try {
			console.log(`[RequestQueue] Executing ${request.priority} priority request`);
			const result = await request.execute();
			request.resolve(result);
		} catch (error: any) {
			// Check if it's a rate limit error
			if (error.message?.includes('rate limit') && request.retryCount < this.MAX_RETRIES) {
				console.log(`[RequestQueue] Rate limit hit, retrying request (attempt ${request.retryCount + 1}/${this.MAX_RETRIES})`);
				
				// Exponential backoff
				const retryDelay = this.BASE_RETRY_DELAY * Math.pow(2, request.retryCount);
				request.retryCount++;
				
				// Re-queue with delay
				setTimeout(() => {
					this.insertByPriority(request);
					this.scheduleProcessing();
				}, retryDelay);
			} else {
				// Non-retryable error or max retries reached
				console.error(`[RequestQueue] Request failed: ${error.message}`);
				request.reject(error);
			}
		}
	}
	
	/**
	 * Get queue status
	 */
	getStatus(): {
		queueLength: number;
		criticalCount: number;
		normalCount: number;
		lowCount: number;
		processing: boolean;
	} {
		let criticalCount = 0, normalCount = 0, lowCount = 0;
		for (const r of this.queue) {
			if (r.priority === 'critical') criticalCount++;
			else if (r.priority === 'normal') normalCount++;
			else lowCount++;
		}
		
		return {
			queueLength: this.queue.length,
			criticalCount,
			normalCount,
			lowCount,
			processing: this.processing
		};
	}
	
	/**
	 * Clear all pending requests
	 */
	clear(): void {
		while (this.queue.length > 0) {
			const request = this.queue.shift();
			if (request) {
				request.reject(new Error('Queue cleared'));
			}
		}
		
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
	}
}
