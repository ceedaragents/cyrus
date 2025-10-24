import type { Activity } from "cyrus-interfaces";
import { describe, expect, it } from "vitest";
import {
	translateActivityToLinear,
	translateWebhookToWorkItem,
	translateWorkItemUpdate,
} from "../src/translators.js";
import {
	mockAgentSessionCreatedWebhook,
	mockAgentSessionPromptedWebhook,
	mockIssueAssignedWebhook,
	mockIssueCommentMentionWebhook,
	mockIssueNewCommentWebhook,
} from "./fixtures/mockWebhooks.js";

describe("Translator Functions", () => {
	describe("translateWebhookToWorkItem", () => {
		it("should translate issue assigned webhook to task WorkItem", () => {
			const workItem = translateWebhookToWorkItem(mockIssueAssignedWebhook);

			expect(workItem).not.toBeNull();
			expect(workItem).toMatchObject({
				id: "issue-1",
				type: "task",
				title: "Test Issue Assignment",
				description: "Issue TEST-1 assigned by Test Actor",
				metadata: {
					source: "linear",
					issueId: "issue-1",
					issueIdentifier: "TEST-1",
					teamKey: "TEST",
					actorName: "Test Actor",
				},
			});
			expect(workItem?.context).toHaveProperty("issueIdentifier", "TEST-1");
			expect(workItem?.context).toHaveProperty("teamKey", "TEST");
		});

		it("should translate new comment webhook to conversation WorkItem", () => {
			const workItem = translateWebhookToWorkItem(mockIssueNewCommentWebhook);

			expect(workItem).not.toBeNull();
			expect(workItem).toMatchObject({
				id: "issue-1-comment-1",
				type: "conversation",
				title: "Comment on: Test Issue",
				description: "This is a test comment",
				metadata: {
					source: "linear",
					issueId: "issue-1",
					commentId: "comment-1",
				},
			});
		});

		it("should translate comment mention webhook to command WorkItem", () => {
			const workItem = translateWebhookToWorkItem(
				mockIssueCommentMentionWebhook,
			);

			expect(workItem).not.toBeNull();
			expect(workItem).toMatchObject({
				id: "issue-1-comment-2",
				type: "command",
				title: "Mention in: Test Issue",
				description: "@cyrus please help with this",
				metadata: {
					source: "linear",
					commentId: "comment-2",
				},
			});
		});

		it("should translate agent session created webhook to conversation WorkItem", () => {
			const workItem = translateWebhookToWorkItem(
				mockAgentSessionCreatedWebhook,
			);

			expect(workItem).not.toBeNull();
			expect(workItem).toMatchObject({
				id: "session-1",
				type: "conversation",
				title: "Agent session: Test Issue",
				description: "Create a new agent session",
				metadata: {
					source: "linear",
					agentSessionId: "session-1",
					issueId: "issue-1",
				},
			});
			expect(workItem?.context).toHaveProperty("agentSessionId", "session-1");
			expect(workItem?.context).toHaveProperty(
				"agentSessionType",
				"commentThread",
			);
		});

		it("should translate agent session prompted webhook to conversation WorkItem", () => {
			const workItem = translateWebhookToWorkItem(
				mockAgentSessionPromptedWebhook,
			);

			expect(workItem).not.toBeNull();
			expect(workItem).toMatchObject({
				id: "session-1-activity-1",
				type: "conversation",
				title: "Feedback on: Test Issue",
				description: "Please continue with the implementation",
				metadata: {
					source: "linear",
					agentSessionId: "session-1",
					agentActivityId: "activity-1",
				},
			});
			expect(workItem?.context).toHaveProperty("agentActivityId", "activity-1");
			expect(workItem?.context).toHaveProperty("agentActivityType", "prompt");
		});

		it("should include all required metadata fields", () => {
			const workItem = translateWebhookToWorkItem(mockIssueAssignedWebhook);

			expect(workItem?.metadata).toHaveProperty("source", "linear");
			expect(workItem?.metadata).toHaveProperty("organizationId");
			expect(workItem?.metadata).toHaveProperty("oauthClientId");
			expect(workItem?.metadata).toHaveProperty("webhookId");
			expect(workItem?.metadata).toHaveProperty("webhookTimestamp");
			expect(workItem?.metadata).toHaveProperty("actorId");
			expect(workItem?.metadata).toHaveProperty("actorName");
			expect(workItem?.metadata).toHaveProperty("actorEmail");
		});
	});

	describe("translateActivityToLinear", () => {
		const agentSessionId = "session-123";

		it("should translate thought activity to Linear thought", () => {
			const activity: Activity = {
				id: "act-1",
				workItemId: "work-1",
				timestamp: new Date(),
				type: "thought",
				content: {
					type: "text",
					text: "Analyzing the requirements...",
				},
			};

			const linearActivity = translateActivityToLinear(
				activity,
				agentSessionId,
			);

			expect(linearActivity).toMatchObject({
				agentSessionId: "session-123",
				content: {
					type: "thought",
					body: "Analyzing the requirements...",
				},
				ephemeral: false,
			});
			expect(linearActivity.signalMetadata).toHaveProperty(
				"cyrusActivityId",
				"act-1",
			);
		});

		it("should translate action activity with tool use to Linear action", () => {
			const activity: Activity = {
				id: "act-2",
				workItemId: "work-1",
				timestamp: new Date(),
				type: "action",
				content: {
					type: "tool_use",
					tool: "bash",
					input: { command: "ls -la" },
				},
			};

			const linearActivity = translateActivityToLinear(
				activity,
				agentSessionId,
			);

			expect(linearActivity.content).toMatchObject({
				type: "action",
				action: "bash",
				parameter: '{"command":"ls -la"}',
			});
		});

		it("should translate result activity with tool result to Linear response", () => {
			const activity: Activity = {
				id: "act-3",
				workItemId: "work-1",
				timestamp: new Date(),
				type: "result",
				content: {
					type: "tool_result",
					tool: "bash",
					output: "file1.txt\nfile2.txt",
				},
			};

			const linearActivity = translateActivityToLinear(
				activity,
				agentSessionId,
			);

			expect(linearActivity.content.type).toBe("response");
			expect(linearActivity.content.body).toContain("bash result");
			expect(linearActivity.content.body).toContain("file1.txt");
		});

		it("should translate error activity to Linear error", () => {
			const activity: Activity = {
				id: "act-4",
				workItemId: "work-1",
				timestamp: new Date(),
				type: "error",
				content: {
					type: "error",
					message: "Command failed",
					stack: "Error: Command failed\n  at line 42",
				},
			};

			const linearActivity = translateActivityToLinear(
				activity,
				agentSessionId,
			);

			expect(linearActivity.content).toMatchObject({
				type: "error",
			});
			expect(linearActivity.content.body).toContain("Command failed");
			expect(linearActivity.content.body).toContain("at line 42");
		});

		it("should translate code content with language to markdown", () => {
			const activity: Activity = {
				id: "act-5",
				workItemId: "work-1",
				timestamp: new Date(),
				type: "thought",
				content: {
					type: "code",
					code: 'console.log("hello");',
					language: "javascript",
				},
			};

			const linearActivity = translateActivityToLinear(
				activity,
				agentSessionId,
			);

			expect(linearActivity.content.body).toContain("```javascript");
			expect(linearActivity.content.body).toContain('console.log("hello");');
			expect(linearActivity.content.body).toContain("```");
		});

		it("should include activity metadata in signalMetadata", () => {
			const activity: Activity = {
				id: "act-6",
				workItemId: "work-1",
				timestamp: new Date("2024-01-15T10:00:00Z"),
				type: "thought",
				content: { type: "text", text: "Test" },
				metadata: {
					custom: "value",
					another: 123,
				},
			};

			const linearActivity = translateActivityToLinear(
				activity,
				agentSessionId,
			);

			expect(linearActivity.signalMetadata).toMatchObject({
				cyrusActivityId: "act-6",
				cyrusActivityTimestamp: "2024-01-15T10:00:00.000Z",
				custom: "value",
				another: 123,
			});
		});
	});

	describe("translateWorkItemUpdate", () => {
		it("should translate status to Linear state", () => {
			const update = {
				status: "active" as const,
			};

			const result = translateWorkItemUpdate(update);

			expect(result.stateUpdate).toEqual({ name: "In Progress" });
		});

		it("should translate all status values", () => {
			const statusMap = {
				active: "In Progress",
				paused: "Paused",
				completed: "Done",
				failed: "Canceled",
				cancelled: "Canceled",
			};

			Object.entries(statusMap).forEach(([status, expectedState]) => {
				const result = translateWorkItemUpdate({
					status: status as any,
				});

				expect(result.stateUpdate).toEqual({ name: expectedState });
			});
		});

		it("should translate progress updates", () => {
			const update = {
				progress: 75,
			};

			const result = translateWorkItemUpdate(update);

			expect(result.progressUpdate).toBe(75);
		});

		it("should translate message updates to comments", () => {
			const update = {
				message: "Work is progressing well",
			};

			const result = translateWorkItemUpdate(update);

			expect(result.commentUpdate).toBe("Work is progressing well");
		});

		it("should handle combined updates", () => {
			const update = {
				status: "active" as const,
				progress: 50,
				message: "Halfway done",
			};

			const result = translateWorkItemUpdate(update);

			expect(result).toEqual({
				stateUpdate: { name: "In Progress" },
				progressUpdate: 50,
				commentUpdate: "Halfway done",
			});
		});

		it("should handle empty updates", () => {
			const result = translateWorkItemUpdate({});

			expect(result).toEqual({});
		});
	});
});
