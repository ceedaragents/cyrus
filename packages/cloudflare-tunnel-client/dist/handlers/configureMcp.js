import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Handle MCP server configuration
 * Writes individual MCP config files to ~/.cyrus/mcp-{slug}.json
 */
export async function handleConfigureMcp(payload, cyrusHome) {
	try {
		// Validate payload
		if (!payload.mcpServers || typeof payload.mcpServers !== "object") {
			return {
				success: false,
				error: "Invalid payload: mcpServers object is required",
			};
		}
		const serverSlugs = Object.keys(payload.mcpServers);
		if (serverSlugs.length === 0) {
			return {
				success: false,
				error: "No MCP servers provided",
			};
		}
		// Ensure the .cyrus directory exists
		if (!existsSync(cyrusHome)) {
			mkdirSync(cyrusHome, { recursive: true });
		}
		const mcpFilesWritten = [];
		// Write each MCP server configuration to its own file
		for (const slug of serverSlugs) {
			const serverConfig = payload.mcpServers[slug];
			const mcpFilePath = join(cyrusHome, `mcp-${slug}.json`);
			// Perform environment variable substitution
			const processedConfig = performEnvSubstitution(serverConfig);
			// Write the config file
			try {
				const configData = {
					mcpServers: {
						[slug]: processedConfig,
					},
				};
				writeFileSync(
					mcpFilePath,
					JSON.stringify(configData, null, 2),
					"utf-8",
				);
				mcpFilesWritten.push(mcpFilePath);
			} catch (error) {
				return {
					success: false,
					error: `Failed to write MCP config file for ${slug}`,
					details: error instanceof Error ? error.message : String(error),
				};
			}
		}
		return {
			success: true,
			message: "MCP configuration files written successfully",
			data: {
				mcpFilesWritten,
				serversConfigured: serverSlugs,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to configure MCP servers",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}
/**
 * Perform environment variable substitution on a config object
 * Replaces ${VAR_NAME} placeholders with values from the env map
 */
function performEnvSubstitution(config) {
	if (!config) return config;
	// Get environment variables from the config
	const env = config.env || {};
	// Deep clone the config to avoid mutations
	const processed = JSON.parse(JSON.stringify(config));
	// Recursively process all string values
	function processValue(value) {
		if (typeof value === "string") {
			// Replace ${VAR_NAME} with the actual value from env
			return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
				return env[varName] || match;
			});
		}
		if (Array.isArray(value)) {
			return value.map(processValue);
		}
		if (typeof value === "object" && value !== null) {
			const result = {};
			for (const key of Object.keys(value)) {
				result[key] = processValue(value[key]);
			}
			return result;
		}
		return value;
	}
	return processValue(processed);
}
//# sourceMappingURL=configureMcp.js.map
