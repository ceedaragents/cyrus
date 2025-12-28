/**
 * Unit tests for LinearIssueTrackerService.
 *
 * These tests verify that the LinearIssueTrackerService correctly wraps
 * the Linear SDK and transforms types to platform-agnostic representations.
 */

import type { LinearClient } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentActivityContentType, IssuePriority } from "../../../types.js";
import { LinearIssueTrackerService } from "../LinearIssueTrackerService.js";

// Mock LinearClient
const createMockLinearClient = (): LinearClient => {
	return {
		issue: vi.fn(),
		comment: vi.fn(),
		team: vi.fn(),
		user: vi.fn(),
		issueLabel: vi.fn(),
		issueLabels: vi.fn(),
		teams: vi.fn(),
		workflowState: vi.fn(),
		viewer: Promise.resolve({
			id: "viewer-id",
			name: "Test Viewer",
			displayName: "Test Viewer",
			email: "viewer@example.com",
			url: "https://linear.app/viewer",
			avatarUrl: "https://example.com/avatar.png",
			admin: false,
			active: true,
			guest: false,
		}),
		createComment: vi.fn(),
		updateIssue: vi.fn(),
		createAgentActivity: vi.fn(),
		fileUpload: vi.fn(),
		client: {
			rawRequest: vi.fn(),
		},
	} as any;
};

describe("LinearIssueTrackerService", () => {
	let mockLinearClient: LinearClient;
	let service: LinearIssueTrackerService;

	beforeEach(() => {
		mockLinearClient = createMockLinearClient();
		service = new LinearIssueTrackerService(mockLinearClient);
	});

	describe("Platform Metadata", () => {
		it("should return linear as platform type", () => {
			expect(service.getPlatformType()).toBe("linear");
		});

		it("should return platform metadata", () => {
			const metadata = service.getPlatformMetadata();
			expect(metadata.platform).toBe("linear");
			expect(metadata.apiVersion).toBe("graphql");
		});
	});

	describe("fetchIssue", () => {
		it("should fetch and adapt an issue by ID", async () => {
			const mockIssue = {
				id: "issue-123",
				identifier: "TEAM-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/team/issue/TEAM-123",
				teamId: "team-456",
				team: Promise.resolve({
					id: "team-456",
					key: "TEAM",
					name: "Team Name",
					description: "Team description",
				}),
				state: Promise.resolve({
					id: "state-789",
					name: "In Progress",
					type: "started",
					color: "#5e6ad2",
					position: 2,
				}),
				assigneeId: "user-101",
				assignee: Promise.resolve({
					id: "user-101",
					name: "John Doe",
					displayName: "John Doe",
					email: "john@example.com",
					url: "https://linear.app/user/john",
					avatarUrl: "https://example.com/john.png",
					admin: false,
					active: true,
					guest: false,
				}),
				labels: vi.fn().mockResolvedValue({
					nodes: [
						{
							id: "label-1",
							name: "bug",
							color: "#ff0000",
							description: "Bug label",
							parentId: null,
							isGroup: false,
						},
					],
				}),
				priority: 2,
				parentId: null,
				createdAt: new Date("2025-01-01T00:00:00Z"),
				updatedAt: new Date("2025-01-02T00:00:00Z"),
				archivedAt: null,
				branchName: "team-123-test-issue",
				number: 123,
				estimate: 3,
				sortOrder: 100,
			};

			vi.mocked(mockLinearClient.issue).mockResolvedValue(mockIssue as any);

			const result = await service.fetchIssue("TEAM-123");

			expect(mockLinearClient.issue).toHaveBeenCalledWith("TEAM-123");
			expect(result.id).toBe("issue-123");
			expect(result.identifier).toBe("TEAM-123");
			expect(result.title).toBe("Test Issue");
			expect(result.teamId).toBe("team-456");
			expect(result.priority).toBe(IssuePriority.High);
			expect(result.team).toBeDefined();
			expect(result.state).toBeDefined();
			expect(result.assignee).toBeDefined();
		});

		it("should handle fetch errors gracefully", async () => {
			vi.mocked(mockLinearClient.issue).mockRejectedValue(
				new Error("Issue not found"),
			);

			await expect(service.fetchIssue("INVALID-123")).rejects.toThrow(
				"Failed to fetch issue INVALID-123",
			);
		});
	});

	describe("fetchIssueChildren", () => {
		it("should fetch children with filters", async () => {
			const mockParentIssue = {
				id: "parent-123",
				identifier: "TEAM-100",
				title: "Parent Issue",
				description: "",
				url: "https://linear.app/team/issue/TEAM-100",
				teamId: "team-456",
				team: Promise.resolve({
					id: "team-456",
					key: "TEAM",
					name: "Team Name",
				}),
				state: Promise.resolve({
					id: "state-1",
					name: "In Progress",
					type: "started",
					color: "#5e6ad2",
				}),
				assigneeId: null,
				assignee: null,
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
				priority: 0,
				parentId: null,
				createdAt: new Date("2025-01-01T00:00:00Z"),
				updatedAt: new Date("2025-01-02T00:00:00Z"),
				archivedAt: null,
				children: vi.fn().mockResolvedValue({
					nodes: [
						{
							id: "child-1",
							identifier: "TEAM-101",
							title: "Child Issue",
							description: "",
							url: "https://linear.app/team/issue/TEAM-101",
							teamId: "team-456",
							team: Promise.resolve({
								id: "team-456",
								key: "TEAM",
								name: "Team Name",
							}),
							state: Promise.resolve({
								id: "state-2",
								name: "Todo",
								type: "unstarted",
								color: "#95a2b3",
							}),
							assigneeId: null,
							assignee: null,
							labels: vi.fn().mockResolvedValue({ nodes: [] }),
							priority: 0,
							parentId: "parent-123",
							createdAt: new Date("2025-01-03T00:00:00Z"),
							updatedAt: new Date("2025-01-03T00:00:00Z"),
							archivedAt: null,
						},
					],
				}),
			};

			vi.mocked(mockLinearClient.issue).mockResolvedValue(
				mockParentIssue as any,
			);

			const result = await service.fetchIssueChildren("TEAM-100", {
				limit: 50,
				includeCompleted: false,
				includeArchived: false,
			});

			expect(result.id).toBe("parent-123");
			expect(result.children).toHaveLength(1);
			expect(result.childCount).toBe(1);
			expect(result.children[0].identifier).toBe("TEAM-101");
		});
	});

	describe("updateIssue", () => {
		it("should update an issue", async () => {
			const mockUpdatedIssue = {
				id: "issue-123",
				identifier: "TEAM-123",
				title: "Updated Title",
				description: "",
				url: "https://linear.app/team/issue/TEAM-123",
				teamId: "team-456",
				team: Promise.resolve({
					id: "team-456",
					key: "TEAM",
					name: "Team Name",
				}),
				state: Promise.resolve({
					id: "state-new",
					name: "Done",
					type: "completed",
					color: "#5e6ad2",
				}),
				assigneeId: null,
				assignee: null,
				labels: vi.fn().mockResolvedValue({ nodes: [] }),
				priority: 0,
				parentId: null,
				createdAt: new Date("2025-01-01T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.updateIssue).mockResolvedValue({
				success: true,
				issue: Promise.resolve(mockUpdatedIssue as any),
			} as any);

			const result = await service.updateIssue("issue-123", {
				stateId: "state-new",
				title: "Updated Title",
			});

			expect(mockLinearClient.updateIssue).toHaveBeenCalledWith("issue-123", {
				stateId: "state-new",
				title: "Updated Title",
			});
			expect(result.title).toBe("Updated Title");
		});
	});

	describe("fetchComments", () => {
		it("should fetch comments for an issue", async () => {
			const mockIssue = {
				id: "issue-123",
				comments: vi.fn().mockResolvedValue({
					nodes: [
						{
							id: "comment-1",
							body: "This is a comment",
							userId: "user-101",
							user: Promise.resolve({
								id: "user-101",
								name: "John Doe",
								displayName: "John Doe",
								email: "john@example.com",
								url: "https://linear.app/user/john",
							}),
							issueId: "issue-123",
							parent: null,
							createdAt: new Date("2025-01-03T00:00:00Z"),
							updatedAt: new Date("2025-01-03T00:00:00Z"),
							archivedAt: null,
							botActor: null,
						},
					],
					pageInfo: {
						hasNextPage: false,
						hasPreviousPage: false,
						startCursor: "cursor-start",
						endCursor: "cursor-end",
					},
				}),
			};

			vi.mocked(mockLinearClient.issue).mockResolvedValue(mockIssue as any);

			const result = await service.fetchComments("issue-123", { first: 50 });

			expect(result.nodes).toHaveLength(1);
			expect(result.nodes[0].body).toBe("This is a comment");
			expect(result.pageInfo?.hasNextPage).toBe(false);
		});
	});

	describe("createComment", () => {
		it("should create a comment on an issue", async () => {
			const mockComment = {
				id: "comment-new",
				body: "New comment",
				userId: "user-101",
				user: Promise.resolve({
					id: "user-101",
					name: "John Doe",
					displayName: "John Doe",
					email: "john@example.com",
					url: "https://linear.app/user/john",
				}),
				issueId: "issue-123",
				parent: null,
				createdAt: new Date("2025-01-05T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.createComment).mockResolvedValue({
				success: true,
				comment: Promise.resolve(mockComment as any),
			} as any);

			const result = await service.createComment("issue-123", {
				body: "New comment",
			});

			expect(mockLinearClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "New comment",
				parentId: undefined,
			});
			expect(result.body).toBe("New comment");
		});

		it("should create a comment with image attachments appended as markdown", async () => {
			const mockComment = {
				id: "comment-new",
				body: "Comment with images\n\n![attachment](https://linear.app/asset/image1.png)\n![attachment](https://linear.app/asset/image2.jpg)",
				userId: "user-101",
				user: Promise.resolve({
					id: "user-101",
					name: "John Doe",
					displayName: "John Doe",
					email: "john@example.com",
					url: "https://linear.app/user/john",
				}),
				issueId: "issue-123",
				parent: null,
				createdAt: new Date("2025-01-05T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.createComment).mockResolvedValue({
				success: true,
				comment: Promise.resolve(mockComment as any),
			} as any);

			const result = await service.createComment("issue-123", {
				body: "Comment with images",
				attachmentUrls: [
					"https://linear.app/asset/image1.png",
					"https://linear.app/asset/image2.jpg",
				],
			});

			expect(mockLinearClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "Comment with images\n\n![attachment](https://linear.app/asset/image1.png)\n![attachment](https://linear.app/asset/image2.jpg)",
				parentId: undefined,
			});
			expect(result.body).toContain(
				"![attachment](https://linear.app/asset/image1.png)",
			);
			expect(result.body).toContain(
				"![attachment](https://linear.app/asset/image2.jpg)",
			);
		});

		it("should create a comment with non-image attachments as markdown links", async () => {
			const mockComment = {
				id: "comment-new",
				body: "Comment with files\n\n[attachment](https://linear.app/asset/document.pdf)\n[attachment](https://linear.app/asset/data.csv)",
				userId: "user-101",
				user: Promise.resolve({
					id: "user-101",
					name: "John Doe",
					displayName: "John Doe",
					email: "john@example.com",
					url: "https://linear.app/user/john",
				}),
				issueId: "issue-123",
				parent: null,
				createdAt: new Date("2025-01-05T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.createComment).mockResolvedValue({
				success: true,
				comment: Promise.resolve(mockComment as any),
			} as any);

			const result = await service.createComment("issue-123", {
				body: "Comment with files",
				attachmentUrls: [
					"https://linear.app/asset/document.pdf",
					"https://linear.app/asset/data.csv",
				],
			});

			expect(mockLinearClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "Comment with files\n\n[attachment](https://linear.app/asset/document.pdf)\n[attachment](https://linear.app/asset/data.csv)",
				parentId: undefined,
			});
			expect(result.body).toContain(
				"[attachment](https://linear.app/asset/document.pdf)",
			);
			expect(result.body).toContain(
				"[attachment](https://linear.app/asset/data.csv)",
			);
		});

		it("should create a comment with attachments only (no body text)", async () => {
			const mockComment = {
				id: "comment-new",
				body: "![attachment](https://linear.app/asset/screenshot.png)",
				userId: "user-101",
				user: Promise.resolve({
					id: "user-101",
					name: "John Doe",
					displayName: "John Doe",
					email: "john@example.com",
					url: "https://linear.app/user/john",
				}),
				issueId: "issue-123",
				parent: null,
				createdAt: new Date("2025-01-05T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.createComment).mockResolvedValue({
				success: true,
				comment: Promise.resolve(mockComment as any),
			} as any);

			const result = await service.createComment("issue-123", {
				body: "",
				attachmentUrls: ["https://linear.app/asset/screenshot.png"],
			});

			expect(mockLinearClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "![attachment](https://linear.app/asset/screenshot.png)",
				parentId: undefined,
			});
			expect(result.body).toBe(
				"![attachment](https://linear.app/asset/screenshot.png)",
			);
		});

		it("should create a comment with mixed image and non-image attachments", async () => {
			const mockComment = {
				id: "comment-new",
				body: "Mixed attachments\n\n![attachment](https://linear.app/asset/image.png)\n[attachment](https://linear.app/asset/document.pdf)\n![attachment](https://linear.app/asset/photo.jpg)",
				userId: "user-101",
				user: Promise.resolve({
					id: "user-101",
					name: "John Doe",
					displayName: "John Doe",
					email: "john@example.com",
					url: "https://linear.app/user/john",
				}),
				issueId: "issue-123",
				parent: null,
				createdAt: new Date("2025-01-05T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.createComment).mockResolvedValue({
				success: true,
				comment: Promise.resolve(mockComment as any),
			} as any);

			const result = await service.createComment("issue-123", {
				body: "Mixed attachments",
				attachmentUrls: [
					"https://linear.app/asset/image.png",
					"https://linear.app/asset/document.pdf",
					"https://linear.app/asset/photo.jpg",
				],
			});

			expect(mockLinearClient.createComment).toHaveBeenCalledWith({
				issueId: "issue-123",
				body: "Mixed attachments\n\n![attachment](https://linear.app/asset/image.png)\n[attachment](https://linear.app/asset/document.pdf)\n![attachment](https://linear.app/asset/photo.jpg)",
				parentId: undefined,
			});
			expect(result.body).toContain(
				"![attachment](https://linear.app/asset/image.png)",
			);
			expect(result.body).toContain(
				"[attachment](https://linear.app/asset/document.pdf)",
			);
			expect(result.body).toContain(
				"![attachment](https://linear.app/asset/photo.jpg)",
			);
		});
	});

	describe("fetchTeams", () => {
		it("should fetch all teams", async () => {
			const mockTeams = {
				nodes: [
					{
						id: "team-1",
						key: "TEAM",
						name: "Team Name",
						description: "Team description",
						icon: "🚀",
						color: "#5e6ad2",
					},
				],
				pageInfo: {
					hasNextPage: false,
					hasPreviousPage: false,
					startCursor: "cursor-start",
					endCursor: "cursor-end",
				},
			};

			vi.mocked(mockLinearClient.teams).mockResolvedValue(mockTeams as any);

			const result = await service.fetchTeams({ first: 50 });

			expect(result.nodes).toHaveLength(1);
			expect(result.nodes[0].key).toBe("TEAM");
		});
	});

	describe("fetchLabels", () => {
		it("should fetch all labels", async () => {
			const mockLabels = {
				nodes: [
					{
						id: "label-1",
						name: "bug",
						color: "#ff0000",
						description: "Bug label",
						parentId: null,
						isGroup: false,
					},
				],
				pageInfo: {
					hasNextPage: false,
					hasPreviousPage: false,
					startCursor: "cursor-start",
					endCursor: "cursor-end",
				},
			};

			vi.mocked(mockLinearClient.issueLabels).mockResolvedValue(
				mockLabels as any,
			);

			const result = await service.fetchLabels({ first: 50 });

			expect(result.nodes).toHaveLength(1);
			expect(result.nodes[0].name).toBe("bug");
		});
	});

	describe("fetchWorkflowStates", () => {
		it("should fetch workflow states for a team", async () => {
			const mockTeam = {
				id: "team-1",
				states: vi.fn().mockResolvedValue({
					nodes: [
						{
							id: "state-1",
							name: "Todo",
							type: "unstarted",
							color: "#95a2b3",
							position: 1,
							description: "Todo state",
						},
						{
							id: "state-2",
							name: "In Progress",
							type: "started",
							color: "#5e6ad2",
							position: 2,
							description: "Started state",
						},
					],
					pageInfo: {
						hasNextPage: false,
						hasPreviousPage: false,
						startCursor: "cursor-start",
						endCursor: "cursor-end",
					},
				}),
			};

			vi.mocked(mockLinearClient.team).mockResolvedValue(mockTeam as any);

			const result = await service.fetchWorkflowStates("team-1");

			expect(result.nodes).toHaveLength(2);
			expect(result.nodes[0].type).toBe("unstarted");
			expect(result.nodes[1].type).toBe("started");
		});
	});

	describe("fetchCurrentUser", () => {
		it("should fetch the current authenticated user", async () => {
			const result = await service.fetchCurrentUser();

			expect(result.id).toBe("viewer-id");
			expect(result.name).toBe("Test Viewer");
			expect(result.email).toBe("viewer@example.com");
		});
	});

	describe("createAgentSessionOnIssue", () => {
		it("should create an agent session on an issue", async () => {
			const mockResponse = {
				data: {
					agentSessionCreateOnIssue: {
						success: true,
						lastSyncId: 12345,
						agentSession: {
							id: "session-new",
						},
					},
				},
			};

			vi.mocked((mockLinearClient as any).client.rawRequest).mockResolvedValue(
				mockResponse,
			);

			const result = await service.createAgentSessionOnIssue({
				issueId: "issue-123",
				externalLink: "https://example.com/session/abc",
			});

			expect(result.success).toBe(true);
			expect(result.agentSessionId).toBe("session-new");
			expect(result.lastSyncId).toBe(12345);
		});
	});

	describe("createAgentSessionOnComment", () => {
		it("should create an agent session on a comment", async () => {
			const mockResponse = {
				data: {
					agentSessionCreateOnComment: {
						success: true,
						lastSyncId: 12346,
						agentSession: {
							id: "session-comment",
						},
					},
				},
			};

			vi.mocked((mockLinearClient as any).client.rawRequest).mockResolvedValue(
				mockResponse,
			);

			const result = await service.createAgentSessionOnComment({
				commentId: "comment-123",
				externalLink: "https://example.com/session/def",
			});

			expect(result.success).toBe(true);
			expect(result.agentSessionId).toBe("session-comment");
			expect(result.lastSyncId).toBe(12346);
		});
	});

	describe("createAgentActivity", () => {
		it("should create an agent activity", async () => {
			const mockActivity = {
				id: "activity-new",
				createdAt: new Date("2025-01-05T00:00:00Z"),
				updatedAt: new Date("2025-01-05T00:00:00Z"),
				archivedAt: null,
			};

			vi.mocked(mockLinearClient.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve(mockActivity as any),
			} as any);

			const result = await service.createAgentActivity({
				agentSessionId: "session-123",
				content: {
					type: AgentActivityContentType.Response,
					body: "This is a response",
				},
			});

			expect(mockLinearClient.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: "session-123",
				content: {
					type: "response",
					body: "This is a response",
				},
			});
			expect(result.success).toBe(true);
			const activity = await result.agentActivity;
			expect(activity.id).toBe("activity-new");
		});
	});

	describe("requestFileUpload", () => {
		it("should request a file upload", async () => {
			const mockUploadResponse = {
				success: true,
				uploadFile: Promise.resolve({
					uploadUrl: "https://upload.example.com/file",
					headers: [{ key: "Content-Type", value: "image/png" }],
					assetUrl: "https://assets.example.com/file.png",
				}),
			};

			vi.mocked(mockLinearClient.fileUpload).mockResolvedValue(
				mockUploadResponse as any,
			);

			const result = await service.requestFileUpload({
				contentType: "image/png",
				filename: "test.png",
				size: 1024,
				makePublic: false,
			});

			expect(mockLinearClient.fileUpload).toHaveBeenCalledWith(
				"image/png",
				"test.png",
				1024,
				{ makePublic: false },
			);
			expect(result.uploadUrl).toBe("https://upload.example.com/file");
			expect(result.assetUrl).toBe("https://assets.example.com/file.png");
		});
	});

	describe("Token Refresh with OAuth Config", () => {
		const mockOAuthConfig = {
			clientId: "test-client-id",
			clientSecret: "test-client-secret",
			refreshToken: "test-refresh-token",
			workspaceId: "workspace-123",
			onTokenRefresh: vi.fn(),
		};

		beforeEach(() => {
			vi.clearAllMocks();
			// Clear static maps between tests
			(LinearIssueTrackerService as any).pendingRefreshes.clear();
			(LinearIssueTrackerService as any).workspaceRefreshTokens.clear();
		});

		it("should patch client.request when OAuth config is provided", async () => {
			const mockGraphQLClient = {
				request: vi.fn().mockResolvedValue({ issue: { id: "123" } }),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL = {
				...mockLinearClient,
				client: mockGraphQLClient,
				issue: vi.fn().mockResolvedValue({ id: "123", title: "Test" }),
			} as any;

			new LinearIssueTrackerService(mockClientWithGraphQL, mockOAuthConfig);

			// The request method should be patched (original is wrapped)
			expect(mockGraphQLClient.request).toBeDefined();
		});

		it("should retry request with new token on 401 error", async () => {
			const error401 = new Error("Unauthorized");
			(error401 as any).status = 401;

			const mockGraphQLClient = {
				request: vi
					.fn()
					.mockRejectedValueOnce(error401)
					.mockResolvedValueOnce({ data: "success" }),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL = {
				...mockLinearClient,
				client: mockGraphQLClient,
			} as any;

			// Mock fetch for token refresh
			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						access_token: "refreshed-token",
						refresh_token: "new-refresh-token",
						expires_in: 86400,
					}),
			});

			new LinearIssueTrackerService(mockClientWithGraphQL, {
				...mockOAuthConfig,
			});

			// Call the patched request directly
			const result = await mockClientWithGraphQL.client.request(
				"query",
				{},
				{},
			);

			expect(fetch).toHaveBeenCalledWith(
				"https://api.linear.app/oauth/token",
				expect.objectContaining({ method: "POST" }),
			);
			expect(mockGraphQLClient.setHeader).toHaveBeenCalledWith(
				"Authorization",
				"Bearer refreshed-token",
			);
			expect(result).toEqual({ data: "success" });
		});

		it("should not retry on non-401 errors", async () => {
			const error500 = new Error("Internal Server Error");
			(error500 as any).status = 500;

			const mockGraphQLClient = {
				request: vi.fn().mockRejectedValueOnce(error500),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL = {
				...mockLinearClient,
				client: mockGraphQLClient,
			} as any;

			global.fetch = vi.fn();

			new LinearIssueTrackerService(mockClientWithGraphQL, mockOAuthConfig);

			await expect(
				mockClientWithGraphQL.client.request("query", {}, {}),
			).rejects.toThrow("Internal Server Error");

			expect(fetch).not.toHaveBeenCalled();
			expect(mockGraphQLClient.setHeader).not.toHaveBeenCalled();
		});

		it("should call onTokenRefresh callback when tokens are refreshed", async () => {
			const error401 = new Error("Unauthorized");
			(error401 as any).status = 401;

			const mockGraphQLClient = {
				request: vi
					.fn()
					.mockRejectedValueOnce(error401)
					.mockResolvedValueOnce({ data: "success" }),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL = {
				...mockLinearClient,
				client: mockGraphQLClient,
			} as any;

			const onTokenRefresh = vi.fn();

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						access_token: "new-access-token",
						refresh_token: "new-refresh-token",
						expires_in: 86400,
					}),
			});

			new LinearIssueTrackerService(mockClientWithGraphQL, {
				...mockOAuthConfig,
				onTokenRefresh,
			});

			await mockClientWithGraphQL.client.request("query", {}, {});

			expect(onTokenRefresh).toHaveBeenCalledWith({
				accessToken: "new-access-token",
				refreshToken: "new-refresh-token",
			});
		});

		it("should coalesce concurrent token refresh requests for the same workspace", async () => {
			const error401 = new Error("Unauthorized");
			(error401 as any).status = 401;

			// Track call count for each service
			let requestCallCount1 = 0;
			let requestCallCount2 = 0;

			const mockGraphQLClient1 = {
				request: vi.fn().mockImplementation(async () => {
					requestCallCount1++;
					if (requestCallCount1 === 1) throw error401;
					return { data: "success1" };
				}),
				setHeader: vi.fn(),
			};

			const mockGraphQLClient2 = {
				request: vi.fn().mockImplementation(async () => {
					requestCallCount2++;
					if (requestCallCount2 === 1) throw error401;
					return { data: "success2" };
				}),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL1 = {
				...createMockLinearClient(),
				client: mockGraphQLClient1,
			} as any;

			const mockClientWithGraphQL2 = {
				...createMockLinearClient(),
				client: mockGraphQLClient2,
			} as any;

			// Mock fetch to delay response to ensure concurrency
			global.fetch = vi.fn().mockImplementation(
				() =>
					new Promise((resolve) => {
						setTimeout(() => {
							resolve({
								ok: true,
								json: () =>
									Promise.resolve({
										access_token: "coalesced-token",
										refresh_token: "coalesced-refresh-token",
										expires_in: 86400,
									}),
							});
						}, 50);
					}),
			);

			// Both services use the same workspace ID
			new LinearIssueTrackerService(mockClientWithGraphQL1, {
				...mockOAuthConfig,
				workspaceId: "same-workspace",
			});

			new LinearIssueTrackerService(mockClientWithGraphQL2, {
				...mockOAuthConfig,
				workspaceId: "same-workspace",
			});

			// Trigger concurrent 401s from both services
			const [result1, result2] = await Promise.all([
				mockClientWithGraphQL1.client.request("query1", {}, {}),
				mockClientWithGraphQL2.client.request("query2", {}, {}),
			]);

			// Both should succeed
			expect(result1).toEqual({ data: "success1" });
			expect(result2).toEqual({ data: "success2" });

			// Only ONE HTTP request should have been made (coalesced)
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("should NOT coalesce requests from different workspaces", async () => {
			const error401 = new Error("Unauthorized");
			(error401 as any).status = 401;

			let requestCallCount1 = 0;
			let requestCallCount2 = 0;

			const mockGraphQLClient1 = {
				request: vi.fn().mockImplementation(async () => {
					requestCallCount1++;
					if (requestCallCount1 === 1) throw error401;
					return { data: "success1" };
				}),
				setHeader: vi.fn(),
			};

			const mockGraphQLClient2 = {
				request: vi.fn().mockImplementation(async () => {
					requestCallCount2++;
					if (requestCallCount2 === 1) throw error401;
					return { data: "success2" };
				}),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL1 = {
				...createMockLinearClient(),
				client: mockGraphQLClient1,
			} as any;

			const mockClientWithGraphQL2 = {
				...createMockLinearClient(),
				client: mockGraphQLClient2,
			} as any;

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () =>
					Promise.resolve({
						access_token: "new-token",
						refresh_token: "new-refresh-token",
						expires_in: 86400,
					}),
			});

			// Different workspace IDs
			new LinearIssueTrackerService(mockClientWithGraphQL1, {
				...mockOAuthConfig,
				workspaceId: "workspace-A",
			});

			new LinearIssueTrackerService(mockClientWithGraphQL2, {
				...mockOAuthConfig,
				workspaceId: "workspace-B",
			});

			// Trigger concurrent 401s from both services
			await Promise.all([
				mockClientWithGraphQL1.client.request("query1", {}, {}),
				mockClientWithGraphQL2.client.request("query2", {}, {}),
			]);

			// TWO HTTP requests should have been made (not coalesced)
			expect(fetch).toHaveBeenCalledTimes(2);
		});
	});

	describe("setAccessToken", () => {
		it("should update the Authorization header on the client", () => {
			const mockGraphQLClient = {
				request: vi.fn(),
				setHeader: vi.fn(),
			};

			const mockClientWithGraphQL = {
				...mockLinearClient,
				client: mockGraphQLClient,
			} as any;

			const service = new LinearIssueTrackerService(mockClientWithGraphQL);

			service.setAccessToken("new-access-token");

			expect(mockGraphQLClient.setHeader).toHaveBeenCalledWith(
				"Authorization",
				"Bearer new-access-token",
			);
		});
	});
});
