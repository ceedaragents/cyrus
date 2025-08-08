import { describe, expect, it } from "vitest";
import type {
	LinearWebhookAgentActivity,
	LinearAgentSessionPromptedWebhook,
} from "cyrus-core";

describe("LinearWebhookAgentActivity - agentContext deprecation", () => {
	it("should handle AgentActivity webhook without agentContextId", () => {
		// This represents the actual webhook payload from Linear API
		// which no longer includes agentContextId
		const actualWebhookPayload = {
			id: "activity-123",
			createdAt: "2025-01-08T10:00:00.000Z",
			updatedAt: "2025-01-08T10:00:00.000Z",
			archivedAt: null,
			// agentContextId is missing - deprecated in Linear API
			agentSessionId: "session-123",
			sourceCommentId: "comment-123",
			content: {
				type: "thought" as const,
				body: "Processing request...",
			},
		};

		// This test will fail because our type requires agentContextId
		// but the actual webhook doesn't include it
		const activity: LinearWebhookAgentActivity = actualWebhookPayload;

		// TypeScript should complain about missing agentContextId
		expect(activity.agentSessionId).toBe("session-123");
	});

	it("should fail type checking when parsing real webhook without agentContextId", () => {
		// This simulates parsing a real webhook that doesn't have agentContextId
		const webhookPayload: LinearAgentSessionPromptedWebhook = {
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
				// @ts-expect-error - agentContextId is required by type but not sent by Linear
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

		// This test passes because we're using @ts-expect-error
		// but it demonstrates the type mismatch
		expect(webhookPayload.agentActivity.agentSessionId).toBe("session-123");
	});

	it("should demonstrate that agentContextId is no longer sent by Linear", () => {
		// Example of a real webhook event that would be received
		const webhookEvent = {
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
				status: "active" as const,
				startedAt: "2025-01-08T10:00:00.000Z",
				endedAt: null,
				type: "commentThread" as const,
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
				// Note: agentContextId is not included in the actual webhook
				agentSessionId: "session-123",
				sourceCommentId: "comment-123",
				content: {
					type: "prompt" as const,
					body: "Please help with this task",
				},
			},
			webhookTimestamp: "1736330400000",
			webhookId: "webhook-123",
		};

		// This demonstrates that we need to update our types to make
		// agentContextId optional or remove it entirely
		expect(webhookEvent.agentActivity).not.toHaveProperty("agentContextId");
	});
});