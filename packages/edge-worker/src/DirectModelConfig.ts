import { join } from "node:path";
import {
	createLogger,
	DEFAULT_CONFIG_FILENAME,
	type ILogger,
} from "cyrus-core";
import type { FastifyInstance } from "fastify";
import { loadConfig, saveConfig } from "./DirectLinearOAuth.js";

/**
 * Registers a minimal, merge-safe endpoint for updating the global default
 * Claude model (`config.json`'s `claudeDefaultModel` /
 * `claudeDefaultFallbackModel`) on a headless, always-on deployment.
 *
 * Unlike `POST /api/update/cyrus-config` (which expects the FULL config —
 * repositories, linearWorkspaces, etc. — and overwrites the file with
 * whatever it's given), this route loads the existing config, patches only
 * the model fields, and saves it back. That makes it safe to call without
 * risking clobbering already-configured repositories or workspace tokens
 * that this route's caller may not have a copy of.
 *
 * Auth: same shared secret as the rest of the config-updater routes
 * (`CYRUS_API_KEY`), passed as a Bearer token.
 */
export interface DirectModelConfigOptions {
	cyrusHome: string;
	getApiKey: () => string;
	logger?: ILogger;
}

export function registerModelConfigRoute(
	fastify: FastifyInstance,
	options: DirectModelConfigOptions,
): void {
	const logger =
		options.logger ?? createLogger({ component: "DirectModelConfig" });
	const configPath = join(options.cyrusHome, DEFAULT_CONFIG_FILENAME);

	fastify.post("/api/update/claude-model", async (request, reply) => {
		const apiKey = options.getApiKey();
		const authHeader = request.headers.authorization;
		if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
			return reply.status(401).send({ success: false, error: "Unauthorized" });
		}

		const body = request.body as
			| { model?: string; fallbackModel?: string }
			| undefined;
		if (!body?.model || typeof body.model !== "string") {
			return reply
				.status(400)
				.send({ success: false, error: "Missing 'model' string in body" });
		}

		const config = loadConfig(configPath);
		config.claudeDefaultModel = body.model;
		if (body.fallbackModel) {
			config.claudeDefaultFallbackModel = body.fallbackModel;
		}
		saveConfig(configPath, config);

		logger.info(`✅ Default Claude model updated to '${body.model}'`);

		return reply.status(200).send({
			success: true,
			message: `Default Claude model set to ${body.model}`,
		});
	});
}
