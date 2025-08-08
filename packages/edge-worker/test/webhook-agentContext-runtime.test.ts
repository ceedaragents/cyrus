import { describe, expect, it } from "vitest";

describe("Linear Webhook - Runtime agentContextId Issue", () => {
	it("Runtime test: Shows agentContextId is undefined in actual webhooks", () => {
		// Simulate the actual JSON that Linear sends in webhooks
		const linearWebhookJSON = JSON.stringify({
			type: "AgentSessionEvent",
			action: "prompted",
			createdAt: "2025-01-08T10:00:00.000Z",
			organizationId: "org-123",
			oauthClientId: "client-123",
			appUserId: "user-123",
			agentSession: {
				id: "session-123",
				// ... session fields
			},
			agentActivity: {
				id: "activity-123",
				createdAt: "2025-01-08T10:00:00.000Z",
				updatedAt: "2025-01-08T10:00:00.000Z",
				archivedAt: null,
				// NOTE: agentContextId is NOT included in the JSON
				agentSessionId: "session-123",
				sourceCommentId: "comment-123",
				content: {
					type: "prompt",
					body: "Please help with this task",
				},
			},
			webhookTimestamp: "1736330400000",
			webhookId: "webhook-123",
		});

		// Parse the webhook as it would be received
		const webhook = JSON.parse(linearWebhookJSON);

		// At runtime, agentContextId is undefined
		expect(webhook.agentActivity.agentContextId).toBeUndefined();
		expect(webhook.agentActivity.agentSessionId).toBe("session-123");

		// This shows that any code expecting agentContextId to be a string or null
		// would fail because it's actually undefined
		const isValidAgentContextId = 
			typeof webhook.agentActivity.agentContextId === "string" ||
			webhook.agentActivity.agentContextId === null;
		
		expect(isValidAgentContextId).toBe(false); // It's undefined, not string or null!
	});

	it("Shows the problem: Type says 'string | null' but runtime is 'undefined'", () => {
		// According to our type, agentContextId should be string | null
		// But at runtime, it's undefined because Linear doesn't send it

		function processAgentActivity(activity: any) {
			// This check would fail for Linear webhooks
			if (activity.agentContextId === null) {
				console.log("agentContextId is explicitly null");
			} else if (typeof activity.agentContextId === "string") {
				console.log("agentContextId is a string:", activity.agentContextId);
			} else {
				// This is what actually happens with Linear webhooks
				console.log("agentContextId is undefined!");
				throw new Error("Unexpected agentContextId type");
			}
		}

		const linearActivity = {
			id: "activity-123",
			agentSessionId: "session-123",
			// agentContextId is missing
		};

		// This would throw an error at runtime
		expect(() => processAgentActivity(linearActivity)).toThrow("Unexpected agentContextId type");
	});

	it("Demonstrates the fix: Make agentContextId optional", () => {
		// The fix is to update the type definition
		interface FixedAgentActivity {
			id: string;
			agentSessionId: string;
			agentContextId?: string | null; // Optional with ?
		}

		// Now this handles all cases correctly
		function processFixedAgentActivity(activity: FixedAgentActivity) {
			if (activity.agentContextId === undefined) {
				console.log("agentContextId is not provided (undefined)");
			} else if (activity.agentContextId === null) {
				console.log("agentContextId is explicitly null");
			} else {
				console.log("agentContextId is a string:", activity.agentContextId);
			}
		}

		const linearActivity: FixedAgentActivity = {
			id: "activity-123",
			agentSessionId: "session-123",
			// agentContextId can be omitted
		};

		// This works correctly
		expect(() => processFixedAgentActivity(linearActivity)).not.toThrow();
	});
});