import { LinearClient } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinearAgentSessionPromptedWebhook } from "cyrus-core";
import { AgentSessionManager } from "../src/AgentSessionManager";

// Mock LinearClient
vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		createAgentActivity: vi.fn(),
	})),
	LinearDocument: {
		AgentSessionType: {
			CommentThread: "comment_thread",
		},
		AgentSessionStatus: {
			Active: "active",
			Complete: "complete",
			Error: "error",
		},
	},
}));

describe("AgentSessionManager - Webhook Type Compatibility", () => {
	let manager: AgentSessionManager;
	let mockLinearClient: any;

	beforeEach(() => {
		mockLinearClient = new LinearClient({ apiKey: "test" });
		manager = new AgentSessionManager(mockLinearClient);
	});

	it("FAILING TEST: Should handle Linear webhook with missing agentContextId", () => {
		// This simulates receiving a webhook from Linear's API
		// Linear no longer sends agentContextId in the AgentActivity object
		const webhookFromLinear = {
			type: "AgentSessionEvent",
			action: "prompted",
			createdAt: "2025-01-08T10:00:00.000Z",
			organizationId: "org-123",
			oauthClientId: "client-123",
			appUserId: "user-123",
			agentSession: {
				id: "session-123",
				createdAt: "2025-01-08T10:00:00.000Z",
				updatedAt: "2025-01-08T10:00:00.000Z",
				archivedAt: null,
				creatorId: "creator-123",
				appUserId: "user-123",
				commentId: "comment-123",
				issueId: "issue-123",
				status: "active",
				startedAt: "2025-01-08T10:00:00.000Z",
				endedAt: null,
				type: "commentThread",
				summary: null,
				sourceMetadata: null,
				organizationId: "org-123",
				creator: {
					id: "creator-123",
					name: "Test User",
					email: "test@example.com",
					avatarUrl: "https://example.com/avatar.png",
					url: "https://linear.app/profiles/test",
				},
				comment: {
					id: "comment-123",
					body: "Test comment",
					userId: "user-123",
					issueId: "issue-123",
				},
				issue: {
					id: "issue-123",
					title: "Test Issue",
					teamId: "team-123",
					team: {
						id: "team-123",
						key: "TEST",
						name: "Test Team",
					},
					identifier: "TEST-123",
					url: "https://linear.app/test/issue/TEST-123",
				},
			},
			agentActivity: {
				id: "activity-123",
				createdAt: "2025-01-08T10:00:00.000Z",
				updatedAt: "2025-01-08T10:00:00.000Z",
				archivedAt: null,
				// agentContextId is NOT included - this is what Linear actually sends
				agentSessionId: "session-123",
				sourceCommentId: "comment-123",
				content: {
					type: "prompt",
					body: "Please help with this task",
				},
			},
			webhookTimestamp: "1736330400000",
			webhookId: "webhook-123",
		};

		// This assignment will fail TypeScript checking because
		// LinearAgentSessionPromptedWebhook expects agentContextId in agentActivity
		// @ts-expect-error - Type error: agentContextId is missing
		const typedWebhook: LinearAgentSessionPromptedWebhook = webhookFromLinear;

		expect(typedWebhook.agentActivity.agentSessionId).toBe("session-123");
	});

	it("Shows the impact: webhook handlers would fail type checking", () => {
		// This is how a webhook handler might look
		function handleLinearWebhook(webhook: unknown): void {
			// Parse the webhook
			const data = webhook as any;

			// Type guard to check if it's an agent session prompted webhook
			if (data.type === "AgentSessionEvent" && data.action === "prompted") {
				// This assignment would fail because agentContextId is missing
				// @ts-expect-error - agentContextId is required but not present
				const promptedWebhook: LinearAgentSessionPromptedWebhook = data;

				// Process the webhook
				console.log("Processing prompted webhook:", promptedWebhook.agentActivity.id);
			}
		}

		// Real webhook data from Linear
		const realWebhookData = {
			type: "AgentSessionEvent",
			action: "prompted",
			agentActivity: {
				id: "activity-123",
				// No agentContextId field!
				agentSessionId: "session-123",
				sourceCommentId: "comment-123",
				content: { type: "prompt", body: "Help needed" },
				createdAt: "2025-01-08T10:00:00.000Z",
				updatedAt: "2025-01-08T10:00:00.000Z",
				archivedAt: null,
			},
			// ... other fields
		};

		// This would fail at runtime due to type mismatch
		expect(() => handleLinearWebhook(realWebhookData)).not.toThrow();
	});

	it("Demonstrates the fix: agentContextId should be optional", () => {
		// This is what the fixed type should look like
		interface FixedLinearAgentSessionPromptedWebhook {
			type: "AgentSessionEvent";
			action: "prompted";
			agentActivity: {
				id: string;
				createdAt: string;
				updatedAt: string;
				archivedAt: string | null;
				agentContextId?: string | null; // Optional!
				agentSessionId: string;
				sourceCommentId: string;
				content: {
					type: string;
					body: string;
				};
			};
			// ... other fields
		}

		// Now this works without type errors
		const webhookData: FixedLinearAgentSessionPromptedWebhook = {
			type: "AgentSessionEvent",
			action: "prompted",
			agentActivity: {
				id: "activity-123",
				createdAt: "2025-01-08T10:00:00.000Z",
				updatedAt: "2025-01-08T10:00:00.000Z",
				archivedAt: null,
				// agentContextId can be omitted
				agentSessionId: "session-123",
				sourceCommentId: "comment-123",
				content: {
					type: "prompt",
					body: "Please help with this task",
				},
			},
		};

		expect(webhookData.agentActivity.agentSessionId).toBe("session-123");
		expect(webhookData.agentActivity.agentContextId).toBeUndefined();
	});
});