import type { Activity, WorkItem } from "cyrus-interfaces";
import { testUserInterfaceContract } from "cyrus-interfaces/test/contracts";
import { beforeEach, describe, expect, it } from "vitest";
import { LinearAdapter } from "../src/LinearAdapter.js";
import {
	createMockLinearClient,
	createMockWebhookClient,
	type MockLinearClient,
	type MockWebhookClient,
} from "./fixtures/mockClients.js";
import {
	mockAgentSessionCreatedWebhook,
	mockIssueAssignedWebhook,
	mockIssueCommentMentionWebhook,
	mockIssueNewCommentWebhook,
} from "./fixtures/mockWebhooks.js";

describe("LinearAdapter", () => {
	let adapter: LinearAdapter;
	let mockLinearClient: MockLinearClient;
	let mockWebhookClient: MockWebhookClient;

	beforeEach(() => {
		mockLinearClient = createMockLinearClient() as unknown as MockLinearClient;
		mockWebhookClient =
			createMockWebhookClient() as unknown as MockWebhookClient;

		adapter = new LinearAdapter({
			linearClient: mockLinearClient as any,
			webhookClient: mockWebhookClient as any,
		});
	});

	describe("Contract Tests", () => {
		testUserInterfaceContract(
			async () => {
				const client = createMockLinearClient() as unknown as MockLinearClient;
				const webhookClient =
					createMockWebhookClient() as unknown as MockWebhookClient;

				// Setup test issue
				client.addIssue({
					id: "test-work-item-id",
					title: "Test Issue",
					description: "Test description",
					identifier: "TEST-1",
					url: "https://linear.app/test/issue/TEST-1",
					teamId: "team-1",
					team: Promise.resolve({
						id: "team-1",
						key: "TEST",
						name: "Test Team",
						states: async () => ({
							nodes: [
								{ id: "state-1", name: "In Progress" },
								{ id: "state-2", name: "Done" },
							],
						}),
					}),
					assignee: Promise.resolve({
						id: "user-1",
						name: "Test User",
						email: "test@example.com",
					}),
					state: Promise.resolve({ name: "In Progress" }),
					priority: 2,
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				// Setup test agent session
				client.addAgentSession({
					id: "session-1",
					issueId: "test-work-item-id",
					status: "active",
				});

				return new LinearAdapter({
					linearClient: client as any,
					webhookClient: webhookClient as any,
				});
			},
			{
				triggerWorkItem: async (ui) => {
					const adapter = ui as LinearAdapter;
					const webhookClient = (adapter as any)
						.webhookClient as MockWebhookClient;

					// Simulate webhook
					webhookClient.simulateWebhook(mockAgentSessionCreatedWebhook);
				},
				skip: {
					// Skip some tests that require real Linear integration
					activityPosting: false,
					workItemUpdate: false,
				},
			},
		);
	});

	describe("Webhook Translation", () => {
		beforeEach(async () => {
			await adapter.initialize();
		});

		it("should translate issue assigned webhook to task WorkItem", async () => {
			const workItems: WorkItem[] = [];
			adapter.onWorkItem((item) => workItems.push(item));

			mockWebhookClient.simulateWebhook(mockIssueAssignedWebhook);

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(workItems).toHaveLength(1);
			expect(workItems[0]).toMatchObject({
				id: "issue-1",
				type: "task",
				title: "Test Issue Assignment",
				metadata: {
					source: "linear",
					issueId: "issue-1",
					issueIdentifier: "TEST-1",
				},
			});
		});

		it("should translate new comment webhook to conversation WorkItem", async () => {
			const workItems: WorkItem[] = [];
			adapter.onWorkItem((item) => workItems.push(item));

			mockWebhookClient.simulateWebhook(mockIssueNewCommentWebhook);

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(workItems).toHaveLength(1);
			expect(workItems[0]).toMatchObject({
				id: "issue-1-comment-1",
				type: "conversation",
				title: "Comment on: Test Issue",
				description: "This is a test comment",
				metadata: {
					source: "linear",
					commentId: "comment-1",
				},
			});
		});

		it("should translate comment mention webhook to command WorkItem", async () => {
			const workItems: WorkItem[] = [];
			adapter.onWorkItem((item) => workItems.push(item));

			mockWebhookClient.simulateWebhook(mockIssueCommentMentionWebhook);

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(workItems).toHaveLength(1);
			expect(workItems[0]).toMatchObject({
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

		it("should translate agent session created webhook", async () => {
			const workItems: WorkItem[] = [];
			adapter.onWorkItem((item) => workItems.push(item));

			mockWebhookClient.simulateWebhook(mockAgentSessionCreatedWebhook);

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(workItems).toHaveLength(1);
			expect(workItems[0]).toMatchObject({
				id: "session-1",
				type: "conversation",
				metadata: {
					source: "linear",
					agentSessionId: "session-1",
				},
			});
		});

		it("should map agent session to work item for activity posting", async () => {
			adapter.onWorkItem(() => {});

			mockWebhookClient.simulateWebhook(mockAgentSessionCreatedWebhook);

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should be able to post activity to this session now
			const activity: Activity = {
				id: "act-1",
				workItemId: "session-1",
				timestamp: new Date(),
				type: "thought",
				content: { type: "text", text: "Test thought" },
			};

			await expect(adapter.postActivity(activity)).resolves.not.toThrow();
		});
	});

	describe("Activity Posting", () => {
		beforeEach(async () => {
			await adapter.initialize();

			// Setup session mapping
			adapter.onWorkItem(() => {});
			mockWebhookClient.simulateWebhook(mockAgentSessionCreatedWebhook);
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		it("should post text thought activities", async () => {
			const activity: Activity = {
				id: "act-1",
				workItemId: "session-1",
				timestamp: new Date(),
				type: "thought",
				content: {
					type: "text",
					text: "Thinking about the problem...",
				},
			};

			await adapter.postActivity(activity);

			const activities = mockLinearClient.getActivities("session-1");
			expect(activities).toHaveLength(1);
			expect(activities[0].content).toMatchObject({
				type: "thought",
				body: "Thinking about the problem...",
			});
		});

		it("should post action activities with tool use", async () => {
			const activity: Activity = {
				id: "act-2",
				workItemId: "session-1",
				timestamp: new Date(),
				type: "action",
				content: {
					type: "tool_use",
					tool: "bash",
					input: { command: "ls -la" },
				},
			};

			await adapter.postActivity(activity);

			const activities = mockLinearClient.getActivities("session-1");
			expect(activities).toHaveLength(1);
			expect(activities[0].content.type).toBe("action");
			expect(activities[0].content.action).toBe("bash");
		});

		it("should post error activities", async () => {
			const activity: Activity = {
				id: "act-3",
				workItemId: "session-1",
				timestamp: new Date(),
				type: "error",
				content: {
					type: "error",
					message: "Something went wrong",
					stack: "Error: at line 42",
				},
			};

			await adapter.postActivity(activity);

			const activities = mockLinearClient.getActivities("session-1");
			expect(activities).toHaveLength(1);
			expect(activities[0].content.type).toBe("error");
			expect(activities[0].content.body).toContain("Something went wrong");
			expect(activities[0].content.body).toContain("Error: at line 42");
		});

		it("should reject posting to non-existent session", async () => {
			const activity: Activity = {
				id: "act-4",
				workItemId: "non-existent",
				timestamp: new Date(),
				type: "thought",
				content: { type: "text", text: "Test" },
			};

			await expect(adapter.postActivity(activity)).rejects.toThrow(
				/No agent session found/,
			);
		});
	});

	describe("Work Item Queries", () => {
		beforeEach(async () => {
			await adapter.initialize();

			// Add test issue
			mockLinearClient.addIssue({
				id: "issue-1",
				title: "Test Issue",
				description: "Test description",
				identifier: "TEST-1",
				url: "https://linear.app/test/issue/TEST-1",
				teamId: "team-1",
				team: Promise.resolve({
					id: "team-1",
					key: "TEST",
					name: "Test Team",
				}),
				assignee: Promise.resolve({
					id: "user-1",
					name: "Test User",
					email: "test@example.com",
				}),
				state: Promise.resolve({ name: "In Progress" }),
				priority: 2,
				createdAt: new Date(),
				updatedAt: new Date(),
			});
		});

		it("should fetch work item by ID", async () => {
			const workItem = await adapter.getWorkItem("issue-1");

			expect(workItem).toMatchObject({
				id: "issue-1",
				type: "task",
				title: "Test Issue",
				description: "Test description",
				metadata: {
					source: "linear",
					issueIdentifier: "TEST-1",
				},
			});
		});

		it("should return null for non-existent issue", async () => {
			await expect(adapter.getWorkItem("non-existent")).rejects.toThrow();
		});
	});

	describe("History Queries", () => {
		beforeEach(async () => {
			await adapter.initialize();

			// Setup session and activities
			mockLinearClient.addAgentSession({
				id: "session-1",
				issueId: "issue-1",
				status: "active",
			});

			// Map session to work item
			adapter.onWorkItem(() => {});
			mockWebhookClient.simulateWebhook(mockAgentSessionCreatedWebhook);
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Add some activities
			await adapter.postActivity({
				id: "act-1",
				workItemId: "session-1",
				timestamp: new Date(),
				type: "thought",
				content: { type: "text", text: "First thought" },
			});

			await adapter.postActivity({
				id: "act-2",
				workItemId: "session-1",
				timestamp: new Date(),
				type: "action",
				content: { type: "tool_use", tool: "bash", input: { command: "pwd" } },
			});
		});

		it("should fetch work item history", async () => {
			const history = await adapter.getWorkItemHistory("session-1");

			expect(history).toHaveLength(2);
			expect(history[0].workItemId).toBe("session-1");
			expect(history[0].type).toBe("thought");
			expect(history[1].type).toBe("action");
		});

		it("should return empty history for unmapped work item", async () => {
			const history = await adapter.getWorkItemHistory("unmapped");
			expect(history).toEqual([]);
		});
	});

	describe("Lifecycle", () => {
		it("should initialize successfully", async () => {
			await expect(adapter.initialize()).resolves.not.toThrow();
			expect(mockWebhookClient.isConnected()).toBe(true);
		});

		it("should shutdown successfully", async () => {
			await adapter.initialize();
			await expect(adapter.shutdown()).resolves.not.toThrow();
			expect(mockWebhookClient.isConnected()).toBe(false);
		});

		it("should throw when posting activity before initialization", async () => {
			const activity: Activity = {
				id: "act-1",
				workItemId: "work-1",
				timestamp: new Date(),
				type: "thought",
				content: { type: "text", text: "Test" },
			};

			await expect(adapter.postActivity(activity)).rejects.toThrow(
				/not initialized/,
			);
		});
	});
});
