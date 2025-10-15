/**
 * @cyrus-ai/config-server
 *
 * Embedded HTTP server for local Cyrus configuration during onboarding.
 * Provides endpoints for managing GitHub credentials, Cyrus config, repositories,
 * MCP servers, and environment variables.
 */

export { handleCyrusConfig } from "./handlers/config-handler";
export {
	handleUpdateCyrusEnv,
	handleUpdateEnvVariables,
} from "./handlers/env-handler";

// Export handlers for direct use if needed
export { handleGitHubCredentials } from "./handlers/github-handler";
export {
	deleteMCPConfigFile,
	handleConfigureMCP,
	handleTestMCP,
} from "./handlers/mcp-handler";
export {
	handleCloneRepository,
	handleDeleteRepository,
	handleListRepositories,
} from "./handlers/repository-handler";
export { ConfigServer } from "./server";
export * from "./types";
