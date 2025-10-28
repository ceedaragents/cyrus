import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig, readCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleRepository } from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
/**
 * ConfigUpdater - Orchestrates configuration updates for Cyrus
 *
 * This class provides a high-level API for managing Cyrus configuration files,
 * environment variables, repositories, and MCP server configurations.
 *
 * All operations are stateless and work with the cyrusHome directory passed during construction.
 */
export class ConfigUpdater {
    cyrusHome;
    /**
     * Creates a new ConfigUpdater instance
     * @param cyrusHome - Path to the Cyrus home directory (typically ~/.cyrus)
     */
    constructor(cyrusHome) {
        this.cyrusHome = cyrusHome;
    }
    /**
     * Update the main Cyrus configuration file (config.json)
     * @param payload - Configuration update payload
     * @returns Promise resolving to API response
     */
    async updateConfig(payload) {
        return handleCyrusConfig(payload, this.cyrusHome);
    }
    /**
     * Update Cyrus environment variables (.env file)
     * @param payload - Environment variables update payload
     * @returns Promise resolving to API response
     */
    async updateEnv(payload) {
        return handleCyrusEnv(payload, this.cyrusHome);
    }
    /**
     * Clone or verify a Git repository
     * @param payload - Repository configuration payload
     * @returns Promise resolving to API response
     */
    async updateRepository(payload) {
        return handleRepository(payload, this.cyrusHome);
    }
    /**
     * Test an MCP server connection
     * @param payload - MCP test configuration payload
     * @returns Promise resolving to API response
     */
    async testMcp(payload) {
        return handleTestMcp(payload);
    }
    /**
     * Configure MCP servers (writes mcp-{slug}.json files)
     * @param payload - MCP server configurations payload
     * @returns Promise resolving to API response
     */
    async configureMcp(payload) {
        return handleConfigureMcp(payload, this.cyrusHome);
    }
    /**
     * Apply multiple configuration updates in sequence
     * Useful for batch configuration operations
     *
     * @param config - Optional Cyrus config payload
     * @param env - Optional environment variables payload
     * @param mcp - Optional MCP configuration payload
     * @returns Promise resolving to array of API responses (one per operation)
     */
    async applyConfig(config, env, mcp) {
        const results = [];
        if (config) {
            const configResult = await this.updateConfig(config);
            results.push(configResult);
        }
        if (env) {
            const envResult = await this.updateEnv(env);
            results.push(envResult);
        }
        if (mcp) {
            const mcpResult = await this.configureMcp(mcp);
            results.push(mcpResult);
        }
        return results;
    }
    /**
     * Read the current Cyrus configuration
     * @returns Current configuration object or default empty config
     */
    readConfig() {
        return readCyrusConfig(this.cyrusHome);
    }
}
//# sourceMappingURL=ConfigUpdater.js.map