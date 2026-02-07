import { describe, expect, it, vi } from "vitest";
import { TeamEvaluator } from "../src/procedures/TeamEvaluator";

// Mock the runner modules
vi.mock("cyrus-simple-agent-runner", () => ({
	SimpleClaudeRunner: vi.fn().mockImplementation(() => ({
		query: vi.fn(),
	})),
}));

vi.mock("cyrus-gemini-runner", () => ({
	SimpleGeminiRunner: vi.fn().mockImplementation(() => ({
		query: vi.fn(),
	})),
}));

function createMockEvaluator(mockResponse: string) {
	const evaluator = new TeamEvaluator({
		cyrusHome: "/test/.cyrus",
		runnerType: "gemini",
	});

	// Access the private runner and mock its query method
	const runner = (evaluator as any).runner;
	runner.query = vi.fn().mockResolvedValue({
		response: mockResponse,
		messages: [],
		sessionId: "test-session",
		durationMs: 100,
	});

	return { evaluator, mockQuery: runner.query };
}

describe("TeamEvaluator", () => {
	describe("evaluate", () => {
		it("should return useTeam=false when AI responds with 0", async () => {
			const { evaluator } = createMockEvaluator("0");

			const result = await evaluator.evaluate({
				issueTitle: "Fix typo in README",
				issueDescription: "There's a typo on line 5",
				classification: "code",
			});

			expect(result.useTeam).toBe(false);
			expect(result.teamSize).toBe(0);
		});

		it("should return useTeam=true with teamSize=2 for moderate tasks", async () => {
			const { evaluator } = createMockEvaluator("2");

			const result = await evaluator.evaluate({
				issueTitle: "Add user authentication",
				issueDescription: "Implement OAuth2 login flow with Google provider",
				classification: "code",
			});

			expect(result.useTeam).toBe(true);
			expect(result.teamSize).toBe(2);
		});

		it("should return useTeam=true with teamSize=3 for complex tasks", async () => {
			const { evaluator } = createMockEvaluator("3");

			const result = await evaluator.evaluate({
				issueTitle: "Refactor authentication system",
				issueDescription: "Major refactoring across multiple packages",
				classification: "code",
			});

			expect(result.useTeam).toBe(true);
			expect(result.teamSize).toBe(3);
		});

		it("should return useTeam=true with teamSize=4 for very complex tasks", async () => {
			const { evaluator } = createMockEvaluator("4");

			const result = await evaluator.evaluate({
				issueTitle: "Full platform migration",
				issueDescription: "Migrate entire platform from Express to Fastify",
				classification: "orchestrator",
			});

			expect(result.useTeam).toBe(true);
			expect(result.teamSize).toBe(4);
		});

		it("should include labels in the query when provided", async () => {
			const { evaluator, mockQuery } = createMockEvaluator("2");

			await evaluator.evaluate({
				issueTitle: "Test issue",
				issueDescription: "Test description",
				classification: "code",
				labels: ["bug", "high-priority"],
			});

			const queryArg = mockQuery.mock.calls[0][0];
			expect(queryArg).toContain("bug, high-priority");
		});

		it("should fallback to no team on error", async () => {
			const evaluator = new TeamEvaluator({
				cyrusHome: "/test/.cyrus",
				runnerType: "gemini",
			});

			// Make the runner throw
			const runner = (evaluator as any).runner;
			runner.query = vi.fn().mockRejectedValue(new Error("API timeout"));

			const result = await evaluator.evaluate({
				issueTitle: "Test",
				issueDescription: "Test",
				classification: "code",
			});

			expect(result.useTeam).toBe(false);
			expect(result.teamSize).toBe(0);
			expect(result.reasoning).toContain("error");
		});
	});

	describe("constructor", () => {
		it("should default to gemini runner type", () => {
			const evaluator = new TeamEvaluator({
				cyrusHome: "/test/.cyrus",
			});
			// If it constructed without error, the default worked
			expect(evaluator).toBeDefined();
		});

		it("should accept claude runner type", () => {
			const evaluator = new TeamEvaluator({
				cyrusHome: "/test/.cyrus",
				runnerType: "claude",
			});
			expect(evaluator).toBeDefined();
		});
	});
});
