/**
 * MCP Configuration Validation Module
 *
 * Provides validation for user-provided MCP server configurations before
 * passing them to the Claude Agent SDK, preventing opaque crashes.
 */

export {
	formatValidationErrorsForLinear,
	loadAndValidateMcpConfigFile,
	loadAndValidateMcpConfigs,
	type McpConfigValidationResult,
	type McpServerValidationResult,
	validateMcpConfig,
	validateMcpServerConfig,
} from "./McpConfigValidator.js";
