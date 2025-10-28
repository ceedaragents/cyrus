import type {
	ApiResponse,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	RepositoryPayload,
	TestMcpPayload,
} from "./types.js";
/**
 * ConfigUpdater - Orchestrates configuration updates for Cyrus
 *
 * This class provides a high-level API for managing Cyrus configuration files,
 * environment variables, repositories, and MCP server configurations.
 *
 * All operations are stateless and work with the cyrusHome directory passed during construction.
 */
export declare class ConfigUpdater {
	private readonly cyrusHome;
	/**
	 * Creates a new ConfigUpdater instance
	 * @param cyrusHome - Path to the Cyrus home directory (typically ~/.cyrus)
	 */
	constructor(cyrusHome: string);
	/**
	 * Update the main Cyrus configuration file (config.json)
	 * @param payload - Configuration update payload
	 * @returns Promise resolving to API response
	 */
	updateConfig(payload: CyrusConfigPayload): Promise<ApiResponse>;
	/**
	 * Update Cyrus environment variables (.env file)
	 * @param payload - Environment variables update payload
	 * @returns Promise resolving to API response
	 */
	updateEnv(payload: CyrusEnvPayload): Promise<ApiResponse>;
	/**
	 * Clone or verify a Git repository
	 * @param payload - Repository configuration payload
	 * @returns Promise resolving to API response
	 */
	updateRepository(payload: RepositoryPayload): Promise<ApiResponse>;
	/**
	 * Test an MCP server connection
	 * @param payload - MCP test configuration payload
	 * @returns Promise resolving to API response
	 */
	testMcp(payload: TestMcpPayload): Promise<ApiResponse>;
	/**
	 * Configure MCP servers (writes mcp-{slug}.json files)
	 * @param payload - MCP server configurations payload
	 * @returns Promise resolving to API response
	 */
	configureMcp(payload: ConfigureMcpPayload): Promise<ApiResponse>;
	/**
	 * Apply multiple configuration updates in sequence
	 * Useful for batch configuration operations
	 *
	 * @param config - Optional Cyrus config payload
	 * @param env - Optional environment variables payload
	 * @param mcp - Optional MCP configuration payload
	 * @returns Promise resolving to array of API responses (one per operation)
	 */
	applyConfig(
		config?: CyrusConfigPayload,
		env?: CyrusEnvPayload,
		mcp?: ConfigureMcpPayload,
	): Promise<ApiResponse[]>;
	/**
	 * Read the current Cyrus configuration
	 * @returns Current configuration object or default empty config
	 */
	readConfig(): any;
}
//# sourceMappingURL=ConfigUpdater.d.ts.map
