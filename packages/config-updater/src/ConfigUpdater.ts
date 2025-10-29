import type { FastifyInstance } from "fastify";
import { handleCheckGh } from "./handlers/checkGh.js";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleRepository } from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
import type {
	ApiResponse,
	CheckGhPayload,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	RepositoryPayload,
	TestMcpPayload,
} from "./types.js";

/**
 * ConfigUpdater registers configuration update routes with a Fastify server
 * Handles: cyrus-config, cyrus-env, repository, test-mcp, configure-mcp, check-gh endpoints
 */
export class ConfigUpdater {
	private fastify: FastifyInstance;
	private cyrusHome: string;
	private apiKey: string;

	constructor(fastify: FastifyInstance, cyrusHome: string, apiKey: string) {
		this.fastify = fastify;
		this.cyrusHome = cyrusHome;
		this.apiKey = apiKey;
	}

	/**
	 * Register all configuration update routes with the Fastify instance
	 */
	register(): void {
		// Register all routes with authentication
		this.registerRoute("/api/update/cyrus-config", this.handleCyrusConfigRoute);
		this.registerRoute("/api/update/cyrus-env", this.handleCyrusEnvRoute);
		this.registerRoute("/api/update/repository", this.handleRepositoryRoute);
		this.registerRoute("/api/test-mcp", this.handleTestMcpRoute);
		this.registerRoute("/api/configure-mcp", this.handleConfigureMcpRoute);
		this.registerRoute("/api/check-gh", this.handleCheckGhRoute);
	}

	/**
	 * Register a route with authentication
	 */
	private registerRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
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
	private verifyAuth(authHeader: string | undefined): boolean {
		if (!authHeader || !this.apiKey) {
			return false;
		}

		const expectedAuth = `Bearer ${this.apiKey}`;
		return authHeader === expectedAuth;
	}

	/**
	 * Handle cyrus-config update
	 */
	private async handleCyrusConfigRoute(
		payload: CyrusConfigPayload,
	): Promise<ApiResponse> {
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
	private async handleCyrusEnvRoute(
		payload: CyrusEnvPayload,
	): Promise<ApiResponse> {
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
	private async handleRepositoryRoute(
		payload: RepositoryPayload,
	): Promise<ApiResponse> {
		return handleRepository(payload, this.cyrusHome);
	}

	/**
	 * Handle MCP connection test
	 */
	private async handleTestMcpRoute(
		payload: TestMcpPayload,
	): Promise<ApiResponse> {
		return handleTestMcp(payload);
	}

	/**
	 * Handle MCP server configuration
	 */
	private async handleConfigureMcpRoute(
		payload: ConfigureMcpPayload,
	): Promise<ApiResponse> {
		return handleConfigureMcp(payload, this.cyrusHome);
	}

	/**
	 * Handle GitHub CLI check
	 */
	private async handleCheckGhRoute(
		payload: CheckGhPayload,
	): Promise<ApiResponse> {
		return handleCheckGh(payload, this.cyrusHome);
	}
}
