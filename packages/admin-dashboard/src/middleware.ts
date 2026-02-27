import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Validate Bearer token against CYRUS_ADMIN_TOKEN (or CYRUS_API_KEY as fallback).
 * Used as a Fastify preHandler for all /api/admin/* routes.
 */
export function createAuthPreHandler() {
	return async (request: FastifyRequest, reply: FastifyReply) => {
		const adminToken =
			process.env.CYRUS_ADMIN_TOKEN || process.env.CYRUS_API_KEY;

		if (!adminToken) {
			return reply.status(500).send({
				success: false,
				error: "Admin token not configured",
			});
		}

		const authHeader = request.headers.authorization;
		if (!authHeader || authHeader !== `Bearer ${adminToken}`) {
			return reply.status(401).send({
				success: false,
				error: "Unauthorized",
			});
		}
	};
}
