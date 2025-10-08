import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
/**
 * Error codes for SimpleAgentRunner operations
 */
export declare enum SimpleAgentErrorCode {
    /** Agent returned a response not in the valid set */
    INVALID_RESPONSE = "INVALID_RESPONSE",
    /** Agent execution timed out */
    TIMEOUT = "TIMEOUT",
    /** Agent failed to produce any response */
    NO_RESPONSE = "NO_RESPONSE",
    /** Agent session encountered an error */
    SESSION_ERROR = "SESSION_ERROR",
    /** Configuration is invalid */
    INVALID_CONFIG = "INVALID_CONFIG",
    /** Agent was aborted */
    ABORTED = "ABORTED",
    /** Agent exceeded maximum turns without response */
    MAX_TURNS_EXCEEDED = "MAX_TURNS_EXCEEDED"
}
/**
 * Base error class for SimpleAgentRunner errors
 */
export declare class SimpleAgentError extends Error {
    readonly code: SimpleAgentErrorCode;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: SimpleAgentErrorCode, message: string, details?: Record<string, unknown> | undefined);
    /**
     * Create a formatted error message with details
     */
    toDetailedString(): string;
}
/**
 * Error thrown when agent returns an invalid response
 */
export declare class InvalidResponseError extends SimpleAgentError {
    readonly receivedResponse: string;
    readonly validResponses: readonly string[];
    constructor(receivedResponse: string, validResponses: readonly string[]);
}
/**
 * Error thrown when agent execution times out
 */
export declare class TimeoutError extends SimpleAgentError {
    readonly timeoutMs: number;
    readonly partialMessages?: SDKMessage[] | undefined;
    constructor(timeoutMs: number, partialMessages?: SDKMessage[] | undefined);
}
/**
 * Error thrown when agent produces no response
 */
export declare class NoResponseError extends SimpleAgentError {
    readonly messages: SDKMessage[];
    constructor(messages: SDKMessage[]);
}
/**
 * Error thrown when max turns exceeded
 */
export declare class MaxTurnsExceededError extends SimpleAgentError {
    readonly maxTurns: number;
    readonly messages: SDKMessage[];
    constructor(maxTurns: number, messages: SDKMessage[]);
}
/**
 * Error thrown when session encounters an error
 */
export declare class SessionError extends SimpleAgentError {
    readonly cause: Error;
    readonly messages?: SDKMessage[] | undefined;
    constructor(cause: Error, messages?: SDKMessage[] | undefined);
}
//# sourceMappingURL=errors.d.ts.map