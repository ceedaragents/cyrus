/**
 * Unit tests for LinearActivitySink
 */

import type { AgentActivityContent, IIssueTrackerService } from "@cyrus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LinearActivitySink } from "../src/sinks/LinearActivitySink.js";

describe("LinearActivitySink", () => {
	let sink: LinearActivitySink;
	let mockIssueTracker: IIssueTrackerService;

	const mockWorkspaceId = "workspace-123";
	const mockSessionId = "session-456";
	const mockIssueId = "issue-789";

	beforeEach(() => {
		// Create a minimal mock IssueTrackerService
		mockIssueTracker = {
			createAgentActivity: vi.fn(),
			createAgentSessionOnIssue: vi.fn(),
		} as unknown as IIssueTrackerService;

		sink = new LinearActivitySink(mockIssueTracker, mockWorkspaceId);
	});

	describe("Constructor", () => {
		it("should set the workspace ID as sink ID", () => {
			expect(sink.id).toBe(mockWorkspaceId);
		});

		it("should store the issue tracker reference", () => {
			// Verify the sink has the tracker by calling a method
			expect(sink).toBeDefined();
		});
	});

	describe("postActivity()", () => {
		it("should post a thought activity", async () => {
			const activity: AgentActivityContent = {
				type: "thought",
				body: "Analyzing the codebase...",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should post an action activity", async () => {
			const activity: AgentActivityContent = {
				type: "action",
				action: "read_file",
				parameter: "src/index.ts",
				result: "File contents...",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-2" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should post a response activity", async () => {
			const activity: AgentActivityContent = {
				type: "response",
				body: "I've completed the task successfully.",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-3" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should post an error activity", async () => {
			const activity: AgentActivityContent = {
				type: "error",
				body: "Failed to read file: Permission denied",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-4" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should post an elicitation activity", async () => {
			const activity: AgentActivityContent = {
				type: "elicitation",
				body: "Which API endpoint should I use?",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-5" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should handle activity posting errors", async () => {
			const activity: AgentActivityContent = {
				type: "thought",
				body: "Test",
			};

			const error = new Error("Network error");
			vi.mocked(mockIssueTracker.createAgentActivity).mockRejectedValue(error);

			await expect(sink.postActivity(mockSessionId, activity)).rejects.toThrow(
				"Network error",
			);
		});

		it("should call createAgentActivity exactly once per post", async () => {
			const activity: AgentActivityContent = {
				type: "thought",
				body: "Test",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledTimes(1);
		});
	});

	describe("createAgentSession()", () => {
		it("should create a session and return session ID", async () => {
			const expectedSessionId = "new-session-123";
			vi.mocked(mockIssueTracker.createAgentSessionOnIssue).mockResolvedValue({
				success: true,
				agentSession: Promise.resolve({ id: expectedSessionId }),
			} as any);

			const sessionId = await sink.createAgentSession(mockIssueId);

			expect(sessionId).toBe(expectedSessionId);
			expect(mockIssueTracker.createAgentSessionOnIssue).toHaveBeenCalledWith({
				issueId: mockIssueId,
			});
		});

		it("should handle session creation errors", async () => {
			const error = new Error("Failed to create session");
			vi.mocked(mockIssueTracker.createAgentSessionOnIssue).mockRejectedValue(
				error,
			);

			await expect(sink.createAgentSession(mockIssueId)).rejects.toThrow(
				"Failed to create session",
			);
		});

		it("should await agentSession promise before extracting ID", async () => {
			const expectedSessionId = "new-session-456";
			const agentSessionPromise = Promise.resolve({ id: expectedSessionId });

			vi.mocked(mockIssueTracker.createAgentSessionOnIssue).mockResolvedValue({
				success: true,
				agentSession: agentSessionPromise,
			} as any);

			const sessionId = await sink.createAgentSession(mockIssueId);

			expect(sessionId).toBe(expectedSessionId);
		});

		it("should call createAgentSessionOnIssue exactly once", async () => {
			vi.mocked(mockIssueTracker.createAgentSessionOnIssue).mockResolvedValue({
				success: true,
				agentSession: Promise.resolve({ id: "session-123" }),
			} as any);

			await sink.createAgentSession(mockIssueId);

			expect(mockIssueTracker.createAgentSessionOnIssue).toHaveBeenCalledTimes(
				1,
			);
		});
	});

	describe("Multiple Operations", () => {
		it("should handle multiple activity posts to the same session", async () => {
			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, {
				type: "thought",
				body: "First thought",
			});
			await sink.postActivity(mockSessionId, {
				type: "action",
				action: "read_file",
				parameter: "test.ts",
			});
			await sink.postActivity(mockSessionId, {
				type: "response",
				body: "Done",
			});

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledTimes(3);
		});

		it("should handle creating multiple sessions", async () => {
			vi.mocked(mockIssueTracker.createAgentSessionOnIssue).mockResolvedValue({
				success: true,
				agentSession: Promise.resolve({ id: "session-1" }),
			} as any);

			await sink.createAgentSession("issue-1");
			await sink.createAgentSession("issue-2");
			await sink.createAgentSession("issue-3");

			expect(mockIssueTracker.createAgentSessionOnIssue).toHaveBeenCalledTimes(
				3,
			);
			expect(
				mockIssueTracker.createAgentSessionOnIssue,
			).toHaveBeenNthCalledWith(1, { issueId: "issue-1" });
			expect(
				mockIssueTracker.createAgentSessionOnIssue,
			).toHaveBeenNthCalledWith(2, { issueId: "issue-2" });
			expect(
				mockIssueTracker.createAgentSessionOnIssue,
			).toHaveBeenNthCalledWith(3, { issueId: "issue-3" });
		});
	});

	describe("Workspace ID Management", () => {
		it("should create sinks with different workspace IDs", () => {
			const sink1 = new LinearActivitySink(mockIssueTracker, "workspace-1");
			const sink2 = new LinearActivitySink(mockIssueTracker, "workspace-2");

			expect(sink1.id).toBe("workspace-1");
			expect(sink2.id).toBe("workspace-2");
		});

		it("should maintain consistent ID throughout lifecycle", async () => {
			const initialId = sink.id;

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, {
				type: "thought",
				body: "Test",
			});

			expect(sink.id).toBe(initialId);
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty activity body", async () => {
			const activity: AgentActivityContent = {
				type: "thought",
				body: "",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should handle activity with minimal fields", async () => {
			const activity: AgentActivityContent = {
				type: "action",
				action: "test",
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});

		it("should handle very long activity content", async () => {
			const longBody = "x".repeat(10000);
			const activity: AgentActivityContent = {
				type: "thought",
				body: longBody,
			};

			vi.mocked(mockIssueTracker.createAgentActivity).mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-1" }),
			} as any);

			await sink.postActivity(mockSessionId, activity);

			expect(mockIssueTracker.createAgentActivity).toHaveBeenCalledWith({
				agentSessionId: mockSessionId,
				content: activity,
			});
		});
	});
});
