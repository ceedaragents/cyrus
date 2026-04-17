import type { EdgeWorkerConfig } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { RunnerSelectionService } from "../src/RunnerSelectionService.js";

function createService(
	overrides: Partial<EdgeWorkerConfig> = {},
): RunnerSelectionService {
	const config: EdgeWorkerConfig = {
		linearWorkspaces: [],
		repositories: [],
		cyrusHome: "/tmp/cyrus",
		...overrides,
	};
	return new RunnerSelectionService(config);
}

describe("RunnerSelectionService - Effort Parsing", () => {
	describe("effort from description tag", () => {
		it("should parse [effort=max] from description", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				[],
				"Some issue [effort=max]",
			);
			expect(result.effortOverride).toBe("max");
		});

		it("should parse [effort=low] from description", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				[],
				"Some issue [effort=low]",
			);
			expect(result.effortOverride).toBe("low");
		});

		it("should parse [effort=xhigh] from description", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				[],
				"Some issue [effort=xhigh]",
			);
			expect(result.effortOverride).toBe("xhigh");
		});

		it("should ignore invalid effort values", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				[],
				"Some issue [effort=turbo]",
			);
			expect(result.effortOverride).toBeUndefined();
		});
	});

	describe("effort from flat labels", () => {
		it("should parse effort-max label", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["effort-max"]);
			expect(result.effortOverride).toBe("max");
		});

		it("should parse max-effort label", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["max-effort"]);
			expect(result.effortOverride).toBe("max");
		});

		it("should parse effort-low label", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["effort-low"]);
			expect(result.effortOverride).toBe("low");
		});

		it("should parse effort-high label", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["effort-high"]);
			expect(result.effortOverride).toBe("high");
		});

		it("should parse effort-xhigh label", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["effort-xhigh"]);
			expect(result.effortOverride).toBe("xhigh");
		});
	});

	describe("effort from group-qualified labels", () => {
		it("should parse 'Effort Level/max' group label", () => {
			const service = createService();
			const result = service.determineRunnerSelection([
				"max",
				"effort level/max",
			]);
			expect(result.effortOverride).toBe("max");
		});

		it("should parse 'CyrusEffort/high' group label", () => {
			const service = createService();
			const result = service.determineRunnerSelection([
				"high",
				"cyruseffort/high",
			]);
			expect(result.effortOverride).toBe("high");
		});

		it("should ignore group labels without 'effort' in group name", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["max", "priority/max"]);
			expect(result.effortOverride).toBeUndefined();
		});
	});

	describe("effort only applies to Claude runner", () => {
		it("should not set effort for gemini runner", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				["gemini", "effort-max"],
				"",
			);
			expect(result.runnerType).toBe("gemini");
			expect(result.effortOverride).toBeUndefined();
		});

		it("should not set effort for codex runner", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				["codex", "effort-max"],
				"",
			);
			expect(result.runnerType).toBe("codex");
			expect(result.effortOverride).toBeUndefined();
		});
	});

	describe("description tag takes priority over labels", () => {
		it("should prefer description tag over label", () => {
			const service = createService();
			const result = service.determineRunnerSelection(
				["effort-low"],
				"Some issue [effort=max]",
			);
			expect(result.effortOverride).toBe("max");
		});
	});

	describe("no effort set by default", () => {
		it("should return undefined effortOverride when no effort specified", () => {
			const service = createService();
			const result = service.determineRunnerSelection(["opus"]);
			expect(result.effortOverride).toBeUndefined();
		});
	});
});
