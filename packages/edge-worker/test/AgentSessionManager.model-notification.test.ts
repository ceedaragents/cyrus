import { LinearClient } from "@linear/sdk";
import type { SDKSystemMessage } from "cyrus-claude-runner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

// Mock LinearClient
vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		createAgentActivity: vi.fn(),
	})),
	LinearDocument: {
		AgentSessionType: {
			CommentThread: "comment_thread",
		},
		AgentSessionStatus: {
			Active: "active",
			Complete: "complete",
			Error: "error",
		},
	},
}));

describe("AgentSessionManager - Model Notification", () => {
	let manager: AgentSessionManager;
	let mockLinearClient: any;
	let createAgentActivitySpy: any;
	const sessionId = "test-session-123";
	const issueId = "issue-123";

	beforeEach(() => {
		mockLinearClient = new LinearClient({ apiKey: "test" });
		createAgentActivitySpy = vi.spyOn(mockLinearClient, "createAgentActivity");
		createAgentActivitySpy.mockResolvedValue({
			success: true,
			agentActivity: Promise.resolve({ id: "activity-123" }),
		});

		manager = new AgentSessionManager(mockLinearClient);

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

	it("should post model notification when system init message is received", async () => {
		// Create a system init message with model information
		const systemMessage: SDKSystemMessage = {
			type: "system",
			subtype: "init",
			session_id: "claude-session-123",
			model: "claude-3-opus-20240229",
			tools: ["bash", "grep", "edit"],
			permissionMode: "allowed_tools",
			apiKeySource: "claude_desktop",
		};

		// Handle the system message
		await manager.handleClaudeMessage(sessionId, systemMessage);

		// Verify that createAgentActivity was called twice:
		// 1. First for any other activities
		// 2. Second for the model notification
		const modelNotificationCall = createAgentActivitySpy.mock.calls.find(
			(call: any) =>
				call[0].content.type === "thought" &&
				call[0].content.body.includes("Using model:"),
		);

		expect(modelNotificationCall).toBeTruthy();
		expect(modelNotificationCall[0]).toEqual({
			agentSessionId: sessionId,
			content: {
				type: "thought",
				body: "Using model: claude-3-opus-20240229",
			},
		});
	});

	it("should not post model notification if model is not provided", async () => {
		// Create a system init message without model information
		const systemMessage: SDKSystemMessage = {
			type: "system",
			subtype: "init",
			session_id: "claude-session-123",
			model: "",
			tools: ["bash", "grep", "edit"],
			permissionMode: "allowed_tools",
			apiKeySource: "claude_desktop",
		};

		// Handle the system message
		await manager.handleClaudeMessage(sessionId, systemMessage);

		// Verify that no model notification was posted
		const modelNotificationCall = createAgentActivitySpy.mock.calls.find(
			(call: any) =>
				call[0].content.type === "thought" &&
				call[0].content.body.includes("Using model:"),
		);

		expect(modelNotificationCall).toBeFalsy();
	});

	it("should update session metadata with model information", async () => {
		// Create a system init message with model information
		const systemMessage: SDKSystemMessage = {
			type: "system",
			subtype: "init",
			session_id: "claude-session-123",
			model: "claude-3-sonnet-20240229",
			tools: ["bash", "grep", "edit"],
			permissionMode: "allowed_tools",
			apiKeySource: "claude_desktop",
		};

		// Handle the system message
		await manager.handleClaudeMessage(sessionId, systemMessage);

		// Verify session metadata was updated
		const session = manager.getSession(sessionId);
		expect(session?.metadata?.model).toBe("claude-3-sonnet-20240229");
		expect(session?.claudeSessionId).toBe("claude-session-123");
	});

	it("should handle error when posting model notification fails", async () => {
		// Mock createAgentActivity to fail
		createAgentActivitySpy.mockResolvedValueOnce({
			success: false,
			error: "Failed to create activity",
		});

		// Spy on console.error
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		// Create a system init message with model information
		const systemMessage: SDKSystemMessage = {
			type: "system",
			subtype: "init",
			session_id: "claude-session-123",
			model: "claude-3-opus-20240229",
			tools: ["bash", "grep", "edit"],
			permissionMode: "allowed_tools",
			apiKeySource: "claude_desktop",
		};

		// Handle the system message
		await manager.handleClaudeMessage(sessionId, systemMessage);

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			"[AgentSessionManager] Failed to post model notification:",
			expect.objectContaining({ success: false }),
		);

		// Clean up
		consoleErrorSpy.mockRestore();
	});
});
