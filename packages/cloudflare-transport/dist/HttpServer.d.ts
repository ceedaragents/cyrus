import { type IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
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
export declare class HttpServer extends EventEmitter {
	private server?;
	private config;
	private handlers;
	constructor(config: HttpServerConfig);
	/**
	 * Register a request handler
	 */
	registerHandler(path: string, handler: RequestHandler): void;
	/**
	 * Start the HTTP server
	 */
	start(): Promise<void>;
	/**
	 * Handle incoming HTTP request
	 */
	private handleRequest;
	/**
	 * Read request body
	 */
	private readBody;
	/**
	 * Stop the HTTP server
	 */
	stop(): Promise<void>;
	/**
	 * Check if server is running
	 */
	isRunning(): boolean;
}
//# sourceMappingURL=HttpServer.d.ts.map
