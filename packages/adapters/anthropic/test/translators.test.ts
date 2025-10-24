/**
 * Tests for type translation utilities
 */

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentRunnerConfig } from "cyrus-interfaces";
import { describe, expect, it } from "vitest";
import {
	createAgentResult,
	translateConfig,
	translateSDKMessage,
} from "../src/translators.js";

describe("translators", () => {
	describe("translateConfig", () => {
		it("should translate basic config", () => {
			const config: AgentRunnerConfig = {
				workingDirectory: "/test/path",
				cyrusHome: "/test/cyrus",
			};

			const result = translateConfig(config);

			expect(result.workingDirectory).toBe("/test/path");
			expect(result.cyrusHome).toBe("/test/cyrus");
		});

		it("should skip environment variables (not supported by ClaudeRunner)", () => {
			const config: AgentRunnerConfig = {
				workingDirectory: "/test",
				environment: { TEST: "value" },
			};

			const result = translateConfig(config);

			// ClaudeRunnerConfig doesn't support environment field
			expect((result as any).environment).toBeUndefined();
		});

		it("should translate system prompt", () => {
			const config: AgentRunnerConfig = {
				workingDirectory: "/test",
				systemPrompt: "Test prompt",
			};

			const result = translateConfig(config);

			expect(result.systemPrompt).toBe("Test prompt");
		});

		it("should translate model ID to model", () => {
			const config: AgentRunnerConfig = {
				workingDirectory: "/test",
				modelId: "sonnet",
			};

			const result = translateConfig(config);

			expect(result.model).toBe("sonnet");
		});

		it("should pass through additional config keys", () => {
			const config: AgentRunnerConfig = {
				workingDirectory: "/test",
				customKey: "customValue",
			};

			const result = translateConfig(config);

			expect((result as any).customKey).toBe("customValue");
		});

		it("should use default cyrusHome if not provided", () => {
			const config: AgentRunnerConfig = {
				workingDirectory: "/test",
			};

			const result = translateConfig(config);

			expect(result.cyrusHome).toContain(".cyrus");
		});
	});

	describe("translateSDKMessage", () => {
		it("should translate system message", () => {
			const sdkMessage: SDKMessage = {
				system: "System prompt text",
			};

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("system");
			expect(result.content.type).toBe("text");
			expect((result.content as any).text).toBe("System prompt text");
			expect(result.timestamp).toBeInstanceOf(Date);
		});

		it("should translate user message with string content", () => {
			const sdkMessage: SDKMessage = {
				role: "user" as const,
				content: "User message",
			};

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("user");
			expect(result.content.type).toBe("text");
			expect((result.content as any).text).toBe("User message");
		});

		it("should translate assistant message with text block", () => {
			const sdkMessage: SDKMessage = {
				role: "assistant" as const,
				content: [
					{
						type: "text" as const,
						text: "Assistant response",
					},
				],
			};

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("assistant");
			expect(result.content.type).toBe("text");
			expect((result.content as any).text).toBe("Assistant response");
		});

		it("should translate assistant message with tool use", () => {
			const sdkMessage: SDKMessage = {
				role: "assistant" as const,
				content: [
					{
						type: "tool_use" as const,
						id: "tool-123",
						name: "test_tool",
						input: { param: "value" },
					},
				],
			};

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("assistant");
			expect(result.content.type).toBe("tool_use");
			expect((result.content as any).id).toBe("tool-123");
			expect((result.content as any).name).toBe("test_tool");
			expect((result.content as any).input).toEqual({ param: "value" });
		});

		it("should translate result message", () => {
			const sdkMessage: SDKMessage = {
				role: "result" as const,
				tool_use_id: "tool-123",
				content: "Tool output",
			};

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("tool_result");
			expect(result.content.type).toBe("tool_result");
			expect((result.content as any).tool_use_id).toBe("tool-123");
			expect((result.content as any).content).toBe("Tool output");
		});

		it("should handle empty content array", () => {
			const sdkMessage: SDKMessage = {
				role: "assistant" as const,
				content: [],
			};

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("assistant");
			expect(result.content.type).toBe("text");
			expect((result.content as any).text).toBe("");
		});

		it("should handle unknown message types", () => {
			const sdkMessage = {
				unknownField: "test",
			} as unknown as SDKMessage;

			const result = translateSDKMessage(sdkMessage);

			expect(result.role).toBe("assistant");
			expect(result.metadata?.original_type).toBe("unknown");
		});
	});

	describe("createAgentResult", () => {
		it("should create success result", () => {
			const messages: SDKMessage[] = [
				{ role: "user" as const, content: "Hello" },
				{ role: "assistant" as const, content: "Hi there" },
			];

			const result = createAgentResult("session-123", messages);

			expect(result.sessionId).toBe("session-123");
			expect(result.status).toBe("success");
			expect(result.messages).toHaveLength(2);
			expect(result.error).toBeUndefined();
			expect(result.metadata).toBeDefined();
		});

		it("should create error result", () => {
			const messages: SDKMessage[] = [];
			const error = new Error("Test error");

			const result = createAgentResult("session-123", messages, error);

			expect(result.sessionId).toBe("session-123");
			expect(result.status).toBe("error");
			expect(result.error).toBe(error);
		});

		it("should include metadata", () => {
			const messages: SDKMessage[] = [];
			const metadata = { duration: 1000, tokensUsed: 50 };

			const result = createAgentResult(
				"session-123",
				messages,
				undefined,
				metadata,
			);

			expect(result.metadata.duration).toBe(1000);
			expect(result.metadata.tokensUsed).toBe(50);
		});

		it("should translate all messages", () => {
			const messages: SDKMessage[] = [
				{ system: "System" },
				{ role: "user" as const, content: "User" },
				{ role: "assistant" as const, content: "Assistant" },
			];

			const result = createAgentResult("session-123", messages);

			expect(result.messages).toHaveLength(3);
			expect(result.messages[0].role).toBe("system");
			expect(result.messages[1].role).toBe("user");
			expect(result.messages[2].role).toBe("assistant");
		});
	});
});
