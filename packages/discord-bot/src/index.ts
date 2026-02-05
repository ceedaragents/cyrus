/**
 * Discord bot integration for Cyrus.
 *
 * This package provides a Discord bot that allows Cyrus to participate
 * in Discord communities as a bot. It includes:
 *
 * - DiscordBot: The main bot client that handles messages and interactions
 * - DiscordEventTransport: An event transport for integrating with the EdgeWorker
 * - Type guards for working with Discord-specific agent events
 *
 * @example
 * Basic usage with standalone bot:
 * ```typescript
 * import { DiscordBot } from 'cyrus-discord-bot';
 *
 * const bot = new DiscordBot({
 *   botToken: process.env.DISCORD_BOT_TOKEN,
 *   applicationId: process.env.DISCORD_APPLICATION_ID,
 * });
 *
 * bot.on('sessionCreate', async (event) => {
 *   console.log('New session:', event.sessionId);
 *   await bot.sendResponse(event.channelId, {
 *     content: 'Hello! I am Cyrus.',
 *   }, event.threadId);
 * });
 *
 * await bot.start();
 * ```
 *
 * @example
 * Usage with EdgeWorker integration:
 * ```typescript
 * import { DiscordEventTransport } from 'cyrus-discord-bot';
 *
 * const transport = new DiscordEventTransport({
 *   botConfig: {
 *     botToken: process.env.DISCORD_BOT_TOKEN,
 *     applicationId: process.env.DISCORD_APPLICATION_ID,
 *     guildIds: ['123456789'], // Optional: restrict to specific guilds
 *   },
 * });
 *
 * transport.on('event', (event) => {
 *   // Handle the event (similar to Linear webhook events)
 *   console.log('Discord event:', event.type, event.action);
 * });
 *
 * transport.register();
 * ```
 *
 * @module cyrus-discord-bot
 */

// Main bot client
export { DiscordBot } from "./DiscordBot.js";

// Event transport for EdgeWorker integration
export {
	type DiscordAgentEvent,
	DiscordEventTransport,
	type DiscordTransportEvents,
	isDiscordAgentEvent,
	isDiscordSessionCreatedEvent,
	isDiscordSessionEndedEvent,
	isDiscordSessionPromptedEvent,
} from "./DiscordEventTransport.js";

// Types
export type {
	DiscordAttachment,
	DiscordBotConfig,
	DiscordEventTransportConfig,
	DiscordEventTransportEvents,
	DiscordResponse,
	DiscordSessionCreateEvent,
	DiscordSessionEndEvent,
	DiscordSessionPromptEvent,
	DiscordSessionState,
	DiscordUser,
} from "./types.js";
