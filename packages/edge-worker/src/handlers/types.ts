import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Base interface for all handler modules
 */
export interface HandlerModule {
	/**
	 * Register this module's handlers with the server
	 * @param registerFn Function to register route handlers
	 */
	register(registerFn: RouteRegistrationFunction): void;

	/**
	 * Clean up resources when the module is unloaded
	 */
	cleanup?(): Promise<void>;
}

/**
 * HTTP request handler function
 */
export type RequestHandler = (
	req: IncomingMessage,
	res: ServerResponse,
) => Promise<void> | void;

/**
 * Function to register a route with the server
 */
export type RouteRegistrationFunction = (
	method: HttpMethod,
	path: string,
	handler: RequestHandler,
) => void;

/**
 * Supported HTTP methods
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

/**
 * Route configuration
 */
export interface RouteConfig {
	method: HttpMethod;
	path: string;
	handler: RequestHandler;
}
