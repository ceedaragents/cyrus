/**
 * OpenCode Configuration Builder
 *
 * Builds OpenCode SDK `Config` from Cyrus `AgentRunnerConfig`.
 * Maps Cyrus settings to OpenCode's configuration format.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "cyrus-core";
import type { OpenCodeRunnerConfig } from "./types.js";

// ============================================================================
// OpenCode SDK Types (from @opencode-ai/sdk/dist/gen/types.gen.d.ts)
// Defined inline to avoid import path issues
// ============================================================================

/**
 * Permission level for actions.
 */
type PermissionLevel = "ask" | "allow" | "deny";

/**
 * OpenCode agent configuration.
 * Reference: types.gen.d.ts lines 819-861
 */
export interface OpenCodeAgentConfig {
	model?: string;
	temperature?: number;
	top_p?: number;
	prompt?: string;
	tools?: Record<string, boolean>;
	disable?: boolean;
	description?: string;
	mode?: "subagent" | "primary" | "all";
	color?: string;
	maxSteps?: number;
	permission?: {
		edit?: PermissionLevel;
		bash?: PermissionLevel | Record<string, PermissionLevel>;
		webfetch?: PermissionLevel;
		doom_loop?: PermissionLevel;
		external_directory?: PermissionLevel;
	};
	[key: string]: unknown;
}

/**
 * MCP local server configuration (stdio transport).
 * Reference: types.gen.d.ts lines 930-953
 */
export interface OpenCodeMcpLocalConfig {
	type: "local";
	command: string[];
	environment?: Record<string, string>;
	enabled?: boolean;
	timeout?: number;
}

/**
 * MCP remote server configuration (HTTP/SSE transport).
 * Reference: types.gen.d.ts lines 968-995
 */
export interface OpenCodeMcpRemoteConfig {
	type: "remote";
	url: string;
	enabled?: boolean;
	headers?: Record<string, string>;
	oauth?:
		| {
				clientId?: string;
				clientSecret?: string;
				scope?: string;
		  }
		| false;
	timeout?: number;
}

/**
 * OpenCode configuration object.
 * Reference: types.gen.d.ts lines 1000-1194
 */
export interface OpenCodeConfig {
	$schema?: string;
	theme?: string;
	model?: string;
	small_model?: string;
	username?: string;
	agent?: {
		plan?: OpenCodeAgentConfig;
		build?: OpenCodeAgentConfig;
		general?: OpenCodeAgentConfig;
		explore?: OpenCodeAgentConfig;
		[key: string]: OpenCodeAgentConfig | undefined;
	};
	provider?: Record<string, unknown>;
	mcp?: Record<string, OpenCodeMcpLocalConfig | OpenCodeMcpRemoteConfig>;
	permission?: {
		edit?: PermissionLevel;
		bash?: PermissionLevel | Record<string, PermissionLevel>;
		webfetch?: PermissionLevel;
		doom_loop?: PermissionLevel;
		external_directory?: PermissionLevel;
	};
	tools?: Record<string, boolean>;
	instructions?: string[];
	disabled_providers?: string[];
	enabled_providers?: string[];
	autoupdate?: boolean | "notify";
	share?: "manual" | "auto" | "disabled";
	snapshot?: boolean;
	experimental?: {
		chatMaxRetries?: number;
		batch_tool?: boolean;
		openTelemetry?: boolean;
		primary_tools?: string[];
		[key: string]: unknown;
	};
}

// ============================================================================
// Types
// ============================================================================

/**
 * Result of building an OpenCode configuration.
 * Contains the config object and a cleanup function for temp files.
 */
export interface OpenCodeConfigBuildResult {
	/** The built OpenCode configuration */
	config: OpenCodeConfig;
	/** Path to the system prompt file (if created) */
	systemPromptPath: string | null;
	/** Cleanup function to remove temporary files */
	cleanup: () => Promise<void>;
}

/**
 * Options for building OpenCode configuration.
 */
export interface OpenCodeConfigBuilderOptions {
	/** The Cyrus runner configuration */
	runnerConfig: OpenCodeRunnerConfig;
	/** System prompt content to use */
	systemPrompt?: string;
	/** Workspace name for unique file paths */
	workspaceName: string;
}

// ============================================================================
// OpenCodeConfigBuilder Class
// ============================================================================

/**
 * Builds OpenCode SDK configuration from Cyrus configuration.
 *
 * Handles:
 * - Model name mapping (Cyrus aliases to OpenCode format)
 * - System prompt via temp file with `{file:./path}` syntax
 * - MCP server conversion (stdio → local, HTTP → remote)
 * - Autonomous mode permissions (allow edit/bash/webfetch)
 * - maxTurns → maxSteps mapping
 *
 * @example
 * ```typescript
 * const builder = new OpenCodeConfigBuilder();
 * const { config, cleanup } = await builder.build({
 *   runnerConfig: myConfig,
 *   systemPrompt: "You are a helpful assistant",
 *   workspaceName: "CYPACK-123"
 * });
 *
 * // Use config...
 *
 * // Cleanup temp files when done
 * await cleanup();
 * ```
 */
export class OpenCodeConfigBuilder {
	/**
	 * Base directory for storing OpenCode-related temp files
	 */
	private static OPENCODE_PROMPTS_DIR = "opencode-system-prompts";

	/**
	 * Model name mapping from Cyrus aliases to OpenCode format.
	 * OpenCode uses "provider/model" format.
	 */
	private static MODEL_MAPPINGS: Record<string, string> = {
		// Claude models (Cyrus aliases)
		opus: "anthropic/claude-opus-4-20250514",
		sonnet: "anthropic/claude-sonnet-4-20250514",
		haiku: "anthropic/claude-haiku-3-5-20241022",
		"opus-4": "anthropic/claude-opus-4-20250514",
		"sonnet-4": "anthropic/claude-sonnet-4-20250514",
		"sonnet-3.5": "anthropic/claude-3-5-sonnet-20241022",
		"haiku-3.5": "anthropic/claude-haiku-3-5-20241022",

		// OpenAI models
		"gpt-4": "openai/gpt-4",
		"gpt-4o": "openai/gpt-4o",
		"gpt-4-turbo": "openai/gpt-4-turbo",

		// Gemini models
		"gemini-pro": "google/gemini-pro",
		"gemini-2.0-flash": "google/gemini-2.0-flash-exp",
		"gemini-2.5-pro": "google/gemini-2.5-pro-preview-05-06",
	};

	/**
	 * Build OpenCode configuration from Cyrus configuration.
	 *
	 * @param options - Build options containing runner config and system prompt
	 * @returns Built configuration with cleanup function
	 */
	async build(
		options: OpenCodeConfigBuilderOptions,
	): Promise<OpenCodeConfigBuildResult> {
		const { runnerConfig, systemPrompt, workspaceName } = options;

		let systemPromptPath: string | null = null;
		const filesToCleanup: string[] = [];

		// Handle system prompt - write to temp file if provided
		if (systemPrompt) {
			systemPromptPath = await this.writeSystemPromptFile(
				runnerConfig.cyrusHome,
				workspaceName,
				systemPrompt,
			);
			filesToCleanup.push(systemPromptPath);
		}

		// Build the OpenCode config
		const config: OpenCodeConfig = {
			// Model configuration
			model: this.mapModelName(runnerConfig.model),

			// Agent configuration with maxSteps and permissions
			agent: this.buildAgentConfig(runnerConfig, systemPromptPath),

			// Top-level permission overrides for autonomous mode
			permission: this.buildPermissions(runnerConfig),

			// MCP server configuration
			mcp: this.buildMcpConfig(runnerConfig),

			// Tool configuration
			tools: this.buildToolsConfig(runnerConfig),
		};

		// Create cleanup function
		const cleanup = async () => {
			for (const filePath of filesToCleanup) {
				await this.cleanupFile(filePath);
			}
		};

		return {
			config,
			systemPromptPath,
			cleanup,
		};
	}

	/**
	 * Map Cyrus model name/alias to OpenCode format.
	 *
	 * @param model - Cyrus model name or alias
	 * @returns OpenCode model name in "provider/model" format
	 */
	mapModelName(model?: string): string | undefined {
		if (!model) return undefined;

		// Check if it's a known alias
		const lowerModel = model.toLowerCase();
		if (OpenCodeConfigBuilder.MODEL_MAPPINGS[lowerModel]) {
			return OpenCodeConfigBuilder.MODEL_MAPPINGS[lowerModel];
		}

		// If already in provider/model format, return as-is
		if (model.includes("/")) {
			return model;
		}

		// Default: assume it's an Anthropic model alias
		// Try to match partial names
		if (model.includes("opus")) {
			return OpenCodeConfigBuilder.MODEL_MAPPINGS.opus;
		}
		if (model.includes("sonnet")) {
			return OpenCodeConfigBuilder.MODEL_MAPPINGS.sonnet;
		}
		if (model.includes("haiku")) {
			return OpenCodeConfigBuilder.MODEL_MAPPINGS.haiku;
		}

		// Return as-is if no mapping found
		return model;
	}

	/**
	 * Build agent configuration with maxSteps and prompt.
	 *
	 * @param runnerConfig - Cyrus runner configuration
	 * @param systemPromptPath - Path to system prompt file (if any)
	 * @returns Agent configuration object
	 */
	private buildAgentConfig(
		runnerConfig: OpenCodeRunnerConfig,
		systemPromptPath: string | null,
	): OpenCodeConfig["agent"] {
		const buildConfig: OpenCodeAgentConfig = {};

		// Map maxTurns → maxSteps
		if (runnerConfig.maxTurns !== undefined) {
			buildConfig.maxSteps = runnerConfig.maxTurns;
		}

		// Set system prompt via file reference syntax: {file:./path}
		if (systemPromptPath) {
			buildConfig.prompt = `{file:${systemPromptPath}}`;
		}

		// Build tool permissions based on allowed/disallowed tools
		if (runnerConfig.allowedTools || runnerConfig.disallowedTools) {
			buildConfig.tools = this.buildToolsConfig(runnerConfig);
		}

		// Set autonomous mode permissions at agent level
		buildConfig.permission = {
			edit: "allow",
			bash: "allow",
			webfetch: "allow",
			doom_loop: "allow",
		};

		return {
			build: buildConfig,
		};
	}

	/**
	 * Build top-level permission configuration for autonomous mode.
	 *
	 * Sets all permissions to "allow" for unattended operation.
	 *
	 * @param runnerConfig - Cyrus runner configuration
	 * @returns Permission configuration
	 */
	private buildPermissions(
		_runnerConfig: OpenCodeRunnerConfig,
	): OpenCodeConfig["permission"] {
		// For autonomous/headless operation, allow all permissions
		// Note: runnerConfig is unused but kept for future extensibility
		return {
			edit: "allow",
			bash: "allow",
			webfetch: "allow",
			doom_loop: "allow",
			external_directory: "allow",
		};
	}

	/**
	 * Build tool enablement configuration from allowed/disallowed tools.
	 *
	 * @param runnerConfig - Cyrus runner configuration
	 * @returns Tools configuration object
	 */
	private buildToolsConfig(
		runnerConfig: OpenCodeRunnerConfig,
	): Record<string, boolean> | undefined {
		const tools: Record<string, boolean> = {};

		// Process disallowed tools first (set to false)
		if (runnerConfig.disallowedTools) {
			for (const tool of runnerConfig.disallowedTools) {
				// Strip glob patterns like "(**)" for tool name matching
				const toolName = tool.replace(/\(\*\*\)$/, "");
				tools[toolName] = false;
			}
		}

		// Process allowed tools (set to true)
		// This overrides any disallowed if there's overlap
		if (runnerConfig.allowedTools) {
			for (const tool of runnerConfig.allowedTools) {
				const toolName = tool.replace(/\(\*\*\)$/, "");
				tools[toolName] = true;
			}
		}

		return Object.keys(tools).length > 0 ? tools : undefined;
	}

	/**
	 * Build MCP server configuration from Cyrus config.
	 *
	 * Converts Cyrus/Claude SDK MCP format to OpenCode format:
	 * - stdio (command-based) → McpLocalConfig { type: "local", command: [...] }
	 * - HTTP → McpRemoteConfig { type: "remote", url: "..." }
	 *
	 * Also auto-detects .mcp.json in the working directory (like ClaudeRunner does).
	 *
	 * @param runnerConfig - Cyrus runner configuration
	 * @returns MCP configuration for OpenCode
	 */
	private buildMcpConfig(
		runnerConfig: OpenCodeRunnerConfig,
	):
		| Record<string, OpenCodeMcpLocalConfig | OpenCodeMcpRemoteConfig>
		| undefined {
		const mcpConfig: Record<
			string,
			OpenCodeMcpLocalConfig | OpenCodeMcpRemoteConfig
		> = {};

		// Auto-detect .mcp.json in working directory (base config)
		if (runnerConfig.workingDirectory) {
			const autoMcpPath = join(runnerConfig.workingDirectory, ".mcp.json");
			if (existsSync(autoMcpPath)) {
				try {
					const mcpConfigContent = readFileSync(autoMcpPath, "utf8");
					const parsedConfig = JSON.parse(mcpConfigContent);
					const servers = parsedConfig.mcpServers || {};

					for (const [serverName, serverConfig] of Object.entries(servers)) {
						const converted = this.convertMcpServerConfig(
							serverName,
							serverConfig as McpServerConfig,
						);
						if (converted) {
							mcpConfig[serverName] = converted;
						}
					}

					if (Object.keys(servers).length > 0) {
						console.log(
							`[OpenCodeConfigBuilder] Auto-detected MCP config at ${autoMcpPath}: ${Object.keys(servers).join(", ")}`,
						);
					}
				} catch (_error) {
					// Silently skip invalid .mcp.json files (could be test fixtures, etc.)
					console.log(
						`[OpenCodeConfigBuilder] Skipping invalid .mcp.json at ${autoMcpPath}`,
					);
				}
			}
		}

		// Merge inline config (overrides file config for same server names)
		if (runnerConfig.mcpConfig) {
			for (const [serverName, serverConfig] of Object.entries(
				runnerConfig.mcpConfig,
			)) {
				const converted = this.convertMcpServerConfig(serverName, serverConfig);
				if (converted) {
					mcpConfig[serverName] = converted;
				}
			}
		}

		return Object.keys(mcpConfig).length > 0 ? mcpConfig : undefined;
	}

	/**
	 * Convert a single MCP server config from Cyrus/Claude format to OpenCode format.
	 *
	 * @param serverName - Name of the MCP server
	 * @param config - Cyrus/Claude MCP server configuration
	 * @returns OpenCode MCP server configuration
	 */
	convertMcpServerConfig(
		serverName: string,
		config: McpServerConfig,
	): OpenCodeMcpLocalConfig | OpenCodeMcpRemoteConfig | null {
		const configAny = config as Record<string, unknown>;

		// Detect SDK MCP server instances (in-process servers)
		// These have methods and are not convertible to external config
		if (
			typeof configAny.listTools === "function" ||
			typeof configAny.callTool === "function" ||
			typeof configAny.name === "string"
		) {
			console.warn(
				`[OpenCodeConfigBuilder] MCP server "${serverName}" is an SDK server instance (in-process). ` +
					`OpenCode only supports external MCP servers with transport configurations. Skipping.`,
			);
			return null;
		}

		// Determine transport type
		if (configAny.type === "http" && configAny.url) {
			// HTTP transport → OpenCodeMcpRemoteConfig
			const remoteConfig: OpenCodeMcpRemoteConfig = {
				type: "remote",
				url: configAny.url as string,
			};

			// Map headers
			if (
				configAny.headers &&
				typeof configAny.headers === "object" &&
				!Array.isArray(configAny.headers)
			) {
				remoteConfig.headers = configAny.headers as Record<string, string>;
			}

			// Map timeout
			if (configAny.timeout && typeof configAny.timeout === "number") {
				remoteConfig.timeout = configAny.timeout;
			}

			console.log(
				`[OpenCodeConfigBuilder] MCP server "${serverName}" configured as remote: ${remoteConfig.url}`,
			);
			return remoteConfig;
		}

		if (configAny.url && !configAny.command) {
			// URL without command → treat as remote (SSE)
			const remoteConfig: OpenCodeMcpRemoteConfig = {
				type: "remote",
				url: configAny.url as string,
			};

			if (
				configAny.headers &&
				typeof configAny.headers === "object" &&
				!Array.isArray(configAny.headers)
			) {
				remoteConfig.headers = configAny.headers as Record<string, string>;
			}

			console.log(
				`[OpenCodeConfigBuilder] MCP server "${serverName}" configured as remote (SSE): ${remoteConfig.url}`,
			);
			return remoteConfig;
		}

		if (configAny.command) {
			// Command-based → OpenCodeMcpLocalConfig (stdio)
			const localConfig: OpenCodeMcpLocalConfig = {
				type: "local",
				command: this.buildCommandArray(configAny),
			};

			// Map environment variables
			if (
				configAny.env &&
				typeof configAny.env === "object" &&
				!Array.isArray(configAny.env)
			) {
				localConfig.environment = configAny.env as Record<string, string>;
			}

			// Map timeout
			if (configAny.timeout && typeof configAny.timeout === "number") {
				localConfig.timeout = configAny.timeout;
			}

			console.log(
				`[OpenCodeConfigBuilder] MCP server "${serverName}" configured as local: ${localConfig.command.join(" ")}`,
			);
			return localConfig;
		}

		// No valid transport configuration
		console.warn(
			`[OpenCodeConfigBuilder] MCP server "${serverName}" has no valid transport configuration. Skipping.`,
		);
		return null;
	}

	/**
	 * Build command array from MCP config.
	 * OpenCode expects command as array: ["command", "arg1", "arg2"]
	 *
	 * @param config - MCP server configuration
	 * @returns Command array
	 */
	private buildCommandArray(config: Record<string, unknown>): string[] {
		const command = config.command as string;
		const args = (config.args as string[]) || [];

		// OpenCode expects full command array
		return [command, ...args];
	}

	/**
	 * Write system prompt to a temporary file.
	 *
	 * Creates workspace-specific files to support parallel execution.
	 *
	 * @param cyrusHome - Cyrus home directory
	 * @param workspaceName - Workspace/issue identifier
	 * @param systemPrompt - System prompt content
	 * @returns Path to the created file
	 */
	private async writeSystemPromptFile(
		cyrusHome: string,
		workspaceName: string,
		systemPrompt: string,
	): Promise<string> {
		// Resolve cyrusHome if it contains tilde
		const resolvedHome = this.resolveTildePath(cyrusHome);

		// Create directory path
		const promptsDir = join(
			resolvedHome,
			OpenCodeConfigBuilder.OPENCODE_PROMPTS_DIR,
		);

		// Ensure directory exists
		await mkdir(promptsDir, { recursive: true });

		// Create file path with workspace name
		const promptPath = join(promptsDir, `${workspaceName}.md`);

		// Write system prompt
		await writeFile(promptPath, systemPrompt, "utf8");

		console.log(
			`[OpenCodeConfigBuilder] Wrote system prompt to: ${promptPath}`,
		);

		return promptPath;
	}

	/**
	 * Clean up a temporary file.
	 *
	 * @param filePath - Path to file to delete
	 */
	private async cleanupFile(filePath: string): Promise<void> {
		try {
			await unlink(filePath);
			console.log(`[OpenCodeConfigBuilder] Cleaned up: ${filePath}`);
		} catch (error) {
			// File may already be deleted
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				console.warn(
					`[OpenCodeConfigBuilder] Failed to cleanup ${filePath}:`,
					error,
				);
			}
		}
	}

	/**
	 * Resolve tilde (~) in paths to absolute home directory path.
	 *
	 * @param path - Path that may contain tilde
	 * @returns Resolved absolute path
	 */
	private resolveTildePath(path: string): string {
		if (path.startsWith("~/")) {
			return join(homedir(), path.slice(2));
		}
		return path;
	}

	/**
	 * Serialize config to JSON string for OPENCODE_CONFIG_CONTENT env var.
	 *
	 * @param config - OpenCode configuration
	 * @returns JSON string
	 */
	static toConfigContent(config: OpenCodeConfig): string {
		return JSON.stringify(config);
	}
}
