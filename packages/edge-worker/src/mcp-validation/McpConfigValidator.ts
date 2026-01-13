/**
 * MCP Configuration Validator
 *
 * Validates user-provided MCP server configurations before passing them to the Claude Agent SDK.
 * This prevents opaque SDK crashes from invalid configurations.
 *
 * Based on SDK types (from @anthropic-ai/claude-agent-sdk):
 * - McpStdioServerConfig: { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; }
 * - McpSSEServerConfig: { type: 'sse'; url: string; headers?: Record<string, string>; }
 * - McpHttpServerConfig: { type: 'http'; url: string; headers?: Record<string, string>; }
 * - McpSdkServerConfig: { type: 'sdk'; name: string; } (not serializable when contains instance)
 *
 * @see https://github.com/anthropics/claude-agent-sdk-typescript/issues/131
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Result of validating a single MCP server configuration
 */
export interface McpServerValidationResult {
	serverName: string;
	isValid: boolean;
	error?: string;
	inferredType?: "stdio" | "sse" | "http" | "sdk";
	warning?: string;
}

/**
 * Result of validating an MCP configuration file or merged config
 */
export interface McpConfigValidationResult {
	isValid: boolean;
	validServers: Record<string, unknown>;
	invalidServers: McpServerValidationResult[];
	warnings: string[];
}

/**
 * Raw MCP server config as it might appear in user's .mcp.json
 * More permissive than SDK types to catch all possible misconfigurations
 */
interface RawMcpServerConfig {
	type?: string;
	command?: string;
	args?: string[];
	env?: Record<string, unknown>;
	url?: string;
	headers?: Record<string, unknown>;
	transport?: string;
	name?: string;
	instance?: unknown;
	[key: string]: unknown;
}

/**
 * Validate a single MCP server configuration
 */
export function validateMcpServerConfig(
	serverName: string,
	config: unknown,
): McpServerValidationResult {
	// Basic type check
	if (!config || typeof config !== "object") {
		return {
			serverName,
			isValid: false,
			error: "Configuration must be an object",
		};
	}

	const rawConfig = config as RawMcpServerConfig;

	// Check for SDK type with unserializable instance
	if (rawConfig.type === "sdk") {
		if (rawConfig.instance !== undefined) {
			return {
				serverName,
				isValid: false,
				error:
					"SDK server configs with 'instance' property cannot be serialized. SDK servers must be created programmatically using createSdkMcpServer().",
				inferredType: "sdk",
			};
		}
		// SDK config without instance needs a name
		if (!rawConfig.name || typeof rawConfig.name !== "string") {
			return {
				serverName,
				isValid: false,
				error: "SDK server config requires a 'name' property of type string",
				inferredType: "sdk",
			};
		}
		return {
			serverName,
			isValid: true,
			inferredType: "sdk",
		};
	}

	// Check for URL-based servers (HTTP or SSE)
	if (rawConfig.url !== undefined) {
		// URL is present - must have explicit type
		if (typeof rawConfig.url !== "string") {
			return {
				serverName,
				isValid: false,
				error: "'url' property must be a string",
			};
		}

		// Validate URL format
		try {
			new URL(rawConfig.url);
		} catch {
			return {
				serverName,
				isValid: false,
				error: `Invalid URL format: ${rawConfig.url}`,
			};
		}

		// Check for missing type - this is the key validation from the issue
		if (rawConfig.type === undefined) {
			return {
				serverName,
				isValid: false,
				error: `URL-based MCP server requires explicit 'type' field. Add "type": "http" or "type": "sse" to your configuration.`,
			};
		}

		// Validate type value for URL-based configs
		if (rawConfig.type !== "http" && rawConfig.type !== "sse") {
			return {
				serverName,
				isValid: false,
				error: `URL-based MCP server has invalid type '${rawConfig.type}'. Must be 'http' or 'sse'.`,
			};
		}

		// Validate headers if present
		if (rawConfig.headers !== undefined) {
			if (
				typeof rawConfig.headers !== "object" ||
				rawConfig.headers === null ||
				Array.isArray(rawConfig.headers)
			) {
				return {
					serverName,
					isValid: false,
					error: "'headers' must be an object with string key-value pairs",
					inferredType: rawConfig.type as "http" | "sse",
				};
			}
			// Check all header values are strings
			for (const [key, value] of Object.entries(rawConfig.headers)) {
				if (typeof value !== "string") {
					return {
						serverName,
						isValid: false,
						error: `Header '${key}' has non-string value. All header values must be strings.`,
						inferredType: rawConfig.type as "http" | "sse",
					};
				}
			}
		}

		return {
			serverName,
			isValid: true,
			inferredType: rawConfig.type as "http" | "sse",
		};
	}

	// Check for command-based servers (stdio)
	if (rawConfig.command !== undefined) {
		if (typeof rawConfig.command !== "string") {
			return {
				serverName,
				isValid: false,
				error: "'command' property must be a string",
			};
		}

		if (rawConfig.command.trim() === "") {
			return {
				serverName,
				isValid: false,
				error: "'command' cannot be empty",
			};
		}

		// Validate type if explicitly set
		if (rawConfig.type !== undefined && rawConfig.type !== "stdio") {
			return {
				serverName,
				isValid: false,
				error: `Command-based MCP server has invalid type '${rawConfig.type}'. Must be 'stdio' or omitted.`,
				inferredType: "stdio",
			};
		}

		// Validate args if present
		if (rawConfig.args !== undefined) {
			if (!Array.isArray(rawConfig.args)) {
				return {
					serverName,
					isValid: false,
					error: "'args' must be an array of strings",
					inferredType: "stdio",
				};
			}
			for (let i = 0; i < rawConfig.args.length; i++) {
				if (typeof rawConfig.args[i] !== "string") {
					return {
						serverName,
						isValid: false,
						error: `'args[${i}]' is not a string. All args must be strings.`,
						inferredType: "stdio",
					};
				}
			}
		}

		// Validate env if present
		if (rawConfig.env !== undefined) {
			if (
				typeof rawConfig.env !== "object" ||
				rawConfig.env === null ||
				Array.isArray(rawConfig.env)
			) {
				return {
					serverName,
					isValid: false,
					error: "'env' must be an object with string key-value pairs",
					inferredType: "stdio",
				};
			}
			for (const [key, value] of Object.entries(rawConfig.env)) {
				if (typeof value !== "string") {
					return {
						serverName,
						isValid: false,
						error: `env['${key}'] has non-string value. All env values must be strings.`,
						inferredType: "stdio",
					};
				}
			}
		}

		return {
			serverName,
			isValid: true,
			inferredType: "stdio",
			// Add warning for stdio configs that explicitly set type
			...(rawConfig.type === undefined && {
				warning: 'Consider adding explicit "type": "stdio" for clarity',
			}),
		};
	}

	// No recognizable configuration pattern
	return {
		serverName,
		isValid: false,
		error:
			"MCP server config must have either 'command' (for stdio) or 'url' (for http/sse). " +
			"See https://docs.anthropic.com/en/docs/claude-code/mcp for configuration examples.",
	};
}

/**
 * Validate an entire MCP configuration object (e.g., from .mcp.json mcpServers field)
 */
export function validateMcpConfig(
	mcpServers: Record<string, unknown>,
): McpConfigValidationResult {
	const validServers: Record<string, unknown> = {};
	const invalidServers: McpServerValidationResult[] = [];
	const warnings: string[] = [];

	for (const [serverName, config] of Object.entries(mcpServers)) {
		const result = validateMcpServerConfig(serverName, config);

		if (result.isValid) {
			validServers[serverName] = config;
			if (result.warning) {
				warnings.push(`${serverName}: ${result.warning}`);
			}
		} else {
			invalidServers.push(result);
		}
	}

	return {
		isValid: invalidServers.length === 0,
		validServers,
		invalidServers,
		warnings,
	};
}

/**
 * Load and validate MCP config from a file path
 * Returns the validated config with invalid servers filtered out
 */
export function loadAndValidateMcpConfigFile(filePath: string): {
	success: boolean;
	config?: { mcpServers: Record<string, unknown> };
	validationResult?: McpConfigValidationResult;
	parseError?: string;
} {
	if (!existsSync(filePath)) {
		return {
			success: false,
			parseError: `File not found: ${filePath}`,
		};
	}

	let content: string;
	try {
		content = readFileSync(filePath, "utf8");
	} catch (error) {
		return {
			success: false,
			parseError: `Failed to read file: ${(error as Error).message}`,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		return {
			success: false,
			parseError: `Invalid JSON: ${(error as Error).message}`,
		};
	}

	if (!parsed || typeof parsed !== "object") {
		return {
			success: false,
			parseError: "MCP config file must contain a JSON object",
		};
	}

	const configObj = parsed as Record<string, unknown>;
	const mcpServers = configObj.mcpServers;

	if (mcpServers === undefined) {
		// No mcpServers field - valid but empty config
		return {
			success: true,
			config: { mcpServers: {} },
			validationResult: {
				isValid: true,
				validServers: {},
				invalidServers: [],
				warnings: [],
			},
		};
	}

	if (
		typeof mcpServers !== "object" ||
		mcpServers === null ||
		Array.isArray(mcpServers)
	) {
		return {
			success: false,
			parseError: "'mcpServers' must be an object",
		};
	}

	const validationResult = validateMcpConfig(
		mcpServers as Record<string, unknown>,
	);

	return {
		success: true,
		config: { mcpServers: validationResult.validServers },
		validationResult,
	};
}

/**
 * Load and validate MCP configs from multiple paths, merging them in order
 * Later configs override earlier ones for the same server name
 *
 * @param workingDirectory - Working directory to check for auto-detected .mcp.json
 * @param explicitPaths - Explicitly configured MCP config paths
 * @returns Merged validation result with valid servers and collected errors
 */
export function loadAndValidateMcpConfigs(
	workingDirectory?: string,
	explicitPaths?: string | string[],
): {
	validServers: Record<string, unknown>;
	allInvalidServers: McpServerValidationResult[];
	allWarnings: string[];
	parseErrors: { path: string; error: string }[];
} {
	const configPaths: string[] = [];
	const parseErrors: { path: string; error: string }[] = [];

	// Auto-detect .mcp.json in working directory
	if (workingDirectory) {
		const autoMcpPath = join(workingDirectory, ".mcp.json");
		if (existsSync(autoMcpPath)) {
			configPaths.push(autoMcpPath);
		}
	}

	// Add explicit paths
	if (explicitPaths) {
		const paths = Array.isArray(explicitPaths)
			? explicitPaths
			: [explicitPaths];
		configPaths.push(...paths);
	}

	let mergedServers: Record<string, unknown> = {};
	const allInvalidServers: McpServerValidationResult[] = [];
	const allWarnings: string[] = [];

	for (const path of configPaths) {
		const result = loadAndValidateMcpConfigFile(path);

		if (!result.success) {
			parseErrors.push({ path, error: result.parseError || "Unknown error" });
			continue;
		}

		if (result.validationResult) {
			// Merge valid servers (later paths override earlier)
			mergedServers = {
				...mergedServers,
				...result.validationResult.validServers,
			};

			// Collect invalid servers with path context
			for (const invalid of result.validationResult.invalidServers) {
				allInvalidServers.push({
					...invalid,
					error: `[${path}] ${invalid.error}`,
				});
			}

			// Collect warnings with path context
			for (const warning of result.validationResult.warnings) {
				allWarnings.push(`[${path}] ${warning}`);
			}
		}
	}

	return {
		validServers: mergedServers,
		allInvalidServers,
		allWarnings,
		parseErrors,
	};
}

/**
 * Format validation errors for display in Linear agent activity
 */
export function formatValidationErrorsForLinear(
	invalidServers: McpServerValidationResult[],
	parseErrors: { path: string; error: string }[],
): string {
	const lines: string[] = [];

	lines.push("## ⚠️ MCP Configuration Validation Errors\n");
	lines.push(
		"The following MCP server configurations are invalid and will be omitted from this session:\n",
	);

	if (parseErrors.length > 0) {
		lines.push("### File Parse Errors\n");
		for (const { path, error } of parseErrors) {
			lines.push(`- **${path}**: ${error}`);
		}
		lines.push("");
	}

	if (invalidServers.length > 0) {
		lines.push("### Invalid Server Configurations\n");
		for (const result of invalidServers) {
			lines.push(`- **${result.serverName}**: ${result.error}`);
		}
		lines.push("");
	}

	lines.push("### How to Fix\n");
	lines.push("Common issues and solutions:");
	lines.push(
		'- **Missing type field**: URL-based servers require `"type": "http"` or `"type": "sse"`',
	);
	lines.push(
		"- **Invalid URL**: Ensure URLs are properly formatted (e.g., `https://example.com/mcp`)",
	);
	lines.push(
		"- **Empty command**: Stdio servers require a non-empty `command` field",
	);
	lines.push("");
	lines.push("See: https://docs.anthropic.com/en/docs/claude-code/mcp");

	return lines.join("\n");
}
