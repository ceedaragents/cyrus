import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IssueCache } from "../src/IssueCache.js";
import type { Issue as LinearIssue } from "@linear/sdk";

describe("IssueCache", () => {
	let cache: IssueCache;

	const mockIssue = (id: string, title: string = "Test Issue"): LinearIssue => ({
		id,
		title,
		identifier: `TEST-${id}`,
		description: "Test description",
		url: `https://linear.app/test/issue/TEST-${id}`,
	} as LinearIssue);

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(1000000));
		cache = new IssueCache();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("Basic Cache Operations", () => {
		it("should store and retrieve issues", () => {
			const issue = mockIssue("123");
			
			cache.set("123", issue);
			const retrieved = cache.get("123");
			
			expect(retrieved).toEqual(issue);
		});

		it("should return null for non-existent issues", () => {
			const retrieved = cache.get("nonexistent");
			expect(retrieved).toBeNull();
		});

		it("should return null for expired issues", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Move time forward beyond default TTL (10 minutes)
			vi.setSystemTime(new Date(1000000 + 11 * 60 * 1000));
			
			const retrieved = cache.get("123");
			expect(retrieved).toBeNull();
		});
	});

	describe("TTL Management", () => {
		it("should use default TTL for new issues", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Move time forward but within default TTL
			vi.setSystemTime(new Date(1000000 + 5 * 60 * 1000));
			
			const retrieved = cache.get("123");
			expect(retrieved).toEqual(issue);
		});

		it("should extend TTL for frequently accessed issues", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Access the issue multiple times to trigger extended TTL
			for (let i = 0; i < 6; i++) {
				cache.get("123");
			}
			
			// Set the issue again - should get extended TTL due to high access count
			cache.set("123", issue);
			
			// Move time forward beyond default TTL but within extended TTL
			vi.setSystemTime(new Date(1000000 + 20 * 60 * 1000)); // 20 minutes
			
			const retrieved = cache.get("123");
			expect(retrieved).toEqual(issue);
		});

		it("should update TTL for frequently accessed issues", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Access issue many times
			for (let i = 0; i < 12; i++) {
				cache.get("123");
			}
			
			cache.updateTTL("123");
			
			// Move time forward beyond default TTL
			vi.setSystemTime(new Date(1000000 + 15 * 60 * 1000));
			
			const retrieved = cache.get("123");
			expect(retrieved).toEqual(issue);
		});
	});

	describe("Stale Data Handling", () => {
		it("should return stale data when requested", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Move time forward beyond TTL but within stale TTL
			vi.setSystemTime(new Date(1000000 + 20 * 60 * 1000)); // 20 minutes
			
			const fresh = cache.get("123", false);
			expect(fresh).toBeNull();
			
			const stale = cache.get("123", true);
			expect(stale).toEqual(issue);
		});

		it("should not return data beyond stale TTL", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Move time forward beyond stale TTL (1 hour)
			vi.setSystemTime(new Date(1000000 + 70 * 60 * 1000));
			
			const stale = cache.get("123", true);
			expect(stale).toBeNull();
		});
	});

	describe("Access Tracking", () => {
		it("should track access count and last accessed time", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Access multiple times
			cache.get("123");
			cache.get("123");
			cache.get("123");
			
			const stats = cache.getStats();
			expect(stats.totalAccessCount).toBeGreaterThan(0);
		});

		it("should identify most accessed issue", () => {
			const issue1 = mockIssue("123");
			const issue2 = mockIssue("456");
			
			cache.set("123", issue1);
			cache.set("456", issue2);
			
			// Access issue 123 more than issue 456
			for (let i = 0; i < 5; i++) {
				cache.get("123");
			}
			cache.get("456");
			
			const stats = cache.getStats();
			expect(stats.mostAccessed?.issueId).toBe("123");
			expect(stats.mostAccessed?.count).toBeGreaterThan(1);
		});
	});

	describe("Cache Invalidation", () => {
		it("should invalidate specific issues", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			expect(cache.get("123")).toEqual(issue);
			
			cache.invalidate("123");
			
			expect(cache.get("123")).toBeNull();
		});

		it("should invalidate all issues", () => {
			const issue1 = mockIssue("123");
			const issue2 = mockIssue("456");
			
			cache.set("123", issue1);
			cache.set("456", issue2);
			
			expect(cache.get("123")).toEqual(issue1);
			expect(cache.get("456")).toEqual(issue2);
			
			cache.invalidateAll();
			
			expect(cache.get("123")).toBeNull();
			expect(cache.get("456")).toBeNull();
		});
	});

	describe("Cache Warming", () => {
		it("should warm cache with multiple issues", () => {
			const issues = [
				mockIssue("123", "Issue 1"),
				mockIssue("456", "Issue 2"),
				mockIssue("789", "Issue 3"),
			];
			
			cache.warm(issues);
			
			expect(cache.get("123")).toEqual(issues[0]);
			expect(cache.get("456")).toEqual(issues[1]);
			expect(cache.get("789")).toEqual(issues[2]);
		});

		it("should handle issues without IDs during warming", () => {
			const issues = [
				{ ...mockIssue("123"), id: undefined } as LinearIssue,
				mockIssue("456"),
			];
			
			// Should not throw error
			expect(() => cache.warm(issues)).not.toThrow();
			
			// Only issue with ID should be cached
			expect(cache.get("123")).toBeNull();
			expect(cache.get("456")).toEqual(issues[1]);
		});
	});

	describe("Cache Eviction", () => {
		it("should evict least recently used items when cache is full", () => {
			// Fill cache beyond limit
			const issues: LinearIssue[] = [];
			for (let i = 0; i < 105; i++) { // Exceeds MAX_CACHE_SIZE of 100
				const issue = mockIssue(i.toString());
				issues.push(issue);
				cache.set(i.toString(), issue);
			}
			
			// First issues should be evicted
			expect(cache.get("0")).toBeNull();
			expect(cache.get("1")).toBeNull();
			
			// Recent issues should still be cached
			expect(cache.get("104")).toEqual(issues[104]);
			expect(cache.get("103")).toEqual(issues[103]);
		});

		it("should preserve recently accessed items during eviction", () => {
			// Fill cache to near limit
			for (let i = 0; i < 90; i++) {
				cache.set(i.toString(), mockIssue(i.toString()));
			}
			
			// Move time forward slightly and access some old items to make them recently used
			vi.setSystemTime(new Date(1000000 + 1000));
			cache.get("0");
			cache.get("1");
			
			// Add more items to trigger eviction (goes beyond MAX_CACHE_SIZE of 100)
			for (let i = 90; i < 105; i++) {
				cache.set(i.toString(), mockIssue(i.toString()));
			}
			
			// Recently accessed old items should survive since eviction removes 15 items (5 over + 10 extra)
			// but items 0 and 1 were accessed more recently than items 2-89
			expect(cache.get("0")).not.toBeNull();
			expect(cache.get("1")).not.toBeNull();
			
			// Some middle items should be evicted (the least recently used ones)
			expect(cache.get("2")).toBeNull();
			expect(cache.get("3")).toBeNull();
		});
	});

	describe("Refresh Detection", () => {
		it("should detect when issues need refreshing", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			expect(cache.needsRefresh("123")).toBe(false);
			
			// Move time forward beyond TTL
			vi.setSystemTime(new Date(1000000 + 11 * 60 * 1000));
			
			expect(cache.needsRefresh("123")).toBe(true);
		});

		it("should indicate refresh needed for non-existent issues", () => {
			expect(cache.needsRefresh("nonexistent")).toBe(true);
		});
	});

	describe("Statistics", () => {
		it("should provide accurate cache statistics", () => {
			const issue1 = mockIssue("123");
			const issue2 = mockIssue("456");
			const issue3 = mockIssue("789");
			
			// Add fresh issues
			cache.set("123", issue1);
			cache.set("456", issue2);
			
			// Add stale issue
			vi.setSystemTime(new Date(1000000 + 15 * 60 * 1000));
			cache.set("789", issue3);
			vi.setSystemTime(new Date(1000000 + 25 * 60 * 1000));
			
			// Access issues
			cache.get("123");
			cache.get("123");
			cache.get("456");
			
			const stats = cache.getStats();
			
			expect(stats.size).toBe(3);
			expect(stats.freshCount).toBe(1); // Only issue3 is fresh at current time
			expect(stats.staleCount).toBe(2); // Issues 1 and 2 are stale but within stale TTL
			expect(stats.totalAccessCount).toBeGreaterThan(0);
			expect(stats.mostAccessed?.issueId).toBe("123");
		});

		it("should handle empty cache statistics", () => {
			const stats = cache.getStats();
			
			expect(stats).toMatchObject({
				size: 0,
				freshCount: 0,
				staleCount: 0,
				totalAccessCount: 0,
				mostAccessed: null,
			});
		});
	});

	describe("Edge Cases", () => {
		it("should handle concurrent access gracefully", () => {
			const issue = mockIssue("123");
			cache.set("123", issue);
			
			// Simulate concurrent access
			const results = [];
			for (let i = 0; i < 10; i++) {
				results.push(cache.get("123"));
			}
			
			// All accesses should return the same issue
			results.forEach(result => {
				expect(result).toEqual(issue);
			});
		});

		it("should handle rapid set/get cycles", () => {
			const issue = mockIssue("123");
			
			for (let i = 0; i < 100; i++) {
				cache.set("123", issue);
				expect(cache.get("123")).toEqual(issue);
			}
		});

		it("should handle very long issue IDs", () => {
			const longId = "a".repeat(1000);
			const issue = mockIssue(longId);
			
			cache.set(longId, issue);
			expect(cache.get(longId)).toEqual(issue);
		});
	});
});