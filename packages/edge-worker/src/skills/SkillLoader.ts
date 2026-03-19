/**
 * SkillLoader - Discovers, loads, and resolves skill files for the skill-based workflow system.
 *
 * Skills are loaded from three sources with priority resolution:
 * 1. Default skills (shipped with Cyrus)
 * 2. Global skills (~/.cyrus/skills/)
 * 3. Repository skills (<repo>/.claude/skills/ or <repo>/skills/)
 *
 * Repository skills override global, which override defaults (by name match).
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ILogger } from "cyrus-core";
import type { SkillDefinition } from "./types.js";

/**
 * Parse a skill markdown file into a SkillDefinition.
 *
 * The skill name is derived from the filename (e.g., "verify-and-ship.md" → "verify-and-ship").
 * The first markdown heading (# ...) is used as the description.
 */
function parseSkillFile(
	filename: string,
	content: string,
	source: SkillDefinition["source"],
): SkillDefinition {
	const name = basename(filename, ".md");

	// Extract description from first markdown heading
	const headingMatch = content.match(/^#\s+(.+)$/m);
	const description = headingMatch?.[1] ?? name;

	return {
		name,
		description,
		content,
		source,
	};
}

/**
 * Load all .md skill files from a directory.
 * Returns an empty array if the directory does not exist.
 */
async function loadSkillsFromDirectory(
	dirPath: string,
	source: SkillDefinition["source"],
	logger?: ILogger,
): Promise<SkillDefinition[]> {
	try {
		const dirStat = await stat(dirPath);
		if (!dirStat.isDirectory()) return [];
	} catch {
		// Directory doesn't exist
		return [];
	}

	const skills: SkillDefinition[] = [];
	try {
		const entries = await readdir(dirPath);
		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;

			try {
				const filePath = join(dirPath, entry);
				const content = await readFile(filePath, "utf-8");
				skills.push(parseSkillFile(entry, content, source));
			} catch (err) {
				logger?.warn(`Failed to read skill file ${entry}: ${err}`);
			}
		}
	} catch (err) {
		logger?.warn(`Failed to read skills directory ${dirPath}: ${err}`);
	}

	return skills;
}

/**
 * Resolve the path to the default skills directory (shipped with Cyrus).
 * This is relative to the edge-worker package's prompts directory.
 */
function getDefaultSkillsDir(): string {
	// __dirname equivalent for ESM — resolve relative to this file
	const thisDir = new URL(".", import.meta.url).pathname;
	return resolve(thisDir, "..", "prompts", "skills");
}

export class SkillLoader {
	private logger?: ILogger;

	constructor(logger?: ILogger) {
		this.logger = logger;
	}

	/**
	 * Load default skills shipped with Cyrus.
	 */
	async loadDefaultSkills(): Promise<SkillDefinition[]> {
		const dir = getDefaultSkillsDir();
		return loadSkillsFromDirectory(dir, "default", this.logger);
	}

	/**
	 * Load global skills from ~/.cyrus/skills/.
	 */
	async loadGlobalSkills(cyrusHome: string): Promise<SkillDefinition[]> {
		const dir = join(cyrusHome, "skills");
		return loadSkillsFromDirectory(dir, "global", this.logger);
	}

	/**
	 * Load repository-specific skills from <repo>/.claude/skills/ and <repo>/skills/.
	 */
	async loadRepositorySkills(repoPath: string): Promise<SkillDefinition[]> {
		const claudeSkillsDir = join(repoPath, ".claude", "skills");
		const rootSkillsDir = join(repoPath, "skills");

		const [claudeSkills, rootSkills] = await Promise.all([
			loadSkillsFromDirectory(claudeSkillsDir, "repository", this.logger),
			loadSkillsFromDirectory(rootSkillsDir, "repository", this.logger),
		]);

		// Merge: .claude/skills/ takes precedence over skills/ for same-name skills
		const merged = new Map<string, SkillDefinition>();
		for (const skill of rootSkills) {
			merged.set(skill.name, skill);
		}
		for (const skill of claudeSkills) {
			merged.set(skill.name, skill);
		}
		return Array.from(merged.values());
	}

	/**
	 * Resolve skills for a given set of skill names, merging from all sources.
	 *
	 * Priority: repository > global > default (higher priority overrides lower by name).
	 *
	 * @param skillNames - Names of skills to include (from the workflow template)
	 * @param repoPath - Path to the repository
	 * @param cyrusHome - Path to the Cyrus home directory (~/.cyrus)
	 * @returns Ordered array of resolved skill definitions
	 */
	async resolveSkills(
		skillNames: string[],
		repoPath: string,
		cyrusHome: string,
	): Promise<SkillDefinition[]> {
		const [defaultSkills, globalSkills, repoSkills] = await Promise.all([
			this.loadDefaultSkills(),
			this.loadGlobalSkills(cyrusHome),
			this.loadRepositorySkills(repoPath),
		]);

		// Build priority-resolved map: default → global → repository
		const skillMap = new Map<string, SkillDefinition>();

		for (const skill of defaultSkills) {
			skillMap.set(skill.name, skill);
		}
		for (const skill of globalSkills) {
			skillMap.set(skill.name, skill);
		}
		for (const skill of repoSkills) {
			skillMap.set(skill.name, skill);
		}

		// Resolve in the order specified by skillNames
		const resolved: SkillDefinition[] = [];
		for (const name of skillNames) {
			const skill = skillMap.get(name);
			if (skill) {
				resolved.push(skill);
			} else {
				this.logger?.warn(
					`Skill "${name}" not found in any source (default/global/repository)`,
				);
			}
		}

		return resolved;
	}

	/**
	 * Assemble resolved skills into a system prompt section.
	 *
	 * Each skill is wrapped in <skill> XML tags for clear delineation.
	 * The workflow guidance checklist is prepended.
	 */
	assembleSkillPrompt(
		skills: SkillDefinition[],
		workflowGuidance: string,
	): string {
		const parts: string[] = [workflowGuidance, ""];

		for (const skill of skills) {
			parts.push(`<skill name="${skill.name}">`);
			parts.push(skill.content);
			parts.push("</skill>");
			parts.push("");
		}

		return parts.join("\n").trim();
	}
}
