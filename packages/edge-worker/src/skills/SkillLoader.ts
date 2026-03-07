import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type {
	ILogger,
	ISkillLoader,
	SkillDefinition,
	SkillRoutingConfig,
	SkillRoutingStrategy,
} from "cyrus-core";

const SKILL_FILENAME = "SKILL.md";

const VALID_STRATEGIES: Set<string> = new Set([
	"always",
	"label",
	"team",
	"repository",
	"keyword",
]);

/**
 * Loads skill definitions from SKILL.md files in a directory.
 *
 * Expected directory structure:
 * ```
 * ~/.cyrus/skills/
 * ├── google/SKILL.md
 * ├── security-review/SKILL.md
 * └── deployment/SKILL.md
 * ```
 *
 * Each SKILL.md uses YAML-like frontmatter:
 * ```
 * ---
 * name: google
 * description: Search the web
 * allowed-tools: WebSearch, WebFetch
 * routing: always
 * ---
 * # Instructions...
 * ```
 */
export class SkillLoader implements ISkillLoader {
	private logger: ILogger;

	constructor(logger: ILogger) {
		this.logger = logger;
	}

	async loadSkills(directory: string): Promise<SkillDefinition[]> {
		const skills: SkillDefinition[] = [];

		let entries: string[];
		try {
			entries = await readdir(directory);
		} catch {
			this.logger.debug(`Skills directory not found: ${directory}`);
			return [];
		}

		for (const entry of entries) {
			const skillDir = join(directory, entry);

			try {
				const stats = await stat(skillDir);
				if (!stats.isDirectory()) continue;
			} catch {
				continue;
			}

			const skillPath = join(skillDir, SKILL_FILENAME);

			try {
				const content = await readFile(skillPath, "utf-8");
				const skill = this.parseSkillFile(content, skillPath);
				if (skill) {
					skills.push(skill);
					this.logger.debug(
						`Loaded skill: ${skill.name} (strategy: ${skill.routing.strategy}) from ${skillPath}`,
					);
				}
			} catch {}
		}

		this.logger.info(`Loaded ${skills.length} skill(s) from ${directory}`);
		return skills;
	}

	/**
	 * Parse a SKILL.md file into a SkillDefinition.
	 * Handles frontmatter extraction and field parsing.
	 */
	parseSkillFile(content: string, sourcePath: string): SkillDefinition | null {
		const { frontmatter, body } = this.extractFrontmatter(content);
		if (!frontmatter) {
			this.logger.warn(`No frontmatter found in ${sourcePath}`);
			return null;
		}

		const fields = this.parseFrontmatter(frontmatter);

		const name = fields.get("name");
		if (!name) {
			this.logger.warn(`Missing 'name' in frontmatter: ${sourcePath}`);
			return null;
		}

		const description = fields.get("description") || "";

		const allowedToolsRaw = fields.get("allowed-tools");
		const allowedTools = allowedToolsRaw
			? this.parseCommaSeparated(allowedToolsRaw)
			: undefined;

		const routing = this.parseRoutingConfig(fields);

		return {
			name,
			description,
			allowedTools,
			routing,
			instructions: body.trim(),
			sourcePath,
		};
	}

	/**
	 * Extract frontmatter block and body from a SKILL.md file.
	 */
	private extractFrontmatter(content: string): {
		frontmatter: string | null;
		body: string;
	} {
		const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
		if (!match) {
			return { frontmatter: null, body: content };
		}
		return { frontmatter: match[1] || "", body: match[2] || "" };
	}

	/**
	 * Parse frontmatter into key-value pairs.
	 * Handles simple `key: value` lines.
	 */
	private parseFrontmatter(raw: string): Map<string, string> {
		const fields = new Map<string, string>();

		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;

			const colonIndex = trimmed.indexOf(":");
			if (colonIndex === -1) continue;

			const key = trimmed.slice(0, colonIndex).trim().toLowerCase();
			const value = trimmed.slice(colonIndex + 1).trim();
			if (key) {
				fields.set(key, value);
			}
		}

		return fields;
	}

	/**
	 * Parse routing configuration from frontmatter fields.
	 * Defaults to 'always' strategy if no routing is specified.
	 */
	private parseRoutingConfig(fields: Map<string, string>): SkillRoutingConfig {
		const strategyRaw = fields.get("routing") || "always";
		const strategy: SkillRoutingStrategy = VALID_STRATEGIES.has(strategyRaw)
			? (strategyRaw as SkillRoutingStrategy)
			: "always";

		const config: SkillRoutingConfig = { strategy };

		const labels = fields.get("routing-labels");
		if (labels) {
			config.labels = this.parseCommaSeparated(labels);
		}

		const teams = fields.get("routing-teams");
		if (teams) {
			config.teams = this.parseCommaSeparated(teams);
		}

		const repositories = fields.get("routing-repositories");
		if (repositories) {
			config.repositories = this.parseCommaSeparated(repositories);
		}

		const keywords = fields.get("routing-keywords");
		if (keywords) {
			config.keywords = this.parseCommaSeparated(keywords);
		}

		return config;
	}

	/**
	 * Parse a comma-separated string into trimmed, non-empty values.
	 */
	private parseCommaSeparated(value: string): string[] {
		return value
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	}
}
