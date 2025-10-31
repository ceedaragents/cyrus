/**
 * LinearRenderer Tests
 *
 * Comprehensive unit tests for LinearRenderer with >80% coverage target
 */

import type {
	AgentActivity,
	AgentActivityActionContent,
	AgentActivityElicitationContent,
	AgentActivityErrorContent,
	AgentActivityPromptContent,
	AgentActivityResponseContent,
	AgentActivityThoughtContent,
	Comment,
	Issue,
	IssueState,
	IssueTracker,
	Member,
	RenderableSession,
	SessionSummary,
} from "cyrus-interfaces";
import { beforeEach, describe, expect, it } from "vitest";
import {
	LinearRenderer,
	type LinearRendererConfig,
} from "../../src/linear/LinearRenderer.js";

/**
 * Mock IssueTracker for testing
 */
class MockIssueTracker implements IssueTracker {
	public comments: Array<{ issueId: string; comment: Comment }> = [];

	async getIssue(_issueId: string): Promise<Issue> {
		throw new Error("Not implemented in mock");
	}

	async listAssignedIssues(_memberId: string): Promise<Issue[]> {
		throw new Error("Not implemented in mock");
	}

	async updateIssueState(_issueId: string, _state: IssueState): Promise<void> {
		throw new Error("Not implemented in mock");
	}

	async addComment(issueId: string, comment: Comment): Promise<string> {
		const commentWithId = { ...comment, id: `comment-${this.comments.length}` };
		this.comments.push({ issueId, comment: commentWithId });
		return commentWithId.id!;
	}

	async getComments(_issueId: string): Promise<Comment[]> {
		throw new Error("Not implemented in mock");
	}

	async *watchIssues(_memberId: string): AsyncIterable<Issue> {
		// Empty generator
	}

	async getAttachments(_issueId: string) {
		throw new Error("Not implemented in mock");
	}

	async sendSignal(_issueId: string, _signal: any): Promise<void> {
		throw new Error("Not implemented in mock");
	}

	// Helper method for testing
	getLastComment(): Comment | undefined {
		return this.comments[this.comments.length - 1]?.comment;
	}

	clearComments(): void {
		this.comments = [];
	}
}

describe("LinearRenderer", () => {
	let mockTracker: MockIssueTracker;
	let renderer: LinearRenderer;
	let agentMember: Member;

	beforeEach(() => {
		mockTracker = new MockIssueTracker();
		agentMember = {
			id: "agent-123",
			name: "Cyrus Agent",
			email: "agent@cyrus.ai",
		};

		const config: LinearRendererConfig = {
			issueTracker: mockTracker,
			agentMember,
		};

		renderer = new LinearRenderer(config);
	});

	describe("renderSessionStart", () => {
		it("should post a session start comment", async () => {
			const session: RenderableSession = {
				id: "session-123",
				issueId: "issue-123",
				issueTitle: "Test Issue",
				startedAt: new Date("2025-01-27T12:00:00Z"),
			};

			await renderer.renderSessionStart(session);

			expect(mockTracker.comments).toHaveLength(1);
			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Session Started");
			expect(comment?.content).toContain("Test Issue");
			expect(comment?.isRoot).toBe(true);
			expect(comment?.author.id).toBe(agentMember.id);
		});

		it("should track session state internally", async () => {
			const session: RenderableSession = {
				id: "session-456",
				issueId: "issue-456",
				issueTitle: "Another Test",
				startedAt: new Date(),
			};

			await renderer.renderSessionStart(session);

			// Subsequent calls should work without error
			await expect(
				renderer.renderText(session.id, "Test text"),
			).resolves.not.toThrow();
		});

		it("should use non-verbose formatting when configured", async () => {
			const config: LinearRendererConfig = {
				issueTracker: mockTracker,
				agentMember,
				verboseFormatting: false,
			};
			renderer = new LinearRenderer(config);

			const session: RenderableSession = {
				id: "session-789",
				issueId: "issue-789",
				issueTitle: "Simple Test",
				startedAt: new Date(),
			};

			await renderer.renderSessionStart(session);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).not.toContain("🚀");
			expect(comment?.content).toContain("Starting work on: Simple Test");
		});
	});

	describe("renderActivity", () => {
		beforeEach(async () => {
			// Start a session first
			await renderer.renderSessionStart({
				id: "session-act",
				issueId: "issue-act",
				issueTitle: "Activity Test",
				startedAt: new Date(),
			});
			mockTracker.clearComments();
		});

		it("should render thought activity", async () => {
			const activity: AgentActivity = {
				id: "act-1",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "thought",
					body: "I need to analyze this problem",
				} as AgentActivityThoughtContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Thinking");
			expect(comment?.content).toContain("I need to analyze this problem");
		});

		it("should render action activity without result", async () => {
			const activity: AgentActivity = {
				id: "act-2",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "action",
					action: "FileRead",
					parameter: "test.txt",
				} as AgentActivityActionContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Action: FileRead");
			expect(comment?.content).toContain("test.txt");
		});

		it("should render action activity with result", async () => {
			const activity: AgentActivity = {
				id: "act-3",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "action",
					action: "BashCommand",
					parameter: "ls -la",
					result: "file1.txt\nfile2.txt",
				} as AgentActivityActionContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Action: BashCommand");
			expect(comment?.content).toContain("ls -la");
			expect(comment?.content).toContain("Result");
			expect(comment?.content).toContain("file1.txt");
		});

		it("should render response activity", async () => {
			const activity: AgentActivity = {
				id: "act-4",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "response",
					body: "Here is my response to your question",
				} as AgentActivityResponseContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Response");
			expect(comment?.content).toContain(
				"Here is my response to your question",
			);
		});

		it("should render error activity", async () => {
			const activity: AgentActivity = {
				id: "act-5",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "error",
					body: "File not found: missing.txt",
				} as AgentActivityErrorContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Error");
			expect(comment?.content).toContain("File not found: missing.txt");
		});

		it("should render elicitation activity", async () => {
			const activity: AgentActivity = {
				id: "act-6",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "elicitation",
					body: "Do you want me to proceed with these changes?",
				} as AgentActivityElicitationContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Input Required");
			expect(comment?.content).toContain(
				"Do you want me to proceed with these changes?",
			);
		});

		it("should render prompt activity", async () => {
			const activity: AgentActivity = {
				id: "act-7",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "prompt",
					body: "Please review the following changes",
				} as AgentActivityPromptContent,
			};

			await renderer.renderActivity("session-act", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Prompt");
			expect(comment?.content).toContain("Please review the following changes");
		});

		it("should throw error for unknown session", async () => {
			const activity: AgentActivity = {
				id: "act-8",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "thought",
					body: "Test",
				} as AgentActivityThoughtContent,
			};

			await expect(
				renderer.renderActivity("unknown-session", activity),
			).rejects.toThrow("Session unknown-session not found");
		});

		it("should use non-verbose formatting for activities", async () => {
			const config: LinearRendererConfig = {
				issueTracker: mockTracker,
				agentMember,
				verboseFormatting: false,
			};
			renderer = new LinearRenderer(config);

			await renderer.renderSessionStart({
				id: "session-simple",
				issueId: "issue-simple",
				issueTitle: "Simple",
				startedAt: new Date(),
			});
			mockTracker.clearComments();

			const activity: AgentActivity = {
				id: "act-9",
				createdAt: new Date(),
				updatedAt: new Date(),
				content: {
					type: "thought",
					body: "Simple thought",
				} as AgentActivityThoughtContent,
			};

			await renderer.renderActivity("session-simple", activity);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).not.toContain("💭");
			expect(comment?.content).toBe("Simple thought");
		});
	});

	describe("renderText", () => {
		beforeEach(async () => {
			await renderer.renderSessionStart({
				id: "session-text",
				issueId: "issue-text",
				issueTitle: "Text Test",
				startedAt: new Date(),
			});
			mockTracker.clearComments();
		});

		it("should post plain text as comment", async () => {
			await renderer.renderText("session-text", "This is a plain text message");

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toBe("This is a plain text message");
		});

		it("should support markdown in text", async () => {
			const markdown = "# Heading\n\n**Bold** and *italic* text";
			await renderer.renderText("session-text", markdown);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toBe(markdown);
		});

		it("should throw error for unknown session", async () => {
			await expect(renderer.renderText("unknown", "Test")).rejects.toThrow(
				"Session unknown not found",
			);
		});
	});

	describe("renderToolUse", () => {
		beforeEach(async () => {
			await renderer.renderSessionStart({
				id: "session-tool",
				issueId: "issue-tool",
				issueTitle: "Tool Test",
				startedAt: new Date(),
			});
			mockTracker.clearComments();
		});

		it("should render tool use with string input", async () => {
			await renderer.renderToolUse("session-tool", "FileRead", "test.txt");

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Tool: FileRead");
			expect(comment?.content).toContain("test.txt");
		});

		it("should render tool use with object input", async () => {
			const input = { file: "test.txt", lines: 100 };
			await renderer.renderToolUse("session-tool", "FileRead", input);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Tool: FileRead");
			expect(comment?.content).toContain('"file"');
			expect(comment?.content).toContain('"test.txt"');
			expect(comment?.content).toContain('"lines"');
		});

		it("should throw error for unknown session", async () => {
			await expect(
				renderer.renderToolUse("unknown", "Test", "input"),
			).rejects.toThrow("Session unknown not found");
		});
	});

	describe("renderComplete", () => {
		beforeEach(async () => {
			await renderer.renderSessionStart({
				id: "session-complete",
				issueId: "issue-complete",
				issueTitle: "Complete Test",
				startedAt: new Date(Date.now() - 5000), // 5 seconds ago
			});
			mockTracker.clearComments();
		});

		it("should render completion summary", async () => {
			const summary: SessionSummary = {
				turns: 10,
				toolsUsed: 5,
				filesModified: ["file1.ts", "file2.ts"],
				exitCode: 0,
			};

			await renderer.renderComplete("session-complete", summary);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Session Complete");
			expect(comment?.content).toContain("10"); // Turns count
			expect(comment?.content).toContain("5"); // Tools used count
			expect(comment?.content).toContain("0"); // Exit code
			expect(comment?.content).toContain("file1.ts");
			expect(comment?.content).toContain("file2.ts");
		});

		it("should include optional summary text", async () => {
			const summary: SessionSummary = {
				turns: 5,
				toolsUsed: 2,
				filesModified: [],
				summary: "Successfully completed the task",
				exitCode: 0,
			};

			await renderer.renderComplete("session-complete", summary);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Successfully completed the task");
		});

		it("should format duration correctly", async () => {
			const summary: SessionSummary = {
				turns: 1,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await renderer.renderComplete("session-complete", summary);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toMatch(/Duration.*\d+[smh]/);
		});

		it("should clean up session after completion", async () => {
			const summary: SessionSummary = {
				turns: 1,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await renderer.renderComplete("session-complete", summary);

			// Should throw error because session was cleaned up
			await expect(
				renderer.renderText("session-complete", "Test"),
			).rejects.toThrow("Session session-complete not found");
		});

		it("should throw error for unknown session", async () => {
			const summary: SessionSummary = {
				turns: 1,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await expect(renderer.renderComplete("unknown", summary)).rejects.toThrow(
				"Session unknown not found",
			);
		});
	});

	describe("renderError", () => {
		beforeEach(async () => {
			await renderer.renderSessionStart({
				id: "session-error",
				issueId: "issue-error",
				issueTitle: "Error Test",
				startedAt: new Date(),
			});
			mockTracker.clearComments();
		});

		it("should render error with message", async () => {
			const error = new Error("Something went wrong");
			await renderer.renderError("session-error", error);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Error Occurred");
			expect(comment?.content).toContain("Something went wrong");
		});

		it("should include stack trace when available", async () => {
			const error = new Error("Test error");
			error.stack = "Error: Test error\n  at test.ts:10:5";

			await renderer.renderError("session-error", error);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toContain("Stack Trace");
			expect(comment?.content).toContain("at test.ts:10:5");
		});

		it("should throw error for unknown session", async () => {
			await expect(
				renderer.renderError("unknown", new Error("Test")),
			).rejects.toThrow("Session unknown not found");
		});
	});

	describe("getUserInput", () => {
		beforeEach(async () => {
			await renderer.renderSessionStart({
				id: "session-input",
				issueId: "issue-input",
				issueTitle: "Input Test",
				startedAt: new Date(),
			});
		});

		it("should return empty async iterable", async () => {
			const inputs: any[] = [];
			for await (const input of renderer.getUserInput("session-input")) {
				inputs.push(input);
			}

			expect(inputs).toHaveLength(0);
		});
	});

	describe("comment threading", () => {
		it("should create root comments by default", async () => {
			await renderer.renderSessionStart({
				id: "session-thread",
				issueId: "issue-thread",
				issueTitle: "Thread Test",
				startedAt: new Date(),
			});

			const comment = mockTracker.getLastComment();
			expect(comment?.isRoot).toBe(true);
			expect(comment?.parentId).toBeUndefined();
		});

		it("should create replies when rootCommentId is provided", async () => {
			const config: LinearRendererConfig = {
				issueTracker: mockTracker,
				agentMember,
				rootCommentId: "parent-comment-123",
			};
			renderer = new LinearRenderer(config);

			await renderer.renderSessionStart({
				id: "session-reply",
				issueId: "issue-reply",
				issueTitle: "Reply Test",
				startedAt: new Date(),
			});

			const comment = mockTracker.getLastComment();
			expect(comment?.isRoot).toBe(false);
			expect(comment?.parentId).toBe("parent-comment-123");
		});
	});

	describe("formatDuration", () => {
		it("should format seconds correctly", async () => {
			await renderer.renderSessionStart({
				id: "session-dur-s",
				issueId: "issue-dur",
				issueTitle: "Duration",
				startedAt: new Date(Date.now() - 15000), // 15 seconds ago
			});
			mockTracker.clearComments();

			const summary: SessionSummary = {
				turns: 1,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await renderer.renderComplete("session-dur-s", summary);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toMatch(/\d+s/);
		});

		it("should format minutes correctly", async () => {
			await renderer.renderSessionStart({
				id: "session-dur-m",
				issueId: "issue-dur",
				issueTitle: "Duration",
				startedAt: new Date(Date.now() - 125000), // 2m 5s ago
			});
			mockTracker.clearComments();

			const summary: SessionSummary = {
				turns: 1,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await renderer.renderComplete("session-dur-m", summary);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toMatch(/2m \d+s/);
		});

		it("should format hours correctly", async () => {
			await renderer.renderSessionStart({
				id: "session-dur-h",
				issueId: "issue-dur",
				issueTitle: "Duration",
				startedAt: new Date(Date.now() - 3665000), // 1h 1m 5s ago
			});
			mockTracker.clearComments();

			const summary: SessionSummary = {
				turns: 1,
				toolsUsed: 0,
				filesModified: [],
				exitCode: 0,
			};

			await renderer.renderComplete("session-dur-h", summary);

			const comment = mockTracker.getLastComment();
			expect(comment?.content).toMatch(/1h 1m/);
		});
	});
});
