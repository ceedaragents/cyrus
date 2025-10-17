import { EventEmitter } from "node:events";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { AuthManager } from "./AuthManager.js";
import type { HandlerResult } from "./types.js";

export interface HttpServerConfig {
	port: number;
	authManager: AuthManager;
	handlers?: Map<string, RequestHandler>;
}

export type RequestHandler = (
	req: IncomingMessage,
	body: string,
) => Promise<HandlerResult>;

/**
 * HTTP server for receiving requests through Cloudflare tunnel
 */
export class HttpServer extends EventEmitter {
	private server?: Server;
	private config: HttpServerConfig;
	private handlers: Map<string, RequestHandler>;

	constructor(config: HttpServerConfig) {
		super();
		this.config = config;
		this.handlers = config.handlers || new Map();
	}

	/**
	 * Register a request handler
	 */
	registerHandler(path: string, handler: RequestHandler): void {
		this.handlers.set(path, handler);
	}

	/**
	 * Start the HTTP server
	 */
	async start(): Promise<void> {
		if (this.server) {
			throw new Error("Server is already running");
		}

		return new Promise((resolve, reject) => {
			this.server = createServer(async (req, res) => {
				await this.handleRequest(req, res);
			});

			this.server.on("error", (error: any) => {
				if (error.code === "EADDRINUSE") {
					reject(new Error(`Port ${this.config.port} is already in use`));
				} else {
					reject(error);
				}
			});

			this.server.listen(this.config.port, () => {
				console.log(`[HttpServer] Listening on port ${this.config.port}`);
				resolve();
			});
		});
	}

	/**
	 * Handle incoming HTTP request
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			// Read request body
			const body = await this.readBody(req);

			// Log request
			console.log(
				`[HttpServer] ${req.method} ${req.url} - Body length: ${body.length}`,
			);

			// Health check endpoint (no auth required)
			if (req.url === "/health" && req.method === "GET") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						status: "healthy",
						timestamp: new Date().toISOString(),
					}),
				);
				return;
			}

			// Validate authentication for all other endpoints
			if (!this.config.authManager.validateRequest(req.headers)) {
				console.warn("[HttpServer] Unauthorized request");
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Unauthorized" }));
				return;
			}

			// Find handler for path
			const path = req.url?.split("?")[0] || "/";
			const handler = this.handlers.get(path);

			if (!handler) {
				console.warn(`[HttpServer] No handler for path: ${path}`);
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ error: "Not found" }));
				return;
			}

			// Execute handler
			const result = await handler(req, body);

			// Send response
			const headers = {
				"Content-Type": "application/json",
				...result.headers,
			};

			res.writeHead(result.status, headers);
			res.end(
				typeof result.body === "string"
					? result.body
					: JSON.stringify(result.body),
			);
		} catch (error) {
			console.error("[HttpServer] Request handling error:", error);
			res.writeHead(500, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					error: "Internal server error",
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	}

	/**
	 * Read request body
	 */
	private readBody(req: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = "";

			req.on("data", (chunk) => {
				body += chunk.toString();

				// Limit body size to 10MB
				if (body.length > 10 * 1024 * 1024) {
					req.destroy();
					reject(new Error("Request body too large"));
				}
			});

			req.on("end", () => {
				resolve(body);
			});

			req.on("error", (error) => {
				reject(error);
			});
		});
	}

	/**
	 * Stop the HTTP server
	 */
	async stop(): Promise<void> {
		if (!this.server) {
			return;
		}

		return new Promise((resolve, reject) => {
			this.server!.close((error) => {
				if (error) {
					reject(error);
				} else {
					this.server = undefined;
					console.log("[HttpServer] Server stopped");
					resolve();
				}
			});
		});
	}

	/**
	 * Check if server is running
	 */
	isRunning(): boolean {
		return !!this.server && this.server.listening;
	}
}
