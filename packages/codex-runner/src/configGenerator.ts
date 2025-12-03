/**
 * Codex CLI Configuration Generator
 *
 * Manages config.toml for the Codex CLI. This includes:
 * - MCP server configuration conversion from .mcp.json format to TOML
 * - Backup and restore of existing config.toml
 * - Session-scoped configuration management
 *
 * Reference: https://github.com/openai/codex/blob/main/docs/config.md
 */

import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// Use @iarna/toml for TOML serialization
import TOML from "@iarna/toml";
import type { McpServerConfig } from "cyrus-core";
import type { CodexMcpServerConfig } from "./types.js";

const CODEX_DIR = join(homedir(), ".codex");
const CONFIG_PATH = join(CODEX_DIR, "config.toml");
const BACKUP_PATH = join(CODEX_DIR, "config.toml.backup");

/**
 * Codex config.toml structure (partial - only what we need to set)
 */
interface CodexConfig {
	model?: string;
	model_provider?: string;
	model_reasoning_effort?: string;
	model_reasoning_summary?: string;
	approval_policy?: string;
	sandbox_mode?: string;
	mcp_servers?: Record<string, CodexMcpServerConfig>;
}

/**
 * Options for generating Codex configuration
 */
export interface CodexConfigOptions {
	model?: string;
	modelProvider?: string;
	reasoningEffort?: string;
	reasoningSummary?: string;
	approvalPolicy?: string;
	sandboxMode?: string;
	mcpServers?: Record<string, CodexMcpServerConfig>;
}

/**
 * Convert McpServerConfig (cyrus-core format) to CodexMcpServerConfig (Codex CLI format)
 *
 * Codex CLI supports two transport types in config.toml:
 * - stdio: Spawns a subprocess and communicates via stdin/stdout
 * - http: Uses Streamable HTTP for communication
 *
 * @param serverName - Name of the MCP server (for logging)
 * @param config - McpServerConfig from cyrus-core
 * @returns CodexMcpServerConfig or null if conversion not possible
 */
export function convertToCodexMcpConfig(
	serverName: string,
	config: McpServerConfig,
): CodexMcpServerConfig | null {
	const configAny = config as Record<string, unknown>;

	// Detect SDK MCP server instances (in-process servers)
	// These have methods like listTools, callTool, etc. and are not convertible
	// to Codex CLI's transport-based configuration format
	if (
		typeof configAny.listTools === "function" ||
		typeof configAny.callTool === "function" ||
		typeof configAny.name === "string"
	) {
		console.warn(
			`[CodexRunner] MCP server "${serverName}" is an SDK server instance (in-process). ` +
				`Codex CLI only supports external MCP servers with transport configurations. Skipping.`,
		);
		return null;
	}

	const codexConfig: CodexMcpServerConfig = {};

	// Determine transport type and configure accordingly
	if (configAny.command) {
		// Command-based -> stdio transport
		codexConfig.transport = "stdio";
		codexConfig.command = configAny.command as string;
		console.log(
			`[CodexRunner] MCP server "${serverName}" configured with stdio transport: ${codexConfig.command}`,
		);
	} else if (configAny.url) {
		// URL-based is not directly supported in stdio config
		// Codex uses different format for HTTP servers
		console.warn(
			`[CodexRunner] MCP server "${serverName}" uses URL-based transport. ` +
				`HTTP MCP servers require different configuration. Skipping.`,
		);
		return null;
	} else {
		// No valid transport configuration
		console.warn(
			`[CodexRunner] MCP server "${serverName}" has no valid transport configuration (need command). Skipping.`,
		);
		return null;
	}

	// Map stdio-specific fields
	if (configAny.args && Array.isArray(configAny.args)) {
		codexConfig.args = configAny.args as string[];
	}

	if (configAny.cwd && typeof configAny.cwd === "string") {
		codexConfig.cwd = configAny.cwd;
	}

	// Map environment variables
	if (
		configAny.env &&
		typeof configAny.env === "object" &&
		!Array.isArray(configAny.env)
	) {
		codexConfig.env = configAny.env as Record<string, string>;
	}

	// Map timeout settings
	if (configAny.timeout && typeof configAny.timeout === "number") {
		// Convert milliseconds to seconds
		codexConfig.tool_timeout_sec = Math.ceil(configAny.timeout / 1000);
	}

	// Enable by default
	codexConfig.enabled = true;

	// Map tool filters
	if (configAny.includeTools && Array.isArray(configAny.includeTools)) {
		codexConfig.enabled_tools = configAny.includeTools as string[];
	}

	if (configAny.excludeTools && Array.isArray(configAny.excludeTools)) {
		codexConfig.disabled_tools = configAny.excludeTools as string[];
	}

	return codexConfig;
}

/**
 * Load MCP configuration from file paths
 *
 * @param configPaths - Single path or array of paths to MCP config files
 * @returns Merged MCP server configurations
 */
export function loadMcpConfigFromPaths(
	configPaths: string | string[] | undefined,
): Record<string, McpServerConfig> {
	if (!configPaths) {
		return {};
	}

	const paths = Array.isArray(configPaths) ? configPaths : [configPaths];
	let mcpServers: Record<string, McpServerConfig> = {};

	for (const configPath of paths) {
		try {
			const mcpConfigContent = readFileSync(configPath, "utf8");
			const mcpConfig = JSON.parse(mcpConfigContent);
			const servers = mcpConfig.mcpServers || {};
			mcpServers = { ...mcpServers, ...servers };
			console.log(
				`[CodexRunner] Loaded MCP config from ${configPath}: ${Object.keys(servers).join(", ")}`,
			);
		} catch (error) {
			console.error(
				`[CodexRunner] Failed to load MCP config from ${configPath}:`,
				error,
			);
		}
	}

	return mcpServers;
}

/**
 * Auto-detect .mcp.json in working directory
 *
 * @param workingDirectory - Working directory to check
 * @returns Path to .mcp.json if valid, undefined otherwise
 */
export function autoDetectMcpConfig(
	workingDirectory?: string,
): string | undefined {
	if (!workingDirectory) {
		return undefined;
	}

	const mcpJsonPath = join(workingDirectory, ".mcp.json");
	if (existsSync(mcpJsonPath)) {
		try {
			// Validate it's valid JSON
			const content = readFileSync(mcpJsonPath, "utf8");
			JSON.parse(content);
			console.log(`[CodexRunner] Auto-detected .mcp.json at ${mcpJsonPath}`);
			return mcpJsonPath;
		} catch {
			console.warn(
				`[CodexRunner] Found .mcp.json at ${mcpJsonPath} but it's not valid JSON, skipping`,
			);
		}
	}
	return undefined;
}

/**
 * Generates config.toml content from options
 *
 * Reference: https://github.com/openai/codex/blob/main/docs/config.md
 */
function generateConfig(options: CodexConfigOptions): CodexConfig {
	const config: CodexConfig = {};

	if (options.model) {
		config.model = options.model;
	}

	if (options.modelProvider) {
		config.model_provider = options.modelProvider;
	}

	if (options.reasoningEffort) {
		config.model_reasoning_effort = options.reasoningEffort;
	}

	if (options.reasoningSummary) {
		config.model_reasoning_summary = options.reasoningSummary;
	}

	if (options.approvalPolicy) {
		config.approval_policy = options.approvalPolicy;
	}

	if (options.sandboxMode) {
		config.sandbox_mode = options.sandboxMode;
	}

	// Add MCP servers if provided
	if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
		config.mcp_servers = options.mcpServers;
		console.log(
			`[CodexRunner] Including ${Object.keys(options.mcpServers).length} MCP server(s) in config.toml: ${Object.keys(options.mcpServers).join(", ")}`,
		);
	}

	return config;
}

/**
 * Backup existing config.toml if it exists
 * Returns true if backup was created, false if no file to backup
 */
export function backupCodexConfig(): boolean {
	if (!existsSync(CONFIG_PATH)) {
		return false;
	}

	// Create backup
	copyFileSync(CONFIG_PATH, BACKUP_PATH);
	console.log(`[CodexRunner] Backed up config.toml to ${BACKUP_PATH}`);
	return true;
}

/**
 * Restore config.toml from backup
 * Returns true if restored, false if no backup exists
 */
export function restoreCodexConfig(): boolean {
	if (!existsSync(BACKUP_PATH)) {
		return false;
	}

	// Restore from backup
	copyFileSync(BACKUP_PATH, CONFIG_PATH);
	unlinkSync(BACKUP_PATH);
	console.log(`[CodexRunner] Restored config.toml from backup`);
	return true;
}

/**
 * Delete config.toml (used when no backup existed)
 */
export function deleteCodexConfig(): void {
	if (existsSync(CONFIG_PATH)) {
		unlinkSync(CONFIG_PATH);
		console.log(`[CodexRunner] Deleted temporary config.toml`);
	}
}

/**
 * Write config.toml with specified options
 * Creates ~/.codex directory if it doesn't exist
 *
 * @param options - Config options including model, sandboxMode, mcpServers, etc.
 */
export function writeCodexConfig(options: CodexConfigOptions): void {
	// Create ~/.codex directory if it doesn't exist
	if (!existsSync(CODEX_DIR)) {
		mkdirSync(CODEX_DIR, { recursive: true });
	}

	// Generate config object
	const config = generateConfig(options);

	// Serialize to TOML
	const tomlContent = TOML.stringify(config as TOML.JsonMap);
	writeFileSync(CONFIG_PATH, tomlContent, "utf-8");

	const parts: string[] = [];
	if (options.model) {
		parts.push(`model=${options.model}`);
	}
	if (options.sandboxMode) {
		parts.push(`sandbox_mode=${options.sandboxMode}`);
	}
	if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
		parts.push(`mcp_servers=[${Object.keys(options.mcpServers).join(", ")}]`);
	}
	console.log(
		`[CodexRunner] Wrote config.toml${parts.length > 0 ? ` with ${parts.join(", ")}` : ""}`,
	);
}

/**
 * Setup Codex configuration for a session
 * Returns cleanup function to call when session ends
 *
 * @param options - Config options including model, sandboxMode, mcpServers, etc.
 */
export function setupCodexConfig(options: CodexConfigOptions): () => void {
	const hadBackup = backupCodexConfig();

	// Write configuration
	writeCodexConfig(options);

	// Return cleanup function
	return () => {
		if (hadBackup) {
			restoreCodexConfig();
		} else {
			deleteCodexConfig();
		}
	};
}
