import type { IAgentRunner, ILogger } from "cyrus-core";
import { createLogger } from "cyrus-core";
import {
	DiscordMessageService,
	DiscordReactionService,
	type DiscordThreadMessage,
	type DiscordWebhookEvent,
	stripMention as stripDiscordMention,
} from "cyrus-discord-event-transport";
import type { ChatPlatformAdapter } from "./ChatSessionHandler.js";

/**
 * Discord implementation of ChatPlatformAdapter.
 *
 * Contains all Discord-specific logic: text extraction, thread keys,
 * system prompts, thread context, reply posting, and acknowledgement reactions.
 */
export class DiscordChatAdapter
	implements ChatPlatformAdapter<DiscordWebhookEvent>
{
	readonly platformName = "discord" as const;
	private repositoryPaths: string[];
	private repositoryRoutingContext: string;
	private logger: ILogger;
	private selfBotId: string | undefined;

	constructor(
		repositoryPaths: string[] = [],
		logger?: ILogger,
		options?: {
			repositoryRoutingContext?: string;
		},
	) {
		this.repositoryPaths = Array.from(
			new Set(repositoryPaths.filter(Boolean)),
		).sort();
		this.repositoryRoutingContext =
			options?.repositoryRoutingContext?.trim() || "";
		this.logger = logger ?? createLogger({ component: "DiscordChatAdapter" });
	}

	/**
	 * Get the Discord bot token, falling back to process.env if the event doesn't carry one.
	 */
	private getDiscordBotToken(event: DiscordWebhookEvent): string | undefined {
		return event.discordBotToken ?? process.env.DISCORD_BOT_TOKEN;
	}

	private async getSelfBotId(token: string): Promise<string | undefined> {
		if (this.selfBotId) {
			return this.selfBotId;
		}
		try {
			const identity = await new DiscordMessageService().getIdentity(token);
			this.selfBotId = identity.id;
			return this.selfBotId;
		} catch (error) {
			this.logger.warn(
				`Failed to resolve bot identity: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}
	}

	extractTaskInstructions(event: DiscordWebhookEvent): string {
		return (
			stripDiscordMention(event.payload.content) ||
			"Ask the user for more context"
		);
	}

	getThreadKey(event: DiscordWebhookEvent): string {
		const { payload } = event;
		// If the message is a reply, use the reference as the thread anchor
		if (payload.message_reference?.message_id) {
			return `${payload.channel_id}:${payload.message_reference.message_id}`;
		}
		return `${payload.channel_id}:${payload.id}`;
	}

	getEventId(event: DiscordWebhookEvent): string {
		return event.eventId;
	}

	buildSystemPrompt(event: DiscordWebhookEvent): string {
		const repositoryAccessSection =
			this.repositoryPaths.length > 0
				? `
## Repository Access
- You have read-only access to the following configured repositories:
${this.repositoryPaths.map((path) => `- ${path}`).join("\n")}

- If you need to inspect source code in one of these repositories, use:
  - Bash(git -C * pull)

- You are explicitly allowed to run git pull with:
  - Bash(git -C * pull)
			`
				: `
## Repository Access
- No repository paths are configured for this chat session.`;

		return `You are responding to a Discord @mention.

## Context
- **Requested by**: ${event.payload.author.global_name ?? event.payload.author.username} (${event.payload.author.id})
- **Channel**: ${event.payload.channel_id}
- **Guild**: ${event.guildId}

## Instructions
- You are running in a transient workspace, not associated with any code repository
- Be concise in your responses as they will be posted back to Discord
- If the user's request involves code changes, help them plan the work and suggest creating an issue in their project tracker (Linear, Jira, or GitHub Issues)
- You can answer questions, provide analysis, help with planning, and assist with research
- If files need to be created or examined, they will be in your working directory
${repositoryAccessSection}
${this.repositoryRoutingContext ? `\n\n${this.repositoryRoutingContext}` : ""}

## Self-Knowledge
- If the user asks about your capabilities, features, how you work, what you can do, setup instructions, or anything related to Cyrus documentation, use the \`mcp__cyrus-docs__search_documentation\` tool to look up the answer from the official Cyrus docs.
- Always prefer searching the docs over guessing or relying on your training data for Cyrus-specific questions.

## Orchestration Notes
- If the user asks you to make repo code changes immediately, use these steps:
  - First run \`mcp__linear__get_user\` with \`query: "me"\` to get your Linear identity.
  - Create an Issue in the user's tracker for the requested work (for example using \`mcp__linear__save_issue\`), including enough context and acceptance criteria to execute it. Default the issue status/state to "Backlog". **IMPORTANT: Never set the status to "Triage".**
  - To route the issue to a specific repository, add \`[repo=repo-name]\` to the issue description. To target a specific branch, use \`[repo=repo-name#branch-name]\`. For multiple repos: \`repos=repo1,repo2\`.
  - Assign that Issue to that same user (your own Linear user).
  - That assignment is what immediately kicks off work in your own agent session.
  - Track execution progress by searching \`mcp__cyrus-tools__linear_get_agent_sessions\` for the active session, then opening it with \`mcp__cyrus-tools__linear_get_agent_session\`.

## Discord Message Formatting (CRITICAL)
Your response will be posted as a Discord message. Discord uses standard Markdown with some differences:
- Discord has a 2,000 character limit per message. Long responses will be split automatically.
- Bold: **bold text** (double asterisks)
- Italic: *italic text* or _italic text_
- Strikethrough: ~~struck text~~
- Inline code: \`code\`
- Code blocks: \`\`\`language\\ncode block\`\`\`
- Blockquote: > quoted text (at start of line)
- Links: paste URL directly (Discord auto-embeds) or use [text](url)
- Headers: # H1, ## H2, ### H3 (supported in Discord)
- Lists: use numbered lines (1. item) or dashes (- item)
- NO tables (not supported in Discord messages)
- Spoilers: ||spoiler text||`;
	}

	async fetchThreadContext(event: DiscordWebhookEvent): Promise<string> {
		// Only fetch context if this message is a reply (has message_reference)
		if (!event.payload.message_reference?.message_id) {
			return "";
		}

		const token = this.getDiscordBotToken(event);
		if (!token) {
			this.logger.warn(
				"Cannot fetch Discord thread context: no discordBotToken available",
			);
			return "";
		}

		try {
			const discordService = new DiscordMessageService();
			const [messages, selfBotId] = await Promise.all([
				discordService.fetchMessages({
					token,
					channelId: event.payload.channel_id,
					limit: 50,
				}),
				this.getSelfBotId(token),
			]);

			if (messages.length === 0) {
				return "";
			}

			return this.formatThreadContext(messages, selfBotId);
		} catch (error) {
			this.logger.warn(
				`Failed to fetch Discord thread context: ${error instanceof Error ? error.message : String(error)}`,
			);
			return "";
		}
	}

	async postReply(
		event: DiscordWebhookEvent,
		runner: IAgentRunner,
	): Promise<void> {
		try {
			// Get the last assistant message from the runner as the summary
			const messages = runner.getMessages();
			const lastAssistantMessage = [...messages]
				.reverse()
				.find((m) => m.type === "assistant");

			let summary = "Task completed.";
			if (
				lastAssistantMessage &&
				lastAssistantMessage.type === "assistant" &&
				"message" in lastAssistantMessage
			) {
				const msg = lastAssistantMessage as {
					message: {
						content: Array<{ type: string; text?: string }>;
					};
				};
				const textBlock = msg.message.content?.find(
					(block) => block.type === "text" && block.text,
				);
				if (textBlock?.text) {
					summary = textBlock.text;
				}
			}

			const token = this.getDiscordBotToken(event);
			if (!token) {
				this.logger.warn(
					"Cannot post Discord reply: no discordBotToken available",
				);
				return;
			}

			await new DiscordMessageService().postMessage({
				token,
				channelId: event.payload.channel_id,
				content: summary,
				messageReference: event.payload.id,
			});

			this.logger.info(
				`Posted Discord reply to channel ${event.payload.channel_id} (reply to ${event.payload.id})`,
			);
		} catch (error) {
			this.logger.error(
				"Failed to post Discord reply",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	async acknowledgeReceipt(event: DiscordWebhookEvent): Promise<void> {
		const token = this.getDiscordBotToken(event);
		if (!token) {
			this.logger.warn(
				"Cannot add Discord reaction: no discordBotToken available",
			);
			return;
		}

		await new DiscordReactionService().addReaction({
			token,
			channelId: event.payload.channel_id,
			messageId: event.payload.id,
			emoji: "\u{1F440}", // 👀 eyes emoji
		});
	}

	async notifyBusy(event: DiscordWebhookEvent): Promise<void> {
		const token = this.getDiscordBotToken(event);
		if (!token) {
			return;
		}

		await new DiscordMessageService().postMessage({
			token,
			channelId: event.payload.channel_id,
			content:
				"I'm still working on the previous request in this thread. I'll pick up your new message once I'm done.",
			messageReference: event.payload.id,
		});
	}

	private formatThreadContext(
		messages: DiscordThreadMessage[],
		selfBotId?: string,
	): string {
		const formattedMessages = messages
			.map((msg) => {
				const isSelf = selfBotId && msg.author_id === selfBotId;
				const author = isSelf
					? "assistant (you)"
					: (msg.author_username ?? "unknown");
				return `  <message>
    <author>${author}</author>
    <timestamp>${msg.timestamp}</timestamp>
    <content>
${msg.content}
    </content>
  </message>`;
			})
			.join("\n");

		return `<discord_thread_context>\n${formattedMessages}\n</discord_thread_context>`;
	}
}
