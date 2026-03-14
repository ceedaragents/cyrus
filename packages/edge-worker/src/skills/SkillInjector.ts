import type { SkillDefinition, SkillInjectionResult } from "cyrus-core";

/**
 * Injects resolved skills into agent runner configurations.
 *
 * Cross-runner compatible: uses appendSystemPrompt and allowedTools,
 * which are supported by all runners (Claude, Codex, Cursor, Gemini).
 *
 * Single Responsibility: only handles merging skill content into runner config.
 */
export class SkillInjector {
	/**
	 * Build the injection result from resolved skills.
	 *
	 * @param skills - Skills to inject
	 * @returns Prompt text and tools to merge into runner config
	 */
	buildInjection(skills: SkillDefinition[]): SkillInjectionResult {
		if (skills.length === 0) {
			return {
				appendedPrompt: "",
				additionalTools: [],
				injectedSkillNames: [],
			};
		}

		const promptSections: string[] = [];
		const allTools = new Set<string>();
		const skillNames: string[] = [];

		for (const skill of skills) {
			skillNames.push(skill.name);

			// Collect allowed tools
			if (skill.allowedTools) {
				for (const tool of skill.allowedTools) {
					allTools.add(tool);
				}
			}

			// Build skill prompt section
			promptSections.push(this.formatSkillPrompt(skill));
		}

		const appendedPrompt = [
			"<dynamic_skills>",
			`The following ${skills.length} skill(s) have been dynamically loaded for this session:`,
			"",
			promptSections.join("\n\n"),
			"</dynamic_skills>",
		].join("\n");

		return {
			appendedPrompt,
			additionalTools: [...allTools],
			injectedSkillNames: skillNames,
		};
	}

	/**
	 * Format a single skill as a prompt section.
	 */
	private formatSkillPrompt(skill: SkillDefinition): string {
		const parts: string[] = [];

		parts.push(`<skill name="${skill.name}">`);

		if (skill.description) {
			parts.push(`<description>${skill.description}</description>`);
		}

		if (skill.instructions) {
			parts.push(`<instructions>`);
			parts.push(skill.instructions);
			parts.push(`</instructions>`);
		}

		parts.push(`</skill>`);

		return parts.join("\n");
	}
}
