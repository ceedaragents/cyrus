// This test file uses strict type checking to demonstrate the agentContextId issue
import { describe, expect, it } from "vitest";
import type { LinearWebhookAgentActivity } from "cyrus-core";

describe("LinearWebhookAgentActivity - Strict Type Checking", () => {
	it("FAILING TEST: LinearWebhookAgentActivity requires agentContextId but Linear doesn't send it", () => {
		// This function simulates processing a webhook from Linear
		function processLinearWebhook(webhookData: unknown): LinearWebhookAgentActivity {
			// In real code, we'd parse the webhook JSON
			const data = webhookData as any;
			
			// This is what Linear actually sends (without agentContextId)
			const agentActivity: LinearWebhookAgentActivity = {
				id: data.id,
				createdAt: data.createdAt,
				updatedAt: data.updatedAt,
				archivedAt: data.archivedAt,
				// agentContextId is required by the type but not in the webhook!
				agentContextId: data.agentContextId, // This will be undefined
				agentSessionId: data.agentSessionId,
				sourceCommentId: data.sourceCommentId,
				content: data.content,
			};
			
			return agentActivity;
		}

		// Simulate actual webhook data from Linear (without agentContextId)
		const linearWebhookData = {
			id: "activity-123",
			createdAt: "2025-01-08T10:00:00.000Z",
			updatedAt: "2025-01-08T10:00:00.000Z",
			archivedAt: null,
			// Note: agentContextId is NOT included
			agentSessionId: "session-123",
			sourceCommentId: "comment-123",
			content: {
				type: "thought",
				body: "Processing request...",
			},
		};

		const result = processLinearWebhook(linearWebhookData);
		
		// This will pass at runtime but the type is incorrect
		expect(result.agentContextId).toBeUndefined(); // Actually undefined!
		expect(result.agentSessionId).toBe("session-123");
	});

	it("DEMONSTRATION: The fix would be to make agentContextId optional", () => {
		// This is what the type should look like
		interface FixedLinearWebhookAgentActivity {
			id: string;
			createdAt: string;
			updatedAt: string;
			archivedAt: string | null;
			agentContextId?: string | null; // Should be optional
			agentSessionId: string;
			sourceCommentId: string;
			content: {
				type: string;
				body: string;
			};
		}

		// Now this works correctly
		const activity: FixedLinearWebhookAgentActivity = {
			id: "activity-123",
			createdAt: "2025-01-08T10:00:00.000Z",
			updatedAt: "2025-01-08T10:00:00.000Z",
			archivedAt: null,
			// agentContextId can be omitted
			agentSessionId: "session-123",
			sourceCommentId: "comment-123",
			content: {
				type: "thought",
				body: "Processing request...",
			},
		};

		expect(activity.agentSessionId).toBe("session-123");
		expect(activity.agentContextId).toBeUndefined();
	});
});