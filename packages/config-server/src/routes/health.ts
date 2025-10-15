import type { Router as RouterType } from "express";
import { type Request, type Response, Router } from "express";
import type { HealthResponse } from "../types";

const router: RouterType = Router();

const startTime = Date.now();

/**
 * Health check endpoint
 * GET /health
 *
 * Returns server status, version, and uptime
 * No authentication required
 */
router.get("/health", (_req: Request, res: Response) => {
	const uptime = Date.now() - startTime;

	const response: HealthResponse = {
		status: "ok",
		version: process.env.npm_package_version || "0.1.0",
		uptime,
	};

	res.json(response);
});

export default router;
