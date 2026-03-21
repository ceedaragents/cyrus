/**
 * Discord Message Translator
 *
 * Translates Discord MESSAGE_CREATE events into unified internal messages
 * for the internal message bus.
 *
 * @module discord-event-transport/DiscordMessageTranslator
 */

import { randomUUID } from "node:crypto";
import type {
	DiscordPlatformRef,
	DiscordSessionStartPlatformData,
	DiscordUserPromptPlatformData,
	IMessageTranslator,
	SessionStartMessage,
	TranslationContext,
	TranslationResult,
	UserPromptMessage,
} from "cyrus-core";
import type { DiscordWebhookEvent } from "./types.js";

/**
 * Strips the @mention from Discord message content.
 * Discord mentions are in the format <@USER_ID> or <@!USER_ID>.
 */
export function stripMention(content: string): string {
	return content.replace(/<@!?\d+>/g, "").trim();
}

/**
 * Translates Discord MESSAGE_CREATE events into internal messages.
 *
 * Note: Discord messages can result in either:
 * - SessionStartMessage: First mention in a channel that starts a session
 * - UserPromptMessage: Follow-up messages in an existing thread session
 *
 * The distinction between session start vs user prompt is determined by
 * the EdgeWorker based on whether an active session exists for the thread.
 */
export class DiscordMessageTranslator
	implements IMessageTranslator<DiscordWebhookEvent>
{
	/**
	 * Check if this translator can handle the given event.
	 */
	canTranslate(event: unknown): event is DiscordWebhookEvent {
		if (!event || typeof event !== "object") {
			return false;
		}

		const e = event as Record<string, unknown>;

		return (
			typeof e.eventType === "string" &&
			e.eventType === "message_create" &&
			typeof e.eventId === "string" &&
			e.payload !== null &&
			typeof e.payload === "object"
		);
	}

	/**
	 * Translate a Discord event into an internal message.
	 *
	 * By default, creates a SessionStartMessage. The EdgeWorker will
	 * determine if this should actually be a UserPromptMessage based
	 * on whether an active session exists.
	 */
	translate(
		event: DiscordWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		if (event.eventType === "message_create") {
			return this.translateMessageCreate(event, context);
		}

		return {
			success: false,
			reason: `Unsupported Discord event type: ${event.eventType}`,
		};
	}

	/**
	 * Create a UserPromptMessage from a Discord event.
	 * This is called by EdgeWorker when it determines the message
	 * is a follow-up to an existing session.
	 */
	translateAsUserPrompt(
		event: DiscordWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		if (event.eventType === "message_create") {
			return this.translateMessageCreateAsUserPrompt(event, context);
		}

		return {
			success: false,
			reason: `Unsupported Discord event type: ${event.eventType}`,
		};
	}

	/**
	 * Translate MESSAGE_CREATE to SessionStartMessage.
	 */
	private translateMessageCreate(
		event: DiscordWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId = context?.organizationId || event.guildId;

		// Session key: channelId:messageId (or channelId:threadId if in a thread)
		const threadKey = this.getThreadKey(payload);
		const sessionKey = threadKey;

		const workItemIdentifier = `discord:${threadKey}`;

		// Strip @mentions from content
		const promptText = stripMention(payload.content);

		const platformData: DiscordSessionStartPlatformData = {
			guild: this.buildGuildRef(event.guildId),
			channel: this.buildChannelRef(payload.channel_id),
			thread: payload.message_reference
				? this.buildThreadRef(
						payload.channel_id,
						payload.message_reference.channel_id,
					)
				: undefined,
			message: this.buildMessageRef(payload),
			discordBotToken: event.discordBotToken,
		};

		const message: SessionStartMessage = {
			id: randomUUID(),
			source: "discord",
			action: "session_start",
			receivedAt: new Date(payload.timestamp).toISOString(),
			organizationId,
			sessionKey,
			workItemId: threadKey,
			workItemIdentifier,
			author: {
				id: payload.author.id,
				name: payload.author.global_name ?? payload.author.username,
			},
			initialPrompt: promptText,
			title: promptText.slice(0, 100) + (promptText.length > 100 ? "..." : ""),
			platformData,
		};

		return { success: true, message };
	}

	/**
	 * Translate MESSAGE_CREATE as UserPromptMessage.
	 */
	private translateMessageCreateAsUserPrompt(
		event: DiscordWebhookEvent,
		context?: TranslationContext,
	): TranslationResult {
		const { payload } = event;

		const organizationId = context?.organizationId || event.guildId;

		const threadKey = this.getThreadKey(payload);
		const promptText = stripMention(payload.content);

		const platformData: DiscordUserPromptPlatformData = {
			guild: this.buildGuildRef(event.guildId),
			channel: this.buildChannelRef(payload.channel_id),
			thread: payload.message_reference
				? this.buildThreadRef(
						payload.channel_id,
						payload.message_reference.channel_id,
					)
				: undefined,
			message: this.buildMessageRef(payload),
			discordBotToken: event.discordBotToken,
		};

		const message: UserPromptMessage = {
			id: randomUUID(),
			source: "discord",
			action: "user_prompt",
			receivedAt: new Date(payload.timestamp).toISOString(),
			organizationId,
			sessionKey: threadKey,
			workItemId: threadKey,
			workItemIdentifier: `discord:${threadKey}`,
			author: {
				id: payload.author.id,
				name: payload.author.global_name ?? payload.author.username,
			},
			content: promptText,
			platformData,
		};

		return { success: true, message };
	}

	// ============================================================================
	// HELPER METHODS
	// ============================================================================

	/**
	 * Get a thread key for session tracking.
	 * Format: channelId:messageId (uses the channel_id as the thread anchor)
	 */
	private getThreadKey(message: DiscordWebhookEvent["payload"]): string {
		// If the message is a reply referencing another message, use the
		// reference's channel and message as the thread anchor
		if (message.message_reference?.message_id) {
			return `${message.channel_id}:${message.message_reference.message_id}`;
		}
		// Otherwise use the channel and this message ID
		return `${message.channel_id}:${message.id}`;
	}

	private buildGuildRef(guildId: string): DiscordPlatformRef["guild"] {
		return { id: guildId };
	}

	private buildChannelRef(channelId: string): DiscordPlatformRef["channel"] {
		return { id: channelId };
	}

	private buildThreadRef(
		threadId: string,
		parentChannelId?: string,
	): DiscordPlatformRef["thread"] {
		return {
			id: threadId,
			parentId: parentChannelId,
		};
	}

	private buildMessageRef(
		message: DiscordWebhookEvent["payload"],
	): DiscordPlatformRef["message"] {
		return {
			id: message.id,
			content: message.content,
			author: {
				id: message.author.id,
				username: message.author.username,
				globalName: message.author.global_name ?? undefined,
			},
		};
	}
}
