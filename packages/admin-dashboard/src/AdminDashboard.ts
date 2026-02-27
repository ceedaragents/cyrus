import type { FastifyInstance } from "fastify";
import { handleGetConfig } from "./handlers/config.js";
import { handleDashboardPage } from "./handlers/dashboard.js";
import { handleGetGhStatus } from "./handlers/ghStatus.js";
import {
	handleLinearOAuthCallback,
	handleLinearOAuthInitiate,
} from "./handlers/linearOAuth.js";
import { handleGetSessions } from "./handlers/sessions.js";
import { handleGetStatus } from "./handlers/status.js";
import { createAuthPreHandler } from "./middleware.js";

export interface AdminDashboardOptions {
	cyrusHome: string;
	version?: string;
	getActiveSessions?: () => Array<{
		issueId: string;
		repositoryId: string;
		isRunning: boolean;
	}>;
}

/**
 * AdminDashboard registers admin UI and API routes on a Fastify instance.
 *
 * Routes:
 *   GET  /admin                           → SPA HTML (token via query param)
 *   GET  /api/admin/config                → sanitized config
 *   GET  /api/admin/status                → extended status
 *   GET  /api/admin/sessions              → active sessions
 *   GET  /api/admin/gh-status             → GitHub CLI auth status
 *   POST /api/admin/linear-oauth/initiate → returns Linear authorize URL
 *   GET  /api/admin/linear-oauth/callback → OAuth redirect handler (no auth)
 */
export class AdminDashboard {
	private fastify: FastifyInstance;
	private options: AdminDashboardOptions;

	constructor(fastify: FastifyInstance, options: AdminDashboardOptions) {
		this.fastify = fastify;
		this.options = options;
	}

	/**
	 * Register all admin dashboard routes with the Fastify instance.
	 */
	register(): void {
		const authPreHandler = createAuthPreHandler();
		const { cyrusHome, version, getActiveSessions } = this.options;

		// Dashboard SPA — no Bearer auth (token comes from URL query param / localStorage)
		this.fastify.get("/admin", handleDashboardPage());

		// Authenticated API endpoints
		this.fastify.get(
			"/api/admin/config",
			{ preHandler: authPreHandler },
			handleGetConfig(cyrusHome),
		);
		this.fastify.get(
			"/api/admin/status",
			{ preHandler: authPreHandler },
			handleGetStatus(cyrusHome, version),
		);
		this.fastify.get(
			"/api/admin/sessions",
			{ preHandler: authPreHandler },
			handleGetSessions(getActiveSessions),
		);
		this.fastify.get(
			"/api/admin/gh-status",
			{ preHandler: authPreHandler },
			handleGetGhStatus(),
		);
		this.fastify.post(
			"/api/admin/linear-oauth/initiate",
			{ preHandler: authPreHandler },
			handleLinearOAuthInitiate(cyrusHome),
		);

		// OAuth callback — NO auth (Linear redirects the user's browser here)
		this.fastify.get(
			"/api/admin/linear-oauth/callback",
			handleLinearOAuthCallback(cyrusHome),
		);
	}
}
