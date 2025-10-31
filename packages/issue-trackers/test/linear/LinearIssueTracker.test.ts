/**
 * Unit tests for LinearIssueTracker
 */

import type { AgentSignal, IssueState } from "cyrus-interfaces";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinearIssueTracker } from "../../src/linear/LinearIssueTracker.js";

// Mock the LinearClient
vi.mock("@linear/sdk", () => {
	return {
		LinearClient: vi.fn().mockImplementation(() => {
			return {
				issue: vi.fn(),
				issues: vi.fn(),
				updateIssue: vi.fn(),
				createComment: vi.fn(),
				comments: vi.fn(),
				workflowStates: vi.fn(),
			};
		}),
	};
});

describe("LinearIssueTracker", () => {
	let tracker: LinearIssueTracker;
	let mockClient: any;

	beforeEach(async () => {
		// Reset mocks
		vi.clearAllMocks();

		// Import after mocking
		const { LinearClient } = await import("@linear/sdk");
		tracker = new LinearIssueTracker({
			accessToken: "test-token",
		});

		// Get the mocked client instance
		mockClient = (LinearClient as any).mock.results[0].value;
	});

	describe("constructor", () => {
		it("should create instance with config", () => {
			expect(tracker).toBeInstanceOf(LinearIssueTracker);
		});
	});

	describe("getIssue", () => {
		it("should fetch and map an issue", async () => {
			const mockLinearIssue = {
				id: "issue-123",
				identifier: "CYPACK-268",
				title: "Test Issue",
				description: "Test description",
				priority: 2,
				url: "https://linear.app/issue/123",
				createdAt: new Date("2025-01-01"),
				updatedAt: new Date("2025-01-02"),
				state: Promise.resolve({
					id: "state-123",
					name: "In Progress",
					type: "started",
					position: 1,
				}),
				assignee: Promise.resolve({
					id: "user-123",
					name: "johndoe",
					displayName: "John Doe",
					email: "john@example.com",
				}),
				labels: vi.fn().mockResolvedValue({
					nodes: [
						{
							id: "label-123",
							name: "bug",
							color: "#ff0000",
						},
					],
				}),
				team: Promise.resolve({
					id: "team-123",
					name: "Test Team",
				}),
			};

			mockClient.issue.mockResolvedValue(mockLinearIssue);

			const issue = await tracker.getIssue("CYPACK-268");

			expect(mockClient.issue).toHaveBeenCalledWith("CYPACK-268");
			expect(issue).toMatchObject({
				id: "issue-123",
				identifier: "CYPACK-268",
				title: "Test Issue",
				description: "Test description",
				priority: 2,
				url: "https://linear.app/issue/123",
			});
			expect(issue.state.type).toBe("started");
			expect(issue.assignee?.name).toBe("John Doe");
			expect(issue.labels).toHaveLength(1);
			expect(issue.labels[0].name).toBe("bug");
		});

		it("should throw error if issue not found", async () => {
			mockClient.issue.mockRejectedValue(new Error("Issue not found"));

			await expect(tracker.getIssue("INVALID-123")).rejects.toThrow(
				"Failed to get issue INVALID-123",
			);
		});
	});

	describe("listAssignedIssues", () => {
		it("should list issues for a member", async () => {
			const mockIssue = {
				id: "issue-123",
				identifier: "CYPACK-268",
				title: "Test Issue",
				description: "Test",
				priority: 2,
				url: "https://linear.app/issue/123",
				createdAt: new Date("2025-01-01"),
				updatedAt: new Date("2025-01-02"),
				state: Promise.resolve({
					id: "state-123",
					name: "In Progress",
					type: "started",
					position: 1,
				}),
				assignee: Promise.resolve(null),
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
				team: Promise.resolve({ id: "team-123" }),
			};

			mockClient.issues.mockResolvedValue({
				nodes: [mockIssue],
			});

			const issues = await tracker.listAssignedIssues("user-123");

			expect(mockClient.issues).toHaveBeenCalledWith({
				filter: {
					assignee: { id: { eq: "user-123" } },
				},
				first: 50,
			});
			expect(issues).toHaveLength(1);
			expect(issues[0].identifier).toBe("CYPACK-268");
		});

		it("should apply state filters", async () => {
			mockClient.issues.mockResolvedValue({ nodes: [] });

			await tracker.listAssignedIssues("user-123", {
				state: "started",
			});

			expect(mockClient.issues).toHaveBeenCalledWith({
				filter: {
					assignee: { id: { eq: "user-123" } },
					state: { type: { eq: "started" } },
				},
				first: 50,
			});
		});

		it("should apply multiple state filters", async () => {
			mockClient.issues.mockResolvedValue({ nodes: [] });

			await tracker.listAssignedIssues("user-123", {
				state: ["started", "unstarted"],
			});

			expect(mockClient.issues).toHaveBeenCalledWith({
				filter: {
					assignee: { id: { eq: "user-123" } },
					state: { type: { in: ["started", "unstarted"] } },
				},
				first: 50,
			});
		});

		it("should apply priority filters", async () => {
			mockClient.issues.mockResolvedValue({ nodes: [] });

			await tracker.listAssignedIssues("user-123", {
				priority: 1,
			});

			expect(mockClient.issues).toHaveBeenCalledWith({
				filter: {
					assignee: { id: { eq: "user-123" } },
					priority: { eq: 1 },
				},
				first: 50,
			});
		});

		it("should apply label filters", async () => {
			mockClient.issues.mockResolvedValue({ nodes: [] });

			await tracker.listAssignedIssues("user-123", {
				labels: ["bug", "critical"],
			});

			expect(mockClient.issues).toHaveBeenCalledWith({
				filter: {
					assignee: { id: { eq: "user-123" } },
					labels: { some: { name: { in: ["bug", "critical"] } } },
				},
				first: 50,
			});
		});

		it("should apply limit", async () => {
			mockClient.issues.mockResolvedValue({ nodes: [] });

			await tracker.listAssignedIssues("user-123", {
				limit: 10,
			});

			expect(mockClient.issues).toHaveBeenCalledWith({
				filter: {
					assignee: { id: { eq: "user-123" } },
				},
				first: 10,
			});
		});
	});

	describe("updateIssueState", () => {
		it("should update issue state by ID", async () => {
			const state: IssueState = {
				type: "completed",
				name: "Done",
				id: "state-456",
			};

			await tracker.updateIssueState("issue-123", state);

			expect(mockClient.updateIssue).toHaveBeenCalledWith("issue-123", {
				stateId: "state-456",
			});
		});

		it("should find state by type if no ID provided", async () => {
			const mockIssue = {
				id: "issue-123",
				team: Promise.resolve({
					id: "team-123",
					name: "Test Team",
				}),
			};

			mockClient.issue.mockResolvedValue(mockIssue);
			mockClient.workflowStates.mockResolvedValue({
				nodes: [
					{ id: "state-456", name: "Done", type: "completed", position: 1 },
				],
			});

			const state: IssueState = {
				type: "completed",
				name: "Done",
			};

			await tracker.updateIssueState("issue-123", state);

			expect(mockClient.issue).toHaveBeenCalledWith("issue-123");
			expect(mockClient.workflowStates).toHaveBeenCalledWith({
				filter: {
					team: { id: { eq: "team-123" } },
					type: { eq: "completed" },
				},
			});
			expect(mockClient.updateIssue).toHaveBeenCalledWith("issue-123", {
				stateId: "state-456",
			});
		});

		it("should throw error if no workflow state found", async () => {
			const mockIssue = {
				id: "issue-123",
				team: Promise.resolve({ id: "team-123" }),
			};

			mockClient.issue.mockResolvedValue(mockIssue);
			mockClient.workflowStates.mockResolvedValue({ nodes: [] });

			const state: IssueState = {
				type: "completed",
				name: "Done",
			};

			await expect(
				tracker.updateIssueState("issue-123", state),
			).rejects.toThrow('No workflow state found for type "completed"');
		});
	});

	describe("addComment", () => {
		it("should add a root comment", async () => {
			const mockComment = {
				id: "comment-123",
			};

			mockClient.createComment.mockResolvedValue({
				comment: Promise.resolve(mockComment),
			});

			const commentId = await tracker.addComment("issue-123", {
				author: { id: "user-123", name: "John Doe" },
				content: "Test comment",
				createdAt: new Date(),
				isRoot: true,
			});

			expect(mockClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "Test comment",
			});
			expect(commentId).toBe("comment-123");
		});

		it("should add a reply comment", async () => {
			const mockComment = {
				id: "comment-456",
			};

			mockClient.createComment.mockResolvedValue({
				comment: Promise.resolve(mockComment),
			});

			const commentId = await tracker.addComment("issue-123", {
				author: { id: "user-123", name: "John Doe" },
				content: "Reply comment",
				createdAt: new Date(),
				isRoot: false,
				parentId: "comment-123",
			});

			expect(mockClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "Reply comment",
				parentId: "comment-123",
			});
			expect(commentId).toBe("comment-456");
		});

		it("should throw error if comment creation fails", async () => {
			mockClient.createComment.mockRejectedValue(new Error("Failed to create"));

			await expect(
				tracker.addComment("issue-123", {
					author: { id: "user-123", name: "John" },
					content: "Test",
					createdAt: new Date(),
					isRoot: true,
				}),
			).rejects.toThrow("Failed to add comment to issue issue-123");
		});
	});

	describe("getComments", () => {
		it("should fetch and map comments", async () => {
			const mockComments = [
				{
					id: "comment-123",
					body: "First comment",
					createdAt: new Date("2025-01-01"),
					updatedAt: new Date("2025-01-02"),
					user: Promise.resolve({
						id: "user-123",
						name: "johndoe",
						displayName: "John Doe",
					}),
					parent: null,
				},
				{
					id: "comment-456",
					body: "Reply comment",
					createdAt: new Date("2025-01-03"),
					updatedAt: new Date("2025-01-04"),
					user: Promise.resolve({
						id: "user-456",
						name: "janedoe",
						displayName: "Jane Doe",
					}),
					parent: { id: "comment-123" },
				},
			];

			mockClient.comments.mockResolvedValue({
				nodes: mockComments,
			});

			const comments = await tracker.getComments("issue-123");

			expect(mockClient.comments).toHaveBeenCalledWith({
				filter: {
					issue: { id: { eq: "issue-123" } },
				},
			});
			expect(comments).toHaveLength(2);
			expect(comments[0].content).toBe("First comment");
			expect(comments[0].isRoot).toBe(true);
			expect(comments[1].isRoot).toBe(false);
			expect(comments[1].parentId).toBe("comment-123");
		});
	});

	describe("getAttachments", () => {
		it("should fetch and map attachments", async () => {
			const mockIssue = {
				id: "issue-123",
				attachments: vi.fn().mockResolvedValue({
					nodes: [
						{
							id: "att-123",
							title: "screenshot.png",
							url: "https://example.com/file.png",
							metadata: {
								contentType: "image/png",
								size: 1024,
							},
						},
					],
				}),
			};

			mockClient.issue.mockResolvedValue(mockIssue);

			const attachments = await tracker.getAttachments("issue-123");

			expect(mockClient.issue).toHaveBeenCalledWith("issue-123");
			expect(attachments).toHaveLength(1);
			expect(attachments[0].name).toBe("screenshot.png");
			expect(attachments[0].mimeType).toBe("image/png");
		});
	});

	describe("sendSignal", () => {
		beforeEach(() => {
			mockClient.createComment.mockResolvedValue({
				comment: Promise.resolve({ id: "comment-123" }),
			});
		});

		it("should send start signal", async () => {
			const signal: AgentSignal = { type: "start" };

			await tracker.sendSignal("issue-123", signal);

			expect(mockClient.createComment).toHaveBeenCalledWith(
				expect.objectContaining({
					issueId: "issue-123",
					body: expect.stringContaining("Starting agent processing"),
				}),
			);
		});

		it("should send stop signal", async () => {
			const signal: AgentSignal = { type: "stop", reason: "User requested" };

			await tracker.sendSignal("issue-123", signal);

			expect(mockClient.createComment).toHaveBeenCalledWith(
				expect.objectContaining({
					issueId: "issue-123",
					body: expect.stringContaining("Stopping agent processing"),
				}),
			);
		});

		it("should send feedback signal", async () => {
			const signal: AgentSignal = {
				type: "feedback",
				message: "Please fix the bug",
			};

			await tracker.sendSignal("issue-123", signal);

			expect(mockClient.createComment).toHaveBeenCalledWith(
				expect.objectContaining({
					issueId: "issue-123",
					body: expect.stringContaining("Please fix the bug"),
				}),
			);
		});

		it("should throw error for unknown signal type", async () => {
			const signal = { type: "unknown" } as any;

			await expect(tracker.sendSignal("issue-123", signal)).rejects.toThrow(
				"Unknown signal type",
			);
		});

		it("should throw error if comment creation fails for signal", async () => {
			mockClient.createComment.mockRejectedValue(new Error("Failed to create"));

			const signal: AgentSignal = { type: "start" };

			await expect(tracker.sendSignal("issue-123", signal)).rejects.toThrow(
				"Failed to send signal to issue issue-123",
			);
		});
	});

	describe("watchIssues", () => {
		it("should emit events for assigned issues", async () => {
			const memberId = "user-123";
			const events: any[] = [];

			// Start watching in background
			const watchPromise = (async () => {
				for await (const event of tracker.watchIssues(memberId)) {
					events.push(event);
					if (events.length >= 2) break;
				}
			})();

			// Give watcher time to set up
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Emit events
			tracker.emitWebhookEvent({
				type: "assigned",
				issue: {
					id: "issue-123",
					identifier: "CYPACK-268",
					title: "Test",
					description: "",
					state: { type: "started", name: "In Progress" },
					priority: 0,
					assignee: { id: memberId, name: "John Doe" },
					labels: [],
					url: "https://linear.app/issue/123",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				assignee: { id: memberId, name: "John Doe" },
			});

			tracker.emitWebhookEvent({
				type: "comment-added",
				issue: {
					id: "issue-123",
					identifier: "CYPACK-268",
					title: "Test",
					description: "",
					state: { type: "started", name: "In Progress" },
					priority: 0,
					assignee: { id: memberId, name: "John Doe" },
					labels: [],
					url: "https://linear.app/issue/123",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				comment: {
					author: { id: "user-456", name: "Jane Doe" },
					content: "Test comment",
					createdAt: new Date(),
					isRoot: true,
				},
			});

			await watchPromise;

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe("assigned");
			expect(events[1].type).toBe("comment-added");
		});

		it("should filter events by member ID", async () => {
			const memberId = "user-123";
			const events: any[] = [];

			// Start watching
			const watchPromise = (async () => {
				for await (const event of tracker.watchIssues(memberId)) {
					events.push(event);
					if (events.length >= 1) break;
				}
			})();

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Emit event for different member (should be ignored)
			tracker.emitWebhookEvent({
				type: "assigned",
				issue: {
					id: "issue-456",
					identifier: "CYPACK-269",
					title: "Other Issue",
					description: "",
					state: { type: "started", name: "In Progress" },
					priority: 0,
					assignee: { id: "user-456", name: "Other User" },
					labels: [],
					url: "https://linear.app/issue/456",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				assignee: { id: "user-456", name: "Other User" },
			});

			// Emit event for correct member
			tracker.emitWebhookEvent({
				type: "assigned",
				issue: {
					id: "issue-123",
					identifier: "CYPACK-268",
					title: "Test",
					description: "",
					state: { type: "started", name: "In Progress" },
					priority: 0,
					assignee: { id: memberId, name: "John Doe" },
					labels: [],
					url: "https://linear.app/issue/123",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				assignee: { id: memberId, name: "John Doe" },
			});

			await watchPromise;

			expect(events).toHaveLength(1);
			expect(events[0].issue.identifier).toBe("CYPACK-268");
		});
	});
});
