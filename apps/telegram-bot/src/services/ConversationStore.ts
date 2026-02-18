import type { Conversation } from "../types.js";

/**
 * In-memory store tracking Telegram ↔ Linear conversation mappings.
 * Uses two indices for efficient lookup in both directions.
 */
export class ConversationStore {
	/** chatId -> Conversation[] (multiple active conversations per chat) */
	private byChatId = new Map<number, Conversation[]>();
	/** linearIssueId -> Conversation (reverse lookup) */
	private byIssueId = new Map<string, Conversation>();

	add(conversation: Conversation): void {
		const existing = this.byChatId.get(conversation.chatId) ?? [];
		existing.push(conversation);
		this.byChatId.set(conversation.chatId, existing);
		this.byIssueId.set(conversation.linearIssueId, conversation);
	}

	/** Find active conversations in a chat. */
	getActiveForChat(chatId: number): Conversation[] {
		return (this.byChatId.get(chatId) ?? []).filter((c) => c.isActive);
	}

	/** Find a conversation by its anchor message ID within a chat. */
	findByAnchor(
		chatId: number,
		anchorMessageId: number,
	): Conversation | undefined {
		const conversations = this.byChatId.get(chatId) ?? [];
		return conversations.find((c) => c.anchorMessageId === anchorMessageId);
	}

	/** Find by Linear issue ID. */
	getByIssueId(issueId: string): Conversation | undefined {
		return this.byIssueId.get(issueId);
	}

	/** Mark a conversation as inactive (issue completed/canceled). */
	markInactive(linearIssueId: string): void {
		const conversation = this.byIssueId.get(linearIssueId);
		if (conversation) {
			conversation.isActive = false;
		}
	}

	/** Get all active conversations (used by the poller). */
	getAllActive(): Conversation[] {
		const active: Conversation[] = [];
		for (const conversation of this.byIssueId.values()) {
			if (conversation.isActive) {
				active.push(conversation);
			}
		}
		return active;
	}

	/** Update the last polled timestamp for a conversation. */
	updateLastPolled(linearIssueId: string, timestamp: number): void {
		const conversation = this.byIssueId.get(linearIssueId);
		if (conversation) {
			conversation.lastPolledAt = timestamp;
		}
	}
}
