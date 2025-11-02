/**
 * Tests for CLIIssueTrackerService
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { Comment, Issue } from "../../types.js";
import { AgentActivityContentType, WorkflowStateType } from "../../types.js";
import { CLIIssueTrackerService } from "../CLIIssueTrackerService.js";

describe("CLIIssueTrackerService", () => {
	let service: CLIIssueTrackerService;

	beforeEach(() => {
		service = new CLIIssueTrackerService({
			agentHandle: "@cyrus",
			agentUserId: "agent-user-id",
		});
	});

	describe("Platform Metadata", () => {
		it("should return cli as platform type", () => {
			expect(service.getPlatformType()).toBe("cli");
		});

		it("should return platform metadata", () => {
			const metadata = service.getPlatformMetadata();
			expect(metadata.platform).toBe("cli");
			expect(metadata.mode).toBe("in-memory");
		});
	});

	describe("Issue Operations", () => {
		it("should create an issue", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
				description: "Test description",
			});

			expect(issue).toMatchObject({
				title: "Test Issue",
				description: "Test description",
				identifier: "CLI-1",
			});
			expect(issue.id).toMatch(/^issue-\d+$/);
		});

		it("should fetch an issue by ID", async () => {
			const created = await service.createIssue({
				title: "Test Issue",
			});

			const fetched = await service.fetchIssue(created.id);
			expect(fetched).toEqual(created);
		});

		it("should fetch an issue by identifier", async () => {
			const created = await service.createIssue({
				title: "Test Issue",
			});

			const fetched = await service.fetchIssue(created.identifier);
			expect(fetched).toEqual(created);
		});

		it("should update an issue", async () => {
			const issue = await service.createIssue({
				title: "Original Title",
			});

			const updated = await service.updateIssue(issue.id, {
				title: "Updated Title",
			});

			expect(updated.title).toBe("Updated Title");
		});

		it("should fetch issue children", async () => {
			const parent = await service.createIssue({
				title: "Parent Issue",
			});

			const _child1 = await service.createIssue({
				title: "Child 1",
				parentId: parent.id,
			});

			const _child2 = await service.createIssue({
				title: "Child 2",
				parentId: parent.id,
			});

			const result = await service.fetchIssueChildren(parent.id);
			expect(result.children).toHaveLength(2);
			expect(result.childCount).toBe(2);
		});

		it("should emit issueAssigned event when issue assigned to agent", async () => {
			const agentUserId = "agent-user-id";

			const eventPromise = new Promise<Issue>((resolve) => {
				service.once("issueAssigned", (issue: Issue) => {
					resolve(issue);
				});
			});

			await service.createIssue({
				title: "Test Issue",
				assigneeId: agentUserId,
			});

			const issue = await eventPromise;
			expect(issue.assigneeId).toBe(agentUserId);
		});
	});

	describe("Comment Operations", () => {
		it("should create a comment on an issue", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const comment = await service.createComment(issue.id, {
				body: "Test comment",
			});

			expect(comment).toMatchObject({
				body: "Test comment",
				issueId: issue.id,
			});
			expect(comment.id).toMatch(/^comment-\d+$/);
		});

		it("should fetch comments for an issue", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			await service.createComment(issue.id, { body: "Comment 1" });
			await service.createComment(issue.id, { body: "Comment 2" });

			const comments = await service.fetchComments(issue.id);
			expect(comments.nodes).toHaveLength(2);
		});

		it("should emit commentMention event when agent mentioned", async () => {
			const issue = await service.createIssue({ title: "Test Issue" });

			const eventPromise = new Promise<{ comment: Comment; issue: string }>(
				(resolve) => {
					service.once("commentMention", ({ comment, issue: issueId }) => {
						resolve({ comment, issue: issueId });
					});
				},
			);

			await service.createComment(issue.id, {
				body: "@cyrus please help",
			});

			const { comment, issue: issueId } = await eventPromise;
			expect(comment.body).toContain("@cyrus");
			expect(issueId).toBe(issue.id);
		});

		it("should store attachment URLs in metadata when creating a comment", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const comment = await service.createComment(issue.id, {
				body: "Comment with attachments",
				attachmentUrls: [
					"https://example.com/file1.png",
					"https://example.com/file2.pdf",
				],
			});

			expect(comment.metadata).toBeDefined();
			expect(comment.metadata?.attachmentUrls).toEqual([
				"https://example.com/file1.png",
				"https://example.com/file2.pdf",
			]);
		});

		it("should not include metadata when no attachments are provided", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const comment = await service.createComment(issue.id, {
				body: "Comment without attachments",
			});

			expect(comment.metadata).toBeUndefined();
		});

		it("should handle empty attachmentUrls array", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const comment = await service.createComment(issue.id, {
				body: "Comment with empty attachments",
				attachmentUrls: [],
			});

			expect(comment.metadata).toBeUndefined();
		});
	});

	describe("Team Operations", () => {
		it("should fetch teams", async () => {
			const teams = await service.fetchTeams();
			expect(teams.nodes).toHaveLength(1); // Default team
			expect(teams.nodes[0].key).toBe("CLI");
		});

		it("should fetch a team by ID", async () => {
			const teams = await service.fetchTeams();
			const team = await service.fetchTeam(teams.nodes[0].id);
			expect(team).toEqual(teams.nodes[0]);
		});
	});

	describe("Label Operations", () => {
		it("should create a label", async () => {
			const label = await service.createLabel({
				name: "bug",
				color: "#ff0000",
			});

			expect(label).toMatchObject({
				name: "bug",
				color: "#ff0000",
			});
			expect(label.id).toMatch(/^label-\d+$/);
		});

		it("should fetch labels", async () => {
			await service.createLabel({ name: "bug" });
			await service.createLabel({ name: "feature" });

			const labels = await service.fetchLabels();
			expect(labels.nodes).toHaveLength(2);
		});
	});

	describe("User Operations", () => {
		it("should create a member", async () => {
			const member = await service.createMember({
				name: "Test User",
				email: "test@example.com",
			});

			expect(member).toMatchObject({
				name: "Test User",
				email: "test@example.com",
			});
		});

		it("should fetch current user", async () => {
			const user = await service.fetchCurrentUser();
			expect(user.name).toBe("CLI User");
		});
	});

	describe("Workflow State Operations", () => {
		it("should fetch workflow states", async () => {
			const teams = await service.fetchTeams();
			const states = await service.fetchWorkflowStates(teams.nodes[0].id);
			expect(states.nodes.length).toBeGreaterThan(0);
		});

		it("should have standard workflow states", async () => {
			const teams = await service.fetchTeams();
			const states = await service.fetchWorkflowStates(teams.nodes[0].id);

			const stateTypes = states.nodes.map((s) => s.type);
			expect(stateTypes).toContain(WorkflowStateType.Triage);
			expect(stateTypes).toContain(WorkflowStateType.Started);
			expect(stateTypes).toContain(WorkflowStateType.Completed);
		});
	});

	describe("Agent Session Operations", () => {
		it("should create an agent session on an issue", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			expect(response.success).toBe(true);
			expect(response.agentSessionId).toMatch(/^session-\d+$/);
		});

		it("should create an agent session on a comment", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const comment = await service.createComment(issue.id, {
				body: "Test comment",
			});

			const response = await service.createAgentSessionOnComment({
				commentId: comment.id,
			});

			expect(response.success).toBe(true);
			expect(response.agentSessionId).toMatch(/^session-\d+$/);
		});

		it("should fetch an agent session", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			const session = await service.fetchAgentSession(response.agentSessionId);
			expect(session.id).toBe(response.agentSessionId);
			expect(session.issueId).toBe(issue.id);
		});

		it("should emit agentSessionCreated event", async () => {
			const issue = await service.createIssue({ title: "Test Issue" });

			const eventPromise = new Promise<{ session: AgentSession; issue: Issue }>(
				(resolve) => {
					service.once("agentSessionCreated", ({ session, issue: iss }) => {
						resolve({ session, issue: iss });
					});
				},
			);

			await service.createAgentSessionOnIssue({ issueId: issue.id });

			const { session, issue: iss } = await eventPromise;
			expect(session.issueId).toBe(issue.id);
			expect(iss.id).toBe(issue.id);
		});
	});

	describe("Agent Activity Operations", () => {
		it("should create an agent activity", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			const activity = await service.createAgentActivity(
				response.agentSessionId,
				{
					type: AgentActivityContentType.Response,
					body: "Test response",
				},
			);

			expect(activity).toMatchObject({
				agentSessionId: response.agentSessionId,
				content: {
					type: AgentActivityContentType.Response,
					body: "Test response",
				},
			});
		});

		it("should fetch agent activities", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			await service.createAgentActivity(response.agentSessionId, {
				type: AgentActivityContentType.Response,
				body: "Activity 1",
			});

			await service.createAgentActivity(response.agentSessionId, {
				type: AgentActivityContentType.Response,
				body: "Activity 2",
			});

			const activities = await service.fetchAgentActivities(
				response.agentSessionId,
			);
			expect(activities).toHaveLength(2);
		});

		it("should create an ephemeral activity that gets replaced", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			// Create first ephemeral activity
			const ephemeralActivity1 = await service.createAgentActivity(
				response.agentSessionId,
				{
					type: AgentActivityContentType.Action,
					body: "Ephemeral activity 1",
				},
				{ ephemeral: true },
			);

			expect(ephemeralActivity1.ephemeral).toBe(true);

			// Verify it exists
			let activities = await service.fetchAgentActivities(
				response.agentSessionId,
			);
			expect(activities).toHaveLength(1);
			expect(activities[0].content.body).toBe("Ephemeral activity 1");

			// Create second ephemeral activity - should replace the first
			const ephemeralActivity2 = await service.createAgentActivity(
				response.agentSessionId,
				{
					type: AgentActivityContentType.Action,
					body: "Ephemeral activity 2",
				},
				{ ephemeral: true },
			);

			// Verify the first ephemeral was replaced
			activities = await service.fetchAgentActivities(response.agentSessionId);
			expect(activities).toHaveLength(1);
			expect(activities[0].content.body).toBe("Ephemeral activity 2");
			expect(activities[0].id).toBe(ephemeralActivity2.id);
		});

		it("should replace ephemeral activity with non-ephemeral", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			// Create ephemeral activity
			await service.createAgentActivity(
				response.agentSessionId,
				{
					type: AgentActivityContentType.Action,
					body: "Ephemeral progress",
				},
				{ ephemeral: true },
			);

			// Create non-ephemeral activity - should replace the ephemeral
			await service.createAgentActivity(
				response.agentSessionId,
				{
					type: AgentActivityContentType.Response,
					body: "Final result",
				},
				{ ephemeral: false },
			);

			// Verify ephemeral was replaced by non-ephemeral
			const activities = await service.fetchAgentActivities(
				response.agentSessionId,
			);
			expect(activities).toHaveLength(1);
			expect(activities[0].content.body).toBe("Final result");
			expect(activities[0].ephemeral).toBe(false);
		});

		it("should not replace non-ephemeral activities", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			// Create non-ephemeral activity
			await service.createAgentActivity(
				response.agentSessionId,
				{
					type: AgentActivityContentType.Response,
					body: "Permanent activity",
				},
				{ ephemeral: false },
			);

			// Create another activity - should NOT replace the previous
			await service.createAgentActivity(response.agentSessionId, {
				type: AgentActivityContentType.Response,
				body: "Another activity",
			});

			// Verify both exist
			const activities = await service.fetchAgentActivities(
				response.agentSessionId,
			);
			expect(activities).toHaveLength(2);
			expect(activities[0].content.body).toBe("Permanent activity");
			expect(activities[1].content.body).toBe("Another activity");
		});

		it("should send prompt to agent session", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			const activity = await service.promptAgentSession(
				response.agentSessionId,
				"Please do something",
			);

			expect(activity.content.type).toBe(AgentActivityContentType.Prompt);
			expect(activity.content.body).toBe("Please do something");
		});

		it("should emit agentSessionPrompted event", async () => {
			const issue = await service.createIssue({ title: "Test Issue" });
			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			const eventPromise = new Promise<{
				sessionId: string;
				activity: AgentActivity;
			}>((resolve) => {
				service.once("agentSessionPrompted", ({ sessionId, activity }) => {
					resolve({ sessionId, activity });
				});
			});

			await service.promptAgentSession(response.agentSessionId, "Test prompt");

			const { sessionId, activity } = await eventPromise;
			expect(sessionId).toBe(response.agentSessionId);
			expect(activity.content.body).toBe("Test prompt");
		});

		it("should stop an agent session", async () => {
			const issue = await service.createIssue({
				title: "Test Issue",
			});

			const response = await service.createAgentSessionOnIssue({
				issueId: issue.id,
			});

			const activity = await service.stopAgentSession(response.agentSessionId);

			expect(activity.signal).toBe("stop");

			const session = await service.fetchAgentSession(response.agentSessionId);
			expect(session.status).toBe("complete");
		});
	});

	describe("Event Transport", () => {
		it("should create an event transport", () => {
			const mockFastifyServer = {
				get: () => {},
				post: () => {},
			} as any;

			const transport = service.createEventTransport({
				fastifyServer: mockFastifyServer,
				verificationMode: "proxy",
				secret: "test-secret",
			});

			expect(transport).toBeDefined();
			expect(typeof transport.register).toBe("function");
			expect(typeof transport.on).toBe("function");
		});
	});

	describe("Error Handling", () => {
		it("should throw error for non-existent issue", async () => {
			await expect(service.fetchIssue("non-existent")).rejects.toThrow(
				"Issue not found",
			);
		});

		it("should throw error for non-existent comment", async () => {
			await expect(service.fetchComment("non-existent")).rejects.toThrow(
				"Comment not found",
			);
		});

		it("should throw error for non-existent session", async () => {
			await expect(service.fetchAgentSession("non-existent")).rejects.toThrow(
				"Agent session not found",
			);
		});

		it("should throw error for REST requests", async () => {
			await expect(service.rawRESTRequest("/test")).rejects.toThrow(
				"CLI issue tracker does not support REST",
			);
		});
	});
});
