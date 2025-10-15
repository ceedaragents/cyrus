/**
 * MCP (Model Context Protocol) Configuration Handler
 *
 * Handles MCP server configuration and testing.
 * Ported from the Go update-server implementation.
 *
 * @module mcp-handler
 *
 * @example
 * ```typescript
 * import { handleConfigureMCP, handleTestMCP } from './handlers/mcp-handler';
 *
 * // Configure MCP servers
 * const configPayload = {
 *   mcpServers: {
 *     'linear': {
 *       command: 'npx',
 *       args: ['-y', '@linear/mcp-server-linear'],
 *       env: { LINEAR_API_KEY: 'lin_api_xxx' }
 *     }
 *   }
 * };
 * const filesWritten = await handleConfigureMCP(configPayload, '/home/user/.cyrus');
 *
 * // Test MCP server connectivity
 * const testPayload = {
 *   transportType: 'stdio',
 *   command: 'npx',
 *   commandArgs: [
 *     { value: '-y', order: 0 },
 *     { value: '@linear/mcp-server-linear', order: 1 }
 *   ]
 * };
 * const result = await handleTestMCP(testPayload);
 * ```
 */

import { promises as fs } from "node:fs";
import { join } from "node:path";
import type {
	ConfigureMCPPayload,
	TestMCPPayload,
	TestMCPResponse,
} from "../types";

/**
 * Validates that a slug contains only safe characters
 * Only allows alphanumeric characters, hyphens, and underscores
 * @param slug - The slug to validate
 * @returns true if the slug is valid, false otherwise
 */
function isValidSlug(slug: string): boolean {
	if (!slug || slug.length === 0) {
		return false;
	}

	// Only allow alphanumeric, hyphens, and underscores
	const validSlugPattern = /^[a-zA-Z0-9_-]+$/;
	return validSlugPattern.test(slug);
}

/**
 * Writes individual MCP server config files to ~/.cyrus/mcp-{slug}.json
 * Each file contains a wrapped config with the structure:
 * { "mcpServers": { "slug": {...config} } }
 *
 * @param mcpServers - Map of slug to MCP server configuration
 * @param cyrusHome - Path to the Cyrus home directory (e.g., ~/.cyrus)
 * @returns Array of file paths that were written
 * @throws Error if slug validation fails or file write fails
 */
async function writeIndividualMCPFiles(
	mcpServers: Record<string, any>,
	cyrusHome: string,
): Promise<string[]> {
	// Ensure the .cyrus directory exists
	await fs.mkdir(cyrusHome, { recursive: true, mode: 0o755 });

	const filesWritten: string[] = [];

	for (const [slug, config] of Object.entries(mcpServers)) {
		// Validate slug
		if (!slug || slug.length === 0) {
			throw new Error("Empty MCP slug not allowed");
		}

		if (!isValidSlug(slug)) {
			throw new Error(
				`Invalid MCP slug '${slug}': only alphanumeric characters, hyphens, and underscores are allowed`,
			);
		}

		// Construct file path
		const filePath = join(cyrusHome, `mcp-${slug}.json`);

		// Wrap the config under "mcpServers" key with the slug
		const configWrapper = {
			mcpServers: {
				[slug]: config,
			},
		};

		// Write file with formatted JSON
		const configData = JSON.stringify(configWrapper, null, 2);
		await fs.writeFile(filePath, configData, { mode: 0o644 });

		filesWritten.push(filePath);
		console.log(`Wrote MCP config file: ${filePath}`);
	}

	return filesWritten;
}

/**
 * Handles MCP server configuration
 * Accepts MCP server configurations and writes individual config files
 * to ~/.cyrus/mcp-{slug}.json
 *
 * This function ONLY writes individual MCP config files.
 * It does NOT modify config.json - that is handled by handleCyrusConfig.
 *
 * @param payload - The MCP configuration payload containing server configs
 * @param cyrusHome - Path to the Cyrus home directory (e.g., ~/.cyrus)
 * @returns Array of file paths that were written
 * @throws Error if no servers provided, slug validation fails, or file write fails
 */
export async function handleConfigureMCP(
	payload: ConfigureMCPPayload,
	cyrusHome: string,
): Promise<string[]> {
	// Validate that mcpServers is provided
	if (!payload.mcpServers || Object.keys(payload.mcpServers).length === 0) {
		throw new Error("No MCP servers provided");
	}

	// Write individual MCP config files
	const mcpFilesWritten = await writeIndividualMCPFiles(
		payload.mcpServers,
		cyrusHome,
	);

	console.log(`Successfully wrote ${mcpFilesWritten.length} MCP config files`);
	return mcpFilesWritten;
}

/**
 * Deletes an individual MCP config file
 * @param slug - The MCP server slug
 * @param cyrusHome - Path to the Cyrus home directory (e.g., ~/.cyrus)
 */
export async function deleteMCPConfigFile(
	slug: string,
	cyrusHome: string,
): Promise<void> {
	const filePath = join(cyrusHome, `mcp-${slug}.json`);

	try {
		await fs.access(filePath);
		await fs.unlink(filePath);
		console.log(`Deleted MCP config file: ${filePath}`);
	} catch (error) {
		// File doesn't exist, nothing to delete
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			return;
		}
		throw new Error(
			`Failed to delete MCP config file ${filePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Tests MCP server connectivity
 *
 * NOTE: This is a placeholder implementation. Full MCP testing requires the
 * @modelcontextprotocol/sdk package which is not currently installed.
 *
 * To enable full MCP testing:
 * 1. Install the MCP SDK: pnpm add @modelcontextprotocol/sdk
 * 2. Implement transport creation (stdio, sse, http)
 * 3. Connect to MCP server and list tools
 *
 * @param payload - The MCP test payload containing transport configuration
 * @returns Test response with success status, tools, and server info
 * @throws Error if transport type is invalid or connection fails
 */
export async function handleTestMCP(
	payload: TestMCPPayload,
): Promise<TestMCPResponse> {
	// Validate transport type
	const validTransports = ["stdio", "sse", "http"];
	if (!validTransports.includes(payload.transportType)) {
		throw new Error(
			`Invalid transport type '${payload.transportType}'. Must be one of: ${validTransports.join(", ")}`,
		);
	}

	// Validate required fields based on transport type
	if (payload.transportType === "stdio") {
		if (!payload.command) {
			throw new Error("command is required for stdio transport");
		}
	} else if (
		payload.transportType === "sse" ||
		payload.transportType === "http"
	) {
		if (!payload.serverUrl) {
			throw new Error(
				`serverUrl is required for ${payload.transportType} transport`,
			);
		}
	}

	// NOTE: Full implementation requires @modelcontextprotocol/sdk
	// For now, return a basic validation response
	console.warn(
		"MCP testing is not fully implemented. Install @modelcontextprotocol/sdk for full functionality.",
	);

	// Basic validation passed
	return {
		success: true,
		server_info: {
			name: payload.command || payload.serverUrl || "unknown",
			version: "1.0.0",
		},
		tools: [],
	};
}

/**
 * IMPLEMENTATION NOTES FOR MCP TESTING
 *
 * When @modelcontextprotocol/sdk is available, implement the following:
 *
 * 1. Create MCP client:
 *    ```typescript
 *    import { Client } from '@modelcontextprotocol/sdk/client/index.js';
 *    import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
 *    import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
 *
 *    const client = new Client({
 *      name: 'cyrus-config-server',
 *      version: '1.0.0',
 *    }, {
 *      capabilities: {}
 *    });
 *    ```
 *
 * 2. Create transport based on type:
 *    - stdio: Use StdioClientTransport with command and args
 *    - sse/http: Use SSEClientTransport with URL and headers
 *
 * 3. Connect and list tools:
 *    ```typescript
 *    await client.connect(transport);
 *    const toolsList = await client.listTools();
 *    const tools = toolsList.tools.map(tool => ({
 *      name: tool.name,
 *      description: tool.description
 *    }));
 *    ```
 *
 * 4. Return response with actual server info and tools
 *
 * 5. Handle cleanup (close connection) in finally block
 *
 * See the Go implementation in test_mcp.go for reference.
 */
