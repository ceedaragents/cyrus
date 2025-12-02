/**
 * Tests for Codex CLI JSONL Event Schemas
 *
 * These tests verify that the Zod schemas correctly validate and parse
 * Codex CLI's JSONL event output format.
 */

import { describe, expect, it } from "vitest";
import {
	// Schema imports
	AgentMessageItemSchema,
	CommandExecutionItemSchema,
	CommandExecutionStatusSchema,
	ErrorItemSchema,
	// Type guards
	extractThreadId,
	FileChangeItemSchema,
	FileUpdateChangeSchema,
	ItemCompletedEventSchema,
	ItemStartedEventSchema,
	ItemUpdatedEventSchema,
	isAgentMessageItem,
	isCommandExecutionItem,
	isErrorItem,
	isFileChangeItem,
	isItemCompletedEvent,
	isItemStartedEvent,
	isItemUpdatedEvent,
	isMcpToolCallItem,
	isReasoningItem,
	isThreadErrorEvent,
	isThreadStartedEvent,
	isTodoListItem,
	isTurnCompletedEvent,
	isTurnFailedEvent,
	isTurnStartedEvent,
	isWebSearchItem,
	McpToolCallItemSchema,
	PatchChangeKindSchema,
	// Parsing utilities
	parseCodexEvent,
	ReasoningItemSchema,
	safeParseCodexEvent,
	ThreadErrorEventSchema,
	ThreadEventSchema,
	ThreadItemSchema,
	ThreadStartedEventSchema,
	TodoListItemSchema,
	TurnCompletedEventSchema,
	TurnFailedEventSchema,
	TurnStartedEventSchema,
	UsageSchema,
	WebSearchItemSchema,
} from "./schemas.js";

// ============================================================================
// Thread Item Schema Tests
// ============================================================================

describe("CommandExecutionStatusSchema", () => {
	it("should accept valid status values", () => {
		expect(CommandExecutionStatusSchema.parse("in_progress")).toBe(
			"in_progress",
		);
		expect(CommandExecutionStatusSchema.parse("completed")).toBe("completed");
		expect(CommandExecutionStatusSchema.parse("failed")).toBe("failed");
		expect(CommandExecutionStatusSchema.parse("declined")).toBe("declined");
	});

	it("should reject invalid status values", () => {
		expect(() => CommandExecutionStatusSchema.parse("running")).toThrow();
		expect(() => CommandExecutionStatusSchema.parse("")).toThrow();
	});
});

describe("CommandExecutionItemSchema", () => {
	it("should parse a valid command execution item", () => {
		const item = {
			id: "cmd_123",
			type: "command_execution",
			command: "npm test",
			aggregated_output: "All tests passed",
			exit_code: 0,
			status: "completed",
		};
		const parsed = CommandExecutionItemSchema.parse(item);
		expect(parsed.id).toBe("cmd_123");
		expect(parsed.command).toBe("npm test");
		expect(parsed.aggregated_output).toBe("All tests passed");
		expect(parsed.exit_code).toBe(0);
		expect(parsed.status).toBe("completed");
	});

	it("should parse without optional exit_code", () => {
		const item = {
			id: "cmd_456",
			type: "command_execution",
			command: "ls -la",
			aggregated_output: "file1.txt\nfile2.txt",
			status: "in_progress",
		};
		const parsed = CommandExecutionItemSchema.parse(item);
		expect(parsed.exit_code).toBeUndefined();
	});

	it("should reject invalid command execution items", () => {
		expect(() =>
			CommandExecutionItemSchema.parse({
				id: "cmd_123",
				type: "command_execution",
				// missing required fields
			}),
		).toThrow();
	});
});

describe("PatchChangeKindSchema", () => {
	it("should accept valid change kinds", () => {
		expect(PatchChangeKindSchema.parse("add")).toBe("add");
		expect(PatchChangeKindSchema.parse("delete")).toBe("delete");
		expect(PatchChangeKindSchema.parse("update")).toBe("update");
	});

	it("should reject invalid change kinds", () => {
		expect(() => PatchChangeKindSchema.parse("modify")).toThrow();
		expect(() => PatchChangeKindSchema.parse("rename")).toThrow();
	});
});

describe("FileUpdateChangeSchema", () => {
	it("should parse valid file update changes", () => {
		const change = { path: "src/index.ts", kind: "update" };
		const parsed = FileUpdateChangeSchema.parse(change);
		expect(parsed.path).toBe("src/index.ts");
		expect(parsed.kind).toBe("update");
	});
});

describe("FileChangeItemSchema", () => {
	it("should parse a valid file change item", () => {
		const item = {
			id: "file_123",
			type: "file_change",
			changes: [
				{ path: "src/index.ts", kind: "update" },
				{ path: "src/new.ts", kind: "add" },
			],
			status: "completed",
		};
		const parsed = FileChangeItemSchema.parse(item);
		expect(parsed.id).toBe("file_123");
		expect(parsed.changes).toHaveLength(2);
		expect(parsed.changes[0].kind).toBe("update");
		expect(parsed.status).toBe("completed");
	});

	it("should parse with empty changes array", () => {
		const item = {
			id: "file_456",
			type: "file_change",
			changes: [],
			status: "failed",
		};
		const parsed = FileChangeItemSchema.parse(item);
		expect(parsed.changes).toHaveLength(0);
	});
});

describe("McpToolCallItemSchema", () => {
	it("should parse a completed MCP tool call with result", () => {
		const item = {
			id: "mcp_123",
			type: "mcp_tool_call",
			server: "linear",
			tool: "list_issues",
			arguments: { query: "assigned to me" },
			result: {
				content: [{ type: "text", text: "Issue 1, Issue 2" }],
			},
			status: "completed",
		};
		const parsed = McpToolCallItemSchema.parse(item);
		expect(parsed.id).toBe("mcp_123");
		expect(parsed.server).toBe("linear");
		expect(parsed.tool).toBe("list_issues");
		expect(parsed.result?.content).toHaveLength(1);
		expect(parsed.status).toBe("completed");
	});

	it("should parse a failed MCP tool call with error", () => {
		const item = {
			id: "mcp_456",
			type: "mcp_tool_call",
			server: "linear",
			tool: "create_issue",
			arguments: {},
			error: { message: "API rate limit exceeded" },
			status: "failed",
		};
		const parsed = McpToolCallItemSchema.parse(item);
		expect(parsed.error?.message).toBe("API rate limit exceeded");
		expect(parsed.status).toBe("failed");
	});

	it("should parse an in-progress MCP tool call", () => {
		const item = {
			id: "mcp_789",
			type: "mcp_tool_call",
			server: "filesystem",
			tool: "read_file",
			arguments: { path: "/tmp/test.txt" },
			status: "in_progress",
		};
		const parsed = McpToolCallItemSchema.parse(item);
		expect(parsed.result).toBeUndefined();
		expect(parsed.error).toBeUndefined();
		expect(parsed.status).toBe("in_progress");
	});
});

describe("AgentMessageItemSchema", () => {
	it("should parse a valid agent message", () => {
		const item = {
			id: "msg_123",
			type: "agent_message",
			text: "I've completed the task successfully.",
		};
		const parsed = AgentMessageItemSchema.parse(item);
		expect(parsed.id).toBe("msg_123");
		expect(parsed.text).toBe("I've completed the task successfully.");
	});

	it("should parse with empty text", () => {
		const item = {
			id: "msg_456",
			type: "agent_message",
			text: "",
		};
		const parsed = AgentMessageItemSchema.parse(item);
		expect(parsed.text).toBe("");
	});
});

describe("ReasoningItemSchema", () => {
	it("should parse a valid reasoning item", () => {
		const item = {
			id: "reason_123",
			type: "reasoning",
			text: "I need to first understand the codebase structure...",
		};
		const parsed = ReasoningItemSchema.parse(item);
		expect(parsed.id).toBe("reason_123");
		expect(parsed.text).toBe(
			"I need to first understand the codebase structure...",
		);
	});
});

describe("WebSearchItemSchema", () => {
	it("should parse a valid web search item", () => {
		const item = {
			id: "search_123",
			type: "web_search",
			query: "TypeScript best practices 2024",
		};
		const parsed = WebSearchItemSchema.parse(item);
		expect(parsed.id).toBe("search_123");
		expect(parsed.query).toBe("TypeScript best practices 2024");
	});
});

describe("TodoListItemSchema", () => {
	it("should parse a valid todo list item", () => {
		const item = {
			id: "todo_123",
			type: "todo_list",
			items: [
				{ text: "Implement feature", completed: true },
				{ text: "Write tests", completed: false },
			],
		};
		const parsed = TodoListItemSchema.parse(item);
		expect(parsed.id).toBe("todo_123");
		expect(parsed.items).toHaveLength(2);
		expect(parsed.items[0].completed).toBe(true);
		expect(parsed.items[1].completed).toBe(false);
	});

	it("should parse with empty items array", () => {
		const item = {
			id: "todo_456",
			type: "todo_list",
			items: [],
		};
		const parsed = TodoListItemSchema.parse(item);
		expect(parsed.items).toHaveLength(0);
	});
});

describe("ErrorItemSchema", () => {
	it("should parse a valid error item", () => {
		const item = {
			id: "err_123",
			type: "error",
			message: "Failed to execute command",
		};
		const parsed = ErrorItemSchema.parse(item);
		expect(parsed.id).toBe("err_123");
		expect(parsed.message).toBe("Failed to execute command");
	});
});

describe("ThreadItemSchema (discriminated union)", () => {
	it("should correctly discriminate by type", () => {
		const agentMessage = ThreadItemSchema.parse({
			id: "1",
			type: "agent_message",
			text: "Hello",
		});
		expect(agentMessage.type).toBe("agent_message");

		const command = ThreadItemSchema.parse({
			id: "2",
			type: "command_execution",
			command: "ls",
			aggregated_output: "",
			status: "completed",
		});
		expect(command.type).toBe("command_execution");
	});

	it("should reject unknown item types", () => {
		expect(() =>
			ThreadItemSchema.parse({
				id: "1",
				type: "unknown_type",
			}),
		).toThrow();
	});
});

// ============================================================================
// Thread Event Schema Tests
// ============================================================================

describe("UsageSchema", () => {
	it("should parse usage with all fields", () => {
		const usage = {
			input_tokens: 100,
			cached_input_tokens: 50,
			output_tokens: 75,
		};
		const parsed = UsageSchema.parse(usage);
		expect(parsed.input_tokens).toBe(100);
		expect(parsed.cached_input_tokens).toBe(50);
		expect(parsed.output_tokens).toBe(75);
	});

	it("should parse usage without cached_input_tokens", () => {
		const usage = {
			input_tokens: 100,
			output_tokens: 75,
		};
		const parsed = UsageSchema.parse(usage);
		expect(parsed.cached_input_tokens).toBeUndefined();
	});
});

describe("ThreadStartedEventSchema", () => {
	it("should parse a thread.started event", () => {
		const event = {
			type: "thread.started",
			thread_id: "thread_abc123",
		};
		const parsed = ThreadStartedEventSchema.parse(event);
		expect(parsed.type).toBe("thread.started");
		expect(parsed.thread_id).toBe("thread_abc123");
	});
});

describe("TurnStartedEventSchema", () => {
	it("should parse a turn.started event", () => {
		const event = { type: "turn.started" };
		const parsed = TurnStartedEventSchema.parse(event);
		expect(parsed.type).toBe("turn.started");
	});
});

describe("TurnCompletedEventSchema", () => {
	it("should parse a turn.completed event with usage", () => {
		const event = {
			type: "turn.completed",
			usage: {
				input_tokens: 200,
				output_tokens: 100,
			},
		};
		const parsed = TurnCompletedEventSchema.parse(event);
		expect(parsed.type).toBe("turn.completed");
		expect(parsed.usage.input_tokens).toBe(200);
		expect(parsed.usage.output_tokens).toBe(100);
	});
});

describe("TurnFailedEventSchema", () => {
	it("should parse a turn.failed event", () => {
		const event = {
			type: "turn.failed",
			error: { message: "Rate limit exceeded" },
		};
		const parsed = TurnFailedEventSchema.parse(event);
		expect(parsed.type).toBe("turn.failed");
		expect(parsed.error.message).toBe("Rate limit exceeded");
	});
});

describe("ItemStartedEventSchema", () => {
	it("should parse an item.started event", () => {
		const event = {
			type: "item.started",
			item: {
				id: "cmd_1",
				type: "command_execution",
				command: "echo hello",
				aggregated_output: "",
				status: "in_progress",
			},
		};
		const parsed = ItemStartedEventSchema.parse(event);
		expect(parsed.type).toBe("item.started");
		expect(parsed.item.type).toBe("command_execution");
	});
});

describe("ItemUpdatedEventSchema", () => {
	it("should parse an item.updated event", () => {
		const event = {
			type: "item.updated",
			item: {
				id: "cmd_1",
				type: "command_execution",
				command: "echo hello",
				aggregated_output: "hello\n",
				status: "in_progress",
			},
		};
		const parsed = ItemUpdatedEventSchema.parse(event);
		expect(parsed.type).toBe("item.updated");
	});
});

describe("ItemCompletedEventSchema", () => {
	it("should parse an item.completed event", () => {
		const event = {
			type: "item.completed",
			item: {
				id: "msg_1",
				type: "agent_message",
				text: "Task complete!",
			},
		};
		const parsed = ItemCompletedEventSchema.parse(event);
		expect(parsed.type).toBe("item.completed");
		expect(parsed.item.type).toBe("agent_message");
	});
});

describe("ThreadErrorEventSchema", () => {
	it("should parse an error event", () => {
		const event = {
			type: "error",
			message: "Connection lost",
		};
		const parsed = ThreadErrorEventSchema.parse(event);
		expect(parsed.type).toBe("error");
		expect(parsed.message).toBe("Connection lost");
	});
});

describe("ThreadEventSchema (discriminated union)", () => {
	it("should correctly discriminate all event types", () => {
		const events = [
			{ type: "thread.started", thread_id: "abc" },
			{ type: "turn.started" },
			{ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
			{ type: "turn.failed", error: { message: "error" } },
			{
				type: "item.started",
				item: { id: "1", type: "agent_message", text: "" },
			},
			{
				type: "item.updated",
				item: { id: "1", type: "agent_message", text: "x" },
			},
			{
				type: "item.completed",
				item: { id: "1", type: "agent_message", text: "y" },
			},
			{ type: "error", message: "error" },
		];

		for (const event of events) {
			expect(() => ThreadEventSchema.parse(event)).not.toThrow();
		}
	});

	it("should reject unknown event types", () => {
		expect(() =>
			ThreadEventSchema.parse({
				type: "unknown.event",
			}),
		).toThrow();
	});
});

// ============================================================================
// Parsing Utility Tests
// ============================================================================

describe("parseCodexEvent", () => {
	it("should parse valid JSON event strings", () => {
		const jsonString = '{"type":"thread.started","thread_id":"test_123"}';
		const event = parseCodexEvent(jsonString);
		expect(event.type).toBe("thread.started");
		expect((event as { thread_id: string }).thread_id).toBe("test_123");
	});

	it("should throw on invalid JSON", () => {
		expect(() => parseCodexEvent("not valid json")).toThrow();
	});

	it("should throw on valid JSON but invalid event", () => {
		expect(() => parseCodexEvent('{"type":"invalid"}')).toThrow();
	});
});

describe("safeParseCodexEvent", () => {
	it("should return parsed event on valid input", () => {
		const jsonString = '{"type":"turn.started"}';
		const event = safeParseCodexEvent(jsonString);
		expect(event).not.toBeNull();
		expect(event?.type).toBe("turn.started");
	});

	it("should return null on invalid JSON", () => {
		const event = safeParseCodexEvent("not valid json");
		expect(event).toBeNull();
	});

	it("should return null on invalid event", () => {
		const event = safeParseCodexEvent('{"type":"invalid"}');
		expect(event).toBeNull();
	});
});

// ============================================================================
// Type Guard Tests
// ============================================================================

describe("Thread Event Type Guards", () => {
	const threadStarted = ThreadEventSchema.parse({
		type: "thread.started",
		thread_id: "test",
	});
	const turnStarted = ThreadEventSchema.parse({ type: "turn.started" });
	const turnCompleted = ThreadEventSchema.parse({
		type: "turn.completed",
		usage: { input_tokens: 1, output_tokens: 1 },
	});
	const turnFailed = ThreadEventSchema.parse({
		type: "turn.failed",
		error: { message: "error" },
	});
	const itemStarted = ThreadEventSchema.parse({
		type: "item.started",
		item: { id: "1", type: "agent_message", text: "" },
	});
	const itemUpdated = ThreadEventSchema.parse({
		type: "item.updated",
		item: { id: "1", type: "agent_message", text: "" },
	});
	const itemCompleted = ThreadEventSchema.parse({
		type: "item.completed",
		item: { id: "1", type: "agent_message", text: "" },
	});
	const threadError = ThreadEventSchema.parse({
		type: "error",
		message: "error",
	});

	it("isThreadStartedEvent should identify thread.started events", () => {
		expect(isThreadStartedEvent(threadStarted)).toBe(true);
		expect(isThreadStartedEvent(turnStarted)).toBe(false);
	});

	it("isTurnStartedEvent should identify turn.started events", () => {
		expect(isTurnStartedEvent(turnStarted)).toBe(true);
		expect(isTurnStartedEvent(threadStarted)).toBe(false);
	});

	it("isTurnCompletedEvent should identify turn.completed events", () => {
		expect(isTurnCompletedEvent(turnCompleted)).toBe(true);
		expect(isTurnCompletedEvent(turnFailed)).toBe(false);
	});

	it("isTurnFailedEvent should identify turn.failed events", () => {
		expect(isTurnFailedEvent(turnFailed)).toBe(true);
		expect(isTurnFailedEvent(turnCompleted)).toBe(false);
	});

	it("isItemStartedEvent should identify item.started events", () => {
		expect(isItemStartedEvent(itemStarted)).toBe(true);
		expect(isItemStartedEvent(itemUpdated)).toBe(false);
	});

	it("isItemUpdatedEvent should identify item.updated events", () => {
		expect(isItemUpdatedEvent(itemUpdated)).toBe(true);
		expect(isItemUpdatedEvent(itemCompleted)).toBe(false);
	});

	it("isItemCompletedEvent should identify item.completed events", () => {
		expect(isItemCompletedEvent(itemCompleted)).toBe(true);
		expect(isItemCompletedEvent(itemStarted)).toBe(false);
	});

	it("isThreadErrorEvent should identify error events", () => {
		expect(isThreadErrorEvent(threadError)).toBe(true);
		expect(isThreadErrorEvent(turnFailed)).toBe(false);
	});
});

describe("Thread Item Type Guards", () => {
	const agentMessage = ThreadItemSchema.parse({
		id: "1",
		type: "agent_message",
		text: "",
	});
	const reasoning = ThreadItemSchema.parse({
		id: "2",
		type: "reasoning",
		text: "",
	});
	const commandExecution = ThreadItemSchema.parse({
		id: "3",
		type: "command_execution",
		command: "ls",
		aggregated_output: "",
		status: "completed",
	});
	const fileChange = ThreadItemSchema.parse({
		id: "4",
		type: "file_change",
		changes: [],
		status: "completed",
	});
	const mcpToolCall = ThreadItemSchema.parse({
		id: "5",
		type: "mcp_tool_call",
		server: "test",
		tool: "test",
		arguments: {},
		status: "completed",
	});
	const webSearch = ThreadItemSchema.parse({
		id: "6",
		type: "web_search",
		query: "test",
	});
	const todoList = ThreadItemSchema.parse({
		id: "7",
		type: "todo_list",
		items: [],
	});
	const errorItem = ThreadItemSchema.parse({
		id: "8",
		type: "error",
		message: "error",
	});

	it("isAgentMessageItem should identify agent_message items", () => {
		expect(isAgentMessageItem(agentMessage)).toBe(true);
		expect(isAgentMessageItem(reasoning)).toBe(false);
	});

	it("isReasoningItem should identify reasoning items", () => {
		expect(isReasoningItem(reasoning)).toBe(true);
		expect(isReasoningItem(agentMessage)).toBe(false);
	});

	it("isCommandExecutionItem should identify command_execution items", () => {
		expect(isCommandExecutionItem(commandExecution)).toBe(true);
		expect(isCommandExecutionItem(fileChange)).toBe(false);
	});

	it("isFileChangeItem should identify file_change items", () => {
		expect(isFileChangeItem(fileChange)).toBe(true);
		expect(isFileChangeItem(commandExecution)).toBe(false);
	});

	it("isMcpToolCallItem should identify mcp_tool_call items", () => {
		expect(isMcpToolCallItem(mcpToolCall)).toBe(true);
		expect(isMcpToolCallItem(webSearch)).toBe(false);
	});

	it("isWebSearchItem should identify web_search items", () => {
		expect(isWebSearchItem(webSearch)).toBe(true);
		expect(isWebSearchItem(todoList)).toBe(false);
	});

	it("isTodoListItem should identify todo_list items", () => {
		expect(isTodoListItem(todoList)).toBe(true);
		expect(isTodoListItem(errorItem)).toBe(false);
	});

	it("isErrorItem should identify error items", () => {
		expect(isErrorItem(errorItem)).toBe(true);
		expect(isErrorItem(agentMessage)).toBe(false);
	});
});

describe("extractThreadId", () => {
	it("should extract thread_id from thread.started events", () => {
		const event = ThreadEventSchema.parse({
			type: "thread.started",
			thread_id: "thread_xyz789",
		});
		expect(extractThreadId(event)).toBe("thread_xyz789");
	});

	it("should return null for non-thread.started events", () => {
		const event = ThreadEventSchema.parse({ type: "turn.started" });
		expect(extractThreadId(event)).toBeNull();
	});
});
