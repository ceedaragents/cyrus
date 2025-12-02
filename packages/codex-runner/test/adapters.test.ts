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

	describe("agent-message items", () => {
		it("should convert agent message to assistant SDK message", () => {
			const item: CodexAgentMessageItem = {
				type: "agent-message",
				content: "Hello, I'm here to help!",
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
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

	describe("command-execution items", () => {
		it("should convert running command to tool use message", () => {
			const item: CodexCommandExecutionItem = {
				type: "command-execution",
				status: "running",
				command: "npm install",
				output: "",
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
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

		it("should convert completed command to tool use message", () => {
			const item: CodexCommandExecutionItem = {
				type: "command-execution",
				status: "completed",
				command: "ls -la",
				output: "file1.txt\nfile2.txt",
				exitCode: 0,
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("assistant");
		});

		it("should convert failed command to tool use message", () => {
			const item: CodexCommandExecutionItem = {
				type: "command-execution",
				status: "failed",
				command: "invalid-command",
				output: "command not found",
				exitCode: 127,
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("assistant");
		});
	});

	describe("file-change items", () => {
		it("should convert file change to Edit tool use", () => {
			const item: CodexFileChangeItem = {
				type: "file-change",
				status: "completed",
				patches: [{ file: "src/index.ts", patch: "+console.log('hello')" }],
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
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
		});
	});

	describe("mcp-tool-call items", () => {
		it("should convert MCP tool call to proper format", () => {
			const item: CodexMcpToolCallItem = {
				type: "mcp-tool-call",
				serverName: "linear",
				toolName: "get_issue",
				arguments: { issueId: "ABC-123" },
				result: "Issue found",
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
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
		});
	});

	describe("todo-list items", () => {
		it("should convert todo list to TodoWrite tool use", () => {
			const item: CodexTodoListItem = {
				type: "todo-list",
				todos: [
					{ id: "1", description: "Fix bug", completed: false },
					{ id: "2", description: "Write tests", completed: true },
				],
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
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
		});
	});

	describe("error items", () => {
		it("should convert error item to error result message", () => {
			const item = {
				type: "error" as const,
				message: "Something went wrong",
			};

			const result = codexItemToSDKMessage(item, sessionId);

			expect(result).not.toBeNull();
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

			const result = codexEventToSDKMessage(event, null, null);

			expect(result).not.toBeNull();
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

			const result = codexEventToSDKMessage(event, sessionId, null);

			expect(result).not.toBeNull();
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

			const result = codexEventToSDKMessage(event, sessionId, null);

			expect(result).not.toBeNull();
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
					type: "agent-message",
					content: "Hello!",
				},
			};

			const result = codexEventToSDKMessage(event, sessionId, null);

			expect(result).not.toBeNull();
			expect(result?.type).toBe("assistant");
		});
	});

	describe("error events", () => {
		it("should convert to error result message", () => {
			const event: CodexThreadErrorEvent = {
				type: "error",
				message: "Stream error",
			};

			const result = codexEventToSDKMessage(event, sessionId, null);

			expect(result).not.toBeNull();
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
