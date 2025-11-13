/**
 * Test file for CYPACK-369: Eliminate dual-interface shimming violations in EdgeWorker
 *
 * Bug Description:
 * After merge from main, 4 instances of forbidden dual-interface shimming were introduced
 * in EdgeWorker.ts. These violate the architectural principle that EdgeWorker must have
 * ZERO platform-specific logic.
 *
 * Forbidden Pattern:
 * const labelNames = typeof issue.labels === "function"
 *   ? (await issue.labels()).nodes.map((l) => l.name)
 *   : (issue.labels as Array<{name: string}>).map((l) => l.name);
 *
 * Violations Found (4 locations):
 * 1. Line ~1453: typeof fullIssue.labels === "function"
 * 2. Line ~3686: typeof fullIssue.labels === "function"
 * 3. Line ~4515: typeof issue.labels === "function"
 * 4. Line ~4860: typeof fullIssue.labels === "function"
 *
 * Correct Approach:
 * EdgeWorker must use ONLY issueTrackerService interface methods.
 * Platform-specific logic belongs in LinearIssueTrackerService/CLIIssueTrackerService.
 */

import { describe, expect, it } from "vitest";

describe("EdgeWorker - CYPACK-369 Dual-Interface Shimming Violations", () => {
	/**
	 * FAILING TEST: Verifies that dual-interface shimming exists
	 *
	 * This test documents the current state and will fail until violations are removed.
	 */
	it("FAILING: EdgeWorker contains 4 dual-interface shimming violations", async () => {
		// Read EdgeWorker source code
		const edgeWorkerSource = await import("node:fs").then((fs) =>
			fs.promises.readFile(
				new URL("../src/EdgeWorker.ts", import.meta.url),
				"utf-8",
			),
		);

		// Search for all instances of the forbidden pattern
		const violationPattern = /typeof\s+\w+\.labels\s*===\s*["']function["']/g;
		const matches = edgeWorkerSource.match(violationPattern);

		// Count violations
		const violationCount = matches ? matches.length : 0;

		// Report findings
		if (violationCount > 0) {
			console.log("\n=== DUAL-INTERFACE SHIMMING VIOLATIONS FOUND ===");
			console.log(`Total violations: ${violationCount}`);
			console.log("\nViolation pattern: typeof X.labels === 'function'");
			console.log("\nThis pattern is FORBIDDEN because:");
			console.log("- EdgeWorker must have ZERO platform-specific logic");
			console.log(
				"- Platform differences belong in IIssueTrackerService implementations",
			);
			console.log("- Dual-interface shimming defeats abstraction purpose");
			console.log("================================================\n");
		}

		// This test documents the current BROKEN state
		// Expected: 4 violations exist (will fail with expect toBe 0)
		// After fix: 0 violations should exist (test will pass)
		expect(violationCount).toBe(0); // WILL FAIL - violations exist
	});

	/**
	 * FAILING TEST: Verify each specific violation location
	 *
	 * Documents the exact line numbers where violations occur
	 */
	it("FAILING: All 4 violation locations documented", async () => {
		const edgeWorkerSource = await import("node:fs").then((fs) =>
			fs.promises.readFile(
				new URL("../src/EdgeWorker.ts", import.meta.url),
				"utf-8",
			),
		);

		const lines = edgeWorkerSource.split("\n");
		const violationLocations: number[] = [];

		// Find all lines with typeof labels === "function"
		for (let i = 0; i < lines.length; i++) {
			if (
				lines[i].includes("typeof") &&
				lines[i].includes("labels") &&
				lines[i].includes("function")
			) {
				violationLocations.push(i + 1); // Line numbers are 1-indexed
			}
		}

		console.log("\n=== VIOLATION LOCATIONS ===");
		for (let i = 0; i < violationLocations.length; i++) {
			console.log(`Violation ${i + 1}: Line ${violationLocations[i]}`);
		}
		console.log("===========================\n");

		// Expected locations (approximate, may shift with code changes)
		// 1. ~1453
		// 2. ~3686
		// 3. ~4515
		// 4. ~4860

		// Verify we found exactly 4 violations
		expect(violationLocations).toHaveLength(0); // WILL FAIL - 4 violations exist
	});

	/**
	 * PASSING TEST: EdgeWorker should use service abstraction for labels
	 *
	 * After fix, EdgeWorker should NOT have the specific dual-interface shimming comment
	 */
	it("PASSING: EdgeWorker uses service abstraction for labels", async () => {
		const edgeWorkerSource = await import("node:fs").then((fs) =>
			fs.promises.readFile(
				new URL("../src/EdgeWorker.ts", import.meta.url),
				"utf-8",
			),
		);

		// Check for the specific forbidden comment that was in the violations
		const hasShimmingComment = edgeWorkerSource.includes(
			"// Handle both Linear SDK (function) and CLI platform (array)",
		);

		// EdgeWorker should NOT have this specific shimming comment
		expect(hasShimmingComment).toBe(false);
	});

	/**
	 * PASSING TEST (after fix): Verify clean architecture
	 *
	 * This test will PASS only after all violations are removed
	 */
	it("PASSING (after fix): EdgeWorker has zero platform awareness", async () => {
		const edgeWorkerSource = await import("node:fs").then((fs) =>
			fs.promises.readFile(
				new URL("../src/EdgeWorker.ts", import.meta.url),
				"utf-8",
			),
		);

		// After fix, these should all be false
		const platformChecks = {
			hasTypeofLabels: edgeWorkerSource.includes(
				'typeof fullIssue.labels === "function"',
			),
			hasTypeofIssueLabels: edgeWorkerSource.includes(
				'typeof issue.labels === "function"',
			),
			hasShimmingComment: edgeWorkerSource.includes(
				"// Handle both Linear SDK (function) and CLI platform (array)",
			),
		};

		// Log current state
		console.log("\n=== PLATFORM AWARENESS CHECK ===");
		console.log("typeof fullIssue.labels:", platformChecks.hasTypeofLabels);
		console.log("typeof issue.labels:", platformChecks.hasTypeofIssueLabels);
		console.log("Shimming comment:", platformChecks.hasShimmingComment);
		console.log("================================\n");

		// After fix: EdgeWorker should have NO dual-interface shimming
		const hasDualInterfaceShimming = Object.values(platformChecks).some(
			(check) => check === true,
		);

		// This should now pass - all shimming violations removed
		expect(hasDualInterfaceShimming).toBe(false);
	});
});
