import type { SkillDefinition, SkillRoutingContext } from "cyrus-core";
import { describe, expect, it } from "vitest";
import {
	AlwaysRoutingStrategy,
	KeywordRoutingStrategy,
	LabelRoutingStrategy,
	RepositoryRoutingStrategy,
	SkillRouter,
	TeamRoutingStrategy,
} from "../../src/skills/SkillRouter.js";

function makeSkill(
	overrides: Partial<SkillDefinition> & { name: string },
): SkillDefinition {
	return {
		description: "",
		instructions: "",
		sourcePath: "/test/SKILL.md",
		routing: { strategy: "always" },
		allowedTools: undefined,
		...overrides,
	};
}

describe("SkillRouter", () => {
	describe("AlwaysRoutingStrategy", () => {
		it("always matches", () => {
			const strategy = new AlwaysRoutingStrategy();
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "always" },
			});

			expect(strategy.matches(skill, {})).toBe(true);
			expect(strategy.matches(skill, { labels: ["bug"] })).toBe(true);
		});
	});

	describe("LabelRoutingStrategy", () => {
		const strategy = new LabelRoutingStrategy();

		it("matches when issue has a matching label", () => {
			const skill = makeSkill({
				name: "security",
				routing: { strategy: "label", labels: ["security", "audit"] },
			});

			expect(strategy.matches(skill, { labels: ["security", "bug"] })).toBe(
				true,
			);
		});

		it("does not match when no labels overlap", () => {
			const skill = makeSkill({
				name: "security",
				routing: { strategy: "label", labels: ["security", "audit"] },
			});

			expect(strategy.matches(skill, { labels: ["bug", "feature"] })).toBe(
				false,
			);
		});

		it("matches case-insensitively", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "label", labels: ["Security"] },
			});

			expect(strategy.matches(skill, { labels: ["SECURITY"] })).toBe(true);
		});

		it("does not match when context has no labels", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "label", labels: ["security"] },
			});

			expect(strategy.matches(skill, {})).toBe(false);
			expect(strategy.matches(skill, { labels: [] })).toBe(false);
		});

		it("does not match when skill has no routing labels", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "label" },
			});

			expect(strategy.matches(skill, { labels: ["security"] })).toBe(false);
		});
	});

	describe("TeamRoutingStrategy", () => {
		const strategy = new TeamRoutingStrategy();

		it("matches when team key matches", () => {
			const skill = makeSkill({
				name: "team-skill",
				routing: { strategy: "team", teams: ["CYPACK", "CYHOST"] },
			});

			expect(strategy.matches(skill, { teamKey: "CYPACK" })).toBe(true);
		});

		it("matches case-insensitively", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "team", teams: ["cypack"] },
			});

			expect(strategy.matches(skill, { teamKey: "CYPACK" })).toBe(true);
		});

		it("does not match different team", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "team", teams: ["CYPACK"] },
			});

			expect(strategy.matches(skill, { teamKey: "OTHER" })).toBe(false);
		});

		it("does not match when no team in context", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "team", teams: ["CYPACK"] },
			});

			expect(strategy.matches(skill, {})).toBe(false);
		});
	});

	describe("RepositoryRoutingStrategy", () => {
		const strategy = new RepositoryRoutingStrategy();

		it("matches by repository ID", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "repository", repositories: ["repo-1"] },
			});

			expect(strategy.matches(skill, { repositoryId: "repo-1" })).toBe(true);
		});

		it("matches by repository name", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "repository", repositories: ["cyrus"] },
			});

			expect(strategy.matches(skill, { repositoryName: "cyrus" })).toBe(true);
		});

		it("matches case-insensitively", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "repository", repositories: ["Cyrus"] },
			});

			expect(strategy.matches(skill, { repositoryName: "CYRUS" })).toBe(true);
		});

		it("does not match different repository", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "repository", repositories: ["other"] },
			});

			expect(
				strategy.matches(skill, {
					repositoryId: "repo-1",
					repositoryName: "cyrus",
				}),
			).toBe(false);
		});
	});

	describe("KeywordRoutingStrategy", () => {
		const strategy = new KeywordRoutingStrategy();

		it("matches keyword in issue title", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "keyword", keywords: ["performance"] },
			});

			expect(
				strategy.matches(skill, {
					issueTitle: "Improve performance of API",
				}),
			).toBe(true);
		});

		it("matches keyword in issue description", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "keyword", keywords: ["optimization"] },
			});

			expect(
				strategy.matches(skill, {
					issueDescription: "We need to do some optimization here.",
				}),
			).toBe(true);
		});

		it("matches case-insensitively", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "keyword", keywords: ["Performance"] },
			});

			expect(
				strategy.matches(skill, {
					issueTitle: "PERFORMANCE ISSUE",
				}),
			).toBe(true);
		});

		it("does not match when no keywords found", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "keyword", keywords: ["security"] },
			});

			expect(
				strategy.matches(skill, {
					issueTitle: "Add new feature",
					issueDescription: "Build login page",
				}),
			).toBe(false);
		});

		it("does not match when no content in context", () => {
			const skill = makeSkill({
				name: "test",
				routing: { strategy: "keyword", keywords: ["test"] },
			});

			expect(strategy.matches(skill, {})).toBe(false);
		});
	});

	describe("SkillRouter (composite)", () => {
		it("resolves skills based on their routing strategy", () => {
			const router = new SkillRouter();

			const alwaysSkill = makeSkill({
				name: "always-skill",
				routing: { strategy: "always" },
			});
			const labelSkill = makeSkill({
				name: "label-skill",
				routing: { strategy: "label", labels: ["security"] },
			});
			const teamSkill = makeSkill({
				name: "team-skill",
				routing: { strategy: "team", teams: ["CYPACK"] },
			});

			const context: SkillRoutingContext = {
				labels: ["bug"],
				teamKey: "CYPACK",
			};

			const resolved = router.resolveSkills(
				[alwaysSkill, labelSkill, teamSkill],
				context,
			);

			expect(resolved.map((s) => s.name)).toEqual([
				"always-skill",
				"team-skill",
			]);
		});

		it("returns empty array when no skills match", () => {
			const router = new SkillRouter();

			const skill = makeSkill({
				name: "test",
				routing: { strategy: "label", labels: ["security"] },
			});

			const resolved = router.resolveSkills([skill], {
				labels: ["bug"],
			});

			expect(resolved).toHaveLength(0);
		});

		it("skips skills with unknown routing strategy", () => {
			const router = new SkillRouter();

			const skill = makeSkill({
				name: "test",
				routing: { strategy: "unknown" as any },
			});

			const resolved = router.resolveSkills([skill], {});

			expect(resolved).toHaveLength(0);
		});

		it("allows registering custom strategies", () => {
			const router = new SkillRouter();

			router.registerStrategy({
				strategyName: "custom" as any,
				matches: () => true,
			});

			const skill = makeSkill({
				name: "test",
				routing: { strategy: "custom" as any },
			});

			const resolved = router.resolveSkills([skill], {});

			expect(resolved).toHaveLength(1);
		});
	});
});
