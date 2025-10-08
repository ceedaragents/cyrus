/**
 * Error codes for SimpleAgentRunner operations
 */
export var SimpleAgentErrorCode;
(function (SimpleAgentErrorCode) {
    /** Agent returned a response not in the valid set */
    SimpleAgentErrorCode["INVALID_RESPONSE"] = "INVALID_RESPONSE";
    /** Agent execution timed out */
    SimpleAgentErrorCode["TIMEOUT"] = "TIMEOUT";
    /** Agent failed to produce any response */
    SimpleAgentErrorCode["NO_RESPONSE"] = "NO_RESPONSE";
    /** Agent session encountered an error */
    SimpleAgentErrorCode["SESSION_ERROR"] = "SESSION_ERROR";
    /** Configuration is invalid */
    SimpleAgentErrorCode["INVALID_CONFIG"] = "INVALID_CONFIG";
    /** Agent was aborted */
    SimpleAgentErrorCode["ABORTED"] = "ABORTED";
    /** Agent exceeded maximum turns without response */
    SimpleAgentErrorCode["MAX_TURNS_EXCEEDED"] = "MAX_TURNS_EXCEEDED";
})(SimpleAgentErrorCode || (SimpleAgentErrorCode = {}));
/**
 * Base error class for SimpleAgentRunner errors
 */
export class SimpleAgentError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "SimpleAgentError";
        // Maintain proper stack trace in V8
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, SimpleAgentError);
        }
    }
    /**
     * Create a formatted error message with details
     */
    toDetailedString() {
        let msg = `${this.name} [${this.code}]: ${this.message}`;
        if (this.details && Object.keys(this.details).length > 0) {
            msg += `\nDetails: ${JSON.stringify(this.details, null, 2)}`;
        }
        return msg;
    }
}
/**
 * Error thrown when agent returns an invalid response
 */
export class InvalidResponseError extends SimpleAgentError {
    receivedResponse;
    validResponses;
    constructor(receivedResponse, validResponses) {
        super(SimpleAgentErrorCode.INVALID_RESPONSE, `Agent returned invalid response: "${receivedResponse}". Valid responses: [${validResponses.join(", ")}]`, { receivedResponse, validResponses });
        this.receivedResponse = receivedResponse;
        this.validResponses = validResponses;
        this.name = "InvalidResponseError";
    }
}
/**
 * Error thrown when agent execution times out
 */
export class TimeoutError extends SimpleAgentError {
    timeoutMs;
    partialMessages;
    constructor(timeoutMs, partialMessages) {
        super(SimpleAgentErrorCode.TIMEOUT, `Agent execution timed out after ${timeoutMs}ms`, { timeoutMs, messageCount: partialMessages?.length });
        this.timeoutMs = timeoutMs;
        this.partialMessages = partialMessages;
        this.name = "TimeoutError";
    }
}
/**
 * Error thrown when agent produces no response
 */
export class NoResponseError extends SimpleAgentError {
    messages;
    constructor(messages) {
        super(SimpleAgentErrorCode.NO_RESPONSE, "Agent completed without producing a valid response", { messageCount: messages.length });
        this.messages = messages;
        this.name = "NoResponseError";
    }
}
/**
 * Error thrown when max turns exceeded
 */
export class MaxTurnsExceededError extends SimpleAgentError {
    maxTurns;
    messages;
    constructor(maxTurns, messages) {
        super(SimpleAgentErrorCode.MAX_TURNS_EXCEEDED, `Agent exceeded maximum turns (${maxTurns}) without valid response`, { maxTurns, messageCount: messages.length });
        this.maxTurns = maxTurns;
        this.messages = messages;
        this.name = "MaxTurnsExceededError";
    }
}
/**
 * Error thrown when session encounters an error
 */
export class SessionError extends SimpleAgentError {
    cause;
    messages;
    constructor(cause, messages) {
        super(SimpleAgentErrorCode.SESSION_ERROR, `Agent session error: ${cause.message}`, { cause: cause.message, stack: cause.stack });
        this.cause = cause;
        this.messages = messages;
        this.name = "SessionError";
    }
}
//# sourceMappingURL=errors.js.map