import { describe, expect, it } from "vitest";
import {
	ClaudeRunnerError,
	ClaudeRunnerErrorCode,
	classifyError,
	InitializationError,
	McpConfigError,
	ProcessExitError,
	SessionAbortedError,
	SessionError,
	SessionTerminatedError,
} from "../src/errors";

describe("ClaudeRunner Errors", () => {
	describe("ClaudeRunnerError base class", () => {
		it("should create error with code, message, and details", () => {
			const error = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.SESSION_ERROR,
				"Test error",
				{ key: "value" },
			);

			expect(error.code).toBe(ClaudeRunnerErrorCode.SESSION_ERROR);
			expect(error.message).toBe("Test error");
			expect(error.details).toEqual({ key: "value" });
			expect(error.name).toBe("ClaudeRunnerError");
		});

		it("should create error with cause", () => {
			const cause = new Error("Original error");
			const error = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.UNKNOWN,
				"Wrapped error",
				undefined,
				cause,
			);

			expect(error.cause).toBe(cause);
		});

		it("should format detailed string", () => {
			const cause = new Error("Original error");
			const error = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.SESSION_ERROR,
				"Test error",
				{ sessionId: "test-123" },
				cause,
			);

			const detailed = error.toDetailedString();
			expect(detailed).toContain(
				"ClaudeRunnerError [SESSION_ERROR]: Test error",
			);
			expect(detailed).toContain('"sessionId": "test-123"');
			expect(detailed).toContain("Caused by: Original error");
		});

		it("should identify abort errors", () => {
			const abortError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.ABORTED,
				"Aborted",
			);
			const otherError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.SESSION_ERROR,
				"Other",
			);

			expect(abortError.isAbort()).toBe(true);
			expect(otherError.isAbort()).toBe(false);
		});

		it("should identify termination errors", () => {
			const terminatedError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.TERMINATED,
				"Terminated",
			);
			const otherError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.SESSION_ERROR,
				"Other",
			);

			expect(terminatedError.isTermination()).toBe(true);
			expect(otherError.isTermination()).toBe(false);
		});

		it("should identify recoverable errors", () => {
			const abortError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.ABORTED,
				"Aborted",
			);
			const terminatedError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.TERMINATED,
				"Terminated",
			);
			const sessionError = new ClaudeRunnerError(
				ClaudeRunnerErrorCode.SESSION_ERROR,
				"Error",
			);

			expect(abortError.isRecoverable()).toBe(true);
			expect(terminatedError.isRecoverable()).toBe(true);
			expect(sessionError.isRecoverable()).toBe(false);
		});
	});

	describe("SessionAbortedError", () => {
		it("should create abort error with session ID", () => {
			const error = new SessionAbortedError("session-123");

			expect(error.code).toBe(ClaudeRunnerErrorCode.ABORTED);
			expect(error.sessionId).toBe("session-123");
			expect(error.name).toBe("SessionAbortedError");
			expect(error.isAbort()).toBe(true);
		});
	});

	describe("SessionTerminatedError", () => {
		it("should create termination error with exit code", () => {
			const error = new SessionTerminatedError("session-123", 143);

			expect(error.code).toBe(ClaudeRunnerErrorCode.TERMINATED);
			expect(error.sessionId).toBe("session-123");
			expect(error.exitCode).toBe(143);
			expect(error.name).toBe("SessionTerminatedError");
			expect(error.isTermination()).toBe(true);
		});

		it("should default to exit code 143", () => {
			const error = new SessionTerminatedError("session-123");
			expect(error.exitCode).toBe(143);
		});
	});

	describe("ProcessExitError", () => {
		it("should create process exit error", () => {
			const original = new Error("Process crashed");
			const error = new ProcessExitError(1, "session-123", original);

			expect(error.code).toBe(ClaudeRunnerErrorCode.PROCESS_EXIT);
			expect(error.exitCode).toBe(1);
			expect(error.sessionId).toBe("session-123");
			expect(error.cause).toBe(original);
			expect(error.name).toBe("ProcessExitError");
		});
	});

	describe("InitializationError", () => {
		it("should create initialization error", () => {
			const original = new Error("Failed to start");
			const error = new InitializationError(
				"SDK init failed",
				"/path/to/workdir",
				original,
			);

			expect(error.code).toBe(ClaudeRunnerErrorCode.INITIALIZATION_FAILED);
			expect(error.workingDirectory).toBe("/path/to/workdir");
			expect(error.cause).toBe(original);
			expect(error.name).toBe("InitializationError");
		});
	});

	describe("McpConfigError", () => {
		it("should create MCP config error", () => {
			const original = new Error("Invalid JSON");
			const error = new McpConfigError(
				"Invalid MCP configuration",
				"/path/to/.mcp.json",
				original,
			);

			expect(error.code).toBe(ClaudeRunnerErrorCode.MCP_CONFIG_ERROR);
			expect(error.configPath).toBe("/path/to/.mcp.json");
			expect(error.cause).toBe(original);
			expect(error.name).toBe("McpConfigError");
		});
	});

	describe("SessionError", () => {
		it("should create session error with messages", () => {
			const messages = [{ type: "assistant" as const, content: [] }];
			const original = new Error("Query failed");
			const error = new SessionError(
				"Session execution failed",
				"session-123",
				messages as any,
				original,
			);

			expect(error.code).toBe(ClaudeRunnerErrorCode.SESSION_ERROR);
			expect(error.sessionId).toBe("session-123");
			expect(error.messages).toEqual(messages);
			expect(error.cause).toBe(original);
			expect(error.name).toBe("SessionError");
		});
	});

	describe("classifyError", () => {
		it("should classify AbortError by name", () => {
			const error = new Error("Operation cancelled");
			error.name = "AbortError";

			const classified = classifyError(error, "session-123");

			expect(classified).toBeInstanceOf(SessionAbortedError);
			expect(classified.code).toBe(ClaudeRunnerErrorCode.ABORTED);
		});

		it("should classify abort by message content", () => {
			const error = new Error("Session aborted by user");

			const classified = classifyError(error, "session-123");

			expect(classified).toBeInstanceOf(SessionAbortedError);
		});

		it("should classify SIGTERM (exit code 143)", () => {
			const error = new Error("Claude Code process exited with code 143");

			const classified = classifyError(error, "session-123");

			expect(classified).toBeInstanceOf(SessionTerminatedError);
			expect((classified as SessionTerminatedError).exitCode).toBe(143);
		});

		it("should classify other exit codes", () => {
			const error = new Error("Claude Code process exited with code 1");

			const classified = classifyError(error, "session-123");

			expect(classified).toBeInstanceOf(ProcessExitError);
			expect((classified as ProcessExitError).exitCode).toBe(1);
		});

		it("should classify MCP errors by .mcp.json mention", () => {
			const error = new Error("Failed to parse /path/to/.mcp.json");

			const classified = classifyError(error);

			expect(classified).toBeInstanceOf(McpConfigError);
		});

		it("should classify MCP errors by MCP keyword", () => {
			const error = new Error("MCP server failed to connect");

			const classified = classifyError(error);

			expect(classified).toBeInstanceOf(McpConfigError);
		});

		it("should default to SessionError for unknown errors", () => {
			const error = new Error("Something went wrong");

			const classified = classifyError(error, "session-123");

			expect(classified).toBeInstanceOf(SessionError);
			expect(classified.code).toBe(ClaudeRunnerErrorCode.SESSION_ERROR);
		});

		it("should handle non-Error objects", () => {
			const classified = classifyError("String error", "session-123");

			expect(classified).toBeInstanceOf(SessionError);
			expect(classified.message).toBe("String error");
		});

		it("should preserve original error as cause", () => {
			const original = new Error("Original error");

			const classified = classifyError(original, "session-123");

			expect(classified.cause).toBe(original);
		});
	});
});
