import { describe, expect, it } from "vitest";
import {
	EdgeConfigSchema,
	MemoryGateConfigSchema,
} from "../src/config-schemas.js";

/**
 * Learning tests for the Zod schema attached to MemoryGateConfig.
 * These pin down what callers can/can't pass via config.json.
 */
describe("MemoryGateConfigSchema", () => {
	it("accepts an empty object (everything optional)", () => {
		expect(() => MemoryGateConfigSchema.parse({})).not.toThrow();
	});

	it("accepts a fully-populated valid config", () => {
		const parsed = MemoryGateConfigSchema.parse({
			enabled: true,
			maxRssPercent: 0.75,
			minAvailableMemoryMb: 512,
			maxHeapUsagePercent: 0.9,
		});
		expect(parsed.enabled).toBe(true);
		expect(parsed.maxRssPercent).toBe(0.75);
	});

	it("rejects maxRssPercent above 1", () => {
		expect(() =>
			MemoryGateConfigSchema.parse({ maxRssPercent: 1.5 }),
		).toThrow();
	});

	it("rejects maxRssPercent below 0", () => {
		expect(() =>
			MemoryGateConfigSchema.parse({ maxRssPercent: -0.1 }),
		).toThrow();
	});

	it("rejects negative minAvailableMemoryMb", () => {
		expect(() =>
			MemoryGateConfigSchema.parse({ minAvailableMemoryMb: -1 }),
		).toThrow();
	});

	it("rejects zero minAvailableMemoryMb (must be positive)", () => {
		expect(() =>
			MemoryGateConfigSchema.parse({ minAvailableMemoryMb: 0 }),
		).toThrow();
	});

	it("rejects maxHeapUsagePercent above 1", () => {
		expect(() =>
			MemoryGateConfigSchema.parse({ maxHeapUsagePercent: 2 }),
		).toThrow();
	});
});

describe("EdgeConfigSchema — runner gate fields", () => {
	it("accepts maxConcurrentRunners as a non-negative integer", () => {
		const parsed = EdgeConfigSchema.parse({
			repositories: [],
			maxConcurrentRunners: 5,
		});
		expect(parsed.maxConcurrentRunners).toBe(5);
	});

	it("accepts maxConcurrentRunners=0 (cap disabled)", () => {
		const parsed = EdgeConfigSchema.parse({
			repositories: [],
			maxConcurrentRunners: 0,
		});
		expect(parsed.maxConcurrentRunners).toBe(0);
	});

	it("rejects negative maxConcurrentRunners", () => {
		expect(() =>
			EdgeConfigSchema.parse({
				repositories: [],
				maxConcurrentRunners: -1,
			}),
		).toThrow();
	});

	it("rejects non-integer maxConcurrentRunners", () => {
		expect(() =>
			EdgeConfigSchema.parse({
				repositories: [],
				maxConcurrentRunners: 2.5,
			}),
		).toThrow();
	});

	it("accepts a nested memoryGate block", () => {
		const parsed = EdgeConfigSchema.parse({
			repositories: [],
			memoryGate: { enabled: true, maxRssPercent: 0.8 },
		});
		expect(parsed.memoryGate?.enabled).toBe(true);
	});

	it("accepts both memoryGate and maxConcurrentRunners together", () => {
		const parsed = EdgeConfigSchema.parse({
			repositories: [],
			memoryGate: { enabled: true, minAvailableMemoryMb: 256 },
			maxConcurrentRunners: 3,
		});
		expect(parsed.memoryGate?.minAvailableMemoryMb).toBe(256);
		expect(parsed.maxConcurrentRunners).toBe(3);
	});
});
