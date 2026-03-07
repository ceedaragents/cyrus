import type { SkillDefinition } from "cyrus-core";
import { describe, expect, it } from "vitest";
import { SkillInjector } from "../../src/skills/SkillInjector.js";

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

describe("SkillInjector", () => {
	const injector = new SkillInjector();

	it("returns empty result for no skills", () => {
		const result = injector.buildInjection([]);

		expect(result.appendedPrompt).toBe("");
		expect(result.additionalTools).toHaveLength(0);
		expect(result.injectedSkillNames).toHaveLength(0);
	});

	it("builds prompt section for a single skill", () => {
		const skill = makeSkill({
			name: "google",
			description: "Search the web.",
			instructions: "Use WebSearch to find results.",
		});

		const result = injector.buildInjection([skill]);

		expect(result.injectedSkillNames).toEqual(["google"]);
		expect(result.appendedPrompt).toContain("<dynamic_skills>");
		expect(result.appendedPrompt).toContain("</dynamic_skills>");
		expect(result.appendedPrompt).toContain('<skill name="google">');
		expect(result.appendedPrompt).toContain(
			"<description>Search the web.</description>",
		);
		expect(result.appendedPrompt).toContain("Use WebSearch to find results.");
	});

	it("collects allowed tools from multiple skills", () => {
		const skill1 = makeSkill({
			name: "google",
			allowedTools: ["WebSearch", "WebFetch"],
		});
		const skill2 = makeSkill({
			name: "code-review",
			allowedTools: ["Read", "Grep", "WebFetch"], // WebFetch duplicated
		});

		const result = injector.buildInjection([skill1, skill2]);

		expect(result.additionalTools).toContain("WebSearch");
		expect(result.additionalTools).toContain("WebFetch");
		expect(result.additionalTools).toContain("Read");
		expect(result.additionalTools).toContain("Grep");
		// No duplicates
		expect(result.additionalTools.filter((t) => t === "WebFetch")).toHaveLength(
			1,
		);
	});

	it("handles skills without allowed tools", () => {
		const skill = makeSkill({
			name: "summary",
			instructions: "Summarize the issue.",
		});

		const result = injector.buildInjection([skill]);

		expect(result.additionalTools).toHaveLength(0);
	});

	it("handles skills without instructions", () => {
		const skill = makeSkill({
			name: "minimal",
			description: "Minimal skill.",
			instructions: "",
		});

		const result = injector.buildInjection([skill]);

		expect(result.appendedPrompt).toContain('<skill name="minimal">');
		expect(result.appendedPrompt).toContain(
			"<description>Minimal skill.</description>",
		);
		expect(result.appendedPrompt).not.toContain("<instructions>");
	});

	it("builds injection for multiple skills", () => {
		const skills = [
			makeSkill({
				name: "skill-a",
				description: "Skill A",
				instructions: "Do A.",
				allowedTools: ["ToolA"],
			}),
			makeSkill({
				name: "skill-b",
				description: "Skill B",
				instructions: "Do B.",
				allowedTools: ["ToolB"],
			}),
		];

		const result = injector.buildInjection(skills);

		expect(result.injectedSkillNames).toEqual(["skill-a", "skill-b"]);
		expect(result.additionalTools).toContain("ToolA");
		expect(result.additionalTools).toContain("ToolB");
		expect(result.appendedPrompt).toContain("2 skill(s)");
		expect(result.appendedPrompt).toContain('<skill name="skill-a">');
		expect(result.appendedPrompt).toContain('<skill name="skill-b">');
	});
});
