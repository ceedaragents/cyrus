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
import toml from "@iarna/toml";
import type { McpServerConfig } from "cyrus-core";
import type { CodexMcpServerConfig } from "./types.js";

const CODEX_DIR = join(homedir(), ".codex");
const CONFIG_PATH = join(CODEX_DIR, "config.toml");
const BACKUP_PATH = join(CODEX_DIR, "config.toml.backup");

/**
 * Codex config.toml structure
 */
interface CodexConfig {
	mcp_servers?: Record<string, CodexMcpServerConfig>;
}

/**
 * Options for generating Codex configuration
 */
export interface CodexConfigOptions {
	mcpServers?: Record<string, CodexMcpServerConfig>;
}

/**
 * Convert McpServerConfig (cyrus-core format) to CodexMcpServerConfig (Codex TOML format)
 *
 * Codex CLI supports two transport types:
 * - stdio: command-based (spawns subprocess)
 * - streamable_http: URL-based with optional bearer token
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

	// Determine transport type and configure accordingly
	if (configAny.command) {
		// Command-based -> stdio transport
		const codexConfig: CodexMcpServerConfig = {
			transport: "stdio",
			command: configAny.command as string,
		};

		// Map stdio-specific fields
		if (configAny.args && Array.isArray(configAny.args)) {
			codexConfig.args = configAny.args as string[];
		}

		if (configAny.cwd && typeof configAny.cwd === "string") {
			codexConfig.cwd = configAny.cwd;
		}

		// Map common fields
		if (
			configAny.env &&
			typeof configAny.env === "object" &&
			!Array.isArray(configAny.env)
		) {
			codexConfig.env = configAny.env as Record<string, string>;
		}

		// Map timeout configurations
		if (configAny.timeout && typeof configAny.timeout === "number") {
			// Convert milliseconds to seconds for Codex
			const timeoutSecs = Math.ceil(configAny.timeout / 1000);
			codexConfig.tool_timeout = { secs: timeoutSecs };
		}

		// Map tool filtering
		if (configAny.includeTools && Array.isArray(configAny.includeTools)) {
			codexConfig.enabled_tools = configAny.includeTools as string[];
		}

		if (configAny.excludeTools && Array.isArray(configAny.excludeTools)) {
			codexConfig.disabled_tools = configAny.excludeTools as string[];
		}

		// Enable by default
		codexConfig.enabled = true;

		console.log(
			`[CodexRunner] MCP server "${serverName}" configured with stdio transport: ${codexConfig.command}`,
		);

		return codexConfig;
	}

	if (configAny.url) {
		// URL-based -> streamable_http transport
		const codexConfig: CodexMcpServerConfig = {
			transport: "streamable_http",
			url: configAny.url as string,
		};

		// Map HTTP-specific fields
		if (
			configAny.headers &&
			typeof configAny.headers === "object" &&
			!Array.isArray(configAny.headers)
		) {
			codexConfig.headers = configAny.headers as Record<string, string>;
		}

		// Check for bearer token configuration
		// Look for Authorization header with Bearer token
		const headers = configAny.headers as Record<string, string> | undefined;
		if (headers?.Authorization?.startsWith("Bearer ")) {
			// Extract env var name if it looks like ${ENV_VAR_NAME}
			const authHeader = headers.Authorization;
			const envVarMatch = authHeader.match(/\$\{([^}]+)\}/);
			if (envVarMatch) {
				codexConfig.bearer_env_var = envVarMatch[1];
				// Remove Authorization header since we're using bearer_env_var
				const { Authorization: _, ...restHeaders } = headers;
				if (Object.keys(restHeaders).length > 0) {
					codexConfig.headers = restHeaders;
				} else {
					delete codexConfig.headers;
				}
			}
		}

		// Map common fields
		if (
			configAny.env &&
			typeof configAny.env === "object" &&
			!Array.isArray(configAny.env)
		) {
			codexConfig.env = configAny.env as Record<string, string>;
		}

		// Map timeout configurations
		if (configAny.timeout && typeof configAny.timeout === "number") {
			// Convert milliseconds to seconds for Codex
			const timeoutSecs = Math.ceil(configAny.timeout / 1000);
			codexConfig.tool_timeout = { secs: timeoutSecs };
		}

		// Map tool filtering
		if (configAny.includeTools && Array.isArray(configAny.includeTools)) {
			codexConfig.enabled_tools = configAny.includeTools as string[];
		}

		if (configAny.excludeTools && Array.isArray(configAny.excludeTools)) {
			codexConfig.disabled_tools = configAny.excludeTools as string[];
		}

		// Enable by default
		codexConfig.enabled = true;

		console.log(
			`[CodexRunner] MCP server "${serverName}" configured with streamable_http transport: ${codexConfig.url}`,
		);

		return codexConfig;
	}

	// No valid transport configuration
	console.warn(
		`[CodexRunner] MCP server "${serverName}" has no valid transport configuration (need command or url). Skipping.`,
	);
	return null;
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
 * Generates config.toml structure with MCP servers
 */
function generateConfig(options: CodexConfigOptions): CodexConfig {
	const config: CodexConfig = {};

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
 * @param options - Configuration options including mcpServers
 */
export function writeCodexConfig(options: CodexConfigOptions): void {
	// Create ~/.codex directory if it doesn't exist
	if (!existsSync(CODEX_DIR)) {
		mkdirSync(CODEX_DIR, { recursive: true });
	}

	// Generate and write config
	const config = generateConfig(options);
	const tomlString = toml.stringify(config as toml.JsonMap);
	writeFileSync(CONFIG_PATH, tomlString, "utf-8");

	const parts: string[] = [];
	if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
		parts.push(`mcpServers=[${Object.keys(options.mcpServers).join(", ")}]`);
	}
	console.log(
		`[CodexRunner] Wrote config.toml${parts.length > 0 ? ` with ${parts.join(", ")}` : ""}`,
	);
}

/**
 * Setup Codex configuration for a session
 * Returns cleanup function to call when session ends
 *
 * @param mcpServers - MCP server configurations to write to config.toml
 * @returns Cleanup function to restore/delete config.toml
 */
export function setupCodexConfig(
	mcpServers: Record<string, CodexMcpServerConfig>,
): () => void {
	const hadBackup = backupCodexConfig();

	// Write config
	writeCodexConfig({ mcpServers });

	// Return cleanup function
	return () => {
		if (hadBackup) {
			restoreCodexConfig();
		} else {
			deleteCodexConfig();
		}
	};
}
