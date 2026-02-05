/**
 * Tests for DiscordEventTransport.
 *
 * These tests verify that Discord events are properly transformed into
 * the agent event format expected by the EdgeWorker.
 */

import { describe, expect, it } from "vitest";
import {
	type DiscordAgentEvent,
	type DiscordSessionCreateEvent,
	type DiscordSessionEndEvent,
	type DiscordSessionPromptEvent,
	isDiscordAgentEvent,
	isDiscordSessionCreatedEvent,
	isDiscordSessionEndedEvent,
	isDiscordSessionPromptedEvent,
} from "../src/index.js";

describe("DiscordEventTransport", () => {
	describe("Type Guards", () => {
		describe("isDiscordAgentEvent", () => {
			it("should return true for valid Discord agent session events", () => {
				const event: DiscordAgentEvent = {
					type: "DiscordAgentSessionEvent",
					action: "created",
					createdAt: new Date().toISOString(),
					discord: {
						sessionId: "session-123",
						guildId: "guild-123",
						channelId: "channel-123",
						messageId: "msg-123",
						user: {
							id: "user-123",
							username: "testuser",
							displayName: "Test User",
						},
						content: "Hello Cyrus!",
					},
					originalEvent: {
						type: "discord_session_create",
						sessionId: "session-123",
						guildId: "guild-123",
						channelId: "channel-123",
						user: {
							id: "user-123",
							username: "testuser",
							displayName: "Test User",
							discriminator: "0",
							isBot: false,
						},
						content: "Hello Cyrus!",
						timestamp: new Date(),
						messageId: "msg-123",
					} as DiscordSessionCreateEvent,
				};

				expect(isDiscordAgentEvent(event)).toBe(true);
			});

			it("should return true for Discord app user notification events", () => {
				const event: DiscordAgentEvent = {
					type: "DiscordAppUserNotification",
					action: "ended",
					createdAt: new Date().toISOString(),
					discord: {
						sessionId: "session-123",
						guildId: "",
						channelId: "",
						messageId: "",
						user: {
							id: "user-123",
							username: "testuser",
							displayName: "Test User",
						},
						content: "Session ended: user_request",
					},
					originalEvent: {
						type: "discord_session_end",
						sessionId: "session-123",
						reason: "user_request",
						timestamp: new Date(),
					} as DiscordSessionEndEvent,
				};

				expect(isDiscordAgentEvent(event)).toBe(true);
			});

			it("should return false for non-Discord events", () => {
				expect(isDiscordAgentEvent(null)).toBe(false);
				expect(isDiscordAgentEvent(undefined)).toBe(false);
				expect(isDiscordAgentEvent({})).toBe(false);
				expect(isDiscordAgentEvent({ type: "LinearEvent" })).toBe(false);
				expect(
					isDiscordAgentEvent({
						type: "DiscordAgentSessionEvent",
						// Missing discord property
					}),
				).toBe(false);
			});
		});

		describe("isDiscordSessionCreatedEvent", () => {
			it("should return true for session created events", () => {
				const event: DiscordAgentEvent = {
					type: "DiscordAgentSessionEvent",
					action: "created",
					createdAt: new Date().toISOString(),
					discord: {
						sessionId: "session-123",
						guildId: "guild-123",
						channelId: "channel-123",
						messageId: "msg-123",
						user: {
							id: "user-123",
							username: "testuser",
							displayName: "Test User",
						},
						content: "Hello!",
					},
					originalEvent: {} as DiscordSessionCreateEvent,
				};

				expect(isDiscordSessionCreatedEvent(event)).toBe(true);
			});

			it("should return false for other event types", () => {
				const promptedEvent: DiscordAgentEvent = {
					type: "DiscordAgentSessionEvent",
					action: "prompted",
					createdAt: new Date().toISOString(),
					discord: {
						sessionId: "session-123",
						guildId: "guild-123",
						channelId: "channel-123",
						messageId: "msg-123",
						user: {
							id: "user-123",
							username: "testuser",
							displayName: "Test User",
						},
						content: "Follow-up",
					},
					originalEvent: {} as DiscordSessionPromptEvent,
				};

				expect(isDiscordSessionCreatedEvent(promptedEvent)).toBe(false);
			});
		});

		describe("isDiscordSessionPromptedEvent", () => {
			it("should return true for session prompted events", () => {
				const event: DiscordAgentEvent = {
					type: "DiscordAgentSessionEvent",
					action: "prompted",
					createdAt: new Date().toISOString(),
					discord: {
						sessionId: "session-123",
						guildId: "guild-123",
						channelId: "channel-123",
						messageId: "msg-456",
						user: {
							id: "user-123",
							username: "testuser",
							displayName: "Test User",
						},
						content: "Can you also do this?",
					},
					agentActivity: {
						id: "msg-456",
						content: {
							type: "prompt",
							body: "Can you also do this?",
						},
					},
					originalEvent: {} as DiscordSessionPromptEvent,
				};

				expect(isDiscordSessionPromptedEvent(event)).toBe(true);
			});
		});

		describe("isDiscordSessionEndedEvent", () => {
			it("should return true for session ended events", () => {
				const event: DiscordAgentEvent = {
					type: "DiscordAppUserNotification",
					action: "ended",
					createdAt: new Date().toISOString(),
					discord: {
						sessionId: "session-123",
						guildId: "",
						channelId: "",
						messageId: "",
						user: {
							id: "system",
							username: "system",
							displayName: "System",
						},
						content: "Session ended: timeout",
					},
					originalEvent: {} as DiscordSessionEndEvent,
				};

				expect(isDiscordSessionEndedEvent(event)).toBe(true);
			});
		});
	});

	describe("Event Structure", () => {
		it("should have correct structure for session create events", () => {
			const event: DiscordAgentEvent = {
				type: "DiscordAgentSessionEvent",
				action: "created",
				createdAt: "2025-02-05T12:00:00.000Z",
				discord: {
					sessionId: "thread-123456789012345678",
					guildId: "guild-123456789012345678",
					channelId: "channel-123456789012345678",
					threadId: "thread-123456789012345678",
					messageId: "msg-123456789012345678",
					user: {
						id: "user-123456789012345678",
						username: "developer",
						displayName: "Developer Name",
					},
					content: "Hey Cyrus, can you help me with a bug?",
					attachments: [
						{
							id: "att-1",
							filename: "error.png",
							url: "https://cdn.discordapp.com/attachments/...",
							contentType: "image/png",
						},
					],
				},
				agentSession: {
					id: "thread-123456789012345678",
					issueId: "thread-123456789012345678",
					status: "active",
				},
				issue: {
					id: "thread-123456789012345678",
					identifier: "DISCORD-5678-345678",
					title: "Hey Cyrus, can you help me with a bug?",
					description: "Hey Cyrus, can you help me with a bug?",
					url: "https://discord.com/channels/guild-123456789012345678/thread-123456789012345678",
				},
				originalEvent: {
					type: "discord_session_create",
					sessionId: "thread-123456789012345678",
					guildId: "guild-123456789012345678",
					channelId: "channel-123456789012345678",
					threadId: "thread-123456789012345678",
					user: {
						id: "user-123456789012345678",
						username: "developer",
						displayName: "Developer Name",
						discriminator: "0",
						isBot: false,
					},
					content: "Hey Cyrus, can you help me with a bug?",
					attachments: [
						{
							id: "att-1",
							filename: "error.png",
							url: "https://cdn.discordapp.com/attachments/...",
							proxyUrl: "https://media.discordapp.net/attachments/...",
							size: 1024,
							contentType: "image/png",
						},
					],
					timestamp: new Date("2025-02-05T12:00:00.000Z"),
					messageId: "msg-123456789012345678",
				} as DiscordSessionCreateEvent,
			};

			// Verify structure
			expect(event.type).toBe("DiscordAgentSessionEvent");
			expect(event.action).toBe("created");
			expect(event.discord.sessionId).toBeDefined();
			expect(event.discord.user.username).toBe("developer");
			expect(event.agentSession?.id).toBe(event.discord.sessionId);
			expect(event.issue?.identifier).toMatch(/^DISCORD-/);
		});
	});
});
