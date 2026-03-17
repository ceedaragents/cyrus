import {
	getAllTools,
	getCoordinatorTools,
	getReadOnlyTools,
	getSafeTools,
} from "cyrus-claude-runner";
import type {
	CyrusAgentSession,
	EdgeWorkerConfig,
	ILogger,
	RepositoryConfig,
} from "cyrus-core";

import type { ProcedureAnalyzer } from "./procedures/index.js";

/** Prompt type used for label-based tool/prompt selection */
export type PromptType =
	| "debugger"
	| "builder"
	| "scoper"
	| "orchestrator"
	| "graphite-orchestrator";

/**
 * Unified tool permission resolver for both issue sessions and chat sessions.
 *
 * Provides a single source of truth for:
 * - Repository-based tool resolution (allowed/disallowed)
 * - Chat-mode read-only tool sets with MCP prefixes
 * - Workspace-level MCP tool prefixes
 * - Subroutine-level tool merging
 */
export class ToolPermissionResolver {
	private config: EdgeWorkerConfig;
	private logger: ILogger;

	constructor(config: EdgeWorkerConfig, logger: ILogger) {
		this.config = config;
		this.logger = logger;
	}

	/**
	 * Update the internal config reference (e.g. after hot-reload).
	 */
	setConfig(config: EdgeWorkerConfig): void {
		this.config = config;
	}

	/**
	 * Resolve a tool preset string to an array of tool names.
	 */
	public resolveToolPreset(preset: string | string[]): string[] {
		if (Array.isArray(preset)) {
			return preset;
		}

		switch (preset) {
			case "readOnly":
				return getReadOnlyTools();
			case "safe":
				return getSafeTools();
			case "all":
				return getAllTools();
			case "coordinator":
				return getCoordinatorTools();
			default:
				// If it's a string but not a preset, treat it as a single tool
				return [preset];
		}
	}

	/**
	 * Build allowed tools for chat sessions.
	 *
	 * Chat sessions get read-only tools plus MCP tool prefixes derived from
	 * the provided MCP config keys. This replaces the manual logic that was
	 * previously inline in ChatSessionHandler.buildRunnerConfig().
	 *
	 * @param mcpConfigKeys - MCP server names (keys from McpServerConfig record)
	 */
	public buildChatAllowedTools(mcpConfigKeys?: string[]): string[] {
		const mcpToolPermissions = (mcpConfigKeys ?? []).map(
			(server) => `mcp__${server}`,
		);

		return Array.from(
			new Set([
				...getReadOnlyTools(),
				...mcpToolPermissions,
				"Bash(git -C * pull)",
			]),
		);
	}

	/**
	 * Build allowed tools list with Linear MCP tools automatically included.
	 * Accepts a single repository or an array for multi-repo sessions.
	 * For multiple repositories, the result is the union of each repo's allowed tools
	 * (presets resolved first, then unioned).
	 * Workspace-level MCP tools are added once regardless of repo count.
	 */
	public buildAllowedTools(
		repositories: RepositoryConfig | RepositoryConfig[],
		promptType?: PromptType,
	): string[] {
		const repoArray = Array.isArray(repositories)
			? repositories
			: [repositories];

		if (repoArray.length === 0) {
			// No repos — fall back to global defaults or safe tools
			const baseTools = this.config.defaultAllowedTools || getSafeTools();
			return [...new Set([...baseTools, ...this.getWorkspaceMcpTools()])];
		}

		// For each repo, resolve its allowed tools (without MCP — those are added once at the end)
		const perRepoTools = repoArray.map((repo) =>
			this.buildAllowedToolsForRepo(repo, promptType),
		);

		// Union across all repos
		const unionTools = [...new Set(perRepoTools.flat())];

		// Workspace-level MCP tools added once regardless of repo count
		const allTools = [
			...new Set([...unionTools, ...this.getWorkspaceMcpTools()]),
		];

		const repoNames = repoArray.map((r) => r.name).join(", ");
		this.logger.debug(
			`Tool selection for [${repoNames}]: ${allTools.length} tools (union of ${repoArray.length} repo(s))`,
		);

		return allTools;
	}

	/**
	 * Get workspace-level MCP tool prefixes that should always be in allowedTools.
	 */
	public getWorkspaceMcpTools(): string[] {
		// See: https://docs.anthropic.com/en/docs/claude-code/iam#tool-specific-permission-rules
		const tools = ["mcp__linear", "mcp__cyrus-tools"];
		if (process.env.SLACK_BOT_TOKEN?.trim()) {
			tools.push("mcp__slack");
		}
		return tools;
	}

	/**
	 * Resolve allowed tools for a single repository (without workspace MCP tools).
	 */
	private buildAllowedToolsForRepo(
		repository: RepositoryConfig,
		promptType?: PromptType,
	): string[] {
		const effectivePromptType =
			promptType === "graphite-orchestrator" ? "orchestrator" : promptType;

		// Priority order:
		// 1. Repository-specific prompt type configuration
		const promptConfig = effectivePromptType
			? repository.labelPrompts?.[effectivePromptType]
			: undefined;
		const promptAllowedTools =
			promptConfig && !Array.isArray(promptConfig)
				? promptConfig.allowedTools
				: undefined;
		if (promptAllowedTools) {
			return this.resolveToolPreset(promptAllowedTools);
		}
		// 2. Global prompt type defaults
		if (
			effectivePromptType &&
			this.config.promptDefaults?.[effectivePromptType]?.allowedTools
		) {
			return this.resolveToolPreset(
				this.config.promptDefaults[effectivePromptType].allowedTools,
			);
		}
		// 3. Repository-level allowed tools
		if (repository.allowedTools) {
			return repository.allowedTools;
		}
		// 4. Global default allowed tools
		if (this.config.defaultAllowedTools) {
			return this.config.defaultAllowedTools;
		}
		// 5. Fall back to safe tools
		return getSafeTools();
	}

	/**
	 * Build disallowed tools list from repository and global config.
	 * Accepts a single repository or an array for multi-repo sessions.
	 * For multiple repositories, the result is the intersection — a tool is only
	 * disallowed if ALL repositories disallow it.
	 */
	public buildDisallowedTools(
		repositories: RepositoryConfig | RepositoryConfig[],
		promptType?: PromptType,
	): string[] {
		const repoArray = Array.isArray(repositories)
			? repositories
			: [repositories];

		if (repoArray.length === 0) {
			// No repos — fall back to global defaults
			return this.config.defaultDisallowedTools || [];
		}

		// For each repo, resolve its disallowed tools
		const perRepoTools = repoArray.map((repo) =>
			this.buildDisallowedToolsForRepo(repo, promptType),
		);

		// Intersection: only block a tool if ALL repos block it
		let intersection: string[];
		if (perRepoTools.length === 1) {
			intersection = perRepoTools[0]!;
		} else {
			const firstSet = new Set(perRepoTools[0]!);
			intersection = [...firstSet].filter((tool) =>
				perRepoTools.every((repoTools) => repoTools.includes(tool)),
			);
		}

		if (intersection.length > 0) {
			const repoNames = repoArray.map((r) => r.name).join(", ");
			this.logger.debug(
				`Disallowed tools for [${repoNames}]: ${intersection.length} tools (intersection of ${repoArray.length} repo(s))`,
			);
		}

		return intersection;
	}

	/**
	 * Resolve disallowed tools for a single repository.
	 */
	private buildDisallowedToolsForRepo(
		repository: RepositoryConfig,
		promptType?: PromptType,
	): string[] {
		const effectivePromptType =
			promptType === "graphite-orchestrator" ? "orchestrator" : promptType;

		// Priority order (same as allowedTools):
		// 1. Repository-specific prompt type configuration
		const promptConfig = effectivePromptType
			? repository.labelPrompts?.[effectivePromptType]
			: undefined;
		const promptDisallowedTools =
			promptConfig && !Array.isArray(promptConfig)
				? promptConfig.disallowedTools
				: undefined;
		if (promptDisallowedTools) {
			return promptDisallowedTools;
		}
		// 2. Global prompt type defaults
		if (
			effectivePromptType &&
			this.config.promptDefaults?.[effectivePromptType]?.disallowedTools
		) {
			return this.config.promptDefaults[effectivePromptType].disallowedTools;
		}
		// 3. Repository-level disallowed tools
		if (repository.disallowedTools) {
			return repository.disallowedTools;
		}
		// 4. Global default disallowed tools
		if (this.config.defaultDisallowedTools) {
			return this.config.defaultDisallowedTools;
		}
		// 5. No defaults for disallowedTools
		return [];
	}

	/**
	 * Merge subroutine-level disallowedTools with base disallowedTools
	 * @param session Current agent session
	 * @param baseDisallowedTools Base disallowed tools from repository/global config
	 * @param logContext Context string for logging (e.g., "EdgeWorker", "resumeClaudeSession")
	 * @param procedureAnalyzer ProcedureAnalyzer instance to resolve current subroutine
	 * @returns Merged disallowed tools list
	 */
	public mergeSubroutineDisallowedTools(
		session: CyrusAgentSession,
		baseDisallowedTools: string[],
		logContext: string,
		procedureAnalyzer: ProcedureAnalyzer,
	): string[] {
		const currentSubroutine = procedureAnalyzer.getCurrentSubroutine(session);
		if (currentSubroutine?.disallowedTools) {
			const mergedTools = [
				...new Set([
					...baseDisallowedTools,
					...currentSubroutine.disallowedTools,
				]),
			];
			this.logger.debug(
				`[${logContext}] Merged subroutine-level disallowedTools for ${currentSubroutine.name}:`,
				currentSubroutine.disallowedTools,
			);
			return mergedTools;
		}
		return baseDisallowedTools;
	}
}
