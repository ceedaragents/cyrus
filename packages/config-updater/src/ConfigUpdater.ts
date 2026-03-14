import type { FastifyInstance, FastifyRequest } from "fastify";
import { handleCheckGh } from "./handlers/checkGh.js";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig, readCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import {
	handleRepository,
	handleRepositoryDelete,
} from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
import type {
	ApiResponse,
	CheckGhPayload,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	DeleteRepositoryPayload,
	RepositoryPayload,
	TestMcpPayload,
} from "./types.js";

// Minimal interface so config-updater doesn't depend on edge-worker package
interface SessionRegistry {
	getAllSessions(): unknown[];
	on(
		event: "sessionCreated" | "sessionUpdated" | "sessionCompleted",
		listener: (...args: unknown[]) => void,
	): this;
	off(event: string, listener: (...args: unknown[]) => void): this;
}

/**
 * ConfigUpdater registers configuration update routes with a Fastify server
 * Handles: cyrus-config, cyrus-env, repository, test-mcp, configure-mcp, check-gh endpoints
 */
export class ConfigUpdater {
	private fastify: FastifyInstance;
	private cyrusHome: string;
	private apiKey: string;
	private sessionRegistry?: SessionRegistry;

	constructor(
		fastify: FastifyInstance,
		cyrusHome: string,
		apiKey: string,
		sessionRegistry?: SessionRegistry,
	) {
		this.fastify = fastify;
		this.cyrusHome = cyrusHome;
		this.apiKey = apiKey;
		this.sessionRegistry = sessionRegistry;
	}

	/**
	 * Register all configuration update routes with the Fastify instance
	 */
	register(): void {
		// Register all routes with authentication
		this.registerRoute("/api/update/cyrus-config", this.handleCyrusConfigRoute);
		this.registerRoute("/api/update/cyrus-env", this.handleCyrusEnvRoute);
		this.registerRoute("/api/update/repository", this.handleRepositoryRoute);
		this.registerDeleteRoute(
			"/api/update/repository",
			this.handleRepositoryDeleteRoute,
		);
		this.registerRoute("/api/test-mcp", this.handleTestMcpRoute);
		this.registerRoute("/api/configure-mcp", this.handleConfigureMcpRoute);
		this.registerRoute("/api/check-gh", this.handleCheckGhRoute);

		// Dashboard read endpoints
		this.registerGetRoute("/api/config", this.handleGetConfigRoute);
		this.registerGetRoute("/api/sessions", this.handleGetSessionsRoute);
		this.registerSseRoute(
			"/api/sessions/stream",
			this.handleSessionsStreamRoute,
		);
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
	 * Register a DELETE route with authentication
	 */
	private registerDeleteRoute(
		path: string,
		handler: (payload: any) => Promise<ApiResponse>,
	): void {
		this.fastify.delete(path, async (request, reply) => {
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

	/**
	 * Handle repository deletion
	 */
	private async handleRepositoryDeleteRoute(
		payload: DeleteRepositoryPayload,
	): Promise<ApiResponse> {
		return handleRepositoryDelete(payload, this.cyrusHome);
	}

	/**
	 * Register a GET route with Bearer token authentication
	 */
	private registerGetRoute(
		path: string,
		handler: (request: FastifyRequest) => Promise<unknown>,
	): void {
		this.fastify.get(path, async (request, reply) => {
			if (!this.verifyAuth(request.headers.authorization)) {
				return reply
					.status(401)
					.send({ success: false, error: "Unauthorized" });
			}
			try {
				const data = await handler.call(this, request);
				return reply.status(200).send(data);
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
	 * Register an SSE route — auth via ?key= query param (EventSource can't send headers)
	 */
	private registerSseRoute(
		path: string,
		handler: (
			request: FastifyRequest,
			send: (event: string, data: unknown) => void,
			close: () => void,
		) => () => void,
	): void {
		this.fastify.get(path, async (request, reply) => {
			const query = request.query as Record<string, string>;
			const keyAuth = query.key ? `Bearer ${query.key}` : undefined;
			if (!this.verifyAuth(request.headers.authorization ?? keyAuth)) {
				return reply
					.status(401)
					.send({ success: false, error: "Unauthorized" });
			}

			reply.raw.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"Access-Control-Allow-Origin": "*",
			});

			const send = (event: string, data: unknown) => {
				reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
			};

			const cleanup = handler.call(this, request, send, () => reply.raw.end());

			request.raw.on("close", cleanup);
		});
	}

	/**
	 * GET /api/config — return current ~/.cyrus/config.json
	 */
	private async handleGetConfigRoute(
		_request: FastifyRequest,
	): Promise<unknown> {
		return readCyrusConfig(this.cyrusHome);
	}

	/**
	 * GET /api/sessions — snapshot of all active sessions
	 */
	private async handleGetSessionsRoute(
		_request: FastifyRequest,
	): Promise<unknown> {
		if (!this.sessionRegistry) {
			return { sessions: [] };
		}
		const sessions = this.sessionRegistry.getAllSessions().map((s) => {
			const { agentRunner: _agentRunner, ...rest } = s as Record<
				string,
				unknown
			>;
			return rest;
		});
		return { sessions };
	}

	/**
	 * GET /api/sessions/stream — SSE stream of session lifecycle events
	 */
	private handleSessionsStreamRoute(
		_request: FastifyRequest,
		send: (event: string, data: unknown) => void,
		_close: () => void,
	): () => void {
		if (!this.sessionRegistry) {
			return () => {};
		}

		const onCreated = (session: unknown) => {
			const { agentRunner: _a, ...rest } = session as Record<string, unknown>;
			send("sessionCreated", rest);
		};
		const onUpdated = (sessionId: unknown, session: unknown) => {
			const { agentRunner: _a, ...rest } = session as Record<string, unknown>;
			send("sessionUpdated", { sessionId, session: rest });
		};
		const onCompleted = (sessionId: unknown, session: unknown) => {
			const { agentRunner: _a, ...rest } = session as Record<string, unknown>;
			send("sessionCompleted", { sessionId, session: rest });
		};

		this.sessionRegistry.on("sessionCreated", onCreated);
		this.sessionRegistry.on("sessionUpdated", onUpdated);
		this.sessionRegistry.on("sessionCompleted", onCompleted);

		// Send current sessions as initial snapshot
		const sessions = this.sessionRegistry.getAllSessions().map((s) => {
			const { agentRunner: _a, ...rest } = s as Record<string, unknown>;
			return rest;
		});
		send("snapshot", { sessions });

		return () => {
			this.sessionRegistry?.off("sessionCreated", onCreated);
			this.sessionRegistry?.off("sessionUpdated", onUpdated);
			this.sessionRegistry?.off("sessionCompleted", onCompleted);
		};
	}
}
