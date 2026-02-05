/**
 * Discord Bot Client for Cyrus.
 *
 * This module provides the Discord bot client that listens for messages
 * and interactions, managing conversations with users in Discord channels.
 *
 * @module discord-bot/DiscordBot
 */

import { EventEmitter } from "node:events";
import {
	ChannelType,
	type ChatInputCommandInteraction,
	Client,
	EmbedBuilder,
	Events,
	GatewayIntentBits,
	type Interaction,
	type Message,
	type MessageCreateOptions,
	Partials,
	REST,
	Routes,
	SlashCommandBuilder,
	type TextChannel,
	type ThreadChannel,
} from "discord.js";
import type {
	DiscordAttachment,
	DiscordBotConfig,
	DiscordEventTransportEvents,
	DiscordResponse,
	DiscordSessionCreateEvent,
	DiscordSessionEndEvent,
	DiscordSessionPromptEvent,
	DiscordSessionState,
	DiscordUser,
} from "./types.js";

export declare interface DiscordBot {
	on<K extends keyof DiscordEventTransportEvents>(
		event: K,
		listener: DiscordEventTransportEvents[K],
	): this;
	emit<K extends keyof DiscordEventTransportEvents>(
		event: K,
		...args: Parameters<DiscordEventTransportEvents[K]>
	): boolean;
}

/**
 * Discord bot client for Cyrus integration.
 *
 * Handles:
 * - Message listening and parsing
 * - Slash command registration and handling
 * - Thread creation for conversations
 * - Response sending (text, embeds, files)
 * - Session state management
 */
export class DiscordBot extends EventEmitter {
	private client: Client;
	private config: DiscordBotConfig;
	private sessions: Map<string, DiscordSessionState> = new Map();
	private isReady: boolean = false;

	constructor(config: DiscordBotConfig) {
		super();
		this.config = {
			commandPrefix: "cyrus",
			respondToMentions: true,
			useThreads: true,
			...config,
		};

		// Create Discord client with required intents
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.MessageContent,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMessageReactions,
			],
			partials: [Partials.Message, Partials.Channel, Partials.Reaction],
		});

		this.setupEventHandlers();
	}

	/**
	 * Start the Discord bot and connect to Discord.
	 */
	async start(): Promise<void> {
		console.log("[DiscordBot] Starting Discord bot...");

		// Register slash commands before login
		await this.registerSlashCommands();

		// Login to Discord
		await this.client.login(this.config.botToken);

		console.log("[DiscordBot] Discord bot started successfully");
	}

	/**
	 * Stop the Discord bot and disconnect.
	 */
	async stop(): Promise<void> {
		console.log("[DiscordBot] Stopping Discord bot...");

		// End all active sessions
		for (const [sessionId, session] of this.sessions) {
			if (session.isActive) {
				this.emit("sessionEnd", {
					type: "discord_session_end",
					sessionId,
					reason: "error",
					timestamp: new Date(),
				});
			}
		}
		this.sessions.clear();

		// Destroy the client
		this.client.destroy();
		this.isReady = false;

		console.log("[DiscordBot] Discord bot stopped");
	}

	/**
	 * Send a response to a Discord channel/thread.
	 */
	async sendResponse(
		channelId: string,
		response: DiscordResponse,
		threadId?: string,
	): Promise<string | null> {
		try {
			const channel = await this.client.channels.fetch(threadId ?? channelId);
			if (
				!channel ||
				(channel.type !== ChannelType.GuildText &&
					channel.type !== ChannelType.PublicThread &&
					channel.type !== ChannelType.PrivateThread &&
					channel.type !== ChannelType.DM)
			) {
				console.error(
					`[DiscordBot] Invalid channel type for ${threadId ?? channelId}`,
				);
				return null;
			}

			const textChannel = channel as TextChannel | ThreadChannel;
			const messageOptions: MessageCreateOptions = {};

			if (response.asEmbed) {
				const embed = new EmbedBuilder()
					.setDescription(response.content)
					.setColor(
						(response.embedColor as `#${string}`) ?? ("#5865F2" as const),
					);
				messageOptions.embeds = [embed];
			} else {
				messageOptions.content = response.content;
			}

			if (response.files && response.files.length > 0) {
				messageOptions.files = response.files.map((f) => ({
					name: f.name,
					attachment: typeof f.data === "string" ? Buffer.from(f.data) : f.data,
				}));
			}

			const sentMessage = await textChannel.send(messageOptions);

			// Update session last activity
			const sessionId = threadId ?? channelId;
			const session = this.sessions.get(sessionId);
			if (session) {
				session.lastActivityAt = new Date();
				session.lastMessageId = sentMessage.id;
			}

			return sentMessage.id;
		} catch (error) {
			const err = new Error("[DiscordBot] Failed to send response");
			if (error instanceof Error) {
				err.cause = error;
			}
			console.error(err);
			this.emit("error", err);
			return null;
		}
	}

	/**
	 * Send a typing indicator to show the bot is processing.
	 */
	async sendTyping(channelId: string, threadId?: string): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(threadId ?? channelId);
			if (
				channel &&
				(channel.type === ChannelType.GuildText ||
					channel.type === ChannelType.PublicThread ||
					channel.type === ChannelType.PrivateThread ||
					channel.type === ChannelType.DM)
			) {
				const textChannel = channel as TextChannel | ThreadChannel;
				await textChannel.sendTyping();
			}
		} catch (error) {
			// Ignore typing indicator failures
			console.debug("[DiscordBot] Failed to send typing indicator:", error);
		}
	}

	/**
	 * Create a thread for a conversation.
	 */
	async createThread(
		channelId: string,
		messageId: string,
		name: string,
	): Promise<string | null> {
		try {
			const channel = await this.client.channels.fetch(channelId);
			if (!channel || channel.type !== ChannelType.GuildText) {
				return null;
			}

			const textChannel = channel as TextChannel;
			const message = await textChannel.messages.fetch(messageId);

			const thread = await message.startThread({
				name: name.substring(0, 100), // Discord thread name limit
				autoArchiveDuration: 1440, // 24 hours
			});

			return thread.id;
		} catch (error) {
			const err = new Error("[DiscordBot] Failed to create thread");
			if (error instanceof Error) {
				err.cause = error;
			}
			console.error(err);
			return null;
		}
	}

	/**
	 * Get the current bot user info.
	 */
	getBotUser(): DiscordUser | null {
		if (!this.client.user) return null;

		return {
			id: this.client.user.id,
			username: this.client.user.username,
			displayName: this.client.user.displayName ?? this.client.user.username,
			discriminator: this.client.user.discriminator,
			avatarUrl: this.client.user.displayAvatarURL() ?? undefined,
			isBot: true,
		};
	}

	/**
	 * Check if the bot is ready and connected.
	 */
	isConnected(): boolean {
		return this.isReady && this.client.isReady();
	}

	/**
	 * Get active session state.
	 */
	getSession(sessionId: string): DiscordSessionState | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Get all active sessions.
	 */
	getActiveSessions(): DiscordSessionState[] {
		return Array.from(this.sessions.values()).filter((s) => s.isActive);
	}

	/**
	 * End a session manually.
	 */
	endSession(
		sessionId: string,
		reason: DiscordSessionEndEvent["reason"],
	): void {
		const session = this.sessions.get(sessionId);
		if (session?.isActive) {
			session.isActive = false;
			this.emit("sessionEnd", {
				type: "discord_session_end",
				sessionId,
				reason,
				timestamp: new Date(),
			});
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Setup Discord.js event handlers.
	 */
	private setupEventHandlers(): void {
		// Bot ready
		this.client.on(Events.ClientReady, (readyClient) => {
			console.log(`[DiscordBot] Logged in as ${readyClient.user.tag}`);
			this.isReady = true;
			this.emit("ready");
		});

		// Message events
		this.client.on(Events.MessageCreate, (message) => {
			this.handleMessage(message).catch((error) => {
				const err = new Error("[DiscordBot] Error handling message");
				if (error instanceof Error) {
					err.cause = error;
				}
				console.error(err);
				this.emit("error", err);
			});
		});

		// Slash command interactions
		this.client.on(Events.InteractionCreate, (interaction) => {
			this.handleInteraction(interaction).catch((error) => {
				const err = new Error("[DiscordBot] Error handling interaction");
				if (error instanceof Error) {
					err.cause = error;
				}
				console.error(err);
				this.emit("error", err);
			});
		});

		// Thread events
		this.client.on(Events.ThreadDelete, (thread) => {
			const session = this.sessions.get(thread.id);
			if (session?.isActive) {
				session.isActive = false;
				this.emit("sessionEnd", {
					type: "discord_session_end",
					sessionId: thread.id,
					reason: "channel_deleted",
					timestamp: new Date(),
				});
			}
		});

		// Error handling
		this.client.on(Events.Error, (error) => {
			console.error("[DiscordBot] Discord client error:", error);
			this.emit("error", error);
		});

		this.client.on(Events.Warn, (warning) => {
			console.warn("[DiscordBot] Discord client warning:", warning);
		});
	}

	/**
	 * Handle incoming messages.
	 */
	private async handleMessage(message: Message): Promise<void> {
		// Ignore bot messages
		if (message.author.bot) return;

		// Ignore messages outside configured guilds
		if (
			this.config.guildIds &&
			this.config.guildIds.length > 0 &&
			message.guildId &&
			!this.config.guildIds.includes(message.guildId)
		) {
			return;
		}

		// Ignore messages outside configured channels (unless it's a thread or DM)
		if (
			this.config.channelIds &&
			this.config.channelIds.length > 0 &&
			message.channel.type === ChannelType.GuildText &&
			!this.config.channelIds.includes(message.channelId)
		) {
			return;
		}

		// Check if message is in an active session thread
		const existingSession = this.sessions.get(message.channelId);
		if (existingSession?.isActive) {
			await this.handleSessionPrompt(message, existingSession);
			return;
		}

		// Check for bot mention
		const isMentioned =
			this.config.respondToMentions &&
			this.client.user &&
			message.mentions.has(this.client.user.id);

		if (isMentioned) {
			await this.handleNewSession(message);
		}
	}

	/**
	 * Handle a new session creation from a message.
	 */
	private async handleNewSession(message: Message): Promise<void> {
		const user = this.extractUser(message);
		const attachments = this.extractAttachments(message);

		// Remove bot mention from content
		let content = message.content;
		if (this.client.user) {
			content = content
				.replace(new RegExp(`<@!?${this.client.user.id}>`, "g"), "")
				.trim();
		}

		// Create a thread for the conversation if enabled
		let sessionId = message.id;
		let threadId: string | undefined;

		if (
			this.config.useThreads &&
			message.channel.type === ChannelType.GuildText
		) {
			// Create thread name from first part of message
			const threadName = content.substring(0, 50) || "Cyrus Conversation";
			const createdThreadId = await this.createThread(
				message.channelId,
				message.id,
				threadName,
			);
			if (createdThreadId) {
				threadId = createdThreadId;
				sessionId = createdThreadId;
			}
		}

		// Create session state
		const sessionState: DiscordSessionState = {
			sessionId,
			guildId: message.guildId ?? "",
			channelId: message.channelId,
			threadId,
			creatorId: message.author.id,
			createdAt: new Date(),
			lastActivityAt: new Date(),
			isActive: true,
			lastMessageId: message.id,
		};
		this.sessions.set(sessionId, sessionState);

		// Emit session create event
		const event: DiscordSessionCreateEvent = {
			type: "discord_session_create",
			sessionId,
			guildId: message.guildId ?? "",
			channelId: message.channelId,
			threadId,
			user,
			content,
			attachments,
			timestamp: message.createdAt,
			messageId: message.id,
		};

		this.emit("sessionCreate", event);
	}

	/**
	 * Handle a prompt to an existing session.
	 */
	private async handleSessionPrompt(
		message: Message,
		session: DiscordSessionState,
	): Promise<void> {
		const user = this.extractUser(message);
		const attachments = this.extractAttachments(message);

		// Update session state
		session.lastActivityAt = new Date();
		session.lastMessageId = message.id;

		// Emit session prompt event
		const event: DiscordSessionPromptEvent = {
			type: "discord_session_prompt",
			sessionId: session.sessionId,
			guildId: message.guildId ?? "",
			channelId: message.channelId,
			threadId: session.threadId,
			user,
			content: message.content,
			attachments,
			timestamp: message.createdAt,
			messageId: message.id,
		};

		this.emit("sessionPrompt", event);
	}

	/**
	 * Handle slash command interactions.
	 */
	private async handleInteraction(interaction: Interaction): Promise<void> {
		if (!interaction.isChatInputCommand()) return;

		const command = interaction.commandName;

		if (command === this.config.commandPrefix) {
			await this.handleCyrusCommand(interaction);
		} else if (command === `${this.config.commandPrefix}-end`) {
			await this.handleEndCommand(interaction);
		}
	}

	/**
	 * Handle the main /cyrus command.
	 */
	private async handleCyrusCommand(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		const prompt = interaction.options.getString("prompt", true);

		// Defer reply to give us time
		await interaction.deferReply();

		const user: DiscordUser = {
			id: interaction.user.id,
			username: interaction.user.username,
			displayName: interaction.user.displayName ?? interaction.user.username,
			discriminator: interaction.user.discriminator,
			avatarUrl: interaction.user.displayAvatarURL() ?? undefined,
			isBot: false,
		};

		// Get the reply message to potentially create a thread
		const reply = await interaction.fetchReply();
		let sessionId = reply.id;
		let threadId: string | undefined;

		// Create thread for conversation
		if (
			this.config.useThreads &&
			interaction.channel?.type === ChannelType.GuildText
		) {
			const threadName = prompt.substring(0, 50) || "Cyrus Conversation";
			const thread = await (interaction.channel as TextChannel).threads.create({
				name: threadName,
				autoArchiveDuration: 1440,
				startMessage: reply.id,
			});
			if (thread) {
				threadId = thread.id;
				sessionId = thread.id;
			}
		}

		// Create session state
		const sessionState: DiscordSessionState = {
			sessionId,
			guildId: interaction.guildId ?? "",
			channelId: interaction.channelId,
			threadId,
			creatorId: interaction.user.id,
			createdAt: new Date(),
			lastActivityAt: new Date(),
			isActive: true,
			lastMessageId: reply.id,
		};
		this.sessions.set(sessionId, sessionState);

		// Emit session create event
		const event: DiscordSessionCreateEvent = {
			type: "discord_session_create",
			sessionId,
			guildId: interaction.guildId ?? "",
			channelId: interaction.channelId,
			threadId,
			user,
			content: prompt,
			attachments: [],
			timestamp: new Date(),
			messageId: reply.id,
		};

		this.emit("sessionCreate", event);

		// Edit the deferred reply
		await interaction.editReply({
			content: `🤔 Processing your request...\n\n> ${prompt}`,
		});
	}

	/**
	 * Handle the /cyrus-end command.
	 */
	private async handleEndCommand(
		interaction: ChatInputCommandInteraction,
	): Promise<void> {
		// Find session in current channel/thread
		const sessionId = interaction.channelId;
		const session = this.sessions.get(sessionId);

		if (!session || !session.isActive) {
			await interaction.reply({
				content: "❌ No active Cyrus session in this channel.",
				ephemeral: true,
			});
			return;
		}

		// End the session
		session.isActive = false;

		const user: DiscordUser = {
			id: interaction.user.id,
			username: interaction.user.username,
			displayName: interaction.user.displayName ?? interaction.user.username,
			discriminator: interaction.user.discriminator,
			avatarUrl: interaction.user.displayAvatarURL() ?? undefined,
			isBot: false,
		};

		this.emit("sessionEnd", {
			type: "discord_session_end",
			sessionId,
			reason: "user_request",
			user,
			timestamp: new Date(),
		});

		await interaction.reply({
			content: "✅ Cyrus session ended.",
		});
	}

	/**
	 * Register slash commands with Discord.
	 */
	private async registerSlashCommands(): Promise<void> {
		const commands = [
			new SlashCommandBuilder()
				.setName(this.config.commandPrefix ?? "cyrus")
				.setDescription("Start a conversation with Cyrus")
				.addStringOption((option) =>
					option
						.setName("prompt")
						.setDescription("What would you like Cyrus to help with?")
						.setRequired(true),
				),
			new SlashCommandBuilder()
				.setName(`${this.config.commandPrefix ?? "cyrus"}-end`)
				.setDescription("End the current Cyrus conversation"),
		];

		const rest = new REST().setToken(this.config.botToken);

		try {
			console.log("[DiscordBot] Registering slash commands...");

			if (this.config.guildIds && this.config.guildIds.length > 0) {
				// Register to specific guilds (faster for development)
				for (const guildId of this.config.guildIds) {
					await rest.put(
						Routes.applicationGuildCommands(this.config.applicationId, guildId),
						{ body: commands.map((c) => c.toJSON()) },
					);
				}
			} else {
				// Register globally (takes up to an hour to propagate)
				await rest.put(Routes.applicationCommands(this.config.applicationId), {
					body: commands.map((c) => c.toJSON()),
				});
			}

			console.log("[DiscordBot] Slash commands registered successfully");
		} catch (error) {
			const err = new Error("[DiscordBot] Failed to register slash commands");
			if (error instanceof Error) {
				err.cause = error;
			}
			console.error(err);
			throw err;
		}
	}

	/**
	 * Extract user information from a Discord message.
	 */
	private extractUser(message: Message): DiscordUser {
		const member = message.member;
		return {
			id: message.author.id,
			username: message.author.username,
			displayName:
				member?.displayName ??
				message.author.displayName ??
				message.author.username,
			discriminator: message.author.discriminator,
			avatarUrl:
				member?.displayAvatarURL() ??
				message.author.displayAvatarURL() ??
				undefined,
			isBot: message.author.bot,
		};
	}

	/**
	 * Extract attachments from a Discord message.
	 */
	private extractAttachments(message: Message): DiscordAttachment[] {
		return message.attachments.map((att) => ({
			id: att.id,
			filename: att.name ?? "attachment",
			url: att.url,
			proxyUrl: att.proxyURL,
			size: att.size,
			contentType: att.contentType ?? undefined,
			width: att.width ?? undefined,
			height: att.height ?? undefined,
		}));
	}
}
