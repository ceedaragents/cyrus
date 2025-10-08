import { describe, expect, it } from "vitest";
import {
	InvalidResponseError,
	MaxTurnsExceededError,
	NoResponseError,
	SessionError,
	SimpleAgentError,
	SimpleAgentErrorCode,
	TimeoutError,
} from "../src/errors.js";

describe("SimpleAgentError", () => {
	it("should create error with code and message", () => {
		const error = new SimpleAgentError(
			SimpleAgentErrorCode.INVALID_CONFIG,
			"Config is invalid",
		);

		expect(error.code).toBe(SimpleAgentErrorCode.INVALID_CONFIG);
		expect(error.message).toBe("Config is invalid");
		expect(error.name).toBe("SimpleAgentError");
	});

	it("should include details in error", () => {
		const error = new SimpleAgentError(
			SimpleAgentErrorCode.SESSION_ERROR,
			"Session failed",
			{ foo: "bar", count: 42 },
		);

		expect(error.details).toEqual({ foo: "bar", count: 42 });
	});

	it("should format detailed string", () => {
		const error = new SimpleAgentError(
			SimpleAgentErrorCode.TIMEOUT,
			"Timed out",
			{ timeoutMs: 5000 },
		);

		const detailed = error.toDetailedString();
		expect(detailed).toContain("SimpleAgentError");
		expect(detailed).toContain("TIMEOUT");
		expect(detailed).toContain("Timed out");
		expect(detailed).toContain("timeoutMs");
		expect(detailed).toContain("5000");
	});
});

describe("InvalidResponseError", () => {
	it("should create error with received and valid responses", () => {
		const error = new InvalidResponseError("maybe", ["yes", "no"]);

		expect(error.code).toBe(SimpleAgentErrorCode.INVALID_RESPONSE);
		expect(error.receivedResponse).toBe("maybe");
		expect(error.validResponses).toEqual(["yes", "no"]);
		expect(error.message).toContain("maybe");
		expect(error.message).toContain("yes");
		expect(error.message).toContain("no");
		expect(error.name).toBe("InvalidResponseError");
	});
});

describe("TimeoutError", () => {
	it("should create error with timeout", () => {
		const error = new TimeoutError(10000);

		expect(error.code).toBe(SimpleAgentErrorCode.TIMEOUT);
		expect(error.timeoutMs).toBe(10000);
		expect(error.message).toContain("10000");
		expect(error.name).toBe("TimeoutError");
	});

	it("should include partial messages if provided", () => {
		const messages = [{ type: "system" as const, text: "test" }];
		const error = new TimeoutError(5000, messages);

		expect(error.partialMessages).toBe(messages);
		expect(error.details?.messageCount).toBe(1);
	});
});

describe("NoResponseError", () => {
	it("should create error with messages", () => {
		const messages = [{ type: "system" as const, text: "test" }];
		const error = new NoResponseError(messages);

		expect(error.code).toBe(SimpleAgentErrorCode.NO_RESPONSE);
		expect(error.messages).toBe(messages);
		expect(error.details?.messageCount).toBe(1);
		expect(error.name).toBe("NoResponseError");
	});
});

describe("MaxTurnsExceededError", () => {
	it("should create error with max turns and messages", () => {
		const messages = [{ type: "system" as const, text: "test" }];
		const error = new MaxTurnsExceededError(5, messages);

		expect(error.code).toBe(SimpleAgentErrorCode.MAX_TURNS_EXCEEDED);
		expect(error.maxTurns).toBe(5);
		expect(error.messages).toBe(messages);
		expect(error.details?.maxTurns).toBe(5);
		expect(error.details?.messageCount).toBe(1);
		expect(error.name).toBe("MaxTurnsExceededError");
	});
});

describe("SessionError", () => {
	it("should create error with cause", () => {
		const cause = new Error("Original error");
		const error = new SessionError(cause);

		expect(error.code).toBe(SimpleAgentErrorCode.SESSION_ERROR);
		expect(error.cause).toBe(cause);
		expect(error.message).toContain("Original error");
		expect(error.name).toBe("SessionError");
	});

	it("should include messages if provided", () => {
		const cause = new Error("Fail");
		const messages = [{ type: "system" as const, text: "test" }];
		const error = new SessionError(cause, messages);

		expect(error.messages).toBe(messages);
	});
});
