/**
 * Test file for CYPACK-334: Clean up ugly label type-checking code in EdgeWorker
 *
 * Bug Description:
 * After CYPACK-331 removed the fetchIssueLabels() method, there are still THREE occurrences
 * of ugly label type-checking code with `(fullIssue as any).labels` pattern in EdgeWorker.
 *
 * These violations appear in:
 * - Line ~3688: buildSessionPrompt()
 * - Line ~4757: resumeClaudeSession()
 *
 * The code violates THREE architectural principles:
 * 1. NO `any` types allowed in codebase (defeats TypeScript's purpose)
 * 2. NO platform-specific logic in EdgeWorker (checking Array.isArray, Promise handling)
 * 3. NO unnecessary defensive coding (try-catch blocks when optional chaining works)
 *
 * Current ugly pattern:
 * ```typescript
 * let labelNames: string[] = [];
 * try {
 *   const labelsData = (fullIssue as any).labels;  // ❌ as any
 *   if (labelsData) {
 *     // Handle both direct arrays and promises
 *     const resolvedLabels = Array.isArray(labelsData)  // ❌ platform check
 *       ? labelsData
 *       : await labelsData;
 *     if (Array.isArray(resolvedLabels)) {
 *       labelNames = resolvedLabels.map((l: any) => l.name);  // ❌ any again
 *     }
 *   }
 * } catch (error) {  // ❌ unnecessary try-catch
 *   console.debug(...);
 * }
 * ```
 *
 * Should be:
 * ```typescript
 * const labelNames = fullIssue.labels?.map((l) => l.name) || [];
 * ```
 *
 * This test verifies that all ugly patterns are removed.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

describe("CYPACK-334: Clean up ugly label type-checking code", () => {
	const edgeWorkerPath = join(process.cwd(), "src/EdgeWorker.ts");

	let edgeWorkerSource: string;

	beforeEach(async () => {
		edgeWorkerSource = await readFile(edgeWorkerPath, "utf-8");
	});

	/**
	 * FAILING TEST: No `(fullIssue as any).labels` patterns
	 *
	 * This test will FAIL until all occurrences of the ugly pattern are removed.
	 */
	it("FAILING: should have zero occurrences of '(fullIssue as any).labels'", () => {
		const matches = edgeWorkerSource.match(/\(fullIssue as any\)\.labels/g);
		const count = matches?.length || 0;

		// Find line numbers for debugging
		if (count > 0) {
			const lines = edgeWorkerSource.split("\n");
			const lineNumbers: number[] = [];

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("(fullIssue as any).labels")) {
					lineNumbers.push(i + 1);
				}
			}

			console.log("\n=== CYPACK-334 VIOLATIONS FOUND ===");
			console.log(
				`Found ${count} occurrence(s) of '(fullIssue as any).labels'`,
			);
			console.log(`Line numbers: ${lineNumbers.join(", ")}`);
			console.log("====================================\n");
		}

		// This assertion will FAIL until the code is cleaned up
		expect(count).toBe(0);
	});

	/**
	 * FAILING TEST: No labelsData variable (part of the ugly pattern)
	 *
	 * The variable `labelsData` is only used in the ugly pattern.
	 * It should not exist after cleanup.
	 */
	it("FAILING: should have zero occurrences of 'const labelsData ='", () => {
		const matches = edgeWorkerSource.match(/const labelsData =/g);
		const count = matches?.length || 0;

		if (count > 0) {
			const lines = edgeWorkerSource.split("\n");
			const lineNumbers: number[] = [];

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("const labelsData =")) {
					lineNumbers.push(i + 1);
				}
			}

			console.log("\n=== CYPACK-334 VIOLATIONS FOUND ===");
			console.log(`Found ${count} occurrence(s) of 'const labelsData ='`);
			console.log(`Line numbers: ${lineNumbers.join(", ")}`);
			console.log("====================================\n");
		}

		expect(count).toBe(0);
	});

	/**
	 * FAILING TEST: No Array.isArray checks for labels
	 *
	 * Array.isArray checks are platform-specific logic that shouldn't be in EdgeWorker.
	 * After cleanup, labels should always be Label[] (fully resolved by the service layer).
	 */
	it("FAILING: should have zero Array.isArray checks for labels/labelsData", () => {
		// Look for patterns like:
		// - Array.isArray(labelsData)
		// - Array.isArray(resolvedLabels)
		const matches = edgeWorkerSource.match(
			/Array\.isArray\((labelsData|resolvedLabels)\)/g,
		);
		const count = matches?.length || 0;

		if (count > 0) {
			const lines = edgeWorkerSource.split("\n");
			const lineNumbers: number[] = [];

			for (let i = 0; i < lines.length; i++) {
				if (
					lines[i].includes("Array.isArray(labelsData)") ||
					lines[i].includes("Array.isArray(resolvedLabels)")
				) {
					lineNumbers.push(i + 1);
				}
			}

			console.log("\n=== CYPACK-334 VIOLATIONS FOUND ===");
			console.log(
				`Found ${count} occurrence(s) of Array.isArray checks for labels`,
			);
			console.log(`Line numbers: ${lineNumbers.join(", ")}`);
			console.log("====================================\n");
		}

		expect(count).toBe(0);
	});

	/**
	 * FAILING TEST: No try-catch blocks for label fetching
	 *
	 * The try-catch blocks around label fetching are unnecessary with optional chaining.
	 * After cleanup, simple `fullIssue.labels?.map(l => l.name) || []` handles all cases.
	 */
	it("FAILING: should have zero try-catch blocks for 'Could not fetch labels'", () => {
		// Search for the error message unique to these try-catch blocks
		const matches = edgeWorkerSource.match(/Could not fetch labels for issue/g);
		const count = matches?.length || 0;

		if (count > 0) {
			const lines = edgeWorkerSource.split("\n");
			const lineNumbers: number[] = [];

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("Could not fetch labels for issue")) {
					lineNumbers.push(i + 1);
				}
			}

			console.log("\n=== CYPACK-334 VIOLATIONS FOUND ===");
			console.log(
				`Found ${count} occurrence(s) of label-fetching try-catch blocks`,
			);
			console.log(`Line numbers: ${lineNumbers.join(", ")}`);
			console.log("====================================\n");
		}

		expect(count).toBe(0);
	});

	/**
	 * FAILING TEST: No `resolvedLabels` variable (part of the ugly pattern)
	 *
	 * The variable `resolvedLabels` is only used in the ugly pattern for handling
	 * both arrays and promises. It should not exist after cleanup.
	 */
	it("FAILING: should have zero occurrences of 'resolvedLabels' variable", () => {
		const matches = edgeWorkerSource.match(/const resolvedLabels =/g);
		const count = matches?.length || 0;

		if (count > 0) {
			const lines = edgeWorkerSource.split("\n");
			const lineNumbers: number[] = [];

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].includes("const resolvedLabels =")) {
					lineNumbers.push(i + 1);
				}
			}

			console.log("\n=== CYPACK-334 VIOLATIONS FOUND ===");
			console.log(`Found ${count} occurrence(s) of 'const resolvedLabels ='`);
			console.log(`Line numbers: ${lineNumbers.join(", ")}`);
			console.log("====================================\n");
		}

		expect(count).toBe(0);
	});

	/**
	 * PASSING TEST: All violations removed (will pass after fix)
	 *
	 * This comprehensive test checks that all aspects of the ugly pattern are gone.
	 */
	it("PASSING (after fix): all ugly label type-checking patterns removed", () => {
		const violations: string[] = [];

		// Check 1: No `(fullIssue as any).labels`
		if (edgeWorkerSource.includes("(fullIssue as any).labels")) {
			violations.push("Found '(fullIssue as any).labels' pattern");
		}

		// Check 2: No labelsData variable
		if (edgeWorkerSource.includes("const labelsData =")) {
			violations.push("Found 'const labelsData =' variable");
		}

		// Check 3: No resolvedLabels variable
		if (edgeWorkerSource.includes("const resolvedLabels =")) {
			violations.push("Found 'const resolvedLabels =' variable");
		}

		// Check 4: No Array.isArray checks for labels
		if (
			edgeWorkerSource.includes("Array.isArray(labelsData)") ||
			edgeWorkerSource.includes("Array.isArray(resolvedLabels)")
		) {
			violations.push("Found Array.isArray checks for labels");
		}

		// Check 5: No try-catch blocks for label fetching
		if (edgeWorkerSource.includes("Could not fetch labels for issue")) {
			violations.push("Found try-catch block for label fetching");
		}

		if (violations.length > 0) {
			console.log("\n=== REMAINING CYPACK-334 VIOLATIONS ===");
			for (let i = 0; i < violations.length; i++) {
				console.log(`${i + 1}. ${violations[i]}`);
			}
			console.log("=========================================\n");
		} else {
			console.log("\n✅ All CYPACK-334 violations fixed!\n");
		}

		// After fix, this should pass
		expect(violations).toHaveLength(0);
	});
});
