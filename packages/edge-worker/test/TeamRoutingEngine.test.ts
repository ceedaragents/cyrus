import { describe, expect, it } from "vitest";
import type { ComplexityScore } from "../src/TeamRoutingEngine.js";
import { TeamRoutingEngine } from "../src/TeamRoutingEngine.js";

describe("TeamRoutingEngine", () => {
	const engine = new TeamRoutingEngine();

	describe("scoreComplexity", () => {
		it("returns complexity from labels when present", () => {
			expect(engine.scoreComplexity("title", "desc", ["Feature", "XL"])).toBe(
				"XL",
			);
			expect(engine.scoreComplexity("title", "desc", ["s"])).toBe("S");
			expect(engine.scoreComplexity("title", "desc", ["Bug", "M"])).toBe("M");
		});

		it("returns L when label is l (case-insensitive)", () => {
			expect(engine.scoreComplexity("title", "desc", ["l"])).toBe("L");
		});

		it("scores based on description length when no label", () => {
			expect(engine.scoreComplexity("title", "short", [])).toBe("S");
			expect(engine.scoreComplexity("title", "x".repeat(500), [])).toBe("M");
			expect(engine.scoreComplexity("title", "x".repeat(1500), [])).toBe("L");
			expect(engine.scoreComplexity("title", "x".repeat(3000), [])).toBe("XL");
		});

		it("bumps complexity for refactoring keywords", () => {
			// "short desc" is <200 chars => S, keyword "refactor" bumps to M
			expect(
				engine.scoreComplexity("Refactor the auth module", "short desc", []),
			).toBe("M");
		});

		it("bumps complexity for migration keyword", () => {
			expect(
				engine.scoreComplexity("Database migration plan", "short desc", []),
			).toBe("M");
		});

		it("bumps complexity for redesign keyword in description", () => {
			expect(
				engine.scoreComplexity("title", "We need to redesign the API", []),
			).toBe("M");
		});

		it("bumps complexity for many file references", () => {
			const desc = Array(6).fill("src/components/auth/Login.tsx").join(" ");
			// 6 file refs > 5 threshold, should bump
			const result = engine.scoreComplexity("title", desc, []);
			// desc length ~180 => S, bumped to M for file refs
			expect(["M", "L", "XL"]).toContain(result);
		});

		it("does not bump XL beyond XL", () => {
			const desc = `${"x".repeat(3000)} refactor migration overhaul`;
			expect(engine.scoreComplexity("title", desc, [])).toBe("XL");
		});

		it("can bump twice (keyword + file refs) from S to L", () => {
			const fileRefs = Array(6).fill("src/components/auth/Login.tsx").join(" ");
			const desc = `refactor ${fileRefs}`;
			const result = engine.scoreComplexity("title", desc, []);
			// S -> M (keyword) -> L (file refs)
			expect(result).toBe("L");
		});

		it("labels take priority over all heuristics", () => {
			// Long description with keywords but label says S
			const desc = `${"x".repeat(3000)} refactor migration overhaul`;
			expect(engine.scoreComplexity("title", desc, ["S"])).toBe("S");
		});
	});

	describe("evaluateRules", () => {
		const defaults = { pattern: "single", agents: ["dev"] };

		it("returns defaults when rules array is empty", () => {
			const result = engine.evaluateRules([], ["Bug"], "M", defaults);
			expect(result.pattern).toBe("single");
			expect(result.agents).toEqual(["dev"]);
			expect(result.reasoning).toContain("No routing rule matched");
		});

		it("matches first matching rule", () => {
			const rules = [
				{
					match: { labels: ["Feature"] },
					pattern: "subagents",
					agents: ["dev-fe", "dev-be"],
				},
				{
					match: { labels: ["Feature"] },
					pattern: "agent-team",
					agents: ["all"],
				},
			];
			const result = engine.evaluateRules(rules, ["Feature"], "M", defaults);
			expect(result.pattern).toBe("subagents");
			expect(result.agents).toEqual(["dev-fe", "dev-be"]);
		});

		it("matches by labels (case-insensitive)", () => {
			const rules = [
				{
					match: { labels: ["TEAM", "feature"] },
					pattern: "agent-team",
				},
			];
			const result = engine.evaluateRules(
				rules,
				["team", "Feature", "UI"],
				"S",
				defaults,
			);
			expect(result.pattern).toBe("agent-team");
		});

		it("does not match when not all labels present", () => {
			const rules = [
				{
					match: { labels: ["Team", "Backend"] },
					pattern: "subagents",
				},
			];
			const result = engine.evaluateRules(rules, ["Team"], "M", defaults);
			expect(result.pattern).toBe("single"); // falls back to default
		});

		it("matches by complexity", () => {
			const rules = [
				{
					match: { complexity: ["L", "XL"] as ComplexityScore[] },
					pattern: "agent-team",
				},
			];
			const result = engine.evaluateRules(rules, [], "L", defaults);
			expect(result.pattern).toBe("agent-team");
		});

		it("does not match when complexity is not in the list", () => {
			const rules = [
				{
					match: { complexity: ["L", "XL"] as ComplexityScore[] },
					pattern: "agent-team",
				},
			];
			const result = engine.evaluateRules(rules, [], "S", defaults);
			expect(result.pattern).toBe("single");
		});

		it("requires both labels AND complexity when both specified", () => {
			const rules = [
				{
					match: {
						labels: ["Feature"],
						complexity: ["XL"] as ComplexityScore[],
					},
					pattern: "agent-team",
				},
			];
			// Has label but wrong complexity
			expect(
				engine.evaluateRules(rules, ["Feature"], "M", defaults).pattern,
			).toBe("single");
			// Has complexity but wrong label
			expect(engine.evaluateRules(rules, ["Bug"], "XL", defaults).pattern).toBe(
				"single",
			);
			// Has both
			expect(
				engine.evaluateRules(rules, ["Feature"], "XL", defaults).pattern,
			).toBe("agent-team");
		});

		it("catch-all rule with empty match matches anything", () => {
			const rules = [
				{
					match: {},
					pattern: "subagents",
					description: "catch-all",
				},
			];
			const result = engine.evaluateRules(rules, [], "S", defaults);
			expect(result.pattern).toBe("subagents");
		});

		it("uses default agents when rule has no agents", () => {
			const rules = [{ match: { labels: ["Team"] }, pattern: "subagents" }];
			const result = engine.evaluateRules(rules, ["Team"], "M", defaults);
			expect(result.agents).toEqual(["dev"]); // from defaults
		});

		it("includes rule description in reasoning when available", () => {
			const rules = [
				{
					match: { labels: ["Team"] },
					pattern: "subagents",
					description: "Team collaboration rule",
				},
			];
			const result = engine.evaluateRules(rules, ["Team"], "M", defaults);
			expect(result.reasoning).toContain("Team collaboration rule");
		});

		it("includes match criteria in reasoning when no description", () => {
			const rules = [
				{
					match: { labels: ["Team"] },
					pattern: "subagents",
				},
			];
			const result = engine.evaluateRules(rules, ["Team"], "M", defaults);
			expect(result.reasoning).toContain("Team");
		});

		it("returns empty modelByRole", () => {
			const result = engine.evaluateRules([], [], "S", defaults);
			expect(result.modelByRole).toEqual({});
		});

		it("skips non-matching rules and matches later rule", () => {
			const rules = [
				{
					match: { labels: ["Backend"] },
					pattern: "subagents",
					agents: ["be-1", "be-2"],
				},
				{
					match: { labels: ["Frontend"] },
					pattern: "agent-team",
					agents: ["fe-1", "fe-2"],
				},
			];
			const result = engine.evaluateRules(rules, ["Frontend"], "M", defaults);
			expect(result.pattern).toBe("agent-team");
			expect(result.agents).toEqual(["fe-1", "fe-2"]);
		});
	});
});
