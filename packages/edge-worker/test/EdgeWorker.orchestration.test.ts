import { LinearClient } from "@linear/sdk";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type {
	LinearIssueUpdatedWebhook,
	LinearAgentSessionCreatedWebhook,
} from "cyrus-core";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock the Linear client
vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn(() => ({
		issue: vi.fn(),
		updateIssue: vi.fn(),
		viewer: { id: "test-agent-user-id" },
	})),
}));

describe("EdgeWorker Orchestration", () => {
	let edgeWorker: EdgeWorker;
	let mockLinearClient: any;
	
	const testRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repository",
		path: "/test/repo",
		linearWorkspaceId: "test-workspace",
		linearToken: "test-token",
		baseBranch: "main",
		workspaceBaseDir: "/test/workspaces",
		labelPrompts: {
			orchestrator: {
				labels: ["orchestrator"],
				allowedTools: "all",
			},
		},
	};

	const config: EdgeWorkerConfig = {
		webhookPort: 3000,
		repositories: [testRepository],
	};

	beforeEach(() => {
		edgeWorker = new EdgeWorker(config);
		mockLinearClient = new LinearClient({ accessToken: "test-token" });
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("Orchestration Queue Management", () => {
		it("should add sub-issues to orchestration queue when parent has orchestrator label", async () => {
			// Mock parent issue with orchestrator label
			const mockParentIssue = {
				id: "parent-123",
				identifier: "PARENT-1",
				labels: vi.fn().mockResolvedValue({
					nodes: [{ name: "orchestrator" }],
				}),
			};

			// Mock Linear client methods
			mockLinearClient.issue = vi.fn().mockResolvedValue(mockParentIssue);
			mockLinearClient.updateIssue = vi.fn().mockResolvedValue({ success: true });
			mockLinearClient.viewer = { id: "test-agent-user-id" };

			// Replace the Linear client in EdgeWorker
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			// Add sub-issue to orchestration queue
			await edgeWorker.addToOrchestrationQueue(
				"parent-123",
				"sub-issue-456",
				"test-repo"
			);

			// Verify the sub-issue was added to the queue
			const queue = (edgeWorker as any).orchestrationQueue.get("parent-123");
			expect(queue).toContain("sub-issue-456");

			// Verify the first sub-issue was assigned to the agent
			expect(mockLinearClient.updateIssue).toHaveBeenCalledWith("sub-issue-456", {
				assigneeId: "test-agent-user-id",
			});
		});

		it("should not add sub-issues to queue when parent lacks orchestrator label", async () => {
			// Mock parent issue without orchestrator label
			const mockParentIssue = {
				id: "parent-789",
				identifier: "PARENT-2",
				labels: vi.fn().mockResolvedValue({
					nodes: [{ name: "bug" }],
				}),
			};

			mockLinearClient.issue = vi.fn().mockResolvedValue(mockParentIssue);
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			// Add sub-issue to orchestration queue
			await edgeWorker.addToOrchestrationQueue(
				"parent-789",
				"sub-issue-101",
				"test-repo"
			);

			// Verify the sub-issue was NOT added to the queue
			const queue = (edgeWorker as any).orchestrationQueue.get("parent-789");
			expect(queue).toBeUndefined();

			// Verify no assignment was made
			expect(mockLinearClient.updateIssue).not.toHaveBeenCalled();
		});
	});

	describe("Issue Completion Webhook Handling", () => {
		it("should trigger next sub-issue when current one completes", async () => {
			// Setup orchestration queue with multiple sub-issues
			const parentId = "parent-abc";
			(edgeWorker as any).orchestrationQueue.set(parentId, ["sub-2", "sub-3"]);
			(edgeWorker as any).activeOrchestration.set(parentId, "sub-1");

			// Mock parent issue with orchestrator label
			const mockParentIssue = {
				id: parentId,
				identifier: "PARENT-3",
				labels: vi.fn().mockResolvedValue({
					nodes: [{ name: "orchestrator" }],
				}),
			};

			mockLinearClient.issue = vi.fn().mockResolvedValue(mockParentIssue);
			mockLinearClient.updateIssue = vi.fn().mockResolvedValue({ success: true });
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			// Create a mock webhook for issue completion
			const completionWebhook: LinearIssueUpdatedWebhook = {
				type: "AppUserNotification",
				action: "issueUpdated",
				createdAt: new Date().toISOString(),
				organizationId: "test-org",
				oauthClientId: "test-client",
				appUserId: "test-agent-user-id",
				notification: {
					id: "notif-1",
					type: "issueUpdated",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					actorId: "actor-1",
					externalUserActorId: null,
					userId: "user-1",
					issueId: "sub-1",
					issue: {
						id: "sub-1",
						identifier: "SUB-1",
						title: "First sub-issue",
						teamId: "team-1",
						team: { id: "team-1", key: "TEAM", name: "Test Team" },
						url: "https://linear.app/test/issue/SUB-1",
						stateId: "completed-state",
						state: { id: "completed-state", name: "Done", type: "completed", position: 5 },
						parentId: parentId,
					},
					actor: {
						id: "actor-1",
						name: "Test User",
						email: "test@example.com",
						url: "https://linear.app/test/user",
					},
				},
				webhookTimestamp: Date.now(),
				webhookId: "webhook-1",
			};

			// Handle the webhook
			await (edgeWorker as any).handleIssueUpdatedWebhook(completionWebhook, testRepository);

			// Verify the next sub-issue was assigned
			expect(mockLinearClient.updateIssue).toHaveBeenCalledWith("sub-2", {
				assigneeId: "test-agent-user-id",
			});

			// Verify the queue was updated
			const remainingQueue = (edgeWorker as any).orchestrationQueue.get(parentId);
			expect(remainingQueue).toEqual(["sub-3"]);

			// Verify active orchestration was updated
			const activeIssue = (edgeWorker as any).activeOrchestration.get(parentId);
			expect(activeIssue).toBe("sub-2");
		});

		it("should clean up orchestration when all sub-issues complete", async () => {
			// Setup orchestration queue with last sub-issue
			const parentId = "parent-xyz";
			(edgeWorker as any).orchestrationQueue.set(parentId, []);
			(edgeWorker as any).activeOrchestration.set(parentId, "sub-last");

			// Mock parent issue
			const mockParentIssue = {
				id: parentId,
				identifier: "PARENT-4",
				labels: vi.fn().mockResolvedValue({
					nodes: [{ name: "orchestrator" }],
				}),
			};

			mockLinearClient.issue = vi.fn().mockResolvedValue(mockParentIssue);
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			// Create webhook for last sub-issue completion
			const completionWebhook: LinearIssueUpdatedWebhook = {
				type: "AppUserNotification",
				action: "issueUpdated",
				createdAt: new Date().toISOString(),
				organizationId: "test-org",
				oauthClientId: "test-client",
				appUserId: "test-agent-user-id",
				notification: {
					id: "notif-2",
					type: "issueUpdated",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					actorId: "actor-1",
					externalUserActorId: null,
					userId: "user-1",
					issueId: "sub-last",
					issue: {
						id: "sub-last",
						identifier: "SUB-LAST",
						title: "Last sub-issue",
						teamId: "team-1",
						team: { id: "team-1", key: "TEAM", name: "Test Team" },
						url: "https://linear.app/test/issue/SUB-LAST",
						stateId: "completed-state",
						state: { id: "completed-state", name: "Done", type: "completed", position: 5 },
						parentId: parentId,
					},
					actor: {
						id: "actor-1",
						name: "Test User",
						email: "test@example.com",
						url: "https://linear.app/test/user",
					},
				},
				webhookTimestamp: Date.now(),
				webhookId: "webhook-2",
			};

			// Handle the webhook
			await (edgeWorker as any).handleIssueUpdatedWebhook(completionWebhook, testRepository);

			// Verify no new assignment was made
			expect(mockLinearClient.updateIssue).not.toHaveBeenCalled();

			// Verify active orchestration was removed
			const activeIssue = (edgeWorker as any).activeOrchestration.get(parentId);
			expect(activeIssue).toBeUndefined();
		});
	});

	describe("Orchestrator Prompt Selection", () => {
		it("should select orchestrator prompt when issue has orchestrator label", async () => {
			const labels = ["bug", "orchestrator", "feature"];
			
			const result = await (edgeWorker as any).determineSystemPromptFromLabels(
				labels,
				testRepository
			);

			expect(result).toBeDefined();
			expect(result?.type).toBe("orchestrator");
			expect(result?.prompt).toContain("orchestration specialist");
		});

		it("should not select orchestrator prompt without orchestrator label", async () => {
			const labels = ["bug", "feature"];
			
			// Add debugger configuration
			const repoWithDebugger = {
				...testRepository,
				labelPrompts: {
					debugger: {
						labels: ["bug"],
						allowedTools: "all",
					},
				},
			};

			const result = await (edgeWorker as any).determineSystemPromptFromLabels(
				labels,
				repoWithDebugger
			);

			expect(result?.type).toBe("debugger");
		});
	});
});