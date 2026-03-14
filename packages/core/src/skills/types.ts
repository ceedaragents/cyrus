/**
 * Dynamic Skills System - Type Definitions
 *
 * Defines the interfaces for loading, routing, and injecting skills into
 * agent runner configurations. Skills are loaded from SKILL.md files and
 * dynamically applied to sessions based on routing strategies.
 *
 * Designed for cross-runner compatibility (Claude, Codex, Cursor, Gemini).
 */

/**
 * Supported routing strategies for skill activation.
 *
 * - `always`: Skill is always loaded for every session
 * - `label`: Skill is loaded when issue has matching labels
 * - `team`: Skill is loaded for specific Linear teams
 * - `repository`: Skill is loaded for specific repositories
 * - `keyword`: Skill is loaded when issue content matches keywords
 */
export type SkillRoutingStrategy =
	| "always"
	| "label"
	| "team"
	| "repository"
	| "keyword";

/**
 * Routing configuration parsed from SKILL.md frontmatter.
 *
 * Uses flat frontmatter keys for simplicity:
 * - `routing`: strategy name
 * - `routing-labels`: comma-separated labels (for label strategy)
 * - `routing-teams`: comma-separated team keys (for team strategy)
 * - `routing-repositories`: comma-separated repository IDs (for repository strategy)
 * - `routing-keywords`: comma-separated keywords (for keyword strategy)
 */
export interface SkillRoutingConfig {
	/** The routing strategy to use */
	strategy: SkillRoutingStrategy;
	/** Labels to match (for 'label' strategy) */
	labels?: string[];
	/** Team keys to match (for 'team' strategy) */
	teams?: string[];
	/** Repository IDs or names to match (for 'repository' strategy) */
	repositories?: string[];
	/** Keywords to match in issue content (for 'keyword' strategy) */
	keywords?: string[];
}

/**
 * A parsed skill definition loaded from a SKILL.md file.
 */
export interface SkillDefinition {
	/** Unique skill name from frontmatter */
	name: string;
	/** Human-readable description from frontmatter */
	description: string;
	/** Tools required by this skill (from `allowed-tools` frontmatter) */
	allowedTools?: string[];
	/** Routing configuration (defaults to 'always' if not specified) */
	routing: SkillRoutingConfig;
	/** The markdown content after frontmatter (skill instructions) */
	instructions: string;
	/** Filesystem path where the skill was loaded from */
	sourcePath: string;
}

/**
 * Context provided to routing strategies for skill resolution.
 * Contains session-level information used to determine which skills to activate.
 */
export interface SkillRoutingContext {
	/** Labels attached to the issue */
	labels?: string[];
	/** Linear team key (e.g., "CYPACK") */
	teamKey?: string;
	/** Repository identifier */
	repositoryId?: string;
	/** Repository name */
	repositoryName?: string;
	/** Issue title for keyword matching */
	issueTitle?: string;
	/** Issue description for keyword matching */
	issueDescription?: string;
}

/**
 * Interface for loading skills from the filesystem.
 * Single Responsibility: only handles filesystem I/O and parsing.
 */
export interface ISkillLoader {
	/**
	 * Load all skills from a directory.
	 * Scans for SKILL.md files in immediate subdirectories.
	 *
	 * @param directory - Path to scan for skill directories
	 * @returns Array of parsed skill definitions
	 */
	loadSkills(directory: string): Promise<SkillDefinition[]>;
}

/**
 * Interface for a single routing strategy implementation.
 * Open/Closed: new strategies can be added without modifying existing ones.
 */
export interface ISkillRoutingStrategy {
	/** The strategy name this implementation handles */
	readonly strategyName: SkillRoutingStrategy;

	/**
	 * Determine if a skill should be activated for the given context.
	 *
	 * @param skill - The skill to evaluate
	 * @param context - The session context to match against
	 * @returns true if the skill should be activated
	 */
	matches(skill: SkillDefinition, context: SkillRoutingContext): boolean;
}

/**
 * Interface for resolving which skills to activate for a session.
 * Dependency Inversion: depends on ISkillRoutingStrategy abstraction.
 */
export interface ISkillRouter {
	/**
	 * Resolve which skills should be active for the given context.
	 *
	 * @param skills - All available skills
	 * @param context - The session context to match against
	 * @returns Skills that should be activated
	 */
	resolveSkills(
		skills: SkillDefinition[],
		context: SkillRoutingContext,
	): SkillDefinition[];
}

/**
 * Result of injecting skills into a runner configuration.
 */
export interface SkillInjectionResult {
	/** Skill instructions to append to the system prompt */
	appendedPrompt: string;
	/** Additional tools to add to allowedTools */
	additionalTools: string[];
	/** Names of skills that were injected */
	injectedSkillNames: string[];
}
