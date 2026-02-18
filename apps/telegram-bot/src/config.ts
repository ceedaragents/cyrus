import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { z } from "zod";

const TelegramBotEnvSchema = z.object({
	TELEGRAM_BOT_TOKEN: z.string().min(1),
	TELEGRAM_ALLOWED_USERS: z.string().min(1),
	CYRUS_LINEAR_TEAM_ID: z.string().min(1),
	CYRUS_LINEAR_ASSIGNEE_ID: z.string().optional(),
	CYRUS_HOME: z.string().optional(),
});

export interface TelegramBotConfig {
	botToken: string;
	allowedUserIds: number[];
	defaultTeamId: string;
	cyrusAssigneeId?: string;
	linearToken: string;
	linearWorkspaceId: string;
	pollIntervalMs: number;
}

export function loadConfig(): TelegramBotConfig {
	const env = TelegramBotEnvSchema.parse(process.env);
	const cyrusHome = env.CYRUS_HOME ?? resolve(homedir(), ".cyrus");
	const configPath = resolve(cyrusHome, "config.json");

	if (!existsSync(configPath)) {
		throw new Error(
			`Cyrus config not found at ${configPath}. Run 'cyrus auth' first.`,
		);
	}

	const edgeConfig = JSON.parse(readFileSync(configPath, "utf-8"));
	const repo = edgeConfig.repositories?.[0];
	if (!repo) {
		throw new Error("No repositories configured in ~/.cyrus/config.json");
	}

	return {
		botToken: env.TELEGRAM_BOT_TOKEN,
		allowedUserIds: env.TELEGRAM_ALLOWED_USERS.split(",").map(Number),
		defaultTeamId: env.CYRUS_LINEAR_TEAM_ID,
		cyrusAssigneeId: env.CYRUS_LINEAR_ASSIGNEE_ID,
		linearToken: repo.linearToken,
		linearWorkspaceId: repo.linearWorkspaceId,
		pollIntervalMs: 15_000,
	};
}
