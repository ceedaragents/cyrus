import type { IAgentRunner } from "../agent/IAgentRunner.js";

/**
 * Configuration for creating an agent runner
 *
 * This is a flexible configuration that can be extended
 * with agent-specific options
 */
export interface IAgentRunnerConfig {
	/**
	 * Type of agent runner (e.g., 'claude', 'openai', 'gpt-engineer')
	 */
	type: string;

	/**
	 * Model to use (e.g., 'sonnet', 'haiku', 'gpt-4')
	 */
	model?: string;

	/**
	 * Fallback model if primary model is unavailable
	 */
	fallbackModel?: string;

	/**
	 * Working directory for the agent
	 */
	workingDirectory?: string;

	/**
	 * System prompt configuration
	 */
	systemPrompt?: string | ISystemPromptConfig;

	/**
	 * Append to system prompt (for preset-based prompts)
	 */
	appendSystemPrompt?: string;

	/**
	 * Allowed tools/capabilities
	 */
	allowedTools?: string[];

	/**
	 * Disallowed tools/capabilities
	 */
	disallowedTools?: string[];

	/**
	 * Allowed directories for file operations
	 */
	allowedDirectories?: string[];

	/**
	 * MCP (Model Context Protocol) server configurations
	 */
	mcpServers?: Record<string, unknown>;

	/**
	 * MCP configuration file path(s)
	 */
	mcpConfigPath?: string | string[];

	/**
	 * Hooks for lifecycle events
	 */
	hooks?: Record<string, unknown>;

	/**
	 * Maximum number of turns/iterations
	 */
	maxTurns?: number;

	/**
	 * Session ID to resume from
	 */
	resumeSessionId?: string;

	/**
	 * Workspace name (for logging/organization)
	 */
	workspaceName?: string;

	/**
	 * Cyrus home directory
	 */
	cyrusHome: string;

	/**
	 * Additional agent-specific configuration
	 * Each agent type can define its own configuration options
	 */
	[key: string]: unknown;
}

/**
 * System prompt configuration
 */
export interface ISystemPromptConfig {
	/**
	 * Type of prompt configuration
	 */
	type: "preset" | "custom";

	/**
	 * Preset name (if using preset)
	 */
	preset?: string;

	/**
	 * Custom prompt text (if using custom)
	 */
	text?: string;

	/**
	 * Additional text to append to the prompt
	 */
	append?: string;
}

/**
 * Factory for creating agent runners
 *
 * The factory pattern allows for:
 * 1. Centralized configuration
 * 2. Dependency injection
 * 3. Runtime selection of agent implementations
 * 4. Easy testing with mock factories
 *
 * Example usage:
 * ```typescript
 * const factory = new AgentRunnerFactory();
 * factory.register('claude', ClaudeAgentRunnerImpl);
 * factory.register('openai', OpenAIAgentRunnerImpl);
 *
 * const runner = await factory.create({
 *   type: 'claude',
 *   model: 'sonnet',
 *   workingDirectory: '/path/to/project'
 * });
 * ```
 */
export interface IAgentRunnerFactory {
	/**
	 * Create a new agent runner instance
	 *
	 * @param config Configuration for the agent runner
	 * @returns Promise resolving to the created agent runner
	 * @throws Error if the agent type is not supported or creation fails
	 */
	create(config: IAgentRunnerConfig): Promise<IAgentRunner>;

	/**
	 * Check if a specific agent type is supported
	 *
	 * @param type The agent type to check
	 * @returns true if supported, false otherwise
	 */
	supports(type: string): boolean;

	/**
	 * Get list of supported agent types
	 *
	 * @returns Array of supported agent type names
	 */
	getSupportedTypes?(): string[];

	/**
	 * Register a new agent type
	 *
	 * Allows dynamically adding support for new agent types
	 *
	 * @param type The agent type name
	 * @param factory Function that creates the agent runner
	 */
	register?(
		type: string,
		factory: (config: IAgentRunnerConfig) => Promise<IAgentRunner>,
	): void;

	/**
	 * Unregister an agent type
	 *
	 * @param type The agent type to remove
	 */
	unregister?(type: string): void;
}

/**
 * Type guard to check if an object implements IAgentRunnerFactory
 */
export function isAgentRunnerFactory(obj: unknown): obj is IAgentRunnerFactory {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"create" in obj &&
		"supports" in obj &&
		typeof (obj as any).create === "function" &&
		typeof (obj as any).supports === "function"
	);
}
