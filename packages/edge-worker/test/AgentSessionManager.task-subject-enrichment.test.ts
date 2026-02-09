import type { SDKAssistantMessage, SDKUserMessage } from "cyrus-claude-runner";
import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import type { IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

/**
 * Tests for TaskUpdate/TaskGet subject enrichment (CYPACK-797)
 *
 * Problem: TaskUpdate and TaskGet tool inputs don't include the task subject,
 * so the activity posted to Linear shows only "Task #3" without description.
 *
 * Solution: Defer TaskUpdate/TaskGet activity posting from tool_use time to
 * tool_result time, where we can enrich with subject from:
 * 1. A cache populated by previous TaskCreate results
 * 2. Parsing the TaskGet result content (which contains "Subject: ...")
 */
describe("AgentSessionManager - Task Subject Enrichment", () => {
	let manager: AgentSessionManager;
	let mockIssueTracker: IIssueTrackerService;
	let createAgentActivitySpy: any;
	const sessionId = "test-session-123";
	const issueId = "issue-123";

	// Helper to create a mock formatter-equipped runner
	const mockRunner = {
		getFormatter: () => new ClaudeMessageFormatter(),
		constructor: { name: "ClaudeRunner" },
	};

	// Helper to create an assistant message with tool_use
	function makeToolUseMessage(
		toolName: string,
		input: any,
		toolUseId: string,
	): SDKAssistantMessage {
		return {
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						name: toolName,
						input,
						id: toolUseId,
					},
				],
			},
			parent_tool_use_id: null,
			session_id: "claude-session-1",
		} as any;
	}

	// Helper to create a user message with tool_result
	function makeToolResultMessage(
		toolUseId: string,
		content: string,
		isError = false,
	): SDKUserMessage {
		return {
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: toolUseId,
						content,
						is_error: isError,
					},
				],
			},
			parent_tool_use_id: null,
			session_id: "claude-session-1",
		} as any;
	}

	beforeEach(() => {
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

		// Create a test session
		manager.createLinearAgentSession(
			sessionId,
			issueId,
			{
				id: issueId,
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				branchName: "test-branch",
			},
			{
				path: "/test/workspace",
				isGitWorktree: false,
			},
		);

		// Attach mock runner to the session so formatter is available
		const session = manager.getSession(sessionId);
		if (session) {
			session.agentRunner = mockRunner as any;
		}
	});

	it("should NOT post activity at TaskUpdate tool_use time (deferred to result)", async () => {
		// Send TaskUpdate tool_use
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "3", status: "completed" },
				"tu-update-1",
			),
		);

		// No activity should have been created at tool_use time
		expect(createAgentActivitySpy).not.toHaveBeenCalled();
	});

	it("should NOT post activity at TaskGet tool_use time (deferred to result)", async () => {
		// Send TaskGet tool_use
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage("TaskGet", { taskId: "3" }, "tu-get-1"),
		);

		// No activity should have been created at tool_use time
		expect(createAgentActivitySpy).not.toHaveBeenCalled();
	});

	it("should still post TaskCreate activity at tool_use time", async () => {
		// Send TaskCreate tool_use
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskCreate",
				{
					subject: "Fix login bug",
					description: "Fix the login bug on the login page",
				},
				"tu-create-1",
			),
		);

		// Activity should have been created at tool_use time
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "⏳ **Fix login bug**",
				},
			}),
		);
	});

	it("should enrich TaskUpdate with subject from TaskCreate cache", async () => {
		// Step 1: Send TaskCreate tool_use (caches subject by toolUseId)
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskCreate",
				{
					subject: "Fix login bug",
					description: "Fix the login bug",
				},
				"tu-create-1",
			),
		);

		// Step 2: Send TaskCreate tool_result (maps subject to task ID)
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage(
				"tu-create-1",
				"Task #3 created successfully: Fix login bug",
			),
		);

		// Clear the spy to focus on TaskUpdate calls
		createAgentActivitySpy.mockClear();

		// Step 3: Send TaskUpdate tool_use (deferred)
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "3", status: "completed" },
				"tu-update-1",
			),
		);

		// No activity at tool_use time
		expect(createAgentActivitySpy).not.toHaveBeenCalled();

		// Step 4: Send TaskUpdate tool_result (enriched thought created)
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage("tu-update-1", "Updated task #3 status"),
		);

		// Verify enriched thought was created with subject
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "✅ Task #3 — Fix login bug",
				},
			}),
		);
	});

	it("should enrich TaskGet with subject parsed from result content", async () => {
		// Send TaskGet tool_use (deferred)
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage("TaskGet", { taskId: "5" }, "tu-get-1"),
		);

		// No activity at tool_use time
		expect(createAgentActivitySpy).not.toHaveBeenCalled();

		// Send TaskGet tool_result with Subject in content
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage(
				"tu-get-1",
				"ID: 5\nSubject: Implement dark mode\nStatus: in_progress\nDescription: Add dark mode toggle",
			),
		);

		// Verify enriched thought was created with subject parsed from result
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "📋 Task #5 — Implement dark mode",
				},
			}),
		);
	});

	it("should cache subject from TaskGet result for subsequent TaskUpdate calls", async () => {
		// Step 1: TaskGet — parses and caches subject
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage("TaskGet", { taskId: "7" }, "tu-get-1"),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage(
				"tu-get-1",
				"ID: 7\nSubject: Add unit tests\nStatus: pending\nDescription: Write tests",
			),
		);

		createAgentActivitySpy.mockClear();

		// Step 2: TaskUpdate — should use cached subject from TaskGet
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "7", status: "in_progress" },
				"tu-update-1",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage("tu-update-1", "Updated task #7 status"),
		);

		// Verify enriched thought uses cached subject
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "🔄 Task #7 — Add unit tests",
				},
			}),
		);
	});

	it("should fall back to task number only when no subject available", async () => {
		// TaskUpdate with no prior TaskCreate or TaskGet
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "99", status: "completed" },
				"tu-update-1",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage("tu-update-1", "Updated task #99 status"),
		);

		// Should fall back to number-only format
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "✅ Task #99",
				},
			}),
		);
	});

	it("should handle multiple TaskCreate → TaskUpdate flows correctly", async () => {
		// Create task #1
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskCreate",
				{ subject: "Research API docs", description: "Research" },
				"tu-create-1",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage(
				"tu-create-1",
				"Task #1 created successfully: Research API docs",
			),
		);

		// Create task #2
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskCreate",
				{
					subject: "Implement feature",
					description: "Implement",
				},
				"tu-create-2",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage(
				"tu-create-2",
				"Task #2 created successfully: Implement feature",
			),
		);

		createAgentActivitySpy.mockClear();

		// Update task #2 (should get "Implement feature")
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "2", status: "in_progress" },
				"tu-update-2",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage("tu-update-2", "Updated task #2 status"),
		);

		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "🔄 Task #2 — Implement feature",
				},
			}),
		);

		createAgentActivitySpy.mockClear();

		// Update task #1 (should get "Research API docs")
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "1", status: "completed" },
				"tu-update-1",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage("tu-update-1", "Updated task #1 status"),
		);

		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "✅ Task #1 — Research API docs",
				},
			}),
		);
	});

	it("should handle TaskUpdate with deleted status", async () => {
		// Create then delete
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskCreate",
				{ subject: "Temp task", description: "Temp" },
				"tu-create-1",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage(
				"tu-create-1",
				"Task #5 created successfully: Temp task",
			),
		);

		createAgentActivitySpy.mockClear();

		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage(
				"TaskUpdate",
				{ taskId: "5", status: "deleted" },
				"tu-delete-1",
			),
		);
		await manager.handleClaudeMessage(
			sessionId,
			makeToolResultMessage("tu-delete-1", "Updated task #5 status"),
		);

		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "🗑️ Task #5 — Temp task",
				},
			}),
		);
	});

	it("should still post TaskList activity at tool_use time", async () => {
		await manager.handleClaudeMessage(
			sessionId,
			makeToolUseMessage("TaskList", {}, "tu-list-1"),
		);

		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				content: {
					type: "thought",
					body: "📋 List all tasks",
				},
			}),
		);
	});
});
