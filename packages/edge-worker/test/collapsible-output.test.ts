import { describe, it, expect } from "vitest";

// Mock the wrapInCollapsibleIfNeeded function for testing
function wrapInCollapsibleIfNeeded(
	content: string,
	title: string = "Output",
	threshold: number = 500,
): string {
	// Check if content should be wrapped
	const shouldWrap =
		content.length > threshold ||
		content.includes("Test Suites:") || // Jest test output
		content.includes("Tests:") || // Test output
		content.includes("PASS ") || // Test pass markers
		content.includes("FAIL ") || // Test fail markers
		content.includes("npm ") || // npm output
		content.includes("pnpm ") || // pnpm output
		content.includes("yarn ") || // yarn output
		content.includes("\x1b[") || // ANSI escape codes
		content.split("\n").length > 10; // Many lines

	if (!shouldWrap) {
		return content;
	}

	// Wrap in collapsible block using Linear's format
	return `+++${title}
${content}
+++`;
}

describe("Collapsible Output Wrapper", () => {
	it("should not wrap small outputs", () => {
		const smallOutput = "This is a small output";
		const result = wrapInCollapsibleIfNeeded(smallOutput);
		expect(result).toBe(smallOutput);
	});

	it("should wrap large outputs", () => {
		const largeOutput = "a".repeat(600);
		const result = wrapInCollapsibleIfNeeded(largeOutput);
		expect(result).toBe(`+++Output
${largeOutput}
+++`);
	});

	it("should wrap test outputs", () => {
		const testOutput = `
Test Suites: 1 passed, 1 total
Tests:       43 passed, 43 total
Time:        9.779 s, estimated 11 s
`;
		const result = wrapInCollapsibleIfNeeded(testOutput, "Test Results");
		expect(result).toBe(`+++Test Results
${testOutput}
+++`);
	});

	it("should wrap npm outputs", () => {
		const npmOutput = `npm install
added 354 packages
Done in 1.8s`;
		const result = wrapInCollapsibleIfNeeded(npmOutput, "npm Output");
		expect(result).toBe(`+++npm Output
${npmOutput}
+++`);
	});

	it("should wrap outputs with many lines", () => {
		const multiLineOutput = Array(15).fill("Line of output").join("\n");
		const result = wrapInCollapsibleIfNeeded(multiLineOutput);
		expect(result).toBe(`+++Output
${multiLineOutput}
+++`);
	});

	it("should wrap outputs with ANSI escape codes", () => {
		const ansiOutput = "\x1b[32mGreen text\x1b[0m";
		const result = wrapInCollapsibleIfNeeded(ansiOutput);
		expect(result).toBe(`+++Output
${ansiOutput}
+++`);
	});

	it("should not wrap short multi-line outputs", () => {
		const shortMultiLine = "Line 1\nLine 2\nLine 3";
		const result = wrapInCollapsibleIfNeeded(shortMultiLine);
		expect(result).toBe(shortMultiLine);
	});
});