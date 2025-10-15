import type { NextFunction, Request, Response } from "express";

/**
 * Authentication middleware for config-server
 * Validates Bearer token against the secret provided during initialization
 */
export function createAuthMiddleware(secret: string) {
	return (req: Request, res: Response, next: NextFunction): void => {
		const authHeader = req.headers.authorization;

		if (!authHeader) {
			res.status(401).json({
				error: "Missing Authorization header",
			});
			return;
		}

		const parts = authHeader.split(" ");
		if (parts.length !== 2 || parts[0] !== "Bearer") {
			res.status(401).json({
				error: "Invalid Authorization header format. Expected: Bearer <token>",
			});
			return;
		}

		const token = parts[1];
		if (token !== secret) {
			res.status(401).json({
				error: "Invalid authentication token",
			});
			return;
		}

		next();
	};
}
