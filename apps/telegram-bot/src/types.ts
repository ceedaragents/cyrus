/** A tracked conversation mapping Telegram messages to a Linear issue. */
export interface Conversation {
	/** Telegram chat ID where this conversation is happening. */
	chatId: number;
	/** Telegram message ID of the bot's initial reply (used as reply-to anchor). */
	anchorMessageId: number;
	/** Linear issue ID (UUID). */
	linearIssueId: string;
	/** Linear issue identifier (e.g., "TEAM-123"). */
	linearIssueIdentifier: string;
	/** Linear issue URL. */
	linearIssueUrl: string;
	/** Timestamp (ms) of creation. */
	createdAt: number;
	/** Timestamp (ms) of last activity update pushed to Telegram. */
	lastPolledAt: number;
	/** Whether the issue is still active (not completed/canceled). */
	isActive: boolean;
}

/** Intent classification result. */
export type IntentType = "new-task" | "follow-up";

export interface ClassifiedIntent {
	type: IntentType;
	/** If follow-up, the conversation it relates to. */
	conversation?: Conversation;
	/** Original message text. */
	text: string;
}
