import { Bot, type Context } from "grammy";
import type { TelegramBotConfig } from "./config.js";
import type { ConversationStore } from "./services/ConversationStore.js";
import type { IntentClassifier } from "./services/IntentClassifier.js";
import type { LinearService } from "./services/LinearService.js";
import type { Conversation } from "./types.js";
import type { Logger } from "./utils/logger.js";
import { extractTitle } from "./utils/titleExtractor.js";

export function createBot(
	config: TelegramBotConfig,
	store: ConversationStore,
	classifier: IntentClassifier,
	linear: LinearService,
	logger: Logger,
): Bot {
	const bot = new Bot(config.botToken);

	// Middleware: whitelist check
	bot.use(async (ctx, next) => {
		const userId = ctx.from?.id;
		if (!userId || !config.allowedUserIds.includes(userId)) {
			logger.debug(`[Bot] Rejected message from unauthorized user ${userId}`);
			return;
		}
		await next();
	});

	// Handler: plain text messages
	bot.on("message:text", async (ctx) => {
		const chatId = ctx.chat.id;
		const messageText = ctx.message.text;
		const replyToMessageId = ctx.message.reply_to_message?.message_id;

		const intent = classifier.classify(chatId, messageText, replyToMessageId);
		logger.info(`[Bot] Intent: ${intent.type} for chat ${chatId}`);

		switch (intent.type) {
			case "new-task":
				await handleNewTask(ctx, config, store, linear, logger, messageText);
				break;
			case "follow-up":
				await handleFollowUp(
					ctx,
					linear,
					logger,
					messageText,
					intent.conversation!,
				);
				break;
		}
	});

	return bot;
}

async function handleNewTask(
	ctx: Context,
	config: TelegramBotConfig,
	store: ConversationStore,
	linear: LinearService,
	logger: Logger,
	messageText: string,
): Promise<void> {
	const chatId = ctx.chat!.id;

	// Acknowledge receipt immediately
	const ack = await ctx.reply("\u23f3 Creating issue...");

	try {
		const title = extractTitle(messageText);
		const issue = await linear.createIssue({
			teamId: config.defaultTeamId,
			title,
			description: messageText,
			assigneeId: config.cyrusAssigneeId,
		});

		// Edit the ack message with the result (becomes the anchor)
		await ctx.api.editMessageText(
			chatId,
			ack.message_id,
			`\ud83c\udfaf Created [${issue.identifier}](${issue.url}): *${issue.title}*\n\nCyrus is on it. Reply to this message to send follow-ups.`,
			{ parse_mode: "Markdown" },
		);

		// Track the conversation
		store.add({
			chatId,
			anchorMessageId: ack.message_id,
			linearIssueId: issue.id,
			linearIssueIdentifier: issue.identifier,
			linearIssueUrl: issue.url,
			createdAt: Date.now(),
			lastPolledAt: Date.now(),
			isActive: true,
		});

		logger.info(`[Bot] Created ${issue.identifier} for chat ${chatId}`);
	} catch (err) {
		await ctx.api.editMessageText(
			chatId,
			ack.message_id,
			`\u274c Failed to create issue: ${err instanceof Error ? err.message : String(err)}`,
		);
		logger.error(`[Bot] Error creating issue: ${err}`);
	}
}

async function handleFollowUp(
	ctx: Context,
	linear: LinearService,
	logger: Logger,
	messageText: string,
	conversation: Conversation,
): Promise<void> {
	try {
		await linear.addComment(conversation.linearIssueId, messageText);
		await ctx.reply(
			`\ud83d\udcac Comment added to ${conversation.linearIssueIdentifier}`,
			{
				reply_parameters: {
					message_id: ctx.message!.message_id,
				},
			},
		);
		logger.info(`[Bot] Added comment to ${conversation.linearIssueIdentifier}`);
	} catch (err) {
		await ctx.reply(
			`\u274c Failed to add comment: ${err instanceof Error ? err.message : String(err)}`,
		);
		logger.error(`[Bot] Error adding comment: ${err}`);
	}
}
