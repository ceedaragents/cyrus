/**
 * Tests for Codex Event to SDK Message Adapters
 *
 * These tests verify that Codex CLI events are correctly converted to
 * cyrus-core SDK message format for the EdgeWorker.
 */

import { describe, expect, it } from "vitest";
import {
	codexEventToSDKMessages,
	createUserMessage,
	itemCompletedToMessages,
} from "./adapters.js";
import type {
	AgentMessageItem,
	CommandExecutionItem,
	FileChangeItem,
	ItemCompletedEvent,
	McpToolCallItem,
	ThreadEvent,
	ThreadStartedEvent,
	TodoListItem,
	TurnCompletedEvent,
	TurnFailedEvent,
} from "./schemas.js";

// ============================================================================
// Helper Functions to Create Test Data
// ============================================================================

function makeItemCompletedEvent<T extends { id: string; type: string }>(
	item: T,
): ItemCompletedEvent {
	return {
		type: "item.completed",
		item: item as ItemCompletedEvent["item"],
	};
}

// ============================================================================
// itemCompletedToMessages Tests
// ============================================================================

describe("itemCompletedToMessages", () => {
	describe("CommandExecutionItem", () => {
		it("should convert a successful command execution to tool use and tool result", () => {
			const item: CommandExecutionItem = {
				id: "cmd_123",
				type: "command_execution",
				command: "npm test",
				aggregated_output: "All tests passed",
				exit_code: 0,
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, "thread_abc");

			expect(messages).toHaveLength(2);

			// First message: tool use
			const toolUse = messages[0];
			expect(toolUse.type).toBe("assistant");
			if (toolUse.type === "assistant") {
				const content = toolUse.message.content;
				expect(Array.isArray(content)).toBe(true);
				const block = (content as unknown[])[0] as {
					type: string;
					name: string;
					id: string;
					input: { command: string };
				};
				expect(block.type).toBe("tool_use");
				expect(block.name).toBe("Bash");
				expect(block.id).toBe("cmd_123");
				expect(block.input.command).toBe("npm test");
			}

			// Second message: tool result
			const toolResult = messages[1];
			expect(toolResult.type).toBe("user");
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					type: string;
					tool_use_id: string;
					content: string;
					is_error: boolean;
				}>;
				expect(content[0].type).toBe("tool_result");
				expect(content[0].tool_use_id).toBe("cmd_123");
				expect(content[0].content).toBe("All tests passed");
				expect(content[0].is_error).toBe(false);
			}
		});

		it("should mark failed command execution as error", () => {
			const item: CommandExecutionItem = {
				id: "cmd_456",
				type: "command_execution",
				command: "npm build",
				aggregated_output: "Build failed: missing module",
				exit_code: 1,
				status: "failed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, "thread_xyz");

			const toolResult = messages[1];
			expect(toolResult.type).toBe("user");
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					is_error: boolean;
				}>;
				expect(content[0].is_error).toBe(true);
			}
		});

		it("should detect error from non-zero exit code even if status is completed", () => {
			const item: CommandExecutionItem = {
				id: "cmd_789",
				type: "command_execution",
				command: "grep pattern file.txt",
				aggregated_output: "",
				exit_code: 1, // grep returns 1 when no matches
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					is_error: boolean;
				}>;
				expect(content[0].is_error).toBe(true);
			}
		});
	});

	describe("FileChangeItem", () => {
		it("should convert file changes to tool uses and results", () => {
			const item: FileChangeItem = {
				id: "file_123",
				type: "file_change",
				changes: [
					{ path: "src/index.ts", kind: "update" },
					{ path: "src/new.ts", kind: "add" },
				],
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, "thread_abc");

			expect(messages).toHaveLength(2);

			// Tool use message with multiple tool uses
			const toolUse = messages[0];
			expect(toolUse.type).toBe("assistant");
			if (toolUse.type === "assistant") {
				const content = toolUse.message.content as Array<{
					type: string;
					name: string;
					id: string;
				}>;
				expect(content).toHaveLength(2);
				expect(content[0].name).toBe("Edit"); // update -> Edit
				expect(content[0].id).toBe("file_123-0");
				expect(content[1].name).toBe("Write"); // add -> Write
				expect(content[1].id).toBe("file_123-1");
			}

			// Tool result message with multiple results
			const toolResult = messages[1];
			expect(toolResult.type).toBe("user");
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					tool_use_id: string;
					content: string;
				}>;
				expect(content).toHaveLength(2);
				expect(content[0].tool_use_id).toBe("file_123-0");
				expect(content[0].content).toBe("update: src/index.ts");
				expect(content[1].tool_use_id).toBe("file_123-1");
				expect(content[1].content).toBe("add: src/new.ts");
			}
		});

		it("should map delete kind to Bash tool", () => {
			const item: FileChangeItem = {
				id: "file_456",
				type: "file_change",
				changes: [{ path: "src/old.ts", kind: "delete" }],
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const toolUse = messages[0];
			if (toolUse.type === "assistant") {
				const content = toolUse.message.content as Array<{ name: string }>;
				expect(content[0].name).toBe("Bash"); // delete -> Bash
			}
		});

		it("should mark failed file changes as errors", () => {
			const item: FileChangeItem = {
				id: "file_789",
				type: "file_change",
				changes: [{ path: "src/readonly.ts", kind: "update" }],
				status: "failed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					is_error: boolean;
					content: string;
				}>;
				expect(content[0].is_error).toBe(true);
				expect(content[0].content).toBe("Failed to apply change");
			}
		});
	});

	describe("McpToolCallItem", () => {
		it("should convert MCP tool call to mcp__server__tool format", () => {
			const item: McpToolCallItem = {
				id: "mcp_123",
				type: "mcp_tool_call",
				server: "linear",
				tool: "list_issues",
				arguments: { query: "assigned to me" },
				result: {
					content: [{ type: "text", text: "Issue 1\nIssue 2" }],
				},
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, "thread_abc");

			expect(messages).toHaveLength(2);

			// Tool use with MCP naming convention
			const toolUse = messages[0];
			if (toolUse.type === "assistant") {
				const content = toolUse.message.content as Array<{
					name: string;
					input: unknown;
				}>;
				expect(content[0].name).toBe("mcp__linear__list_issues");
				expect(content[0].input).toEqual({ query: "assigned to me" });
			}

			// Tool result with extracted text content
			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					content: string;
					is_error: boolean;
				}>;
				expect(content[0].content).toBe("Issue 1\nIssue 2");
				expect(content[0].is_error).toBe(false);
			}
		});

		it("should handle MCP tool call with error", () => {
			const item: McpToolCallItem = {
				id: "mcp_456",
				type: "mcp_tool_call",
				server: "linear",
				tool: "create_issue",
				arguments: {},
				error: { message: "API rate limit exceeded" },
				status: "failed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					content: string;
					is_error: boolean;
				}>;
				expect(content[0].content).toBe("Error: API rate limit exceeded");
				expect(content[0].is_error).toBe(true);
			}
		});

		it("should handle structured_content in MCP result", () => {
			const item: McpToolCallItem = {
				id: "mcp_789",
				type: "mcp_tool_call",
				server: "filesystem",
				tool: "read_file",
				arguments: { path: "/tmp/test.json" },
				result: {
					structured_content: { key: "value", nested: { data: 123 } },
				},
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					content: string;
				}>;
				expect(content[0].content).toBe(
					'{"key":"value","nested":{"data":123}}',
				);
			}
		});

		it("should handle empty MCP result with Success message", () => {
			const item: McpToolCallItem = {
				id: "mcp_empty",
				type: "mcp_tool_call",
				server: "trigger",
				tool: "trigger_task",
				arguments: {},
				result: {},
				status: "completed",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					content: string;
				}>;
				expect(content[0].content).toBe("Success");
			}
		});
	});

	describe("TodoListItem", () => {
		it("should convert todo list to TodoWrite tool use and result", () => {
			const item: TodoListItem = {
				id: "todo_123",
				type: "todo_list",
				items: [
					{ text: "Implement feature", completed: true },
					{ text: "Write tests", completed: false },
				],
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, "thread_abc");

			expect(messages).toHaveLength(2);

			// Tool use for TodoWrite
			const toolUse = messages[0];
			if (toolUse.type === "assistant") {
				const content = toolUse.message.content as Array<{
					name: string;
					input: { todos: Array<{ content: string; status: string }> };
				}>;
				expect(content[0].name).toBe("TodoWrite");
				expect(content[0].input.todos).toHaveLength(2);
				expect(content[0].input.todos[0].content).toBe("Implement feature");
				expect(content[0].input.todos[0].status).toBe("completed");
				expect(content[0].input.todos[1].status).toBe("pending");
			}

			// Tool result
			const toolResult = messages[1];
			if (toolResult.type === "user") {
				const content = toolResult.message.content as Array<{
					content: string;
					is_error: boolean;
				}>;
				expect(content[0].content).toBe("Todos updated");
				expect(content[0].is_error).toBe(false);
			}
		});
	});

	describe("AgentMessageItem", () => {
		it("should convert agent message to assistant message", () => {
			const item: AgentMessageItem = {
				id: "msg_123",
				type: "agent_message",
				text: "I've completed the task successfully.",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, "thread_abc");

			expect(messages).toHaveLength(1);

			const assistant = messages[0];
			expect(assistant.type).toBe("assistant");
			if (assistant.type === "assistant") {
				expect(assistant.session_id).toBe("thread_abc");
				const content = assistant.message.content as Array<{
					type: string;
					text: string;
				}>;
				expect(content[0].type).toBe("text");
				expect(content[0].text).toBe("I've completed the task successfully.");
			}
		});

		it("should use 'pending' session_id when threadId is null", () => {
			const item: AgentMessageItem = {
				id: "msg_456",
				type: "agent_message",
				text: "Hello",
			};
			const event = makeItemCompletedEvent(item);
			const messages = itemCompletedToMessages(event, null);

			const assistant = messages[0];
			if (assistant.type === "assistant") {
				expect(assistant.session_id).toBe("pending");
			}
		});
	});

	describe("Unsupported items", () => {
		it("should return empty array for reasoning items", () => {
			const event: ItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "reason_123",
					type: "reasoning",
					text: "Thinking about the problem...",
				},
			};
			const messages = itemCompletedToMessages(event, "thread_abc");
			expect(messages).toHaveLength(0);
		});

		it("should return empty array for web search items", () => {
			const event: ItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "search_123",
					type: "web_search",
					query: "TypeScript best practices",
				},
			};
			const messages = itemCompletedToMessages(event, "thread_abc");
			expect(messages).toHaveLength(0);
		});

		it("should return empty array for error items", () => {
			const event: ItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "err_123",
					type: "error",
					message: "Something went wrong",
				},
			};
			const messages = itemCompletedToMessages(event, "thread_abc");
			expect(messages).toHaveLength(0);
		});
	});
});

// ============================================================================
// codexEventToSDKMessages Tests
// ============================================================================

describe("codexEventToSDKMessages", () => {
	describe("thread.started event", () => {
		it("should convert to system init message", () => {
			const event: ThreadStartedEvent = {
				type: "thread.started",
				thread_id: "thread_abc123",
			};
			const messages = codexEventToSDKMessages(event, null, "gpt-5.1-codex");

			expect(messages).toHaveLength(1);
			expect(messages[0].type).toBe("system");
			if (messages[0].type === "system") {
				expect(messages[0].subtype).toBe("init");
				expect(messages[0].session_id).toBe("thread_abc123");
				expect(messages[0].model).toBe("gpt-5.1-codex");
			}
		});

		it("should use default model when not provided", () => {
			const event: ThreadStartedEvent = {
				type: "thread.started",
				thread_id: "thread_xyz",
			};
			const messages = codexEventToSDKMessages(event, null);

			if (messages[0].type === "system") {
				expect(messages[0].model).toBe("codex");
			}
		});
	});

	describe("turn.completed event", () => {
		it("should convert to success result message with usage", () => {
			const event: TurnCompletedEvent = {
				type: "turn.completed",
				usage: {
					input_tokens: 1000,
					output_tokens: 500,
					cached_input_tokens: 200,
				},
			};
			const messages = codexEventToSDKMessages(
				event,
				"thread_abc",
				undefined,
				"Task completed successfully",
			);

			expect(messages).toHaveLength(1);
			expect(messages[0].type).toBe("result");
			if (messages[0].type === "result") {
				expect(messages[0].subtype).toBe("success");
				expect(messages[0].is_error).toBe(false);
				expect(messages[0].result).toBe("Task completed successfully");
				expect(messages[0].session_id).toBe("thread_abc");
				expect(messages[0].usage.input_tokens).toBe(1000);
				expect(messages[0].usage.output_tokens).toBe(500);
				expect(messages[0].usage.cache_read_input_tokens).toBe(200);
			}
		});

		it("should use default result message when lastAgentMessage not provided", () => {
			const event: TurnCompletedEvent = {
				type: "turn.completed",
				usage: { input_tokens: 100, output_tokens: 50 },
			};
			const messages = codexEventToSDKMessages(event, "thread_abc");

			if (messages[0].type === "result") {
				expect(messages[0].result).toBe("Session completed successfully");
			}
		});
	});

	describe("turn.failed event", () => {
		it("should convert to error result message", () => {
			const event: TurnFailedEvent = {
				type: "turn.failed",
				error: { message: "Rate limit exceeded" },
			};
			const messages = codexEventToSDKMessages(event, "thread_abc");

			expect(messages).toHaveLength(1);
			expect(messages[0].type).toBe("result");
			if (messages[0].type === "result") {
				expect(messages[0].subtype).toBe("error_during_execution");
				expect(messages[0].is_error).toBe(true);
				expect(messages[0].errors).toContain("Rate limit exceeded");
			}
		});
	});

	describe("error event", () => {
		it("should convert to error result message", () => {
			const event: ThreadEvent = {
				type: "error",
				message: "Connection lost",
			};
			const messages = codexEventToSDKMessages(event, "thread_abc");

			expect(messages).toHaveLength(1);
			if (messages[0].type === "result") {
				expect(messages[0].is_error).toBe(true);
				expect(messages[0].errors).toContain("Connection lost");
			}
		});
	});

	describe("item.completed event", () => {
		it("should delegate to itemCompletedToMessages", () => {
			const event: ThreadEvent = {
				type: "item.completed",
				item: {
					id: "msg_123",
					type: "agent_message",
					text: "Hello world",
				},
			};
			const messages = codexEventToSDKMessages(event, "thread_abc");

			expect(messages).toHaveLength(1);
			expect(messages[0].type).toBe("assistant");
		});
	});

	describe("events that don't produce messages", () => {
		it("should return empty array for turn.started", () => {
			const event: ThreadEvent = { type: "turn.started" };
			const messages = codexEventToSDKMessages(event, "thread_abc");
			expect(messages).toHaveLength(0);
		});

		it("should return empty array for item.started", () => {
			const event: ThreadEvent = {
				type: "item.started",
				item: { id: "1", type: "agent_message", text: "" },
			};
			const messages = codexEventToSDKMessages(event, "thread_abc");
			expect(messages).toHaveLength(0);
		});

		it("should return empty array for item.updated", () => {
			const event: ThreadEvent = {
				type: "item.updated",
				item: { id: "1", type: "agent_message", text: "partial" },
			};
			const messages = codexEventToSDKMessages(event, "thread_abc");
			expect(messages).toHaveLength(0);
		});
	});
});

// ============================================================================
// createUserMessage Tests
// ============================================================================

describe("createUserMessage", () => {
	it("should create a properly formatted user message", () => {
		const message = createUserMessage("Hello, please help me", "thread_abc");

		expect(message.type).toBe("user");
		expect(message.message.role).toBe("user");
		expect(message.message.content).toBe("Hello, please help me");
		expect(message.parent_tool_use_id).toBeNull();
		expect(message.session_id).toBe("thread_abc");
	});

	it("should use 'pending' session_id when threadId is null", () => {
		const message = createUserMessage("Test prompt", null);

		expect(message.session_id).toBe("pending");
	});
});
