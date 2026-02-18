import type { Api, RawApi } from "grammy";
import type { Logger } from "../utils/logger.js";
import type { ConversationStore } from "./ConversationStore.js";
import type { LinearService } from "./LinearService.js";

/**
 * Polls Linear for status changes and new comments on active conversations,
 * then pushes updates to Telegram.
 */
export class ProgressPoller {
	private intervalId?: ReturnType<typeof setInterval>;

	constructor(
		private api: Api<RawApi>,
		private store: ConversationStore,
		private linear: LinearService,
		private pollIntervalMs: number,
		private logger: Logger,
		private cyrusUserId?: string,
	) {}

	start(): void {
		this.intervalId = setInterval(() => {
			this.poll().catch((err) =>
				this.logger.error(`[ProgressPoller] Unhandled error: ${err}`),
			);
		}, this.pollIntervalMs);
		this.logger.info(`[ProgressPoller] Polling every ${this.pollIntervalMs}ms`);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = undefined;
		}
	}

	private async poll(): Promise<void> {
		const activeConversations = this.store.getAllActive();

		for (const conversation of activeConversations) {
			try {
				// Check issue status
				const status = await this.linear.getIssueStatus(
					conversation.linearIssueId,
				);
				if (
					status.stateType === "completed" ||
					status.stateType === "canceled"
				) {
					const emoji = status.stateType === "completed" ? "\u2705" : "\u274c";
					await this.api.sendMessage(
						conversation.chatId,
						`${emoji} *${conversation.linearIssueIdentifier}* is now *${status.stateName}*`,
						{
							parse_mode: "Markdown",
							reply_parameters: {
								message_id: conversation.anchorMessageId,
							},
						},
					);
					this.store.markInactive(conversation.linearIssueId);
					continue;
				}

				// Fetch new comments since last poll
				const comments = await this.linear.getRecentComments(
					conversation.linearIssueId,
					conversation.lastPolledAt,
					this.cyrusUserId,
				);

				for (const comment of comments) {
					const truncatedBody =
						comment.body.length > 1000
							? `${comment.body.slice(0, 1000)}...`
							: comment.body;

					await this.api.sendMessage(
						conversation.chatId,
						`\ud83d\udcdd *${conversation.linearIssueIdentifier}* \u2014 ${comment.authorName}:\n${truncatedBody}`,
						{
							parse_mode: "Markdown",
							reply_parameters: {
								message_id: conversation.anchorMessageId,
							},
						},
					);
				}

				// Update polling timestamp
				if (comments.length > 0) {
					const latestTime = Math.max(
						...comments.map((c) => c.createdAt.getTime()),
					);
					this.store.updateLastPolled(conversation.linearIssueId, latestTime);
				}
			} catch (err) {
				this.logger.error(
					`[ProgressPoller] Error polling ${conversation.linearIssueIdentifier}: ${err}`,
				);
			}
		}
	}
}
