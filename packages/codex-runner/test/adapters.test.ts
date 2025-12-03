import { describe, expect, it } from "vitest";
import {
	codexEventToSDKMessage,
	codexItemToSDKMessage,
	createToolResultMessage,
	createUserMessage,
	extractThreadId,
} from "../src/adapters.js";
import type {
	CodexAgentMessageItem,
	CodexCommandExecutionItem,
	CodexFileChangeItem,
	CodexItemCompletedEvent,
	CodexMcpToolCallItem,
	CodexThreadErrorEvent,
	CodexThreadEvent,
	CodexThreadStartedEvent,
	CodexTodoListItem,
	CodexTurnCompletedEvent,
	CodexTurnFailedEvent,
} from "../src/types.js";

describe("codexItemToSDKMessage", () => {
	const sessionId = "test-session-123";

	describe("agent_message items", () => {
		it("should convert agent message to assistant SDK message", () => {
			const item: CodexAgentMessageItem = {
				id: "msg-1",
				type: "agent_message",
				text: "Hello, I'm here to help!",
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(1);
			const result = results![0];
			expect(result?.type).toBe("assistant");
			if (result?.type === "assistant") {
				expect(result.session_id).toBe(sessionId);
				const content = result.message.content;
				expect(Array.isArray(content)).toBe(true);
				if (Array.isArray(content) && content.length > 0) {
					const textBlock = content[0];
					expect(textBlock?.type).toBe("text");
					if (textBlock && "text" in textBlock) {
						expect(textBlock.text).toBe("Hello, I'm here to help!");
					}
				}
			}
		});
	});

	describe("command_execution items", () => {
		it("should convert in_progress command to tool use message", () => {
			const item: CodexCommandExecutionItem = {
				id: "cmd-1",
				type: "command_execution",
				status: "in_progress",
				command: "npm install",
				aggregated_output: "",
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results!.length).toBeGreaterThanOrEqual(1);
			const result = results![0];
			expect(result?.type).toBe("assistant");
			if (result?.type === "assistant") {
				const content = result.message.content;
				expect(Array.isArray(content)).toBe(true);
				if (Array.isArray(content) && content.length > 0) {
					const toolUse = content[0];
					expect(toolUse?.type).toBe("tool_use");
					if (toolUse && "name" in toolUse) {
						expect(toolUse.name).toBe("Bash");
					}
				}
			}
		});

		it("should convert completed command to tool use and tool result messages", () => {
			const item: CodexCommandExecutionItem = {
				id: "cmd-2",
				type: "command_execution",
				status: "completed",
				command: "ls -la",
				aggregated_output: "file1.txt\nfile2.txt",
				exit_code: 0,
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(2);
			// First message is tool_use (assistant)
			expect(results![0]?.type).toBe("assistant");
			// Second message is tool_result (user)
			expect(results![1]?.type).toBe("user");
		});

		it("should convert failed command to tool use and tool result messages", () => {
			const item: CodexCommandExecutionItem = {
				id: "cmd-3",
				type: "command_execution",
				status: "failed",
				command: "invalid-command",
				aggregated_output: "command not found",
				exit_code: 127,
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(2);
			expect(results![0]?.type).toBe("assistant");
			expect(results![1]?.type).toBe("user");
		});
	});

	describe("file_change items", () => {
		it("should convert file change to Edit tool use and result", () => {
			const item: CodexFileChangeItem = {
				id: "file-1",
				type: "file_change",
				status: "completed",
				changes: [{ path: "src/index.ts", kind: "update" }],
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(2);
			const result = results![0];
			expect(result?.type).toBe("assistant");
			if (result?.type === "assistant") {
				const content = result.message.content;
				expect(Array.isArray(content)).toBe(true);
				if (Array.isArray(content) && content.length > 0) {
					const toolUse = content[0];
					expect(toolUse?.type).toBe("tool_use");
					if (toolUse && "name" in toolUse) {
						expect(toolUse.name).toBe("Edit");
					}
				}
			}
			// Second message is tool_result
			expect(results![1]?.type).toBe("user");
		});
	});

	describe("mcp_tool_call items", () => {
		it("should convert MCP tool call to proper format with result", () => {
			const item: CodexMcpToolCallItem = {
				id: "mcp-1",
				type: "mcp_tool_call",
				server: "linear",
				tool: "get_issue",
				arguments: { issueId: "ABC-123" },
				status: "completed",
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(2);
			const result = results![0];
			expect(result?.type).toBe("assistant");
			if (result?.type === "assistant") {
				const content = result.message.content;
				expect(Array.isArray(content)).toBe(true);
				if (Array.isArray(content) && content.length > 0) {
					const toolUse = content[0];
					expect(toolUse?.type).toBe("tool_use");
					if (toolUse && "name" in toolUse) {
						expect(toolUse.name).toBe("mcp__linear__get_issue");
					}
				}
			}
			// Second message is tool_result
			expect(results![1]?.type).toBe("user");
		});
	});

	describe("todo_list items", () => {
		it("should convert todo list to TodoWrite tool use and result", () => {
			const item: CodexTodoListItem = {
				id: "todo-1",
				type: "todo_list",
				items: [
					{ text: "Fix bug", completed: false },
					{ text: "Write tests", completed: true },
				],
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(2);
			const result = results![0];
			expect(result?.type).toBe("assistant");
			if (result?.type === "assistant") {
				const content = result.message.content;
				expect(Array.isArray(content)).toBe(true);
				if (Array.isArray(content) && content.length > 0) {
					const toolUse = content[0];
					expect(toolUse?.type).toBe("tool_use");
					if (toolUse && "name" in toolUse) {
						expect(toolUse.name).toBe("TodoWrite");
					}
				}
			}
			// Second message is tool_result
			expect(results![1]?.type).toBe("user");
		});
	});

	describe("error items", () => {
		it("should convert error item to error result message", () => {
			const item = {
				id: "err-1",
				type: "error" as const,
				message: "Something went wrong",
			};

			const results = codexItemToSDKMessage(item, sessionId);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(1);
			const result = results![0];
			expect(result?.type).toBe("result");
			if (result?.type === "result") {
				expect(result.is_error).toBe(true);
				expect(result.errors).toContain("Something went wrong");
			}
		});
	});
});

describe("codexEventToSDKMessage", () => {
	const sessionId = "test-session-123";

	describe("thread.started events", () => {
		it("should convert to system init message", () => {
			const event: CodexThreadStartedEvent = {
				type: "thread.started",
				thread_id: "thread-abc",
			};

			const results = codexEventToSDKMessage(event, null, null);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(1);
			const result = results![0];
			expect(result?.type).toBe("system");
			if (result?.type === "system") {
				expect(result.session_id).toBe("thread-abc");
			}
		});
	});

	describe("turn.completed events", () => {
		it("should convert to success result message", () => {
			const event: CodexTurnCompletedEvent = {
				type: "turn.completed",
				usage: {
					input_tokens: 100,
					output_tokens: 50,
					cached_input_tokens: 10,
				},
			};

			const results = codexEventToSDKMessage(event, sessionId, null);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(1);
			const result = results![0];
			expect(result?.type).toBe("result");
			if (result?.type === "result") {
				expect(result.is_error).toBe(false);
				expect(result.usage.input_tokens).toBe(100);
				expect(result.usage.output_tokens).toBe(50);
			}
		});
	});

	describe("turn.failed events", () => {
		it("should convert to error result message", () => {
			const event: CodexTurnFailedEvent = {
				type: "turn.failed",
				error: { message: "API error" },
				usage: {
					input_tokens: 100,
					output_tokens: 0,
					cached_input_tokens: 0,
				},
			};

			const results = codexEventToSDKMessage(event, sessionId, null);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(1);
			const result = results![0];
			expect(result?.type).toBe("result");
			if (result?.type === "result") {
				expect(result.is_error).toBe(true);
				expect(result.errors).toContain("API error");
			}
		});
	});

	describe("item.completed events", () => {
		it("should delegate to codexItemToSDKMessage", () => {
			const event: CodexItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "msg-1",
					type: "agent_message",
					text: "Hello!",
				},
			};

			const results = codexEventToSDKMessage(event, sessionId, null);

			expect(results).not.toBeNull();
			expect(results!.length).toBeGreaterThan(0);
			const result = results![0];
			expect(result?.type).toBe("assistant");
		});
	});

	describe("error events", () => {
		it("should convert to error result message", () => {
			const event: CodexThreadErrorEvent = {
				type: "error",
				message: "Stream error",
			};

			const results = codexEventToSDKMessage(event, sessionId, null);

			expect(results).not.toBeNull();
			expect(results).toHaveLength(1);
			const result = results![0];
			expect(result?.type).toBe("result");
			if (result?.type === "result") {
				expect(result.is_error).toBe(true);
				expect(result.errors).toContain("Stream error");
			}
		});
	});
});

describe("extractThreadId", () => {
	it("should extract thread ID from thread.started event", () => {
		const event: CodexThreadEvent = {
			type: "thread.started",
			thread_id: "thread-xyz",
		};

		const result = extractThreadId(event);

		expect(result).toBe("thread-xyz");
	});

	it("should return null for other event types", () => {
		const event: CodexThreadEvent = {
			type: "turn.started",
		};

		const result = extractThreadId(event);

		expect(result).toBeNull();
	});
});

describe("createUserMessage", () => {
	it("should create properly formatted user message", () => {
		const result = createUserMessage("Hello, world!", "session-123");

		expect(result.type).toBe("user");
		expect(result.message.role).toBe("user");
		expect(result.message.content).toBe("Hello, world!");
		expect(result.session_id).toBe("session-123");
	});

	it("should handle null session ID", () => {
		const result = createUserMessage("Test prompt", null);

		expect(result.session_id).toBe("pending");
	});
});

describe("createToolResultMessage", () => {
	it("should create success tool result message", () => {
		const result = createToolResultMessage(
			"tool-123",
			"Success output",
			false,
			"session-456",
		);

		expect(result.type).toBe("user");
		expect(result.message.role).toBe("user");
		const content = result.message.content;
		expect(Array.isArray(content)).toBe(true);
		if (Array.isArray(content) && content.length > 0) {
			const toolResult = content[0];
			expect(toolResult?.type).toBe("tool_result");
			if (toolResult && "tool_use_id" in toolResult) {
				expect(toolResult.tool_use_id).toBe("tool-123");
				expect(toolResult.content).toBe("Success output");
				expect(toolResult.is_error).toBe(false);
			}
		}
	});

	it("should create error tool result message", () => {
		const result = createToolResultMessage(
			"tool-456",
			"Error: something failed",
			true,
			"session-789",
		);

		const content = result.message.content;
		if (Array.isArray(content) && content.length > 0) {
			const toolResult = content[0];
			if (toolResult && "is_error" in toolResult) {
				expect(toolResult.is_error).toBe(true);
			}
		}
	});
});
