import type { IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

describe("AgentSessionManager - Stale Session Recovery", () => {
	let manager: AgentSessionManager;
	let mockIssueTracker: IIssueTrackerService;
	const sessionId = "test-session-123";
	const issueId = "issue-123";
	const claudeSessionId = "claude-session-abc";

	beforeEach(() => {
		// Create mock IIssueTrackerService
		mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-123" }),
			}),
			fetchIssue: vi.fn(),
			getIssueLabels: vi.fn().mockResolvedValue([]),
		} as any;

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
	});

	describe("clearClaudeSessionId", () => {
		it("should clear the claudeSessionId from a session", () => {
			// First, set a Claude session ID on the session
			const session = manager.getSession(sessionId);
			expect(session).toBeDefined();
			session!.claudeSessionId = claudeSessionId;

			// Verify it was set
			expect(manager.getSession(sessionId)?.claudeSessionId).toBe(
				claudeSessionId,
			);

			// Clear it
			manager.clearClaudeSessionId(sessionId);

			// Verify it was cleared
			expect(manager.getSession(sessionId)?.claudeSessionId).toBeUndefined();
		});

		it("should update the updatedAt timestamp when clearing", () => {
			const session = manager.getSession(sessionId);
			session!.claudeSessionId = claudeSessionId;
			// Set an old timestamp
			session!.updatedAt = 1000;

			manager.clearClaudeSessionId(sessionId);

			// updatedAt should be updated to current time (much greater than 1000)
			expect(manager.getSession(sessionId)?.updatedAt).toBeGreaterThan(1000);
		});

		it("should not crash if session does not exist", () => {
			// Should not throw
			expect(() => {
				manager.clearClaudeSessionId("non-existent-session");
			}).not.toThrow();
		});

		it("should log the cleared session ID", () => {
			const consoleLogSpy = vi
				.spyOn(console, "log")
				.mockImplementation(() => {});

			const session = manager.getSession(sessionId);
			session!.claudeSessionId = claudeSessionId;

			manager.clearClaudeSessionId(sessionId);

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining("Cleared stale Claude session ID"),
			);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining(claudeSessionId),
			);

			consoleLogSpy.mockRestore();
		});
	});

	describe("buildConversationSummary", () => {
		it("should return undefined for empty entries", () => {
			const summary = manager.buildConversationSummary(sessionId);
			expect(summary).toBeUndefined();
		});

		it("should return undefined for non-existent session", () => {
			const summary = manager.buildConversationSummary("non-existent-session");
			expect(summary).toBeUndefined();
		});

		it("should include user messages in summary", async () => {
			// Add a user message entry via handleClaudeMessage
			await manager.handleClaudeMessage(sessionId, {
				type: "user",
				session_id: claudeSessionId,
				message: {
					role: "user",
					content: [{ type: "text", text: "Please implement the feature" }],
				},
			} as any);

			const summary = manager.buildConversationSummary(sessionId);

			expect(summary).toBeDefined();
			expect(summary).toContain("# Session Recovery Context");
			expect(summary).toContain("## User Requests");
			expect(summary).toContain("Please implement the feature");
		});

		it("should include tool usage in summary", async () => {
			// Add an assistant message with tool use
			await manager.handleClaudeMessage(sessionId, {
				type: "assistant",
				session_id: claudeSessionId,
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-123",
							name: "Edit",
							input: { file_path: "test.ts" },
						},
					],
				},
			} as any);

			const summary = manager.buildConversationSummary(sessionId);

			expect(summary).toBeDefined();
			expect(summary).toContain("## Files You Modified");
			expect(summary).toContain("test.ts");
		});

		it("should skip TodoWrite in summary (noisy)", async () => {
			// Add an assistant message with TodoWrite tool
			await manager.handleClaudeMessage(sessionId, {
				type: "assistant",
				session_id: claudeSessionId,
				message: {
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-123",
							name: "TodoWrite",
							input: { todos: [] },
						},
					],
				},
			} as any);

			const summary = manager.buildConversationSummary(sessionId);

			// Should not include TodoWrite, so should return undefined (no meaningful content)
			expect(summary).toBeUndefined();
		});

		it("should truncate long user messages", async () => {
			// Add a user message with very long content (>500 chars triggers truncation)
			const longContent = "A".repeat(1000);
			await manager.handleClaudeMessage(sessionId, {
				type: "user",
				session_id: claudeSessionId,
				message: {
					role: "user",
					content: [{ type: "text", text: longContent }],
				},
			} as any);

			const summary = manager.buildConversationSummary(sessionId);

			expect(summary).toBeDefined();
			// Should be truncated to 500 chars + "..."
			expect(summary).toContain("...");
			// Summary (including headers) should be shorter than the raw content
			expect(summary!.length).toBeLessThan(longContent.length);
		});

		it("should only include recent user messages in summary", async () => {
			// Add many entries — implementation only keeps last 3 user messages
			for (let i = 0; i < 50; i++) {
				await manager.handleClaudeMessage(sessionId, {
					type: "user",
					session_id: claudeSessionId,
					message: {
						role: "user",
						content: [
							{ type: "text", text: `This is user message number ${i}` },
						],
					},
				} as any);
			}

			const summary = manager.buildConversationSummary(sessionId);

			expect(summary).toBeDefined();
			// Should only contain the last 3 user messages (47, 48, 49)
			expect(summary).toContain("This is user message number 47");
			expect(summary).toContain("This is user message number 48");
			expect(summary).toContain("This is user message number 49");
			// Should NOT contain earlier messages
			expect(summary).not.toContain("This is user message number 0");
			expect(summary).not.toContain("This is user message number 46");
		});

		it("should skip tool result entries (user messages with toolUseId)", async () => {
			// Add a tool result entry (this is a user message that's a response to a tool)
			await manager.handleClaudeMessage(sessionId, {
				type: "user",
				session_id: claudeSessionId,
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-123",
							content: "Tool output here",
						},
					],
				},
			} as any);

			const summary = manager.buildConversationSummary(sessionId);

			// Tool results should not appear in summary
			expect(summary).toBeUndefined();
		});
	});
});
