import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { LinearClient, LinearDocument } from "@linear/sdk";
import type { SDKAssistantMessage, SDKResultMessage, APIAssistantMessage } from "cyrus-claude-runner";
import { LAST_MESSAGE_MARKER } from "../src/constants.js";

// Mock LinearClient
vi.mock("@linear/sdk", () => ({
	LinearClient: vi.fn().mockImplementation(() => ({
		createAgentActivity: vi.fn(),
		updateAgentSessionStatus: vi.fn(),
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

describe("AgentSessionManager - Last Message Marker Handling", () => {
	let mockLinearClient: any;
	let manager: AgentSessionManager;
	let createAgentActivitySpy: any;
	let updateStatusSpy: any;
	const mockSessionId = "test-session-123";
	const mockIssueId = "issue-123";

	beforeEach(() => {
		// Create mock client
		mockLinearClient = new LinearClient({ apiKey: "test" });
		createAgentActivitySpy = vi.spyOn(mockLinearClient, "createAgentActivity");
		updateStatusSpy = vi.spyOn(mockLinearClient, "updateAgentSessionStatus");
		
		createAgentActivitySpy.mockResolvedValue({
			success: true,
			agentActivity: Promise.resolve({ id: "activity-123" }),
		});
		updateStatusSpy.mockResolvedValue({
			success: true,
		});

		manager = new AgentSessionManager(mockLinearClient);

		// Create a mock session
		manager.createLinearAgentSession(
			mockSessionId,
			mockIssueId,
			{
				id: mockIssueId,
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
			},
			{
				path: "/test/workspace",
				mainBranch: "main",
			} as any
		);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("should store assistant message with last message marker", async () => {
		const content = `${LAST_MESSAGE_MARKER}\nThis is the final response.`;
		const messageWithMarker: SDKAssistantMessage = {
			type: "assistant",
			message: {
				content: content,
			} as APIAssistantMessage,
			session_id: "test-claude-session",
			timestamp: Date.now(),
		};

		// Create session entry
		const entry = await (manager as any).createSessionEntry(mockSessionId, messageWithMarker);
		
		// Try to sync to Linear - should be skipped
		await (manager as any).syncEntryToLinear(entry, mockSessionId);

		// Verify the message was not posted as a thought
		expect(createAgentActivitySpy).not.toHaveBeenCalled();

		// Verify the message was stored
		const storedMessage = (manager as any).lastMessageWithMarker.get(mockSessionId);
		expect(storedMessage).toBe(content);
	});

	it("should post stored message when session completes without result content", async () => {
		const messageWithMarker = `${LAST_MESSAGE_MARKER}\nThis is the final response.`;
		
		// Store a message with marker
		(manager as any).lastMessageWithMarker.set(mockSessionId, messageWithMarker);

		// Complete session without result content
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "success",
			timestamp: Date.now(),
			total_cost_usd: 0.01,
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			// No result field
		};

		await manager.completeSession(mockSessionId, resultMessage);

		// Verify the stored message was posted as a response
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				agentSessionId: mockSessionId,
				content: {
					type: "response",
					body: "This is the final response.", // Marker should be stripped
				},
			})
		);

		// Verify the stored message was cleared
		const storedMessage = (manager as any).lastMessageWithMarker.get(mockSessionId);
		expect(storedMessage).toBeUndefined();
	});

	it("should use result message when available and clear stored message", async () => {
		const messageWithMarker = `${LAST_MESSAGE_MARKER}\nThis is the stored response.`;
		
		// Store a message with marker
		(manager as any).lastMessageWithMarker.set(mockSessionId, messageWithMarker);

		// Complete session WITH result content
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "success",
			timestamp: Date.now(),
			total_cost_usd: 0.01,
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			result: "This is the actual result response.",
		};

		await manager.completeSession(mockSessionId, resultMessage);

		// Verify the result message was posted (not the stored one)
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				agentSessionId: mockSessionId,
				content: {
					type: "response",
					body: "This is the actual result response.",
				},
			})
		);

		// Verify the stored message was cleared
		const storedMessage = (manager as any).lastMessageWithMarker.get(mockSessionId);
		expect(storedMessage).toBeUndefined();
	});

	it("should handle assistant messages without marker normally", async () => {
		const normalMessage: SDKAssistantMessage = {
			type: "assistant",
			message: {
				content: "This is a normal thought without marker.",
			} as APIAssistantMessage,
			session_id: "test-claude-session",
			timestamp: Date.now(),
		};

		// Create and sync entry
		const entry = await (manager as any).createSessionEntry(mockSessionId, normalMessage);
		await (manager as any).syncEntryToLinear(entry, mockSessionId);

		// Verify the message was posted as a thought
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				agentSessionId: mockSessionId,
				content: {
					type: "thought",
					body: "This is a normal thought without marker.",
				},
			})
		);

		// Verify no message was stored
		const storedMessage = (manager as any).lastMessageWithMarker.get(mockSessionId);
		expect(storedMessage).toBeUndefined();
	});

	it("should strip marker from result messages", async () => {
		const resultMessage: SDKResultMessage = {
			type: "result",
			subtype: "success",
			timestamp: Date.now(),
			total_cost_usd: 0.01,
			usage: {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
			},
			result: `${LAST_MESSAGE_MARKER}\nThis is the result with marker.`,
		};

		await manager.completeSession(mockSessionId, resultMessage);

		// Verify the marker was stripped from the result
		expect(createAgentActivitySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				agentSessionId: mockSessionId,
				content: {
					type: "response",
					body: "This is the result with marker.",
				},
			})
		);
	});
});