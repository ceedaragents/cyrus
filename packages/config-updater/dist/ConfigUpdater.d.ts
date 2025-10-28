import type { FastifyInstance } from "fastify";
/**
 * ConfigUpdater registers configuration update routes with a Fastify server
 * Handles: cyrus-config, cyrus-env, repository, test-mcp, configure-mcp endpoints
 */
export declare class ConfigUpdater {
	private fastify;
	private cyrusHome;
	private apiKey;
	constructor(fastify: FastifyInstance, cyrusHome: string, apiKey: string);
	/**
	 * Register all configuration update routes with the Fastify instance
	 */
	register(): void;
	/**
	 * Register a route with authentication
	 */
	private registerRoute;
	/**
	 * Verify Bearer token authentication
	 */
	private verifyAuth;
	/**
	 * Handle cyrus-config update
	 */
	private handleCyrusConfigRoute;
	/**
	 * Handle cyrus-env update
	 */
	private handleCyrusEnvRoute;
	/**
	 * Handle repository clone/verify
	 */
	private handleRepositoryRoute;
	/**
	 * Handle MCP connection test
	 */
	private handleTestMcpRoute;
	/**
	 * Handle MCP server configuration
	 */
	private handleConfigureMcpRoute;
}
//# sourceMappingURL=ConfigUpdater.d.ts.map
