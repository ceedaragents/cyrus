import type { Issue as LinearIssue } from "@linear/sdk";
import { LRUCache } from "lru-cache";

export interface CachedIssue {
	issue: LinearIssue;
	timestamp: number;
	ttl: number;
	accessCount: number;
	lastAccessed: number;
}

/**
 * Smart cache for Linear issues with TTL and fallback support
 * Uses lru-cache for efficient memory management and automatic eviction
 */
export class IssueCache {
	private cache: LRUCache<string, CachedIssue>;
	private readonly DEFAULT_TTL = 600000; // 10 minutes default TTL
	private readonly EXTENDED_TTL = 1800000; // 30 minutes for frequently accessed issues
	private readonly STALE_TTL = 3600000; // 1 hour - maximum time to keep stale data
	private readonly MAX_CACHE_SIZE = 100; // Maximum number of issues to cache
	
	constructor() {
		this.cache = new LRUCache<string, CachedIssue>({
			max: this.MAX_CACHE_SIZE,
			// Don't use built-in TTL since we need custom stale data handling
			ttl: 0,
			// Update access time on get
			updateAgeOnGet: false,
			// Allow stale data to be returned while revalidating
			allowStale: true,
			// Dispose callback for logging
			dispose: (_value, key) => {
				console.log(`[IssueCache] Evicted issue ${key} from cache`);
			}
		});
	}
	
	/**
	 * Get an issue from cache
	 * @param issueId The issue ID
	 * @param allowStale Whether to return stale data if fresh data is not available
	 */
	get(issueId: string, allowStale = false): LinearIssue | null {
		const cached = this.cache.get(issueId);
		if (!cached) {
			return null;
		}
		
		const now = Date.now();
		const age = now - cached.timestamp;
		
		// Update access tracking
		cached.accessCount++;
		cached.lastAccessed = now;
		// Update the cache entry with new access info
		this.cache.set(issueId, cached);
		
		// Check if data is fresh
		if (age <= cached.ttl) {
			console.log(`[IssueCache] Cache hit for issue ${issueId} (age: ${age}ms)`);
			return cached.issue;
		}
		
		// Check if we can return stale data
		if (allowStale && age <= this.STALE_TTL) {
			console.log(`[IssueCache] Returning stale data for issue ${issueId} (age: ${age}ms)`);
			return cached.issue;
		}
		
		// Data is too old
		if (age > this.STALE_TTL) {
			// Only delete if it's beyond stale TTL
			this.cache.delete(issueId);
			console.log(`[IssueCache] Cache miss for issue ${issueId} (expired beyond stale TTL)`);
		} else {
			// Data is stale but not requested with allowStale
			console.log(`[IssueCache] Cache miss for issue ${issueId} (expired)`);
		}
		return null;
	}
	
	/**
	 * Store an issue in cache
	 */
	set(issueId: string, issue: LinearIssue): void {
		const existing = this.cache.get(issueId);
		const now = Date.now();
		
		// Determine TTL based on access patterns
		let ttl = this.DEFAULT_TTL;
		if (existing && existing.accessCount > 5) {
			// Frequently accessed issues get longer TTL
			ttl = this.EXTENDED_TTL;
		}
		
		// Store the issue
		this.cache.set(issueId, {
			issue,
			timestamp: now,
			ttl,
			accessCount: existing?.accessCount || 0,
			lastAccessed: now
		});
		
		console.log(`[IssueCache] Cached issue ${issueId} with TTL ${ttl}ms`);
	}
	
	/**
	 * Invalidate cache entry
	 */
	invalidate(issueId: string): void {
		if (this.cache.delete(issueId)) {
			console.log(`[IssueCache] Invalidated cache for issue ${issueId}`);
		}
	}
	
	/**
	 * Invalidate all cache entries
	 */
	invalidateAll(): void {
		const size = this.cache.size;
		this.cache.clear();
		console.log(`[IssueCache] Cleared ${size} cached issues`);
	}
	
	/**
	 * Warm the cache with frequently accessed issues
	 * @param issues Array of issues to pre-cache
	 */
	warm(issues: LinearIssue[]): void {
		let added = 0;
		for (const issue of issues) {
			if (issue.id) {
				this.set(issue.id, issue);
				added++;
			}
		}
		console.log(`[IssueCache] Warmed cache with ${added}/${issues.length} issues`);
	}
	
	/**
	 * Get cache statistics
	 */
	getStats(): {
		size: number;
		freshCount: number;
		staleCount: number;
		totalAccessCount: number;
		mostAccessed: { issueId: string; count: number } | null;
	} {
		const now = Date.now();
		let freshCount = 0;
		let staleCount = 0;
		let totalAccessCount = 0;
		let mostAccessed: { issueId: string; count: number } | null = null;
		
		// Iterate through cache entries
		for (const [issueId, cached] of this.cache.entries()) {
			const age = now - cached.timestamp;
			if (age <= cached.ttl) {
				freshCount++;
			} else if (age <= this.STALE_TTL) {
				staleCount++;
			}
			
			totalAccessCount += cached.accessCount;
			
			if (!mostAccessed || cached.accessCount > mostAccessed.count) {
				mostAccessed = { issueId, count: cached.accessCount };
			}
		}
		
		return {
			size: this.cache.size,
			freshCount,
			staleCount,
			totalAccessCount,
			mostAccessed
		};
	}
	
	/**
	 * Check if an issue needs refreshing
	 */
	needsRefresh(issueId: string): boolean {
		const cached = this.cache.get(issueId);
		if (!cached) {
			return true;
		}
		
		const age = Date.now() - cached.timestamp;
		return age > cached.ttl;
	}
	
	/**
	 * Update TTL for an issue based on access patterns
	 */
	updateTTL(issueId: string): void {
		const cached = this.cache.get(issueId);
		if (!cached) {
			return;
		}
		
		// Extend TTL for frequently accessed issues
		if (cached.accessCount > 10) {
			cached.ttl = this.EXTENDED_TTL;
			// Update the cache entry with new TTL
			this.cache.set(issueId, cached);
			console.log(`[IssueCache] Extended TTL for frequently accessed issue ${issueId}`);
		}
	}
}