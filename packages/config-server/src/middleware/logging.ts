import type { Request, RequestHandler } from "express";
import morgan from "morgan";

/**
 * Custom logging format for config-server
 * Logs method, URL, status, response time, and content length
 */
export const loggingMiddleware: RequestHandler = morgan(
	":method :url :status :response-time ms - :res[content-length]",
	{
		skip: (req: Request) => {
			// Skip logging health checks to reduce noise
			return req.url === "/health";
		},
	},
);
