import type { SDKStatusMessage } from "cyrus-claude-runner";
import {
	AgentActivityContentType,
	type IIssueTrackerService,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

describe("AgentSessionManager - Status Messages", () => {
	let manager: AgentSessionManager;
	let mockIssueTracker: IIssueTrackerService;
	let createAgentActivitySpy: any;
	const sessionId = "test-session-123";
	const issueId = "issue-123";

	beforeEach(() => {
		// Create mock IIssueTrackerService
		mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				id: "activity-123",
				agentSessionId: sessionId,
				content: { type: AgentActivityContentType.Thought, body: "" },
				createdAt: new Date(),
			}),
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
	});

	it("should post ephemeral activity when compacting status is received", async () => {
		// Create a status message with compacting status
		const statusMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: "compacting",
			session_id: "claude-session-123",
		};

		// Handle the status message
		await manager.handleClaudeMessage(sessionId, statusMessage);

		// Verify that createAgentActivity was called with ephemeral thought
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			sessionId,
			{
				type: AgentActivityContentType.Thought,
				body: "Compacting conversation history…",
			},
			{ ephemeral: true },
		);
	});

	it("should post non-ephemeral activity when status is cleared (null)", async () => {
		// First, send a compacting status
		const compactingMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: "compacting",
			session_id: "claude-session-123",
		};
		await manager.handleClaudeMessage(sessionId, compactingMessage);

		// Clear the mock calls
		createAgentActivitySpy.mockClear();

		// Now send a status clear message
		const statusClearMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: null,
			session_id: "claude-session-123",
		};

		// Handle the status clear message
		await manager.handleClaudeMessage(sessionId, statusClearMessage);

		// Verify that createAgentActivity was called with non-ephemeral thought
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			sessionId,
			{
				type: AgentActivityContentType.Thought,
				body: "Conversation history compacted",
			},
			{ ephemeral: false },
		);
	});

	it("should handle compacting status followed by clear status", async () => {
		// Send compacting status
		const compactingMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: "compacting",
			session_id: "claude-session-123",
		};
		await manager.handleClaudeMessage(sessionId, compactingMessage);

		// Verify ephemeral activity was created
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			sessionId,
			{
				type: AgentActivityContentType.Thought,
				body: "Compacting conversation history…",
			},
			{ ephemeral: true },
		);

		// Clear the mock calls
		createAgentActivitySpy.mockClear();

		// Send status clear
		const statusClearMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: null,
			session_id: "claude-session-123",
		};
		await manager.handleClaudeMessage(sessionId, statusClearMessage);

		// Verify non-ephemeral activity was created
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			sessionId,
			{
				type: AgentActivityContentType.Thought,
				body: "Conversation history compacted",
			},
			{ ephemeral: false },
		);
	});

	it("should handle error when posting compacting status fails", async () => {
		// Mock createAgentActivity to throw an error
		const testError = new Error("Failed to create activity");
		createAgentActivitySpy.mockRejectedValueOnce(testError);

		// Spy on console.error
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		// Create a status message with compacting status
		const statusMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: "compacting",
			session_id: "claude-session-123",
		};

		// Handle the status message
		await manager.handleClaudeMessage(sessionId, statusMessage);

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"[AgentSessionManager] Error handling status message:",
			testError,
		);

		// Clean up
		consoleErrorSpy.mockRestore();
	});

	it("should handle error when posting status clear fails", async () => {
		// First send compacting status successfully
		const compactingMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: "compacting",
			session_id: "claude-session-123",
		};
		await manager.handleClaudeMessage(sessionId, compactingMessage);

		// Mock createAgentActivity to throw an error for the next call
		const testError = new Error("Failed to create activity");
		createAgentActivitySpy.mockRejectedValueOnce(testError);

		// Spy on console.error
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		// Send status clear
		const statusClearMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: null,
			session_id: "claude-session-123",
		};

		// Handle the status clear message
		await manager.handleClaudeMessage(sessionId, statusClearMessage);

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"[AgentSessionManager] Error handling status message:",
			testError,
		);

		// Clean up
		consoleErrorSpy.mockRestore();
	});

	it("should not crash if session is not found", async () => {
		// Spy on console.warn
		const consoleWarnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => {});

		// Create a status message for a non-existent session
		const statusMessage: SDKStatusMessage = {
			type: "system",
			subtype: "status",
			status: "compacting",
			session_id: "claude-session-123",
		};

		// Handle the status message for a non-existent session
		await manager.handleClaudeMessage("non-existent-session", statusMessage);

		// Verify warning was logged
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			"[AgentSessionManager] No Linear session ID for session non-existent-session",
		);

		// Verify createAgentActivity was not called
		expect(createAgentActivitySpy).not.toHaveBeenCalled();

		// Clean up
		consoleWarnSpy.mockRestore();
	});
});
