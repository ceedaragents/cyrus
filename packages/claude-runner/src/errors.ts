import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/**
 * Error codes for ClaudeRunner operations
 */
export enum ClaudeRunnerErrorCode {
	/** Session was aborted by user */
	ABORTED = "ABORTED",

	/** Session was terminated gracefully via SIGTERM */
	TERMINATED = "TERMINATED",

	/** Claude Code process exited with non-zero code */
	PROCESS_EXIT = "PROCESS_EXIT",

	/** SDK initialization failed */
	INITIALIZATION_FAILED = "INITIALIZATION_FAILED",

	/** MCP configuration error */
	MCP_CONFIG_ERROR = "MCP_CONFIG_ERROR",

	/** Session execution error */
	SESSION_ERROR = "SESSION_ERROR",

	/** Unknown/unclassified error */
	UNKNOWN = "UNKNOWN",
}

/**
 * Base error class for ClaudeRunner errors
 *
 * Provides typed error handling with error codes and detailed context.
 * Use specific subclasses for more semantic error handling.
 */
export class ClaudeRunnerError extends Error {
	constructor(
		public readonly code: ClaudeRunnerErrorCode,
		message: string,
		public readonly details?: Record<string, unknown>,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = "ClaudeRunnerError";

		// Maintain proper stack trace in V8
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, ClaudeRunnerError);
		}
	}

	/**
	 * Create a formatted error message with details
	 */
	toDetailedString(): string {
		let msg = `${this.name} [${this.code}]: ${this.message}`;
		if (this.details && Object.keys(this.details).length > 0) {
			msg += `\nDetails: ${JSON.stringify(this.details, null, 2)}`;
		}
		if (this.cause) {
			msg += `\nCaused by: ${this.cause.message}`;
		}
		return msg;
	}

	/**
	 * Check if this error represents a user-initiated abort
	 */
	isAbort(): boolean {
		return this.code === ClaudeRunnerErrorCode.ABORTED;
	}

	/**
	 * Check if this error represents a graceful termination
	 */
	isTermination(): boolean {
		return this.code === ClaudeRunnerErrorCode.TERMINATED;
	}

	/**
	 * Check if this error is recoverable (user-initiated stop or graceful termination)
	 */
	isRecoverable(): boolean {
		return this.isAbort() || this.isTermination();
	}
}

/**
 * Error thrown when session is aborted by user via AbortController
 */
export class SessionAbortedError extends ClaudeRunnerError {
	constructor(public readonly sessionId?: string | null) {
		super(ClaudeRunnerErrorCode.ABORTED, "Session was aborted by user", {
			sessionId,
		});
		this.name = "SessionAbortedError";
	}
}

/**
 * Error thrown when session is gracefully terminated via SIGTERM
 */
export class SessionTerminatedError extends ClaudeRunnerError {
	constructor(
		public readonly sessionId?: string | null,
		public readonly exitCode: number = 143,
	) {
		super(
			ClaudeRunnerErrorCode.TERMINATED,
			`Session was terminated gracefully (exit code ${exitCode})`,
			{ sessionId, exitCode },
		);
		this.name = "SessionTerminatedError";
	}
}

/**
 * Error thrown when Claude Code process exits with non-zero code
 */
export class ProcessExitError extends ClaudeRunnerError {
	constructor(
		public readonly exitCode: number,
		public readonly sessionId?: string | null,
		originalError?: Error,
	) {
		super(
			ClaudeRunnerErrorCode.PROCESS_EXIT,
			`Claude Code process exited with code ${exitCode}`,
			{ exitCode, sessionId },
			originalError,
		);
		this.name = "ProcessExitError";
	}
}

/**
 * Error thrown when SDK initialization fails
 */
export class InitializationError extends ClaudeRunnerError {
	constructor(
		message: string,
		public readonly workingDirectory?: string,
		originalError?: Error,
	) {
		super(
			ClaudeRunnerErrorCode.INITIALIZATION_FAILED,
			message,
			{ workingDirectory },
			originalError,
		);
		this.name = "InitializationError";
	}
}

/**
 * Error thrown when MCP configuration is invalid
 */
export class McpConfigError extends ClaudeRunnerError {
	constructor(
		message: string,
		public readonly configPath?: string,
		originalError?: Error,
	) {
		super(
			ClaudeRunnerErrorCode.MCP_CONFIG_ERROR,
			message,
			{ configPath },
			originalError,
		);
		this.name = "McpConfigError";
	}
}

/**
 * Error thrown when session execution fails
 */
export class SessionError extends ClaudeRunnerError {
	constructor(
		message: string,
		public readonly sessionId?: string | null,
		public readonly messages?: SDKMessage[],
		originalError?: Error,
	) {
		super(
			ClaudeRunnerErrorCode.SESSION_ERROR,
			message,
			{ sessionId, messageCount: messages?.length },
			originalError,
		);
		this.name = "SessionError";
	}
}

/**
 * Classify an unknown error into a typed ClaudeRunnerError
 *
 * This function analyzes error messages to determine the appropriate
 * typed error class, making it easier to handle specific error cases.
 *
 * @param error - The original error to classify
 * @param sessionId - Optional session ID for context
 * @returns A typed ClaudeRunnerError instance
 */
export function classifyError(
	error: unknown,
	sessionId?: string | null,
): ClaudeRunnerError {
	// Ensure we have an Error object
	const errorObj = error instanceof Error ? error : new Error(String(error));

	// Check for user-initiated abort
	if (
		errorObj.name === "AbortError" ||
		errorObj.message.includes("aborted by user")
	) {
		return new SessionAbortedError(sessionId);
	}

	// Check for SIGTERM (exit code 143 = 128 + 15)
	if (errorObj.message.includes("Claude Code process exited with code 143")) {
		return new SessionTerminatedError(sessionId, 143);
	}

	// Check for other non-zero exit codes
	const exitCodeMatch = errorObj.message.match(
		/Claude Code process exited with code (\d+)/,
	);
	if (exitCodeMatch?.[1]) {
		const exitCode = parseInt(exitCodeMatch[1], 10);
		return new ProcessExitError(exitCode, sessionId, errorObj);
	}

	// Check for MCP configuration errors
	if (
		errorObj.message.includes(".mcp.json") ||
		errorObj.message.includes("MCP") ||
		errorObj.message.includes("mcp")
	) {
		return new McpConfigError(errorObj.message, undefined, errorObj);
	}

	// Default to generic session error
	return new SessionError(errorObj.message, sessionId, undefined, errorObj);
}
