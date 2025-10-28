import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleRepository } from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
/**
 * ConfigUpdater registers configuration update routes with a Fastify server
 * Handles: cyrus-config, cyrus-env, repository, test-mcp, configure-mcp endpoints
 */
export class ConfigUpdater {
	fastify;
	cyrusHome;
	apiKey;
	constructor(fastify, cyrusHome, apiKey) {
		this.fastify = fastify;
		this.cyrusHome = cyrusHome;
		this.apiKey = apiKey;
	}
	/**
	 * Register all configuration update routes with the Fastify instance
	 */
	register() {
		// Register all routes with authentication
		this.registerRoute("/api/update/cyrus-config", this.handleCyrusConfigRoute);
		this.registerRoute("/api/update/cyrus-env", this.handleCyrusEnvRoute);
		this.registerRoute("/api/update/repository", this.handleRepositoryRoute);
		this.registerRoute("/api/test-mcp", this.handleTestMcpRoute);
		this.registerRoute("/api/configure-mcp", this.handleConfigureMcpRoute);
	}
	/**
	 * Register a route with authentication
	 */
	registerRoute(path, handler) {
		this.fastify.post(path, async (request, reply) => {
			// Verify authentication
			const authHeader = request.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				return reply.status(401).send({
					success: false,
					error: "Unauthorized",
				});
			}
			try {
				const response = await handler.call(this, request.body);
				const statusCode = response.success ? 200 : 400;
				return reply.status(statusCode).send(response);
			} catch (error) {
				return reply.status(500).send({
					success: false,
					error: "Internal server error",
					details: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}
	/**
	 * Verify Bearer token authentication
	 */
	verifyAuth(authHeader) {
		if (!authHeader || !this.apiKey) {
			return false;
		}
		const expectedAuth = `Bearer ${this.apiKey}`;
		return authHeader === expectedAuth;
	}
	/**
	 * Handle cyrus-config update
	 */
	async handleCyrusConfigRoute(payload) {
		const response = await handleCyrusConfig(payload, this.cyrusHome);
		// Emit restart event if requested
		if (response.success && response.data?.restartCyrus) {
			this.fastify.log.info("Config update requested Cyrus restart");
		}
		return response;
	}
	/**
	 * Handle cyrus-env update
	 */
	async handleCyrusEnvRoute(payload) {
		const response = await handleCyrusEnv(payload, this.cyrusHome);
		// Emit restart event if requested
		if (response.success && response.data?.restartCyrus) {
			this.fastify.log.info("Env update requested Cyrus restart");
		}
		return response;
	}
	/**
	 * Handle repository clone/verify
	 */
	async handleRepositoryRoute(payload) {
		return handleRepository(payload, this.cyrusHome);
	}
	/**
	 * Handle MCP connection test
	 */
	async handleTestMcpRoute(payload) {
		return handleTestMcp(payload);
	}
	/**
	 * Handle MCP server configuration
	 */
	async handleConfigureMcpRoute(payload) {
		return handleConfigureMcp(payload, this.cyrusHome);
	}
}
//# sourceMappingURL=ConfigUpdater.js.map
