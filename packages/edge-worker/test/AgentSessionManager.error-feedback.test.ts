import { EventEmitter } from "node:events";
import type { IAgentRunner, IIssueTrackerService } from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager";

/**
 * Mock agent runner that can emit error events
 */
class MockAgentRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;
	private _running = false;

	async start(_prompt: string) {
		this._running = true;
		return { sessionId: "mock-session", isRunning: true };
	}

	stop() {
		this._running = false;
	}

	isRunning() {
		return this._running;
	}

	getMessages() {
		return [];
	}

	getFormatter() {
		return {
			formatToolParameter: () => "",
			formatToolResult: () => ({ summary: "" }),
			formatToolResultAsString: () => "",
			formatAPIMessage: () => "",
		};
	}

	// Emit an error for testing
	emitError(error: Error) {
		this.emit("error", error);
	}
}

describe("AgentSessionManager - Error Feedback", () => {
	let manager: AgentSessionManager;
	let mockIssueTracker: IIssueTrackerService;
	let createAgentActivitySpy: ReturnType<typeof vi.spyOn>;
	const sessionId = "test-session-123";
	const issueId = "issue-123";

	beforeEach(() => {
		// Create mock IIssueTrackerService
		mockIssueTracker = {
			createAgentActivity: vi.fn().mockResolvedValue({
				success: true,
				agentActivity: Promise.resolve({ id: "activity-123" }),
			}),
			fetchIssue: vi.fn(),
			getIssueLabels: vi.fn().mockResolvedValue([]),
		} as unknown as IIssueTrackerService;

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

	describe("addAgentRunner error event handling", () => {
		it("should subscribe to error events when runner is added", async () => {
			const mockRunner = new MockAgentRunner();

			// Add the runner to the session
			manager.addAgentRunner(sessionId, mockRunner);

			// Emit an error from the runner
			const testError = new Error("Test error message");
			mockRunner.emitError(testError);

			// Wait for async error handling
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify that createAgentActivity was called with error content
			expect(createAgentActivitySpy).toHaveBeenCalledWith({
				agentSessionId: sessionId,
				content: {
					type: "error",
					body: expect.stringContaining("An error occurred while processing"),
				},
			});
		});

		it("should sanitize error messages before posting", async () => {
			const mockRunner = new MockAgentRunner();

			// Add the runner to the session
			manager.addAgentRunner(sessionId, mockRunner);

			// Emit an error with a long API key-like string
			const testError = new Error(
				"API Error: key_abc123def456ghi789jkl012mno345pqr is invalid",
			);
			mockRunner.emitError(testError);

			// Wait for async error handling
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify that the error was sanitized
			expect(createAgentActivitySpy).toHaveBeenCalledWith({
				agentSessionId: sessionId,
				content: {
					type: "error",
					body: expect.stringContaining("[REDACTED]"),
				},
			});
		});

		it("should truncate very long error messages", async () => {
			const mockRunner = new MockAgentRunner();

			// Add the runner to the session
			manager.addAgentRunner(sessionId, mockRunner);

			// Emit an error with a very long message
			const longMessage = "x".repeat(1000);
			const testError = new Error(longMessage);
			mockRunner.emitError(testError);

			// Wait for async error handling
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify that createAgentActivity was called
			expect(createAgentActivitySpy).toHaveBeenCalled();

			// Get the actual call and verify the body is truncated
			const call = createAgentActivitySpy.mock.calls[0][0] as {
				content: { body: string };
			};
			expect(call.content.body.length).toBeLessThan(1000);
		});

		it("should remove stack traces from error messages", async () => {
			const mockRunner = new MockAgentRunner();

			// Add the runner to the session
			manager.addAgentRunner(sessionId, mockRunner);

			// Emit an error with a stack trace
			const testError = new Error("Something went wrong");
			testError.stack =
				"Error: Something went wrong\n    at foo (/path/to/file.js:10)\n    at bar (/path/to/other.js:20)";
			// The message doesn't include the stack by default, but let's simulate if it did
			const errorWithStack = new Error(
				"Something went wrong\n    at foo (/path/to/file.js:10)",
			);
			mockRunner.emitError(errorWithStack);

			// Wait for async error handling
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify that the stack trace was removed
			const call = createAgentActivitySpy.mock.calls[0][0] as {
				content: { body: string };
			};
			expect(call.content.body).not.toContain("at foo");
		});

		it("should handle non-Error objects emitted as errors", async () => {
			const mockRunner = new MockAgentRunner();

			// Add the runner to the session
			manager.addAgentRunner(sessionId, mockRunner);

			// Emit a string as an error (non-Error object)
			mockRunner.emit("error", "String error message");

			// Wait for async error handling
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Verify that createAgentActivity was called
			expect(createAgentActivitySpy).toHaveBeenCalledWith({
				agentSessionId: sessionId,
				content: {
					type: "error",
					body: expect.stringContaining("String error message"),
				},
			});
		});
	});

	describe("sanitizeErrorMessage", () => {
		it("should sanitize absolute file paths", async () => {
			const mockRunner = new MockAgentRunner();
			manager.addAgentRunner(sessionId, mockRunner);

			const testError = new Error(
				"File not found: /Users/username/secret/path/to/file.js",
			);
			mockRunner.emitError(testError);

			await new Promise((resolve) => setTimeout(resolve, 10));

			const call = createAgentActivitySpy.mock.calls[0][0] as {
				content: { body: string };
			};
			// The full path should be sanitized
			expect(call.content.body).not.toContain("/Users/username/secret");
		});
	});
});
