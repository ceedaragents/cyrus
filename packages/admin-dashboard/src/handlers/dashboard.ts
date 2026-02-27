import type { FastifyReply, FastifyRequest } from "fastify";
import { getDashboardHtml } from "../templates/app.js";

/**
 * GET /admin — serve the SPA HTML dashboard.
 * On first visit, reads token from ?token= query param.
 * No Bearer auth required — the page itself handles auth via localStorage.
 */
export function handleDashboardPage() {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const query = request.query as { token?: string };
		const adminToken =
			process.env.CYRUS_ADMIN_TOKEN || process.env.CYRUS_API_KEY;

		// If token is provided in URL, validate it before serving the page
		if (query.token && adminToken && query.token !== adminToken) {
			return reply
				.type("text/html; charset=utf-8")
				.status(401)
				.send(unauthorizedPage());
		}

		return reply
			.type("text/html; charset=utf-8")
			.status(200)
			.send(getDashboardHtml());
	};
}

function unauthorizedPage(): string {
	return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Unauthorized</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;">
<div style="text-align:center;padding:40px;">
<h2 style="color:#f87171">Invalid Token</h2>
<p>The admin token provided is invalid.</p>
</div>
</body></html>`;
}
