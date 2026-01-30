import type {
	SDKAssistantMessage,
	SDKStatusMessage,
	SDKSystemMessage,
} from "cyrus-claude-runner";
import type { IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

/**
 * Tests for CYPACK-776: GitHub sessions must NOT sync activities to Linear.
 *
 * GitHub PR comment sessions use `createGitHubSession()` which sets `platform: "github"`.
 * All Linear activity syncing methods (syncEntryToLinear, postModelNotificationThought,
 * handleStatusMessage) check `session.platform` and skip syncing for non-Linear sessions.
 * Only the final result is posted back as a GitHub PR comment (handled by EdgeWorker).
 */
describe("AgentSessionManager - GitHub Session (CYPACK-776)", () => {
	let manager: AgentSessionManager;
	let mockIssueTracker: IIssueTrackerService;
	let createAgentActivitySpy: any;

	// GitHub sessions use `github-{deliveryId}` format — NOT a valid Linear UUID
	const githubSessionId = "github-4b51a9d0-fe2a-11f0-996d-3db469e6e0cd";
	const issueId = "ray-tracer#6";

	const issueMinimal = {
		id: issueId,
		identifier: "ray-tracer#6",
		title: "Test PR",
		description: "GitHub PR comment session",
		branchName: "feature/test-branch",
	};

	const workspace = {
		path: "/test/workspace",
		isGitWorktree: true,
	};

	beforeEach(() => {
		// Create mock IIssueTrackerService that tracks all calls
		mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-123" }),
			}),
			fetchIssue: vi.fn(),
			getIssueLabels: vi.fn().mockResolvedValue([]),
		} as any;

		createAgentActivitySpy = vi.spyOn(mockIssueTracker, "createAgentActivity");

		manager = new AgentSessionManager(mockIssueTracker);
	});

	describe("GitHub sessions must not sync activities to Linear", () => {
		it("should NOT call createAgentActivity when handling assistant messages in a GitHub session", async () => {
			manager.createGitHubSession(
				githubSessionId,
				issueId,
				issueMinimal,
				workspace,
			);

			// Send an assistant message (thought)
			const assistantMessage: SDKAssistantMessage = {
				type: "assistant",
				message: {
					id: "msg-1",
					type: "message",
					role: "assistant",
					model: "claude-sonnet-4-20250514",
					content: [
						{
							type: "text",
							text: "I will fix this bug now.",
						},
					],
					stop_reason: "end_turn",
					stop_sequence: null,
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_creation_input_tokens: 0,
						cache_read_input_tokens: 0,
						server_tool_use: null,
					},
				},
				session_id: "claude-session-456",
			};

			await manager.handleClaudeMessage(githubSessionId, assistantMessage);

			// GitHub sessions must NOT call createAgentActivity
			expect(createAgentActivitySpy).not.toHaveBeenCalled();
		});

		it("should NOT call createAgentActivity for model notifications in a GitHub session", async () => {
			manager.createGitHubSession(
				githubSessionId,
				issueId,
				issueMinimal,
				workspace,
			);

			// Send a system init message with model info
			const systemMessage: SDKSystemMessage = {
				type: "system",
				subtype: "init",
				session_id: "claude-session-456",
				model: "claude-sonnet-4-20250514",
				tools: ["bash", "grep", "edit"],
				permissionMode: "allowed_tools",
				apiKeySource: "claude_desktop",
			};

			await manager.handleClaudeMessage(githubSessionId, systemMessage);

			// GitHub sessions must NOT post model notifications to Linear
			const modelNotificationCall = createAgentActivitySpy.mock.calls.find(
				(call: any) =>
					call[0]?.content?.type === "thought" &&
					call[0]?.content?.body?.includes("Using model:"),
			);

			expect(modelNotificationCall).toBeFalsy();
		});

		it("should NOT call createAgentActivity for status messages in a GitHub session", async () => {
			manager.createGitHubSession(
				githubSessionId,
				issueId,
				issueMinimal,
				workspace,
			);

			// Send a compacting status message
			const statusMessage: SDKStatusMessage = {
				type: "system",
				subtype: "status",
				status: "compacting",
				session_id: "claude-session-456",
			};

			await manager.handleClaudeMessage(githubSessionId, statusMessage);

			// GitHub sessions must NOT sync status updates to Linear
			expect(createAgentActivitySpy).not.toHaveBeenCalled();
		});
	});

	describe("Linear sessions must continue to work (no regression)", () => {
		const linearSessionId = "linear-session-uuid-123";
		const linearIssueId = "issue-456";

		beforeEach(() => {
			manager.createLinearAgentSession(
				linearSessionId,
				linearIssueId,
				{
					id: linearIssueId,
					identifier: "TEST-456",
					title: "Linear Issue",
					description: "Normal Linear issue",
					branchName: "test-branch",
				},
				workspace,
			);
		});

		it("should still sync assistant messages to Linear for Linear sessions", async () => {
			const assistantMessage: SDKAssistantMessage = {
				type: "assistant",
				message: {
					id: "msg-2",
					type: "message",
					role: "assistant",
					model: "claude-sonnet-4-20250514",
					content: [
						{
							type: "text",
							text: "Working on this Linear issue.",
						},
					],
					stop_reason: "end_turn",
					stop_sequence: null,
					usage: {
						input_tokens: 100,
						output_tokens: 50,
						cache_creation_input_tokens: 0,
						cache_read_input_tokens: 0,
						server_tool_use: null,
					},
				},
				session_id: "claude-session-789",
			};

			await manager.handleClaudeMessage(linearSessionId, assistantMessage);

			// Linear sessions SHOULD still sync to Linear
			expect(createAgentActivitySpy).toHaveBeenCalled();
		});

		it("should still post model notifications for Linear sessions", async () => {
			const systemMessage: SDKSystemMessage = {
				type: "system",
				subtype: "init",
				session_id: "claude-session-789",
				model: "claude-sonnet-4-20250514",
				tools: ["bash", "grep", "edit"],
				permissionMode: "allowed_tools",
				apiKeySource: "claude_desktop",
			};

			await manager.handleClaudeMessage(linearSessionId, systemMessage);

			// Linear sessions SHOULD still post model notifications
			const modelNotificationCall = createAgentActivitySpy.mock.calls.find(
				(call: any) =>
					call[0]?.content?.type === "thought" &&
					call[0]?.content?.body?.includes("Using model:"),
			);

			expect(modelNotificationCall).toBeTruthy();
		});
	});
});
