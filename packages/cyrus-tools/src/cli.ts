#!/usr/bin/env node
/**
 * Cyrus Tools MCP Server CLI
 *
 * This CLI starts a standard MCP server over stdio transport, making it
 * compatible with any MCP client including Claude Code, Gemini CLI, and others.
 *
 * Usage:
 *   LINEAR_API_TOKEN=your_token cyrus-tools
 *
 * Or configure in your MCP client settings:
 *
 * For Gemini CLI (settings.json):
 *   {
 *     "mcpServers": {
 *       "cyrus-tools": {
 *         "command": "npx",
 *         "args": ["cyrus-tools"],
 *         "env": {
 *           "LINEAR_API_TOKEN": "$LINEAR_API_TOKEN"
 *         }
 *       }
 *     }
 *   }
 *
 * For Claude Desktop (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "cyrus-tools": {
 *         "command": "npx",
 *         "args": ["cyrus-tools"],
 *         "env": {
 *           "LINEAR_API_TOKEN": "your_token"
 *         }
 *       }
 *     }
 *   }
 */

import { startStdioServer } from "./stdio-server.js";

const linearApiToken = process.env.LINEAR_API_TOKEN;

if (!linearApiToken) {
	console.error("Error: LINEAR_API_TOKEN environment variable is required");
	console.error("");
	console.error("Usage:");
	console.error("  LINEAR_API_TOKEN=your_token cyrus-tools");
	console.error("");
	console.error("Or set it in your MCP client configuration.");
	process.exit(1);
}

startStdioServer(linearApiToken).catch((error) => {
	console.error("Failed to start MCP server:", error);
	process.exit(1);
});
