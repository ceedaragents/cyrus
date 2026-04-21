import { describe, expect, it } from "vitest";
import {
	checkMemoryHealth,
	collectMemoryMetrics,
	formatMemoryPressureMessage,
	type MemorySources,
} from "../src/memory-health.js";

const GB = 1024 * 1024 * 1024;

function sourcesFor(args: {
	rss: number;
	total: number;
	free: number;
	heapUsed: number;
	heapLimit: number;
}): MemorySources {
	return {
		rssBytes: () => args.rss,
		totalSystemBytes: () => args.total,
		availableSystemBytes: () => args.free,
		heapUsedBytes: () => args.heapUsed,
		heapLimitBytes: () => args.heapLimit,
	};
}

describe("checkMemoryHealth", () => {
	it("reports ok when gate is disabled even with dire memory pressure", () => {
		const sources = sourcesFor({
			rss: 4 * GB,
			total: 4 * GB,
			free: 0,
			heapUsed: 4 * GB,
			heapLimit: 4 * GB,
		});
		const result = checkMemoryHealth(
			{ enabled: false, maxRssPercent: 0.5 },
			sources,
		);
		expect(result.ok).toBe(true);
	});

	it("reports ok when config is undefined", () => {
		const sources = sourcesFor({
			rss: 4 * GB,
			total: 4 * GB,
			free: 0,
			heapUsed: 4 * GB,
			heapLimit: 4 * GB,
		});
		const result = checkMemoryHealth(undefined, sources);
		expect(result.ok).toBe(true);
	});

	it("rejects when process RSS exceeds the configured percentage", () => {
		const sources = sourcesFor({
			rss: 3.5 * GB,
			total: 4 * GB,
			free: 0.5 * GB,
			heapUsed: 200 * 1024 * 1024,
			heapLimit: 2 * GB,
		});
		const result = checkMemoryHealth(
			{ enabled: true, maxRssPercent: 0.75 },
			sources,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/RSS/i);
			expect(result.metrics.rssPercent).toBeGreaterThan(0.75);
		}
	});

	it("rejects when available system memory falls below threshold", () => {
		const sources = sourcesFor({
			rss: 1 * GB,
			total: 4 * GB,
			free: 200 * 1024 * 1024,
			heapUsed: 200 * 1024 * 1024,
			heapLimit: 2 * GB,
		});
		const result = checkMemoryHealth(
			{ enabled: true, minAvailableMemoryMb: 500 },
			sources,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/available/i);
		}
	});

	it("rejects when heap usage exceeds configured percentage", () => {
		const sources = sourcesFor({
			rss: 1 * GB,
			total: 4 * GB,
			free: 2 * GB,
			heapUsed: 1.9 * GB,
			heapLimit: 2 * GB,
		});
		const result = checkMemoryHealth(
			{ enabled: true, maxHeapUsagePercent: 0.85 },
			sources,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/heap/i);
		}
	});

	it("allows when all thresholds are satisfied", () => {
		const sources = sourcesFor({
			rss: 1 * GB,
			total: 4 * GB,
			free: 2 * GB,
			heapUsed: 300 * 1024 * 1024,
			heapLimit: 2 * GB,
		});
		const result = checkMemoryHealth(
			{
				enabled: true,
				maxRssPercent: 0.75,
				minAvailableMemoryMb: 500,
				maxHeapUsagePercent: 0.85,
			},
			sources,
		);
		expect(result.ok).toBe(true);
		expect(result.metrics.rssMb).toBeCloseTo(1024, 0);
		expect(result.metrics.totalSystemMemoryMb).toBeCloseTo(4096, 0);
	});

	it("prioritises RSS check before heap and free memory", () => {
		const sources = sourcesFor({
			rss: 3.9 * GB,
			total: 4 * GB,
			free: 100 * 1024 * 1024,
			heapUsed: 1.9 * GB,
			heapLimit: 2 * GB,
		});
		const result = checkMemoryHealth(
			{
				enabled: true,
				maxRssPercent: 0.75,
				minAvailableMemoryMb: 500,
				maxHeapUsagePercent: 0.85,
			},
			sources,
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/RSS/i);
		}
	});
});

describe("collectMemoryMetrics", () => {
	it("returns zero percent when totals are zero (defensive)", () => {
		const metrics = collectMemoryMetrics(
			sourcesFor({
				rss: 1024,
				total: 0,
				free: 0,
				heapUsed: 0,
				heapLimit: 0,
			}),
		);
		expect(metrics.rssPercent).toBe(0);
		expect(metrics.heapPercent).toBe(0);
	});
});

describe("formatMemoryPressureMessage", () => {
	it("produces a user-facing message including the reason", () => {
		const msg = formatMemoryPressureMessage("example reason");
		expect(msg).toContain("Cyrus is temporarily out of capacity");
		expect(msg).toContain("example reason");
	});
});
