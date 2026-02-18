import { homedir } from "node:os";
import { resolve } from "node:path";
import dotenv from "dotenv";

// Load .env from ~/.cyrus/.env (same as CLI app)
dotenv.config({ path: resolve(homedir(), ".cyrus", ".env") });

import { createBot } from "./bot.js";
import { loadConfig } from "./config.js";
import { ConversationStore } from "./services/ConversationStore.js";
import { IntentClassifier } from "./services/IntentClassifier.js";
import { LinearService } from "./services/LinearService.js";
import { ProgressPoller } from "./services/ProgressPoller.js";
import { Logger } from "./utils/logger.js";

async function main(): Promise<void> {
	const logger = new Logger();
	logger.info("[TelegramBot] Starting...");

	const config = loadConfig();
	logger.info(
		`[TelegramBot] Allowed users: ${config.allowedUserIds.join(", ")}`,
	);

	const linear = new LinearService(config.linearToken);

	// Auto-detect Cyrus's Linear user ID if not provided
	if (!config.cyrusAssigneeId) {
		config.cyrusAssigneeId = await linear.detectCurrentUserId();
		logger.info(
			`[TelegramBot] Auto-detected Cyrus user ID: ${config.cyrusAssigneeId}`,
		);
	}

	const store = new ConversationStore();
	const classifier = new IntentClassifier(store);
	const bot = createBot(config, store, classifier, linear, logger);

	// Start progress poller
	const poller = new ProgressPoller(
		bot.api,
		store,
		linear,
		config.pollIntervalMs,
		logger,
		config.cyrusAssigneeId,
	);
	poller.start();

	// Graceful shutdown
	const shutdown = (): void => {
		logger.info("[TelegramBot] Shutting down...");
		poller.stop();
		bot.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	logger.info("[TelegramBot] Bot is running");
	await bot.start();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
