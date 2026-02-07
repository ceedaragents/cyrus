import { describe, expect, it } from "vitest";
import { scoreComplexity } from "../src/ComplexityScorer.js";
import type { ComplexityInput } from "../src/types.js";

function makeInput(overrides: Partial<ComplexityInput> = {}): ComplexityInput {
	return {
		classification: "code",
		issueTitle: "Test issue",
		issueDescription: "A test description",
		procedureName: "full-development",
		...overrides,
	};
}

describe("scoreComplexity", () => {
	it("should score orchestrator classification high", () => {
		const result = scoreComplexity(
			makeInput({ classification: "orchestrator" }),
		);
		expect(result.score).toBeGreaterThanOrEqual(80);
		expect(result.useTeam).toBe(true);
		expect(result.reasoning).toContain("orchestrator");
	});

	it("should score debugger classification moderate-high", () => {
		const result = scoreComplexity(makeInput({ classification: "debugger" }));
		expect(result.score).toBeGreaterThanOrEqual(50);
		expect(result.reasoning).toContain("debugger");
	});

	it("should score question classification as 0", () => {
		const result = scoreComplexity(makeInput({ classification: "question" }));
		expect(result.score).toBe(0);
		expect(result.useTeam).toBe(false);
	});

	it("should score short code description low", () => {
		const result = scoreComplexity(
			makeInput({
				classification: "code",
				issueDescription: "Fix the button color",
			}),
		);
		expect(result.score).toBeLessThan(60);
		expect(result.useTeam).toBe(false);
	});

	it("should score long code description with keywords high", () => {
		const longDescription =
			"We need to refactor the architecture of the authentication system. " +
			"This involves multiple files across the codebase and requires a redesign " +
			"of the integration layer. There are also security concerns that need to " +
			"be addressed as part of this migration. " +
			"x".repeat(2001);
		const result = scoreComplexity(
			makeInput({
				classification: "code",
				issueDescription: longDescription,
			}),
		);
		expect(result.score).toBeGreaterThanOrEqual(60);
		expect(result.useTeam).toBe(true);
	});

	it("should suggest team sizes matching score ranges", () => {
		// Score >= 80 -> team size 4
		const highResult = scoreComplexity(
			makeInput({ classification: "orchestrator" }),
		);
		expect(highResult.suggestedTeamSize).toBe(4);

		// Score 0 -> team size 0
		const zeroResult = scoreComplexity(
			makeInput({ classification: "question" }),
		);
		expect(zeroResult.suggestedTeamSize).toBe(0);

		// Score >= 60 but < 80 -> team size 3
		const midDescription =
			"We need to refactor the architecture and do a migration. " +
			"x".repeat(2001);
		const midResult = scoreComplexity(
			makeInput({
				classification: "code",
				issueDescription: midDescription,
			}),
		);
		expect(midResult.score).toBeGreaterThanOrEqual(60);
		expect(midResult.score).toBeLessThan(80);
		expect(midResult.suggestedTeamSize).toBe(3);
	});

	it("should set useTeam flag based on threshold", () => {
		// Below threshold
		const lowResult = scoreComplexity(
			makeInput({
				classification: "code",
				issueDescription: "Simple fix",
			}),
		);
		expect(lowResult.useTeam).toBe(false);

		// Above threshold
		const highResult = scoreComplexity(
			makeInput({ classification: "orchestrator" }),
		);
		expect(highResult.useTeam).toBe(true);

		// Custom threshold
		const customResult = scoreComplexity(
			makeInput({ classification: "debugger" }),
			40,
		);
		expect(customResult.useTeam).toBe(true);
	});
});
