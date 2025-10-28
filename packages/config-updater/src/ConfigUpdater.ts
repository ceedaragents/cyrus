import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleConfigureMcp } from "./handlers/configureMcp.js";
import { handleCyrusConfig } from "./handlers/cyrusConfig.js";
import { handleCyrusEnv } from "./handlers/cyrusEnv.js";
import { handleRepository } from "./handlers/repository.js";
import { handleTestMcp } from "./handlers/testMcp.js";
import type {
	ApiResponse,
	ConfigUpdaterConfig,
	ConfigUpdaterEvents,
	ConfigureMcpPayload,
	CyrusConfigPayload,
	CyrusEnvPayload,
	RepositoryPayload,
	TestMcpPayload,
} from "./types.js";

export declare interface ConfigUpdater {
	on<K extends keyof ConfigUpdaterEvents>(
		event: K,
		listener: ConfigUpdaterEvents[K],
	): this;
	emit<K extends keyof ConfigUpdaterEvents>(
		event: K,
		...args: Parameters<ConfigUpdaterEvents[K]>
	): boolean;
}

/**
 * Configuration update handler module
 * Handles configuration update requests and registers endpoints with SharedApplicationServer
 */
export class ConfigUpdater extends EventEmitter {
	private config: ConfigUpdaterConfig;
	private apiKey: string;

	constructor(config: ConfigUpdaterConfig) {
		super();
		this.config = config;
		this.apiKey = config.apiKey;

		// Forward config callbacks to events
		if (config.onConfigUpdate) this.on("configUpdate", config.onConfigUpdate);
		if (config.onError) this.on("error", config.onError);
		if (config.onRestart) this.on("restart", config.onRestart);
	}

	/**
	 * Register handlers with SharedApplicationServer
	 * This method should be called to mount the config updater endpoints
	 */
	registerHandlers(
		registerHandler: (
			path: string,
			handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
		) => void,
	): void {
		// Register all config update endpoints
		registerHandler("/api/update/cyrus-config", (req, res) =>
			this.handleRequest(req, res, "/api/update/cyrus-config"),
		);
		registerHandler("/api/update/cyrus-env", (req, res) =>
			this.handleRequest(req, res, "/api/update/cyrus-env"),
		);
		registerHandler("/api/update/repository", (req, res) =>
			this.handleRequest(req, res, "/api/update/repository"),
		);
		registerHandler("/api/test-mcp", (req, res) =>
			this.handleRequest(req, res, "/api/test-mcp"),
		);
		registerHandler("/api/configure-mcp", (req, res) =>
			this.handleRequest(req, res, "/api/configure-mcp"),
		);
	}

	/**
	 * Handle incoming HTTP requests for config updates
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
		endpoint: string,
	): Promise<void> {
		try {
			// Verify authentication
			const authHeader = req.headers.authorization;
			if (!this.verifyAuth(authHeader)) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ success: false, error: "Unauthorized" }));
				return;
			}

			// Only allow POST requests
			if (req.method !== "POST") {
				res.writeHead(405, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({ success: false, error: "Method Not Allowed" }),
				);
				return;
			}

			// Read request body
			const body = await this.readBody(req);

			// Parse JSON body safely
			let parsedBody: any;
			try {
				parsedBody = JSON.parse(body);
			} catch (error) {
				const response: ApiResponse = {
					success: false,
					error: "Invalid JSON in request body",
					details: error instanceof Error ? error.message : String(error),
				};
				res.writeHead(400, { "Content-Type": "application/json" });
				res.end(JSON.stringify(response));
				return;
			}

			// Route to appropriate handler
			let response: ApiResponse;

			switch (endpoint) {
				case "/api/update/cyrus-config":
					response = await handleCyrusConfig(
						parsedBody as CyrusConfigPayload,
						this.config.cyrusHome,
					);
					if (response.success) {
						this.emit("configUpdate");
						// Emit restart event if requested
						if (response.data?.restartCyrus) {
							this.emit("restart", "config");
						}
					}
					break;

				case "/api/update/cyrus-env":
					response = await handleCyrusEnv(
						parsedBody as CyrusEnvPayload,
						this.config.cyrusHome,
					);
					if (response.success && response.data?.restartCyrus) {
						this.emit("restart", "env");
					}
					break;

				case "/api/update/repository":
					response = await handleRepository(
						parsedBody as RepositoryPayload,
						this.config.cyrusHome,
					);
					break;

				case "/api/test-mcp":
					response = await handleTestMcp(parsedBody as TestMcpPayload);
					break;

				case "/api/configure-mcp":
					response = await handleConfigureMcp(
						parsedBody as ConfigureMcpPayload,
						this.config.cyrusHome,
					);
					break;

				default:
					response = {
						success: false,
						error: `Unknown endpoint: ${endpoint}`,
					};
			}

			// Send response
			res.writeHead(response.success ? 200 : 400, {
				"Content-Type": "application/json",
			});
			res.end(JSON.stringify(response));
		} catch (error) {
			this.emit("error", error as Error);

			const response: ApiResponse = {
				success: false,
				error: "Internal server error",
				details: error instanceof Error ? error.message : String(error),
			};

			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(JSON.stringify(response));
		}
	}

	/**
	 * Verify authentication header
	 */
	private verifyAuth(authHeader: string | undefined): boolean {
		if (!authHeader || !this.apiKey) {
			return false;
		}

		const expectedAuth = `Bearer ${this.apiKey}`;
		return authHeader === expectedAuth;
	}

	/**
	 * Read request body
	 */
	private async readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = "";

			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", () => {
				resolve(body);
			});

			req.on("error", (error) => {
				reject(error);
			});
		});
	}
}
