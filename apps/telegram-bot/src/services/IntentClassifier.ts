import type { ClassifiedIntent } from "../types.js";
import type { ConversationStore } from "./ConversationStore.js";

/**
 * Classifies incoming Telegram messages as new tasks or follow-ups.
 *
 * Phase 1 uses a simple structural heuristic:
 * - If the message is a reply to a known anchor message → follow-up
 * - Otherwise → new task
 */
export class IntentClassifier {
	constructor(private store: ConversationStore) {}

	classify(
		chatId: number,
		messageText: string,
		replyToMessageId?: number,
	): ClassifiedIntent {
		// If the message is a Telegram reply, check if it targets a known conversation anchor
		if (replyToMessageId) {
			const conversation = this.store.findByAnchor(chatId, replyToMessageId);
			if (conversation?.isActive) {
				return { type: "follow-up", conversation, text: messageText };
			}
		}

		return { type: "new-task", text: messageText };
	}
}
