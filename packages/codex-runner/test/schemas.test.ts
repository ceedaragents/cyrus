import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
	AgentMessageItemSchema,
	CommandExecutionItemSchema,
	ErrorItemSchema,
	FileChangeItemSchema,
	ItemCompletedEventSchema,
	ItemStartedEventSchema,
	ItemStatusSchema,
	ItemUpdatedEventSchema,
	// Item type guards
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
	// Event type guards
	isThreadStartedEvent,
	isTodoListItem,
	isTurnCompletedEvent,
	isTurnFailedEvent,
	isTurnStartedEvent,
	isWebSearchItem,
	McpToolCallItemSchema,
	parseCodexEvent,
	ReasoningItemSchema,
	// Parsing utilities
	safeParseCodexEvent,
	ThreadErrorEventSchema,
	ThreadEventSchema,
	ThreadItemSchema,
	ThreadStartedEventSchema,
	TodoListItemSchema,
	TurnCompletedEventSchema,
	TurnFailedEventSchema,
	TurnStartedEventSchema,
	// Schemas
	UsageSchema,
	WebSearchItemSchema,
} from "../src/schemas.js";

describe("Codex Event Schemas", () => {
	describe("UsageSchema", () => {
		it("should validate valid usage with all fields", () => {
			const usage = {
				input_tokens: 6651,
				cached_input_tokens: 6144,
				output_tokens: 39,
			};

			const result = UsageSchema.parse(usage);
			expect(result.input_tokens).toBe(6651);
			expect(result.cached_input_tokens).toBe(6144);
			expect(result.output_tokens).toBe(39);
		});

		it("should validate usage without cached_input_tokens", () => {
			const usage = {
				input_tokens: 1000,
				output_tokens: 50,
			};

			const result = UsageSchema.parse(usage);
			expect(result.input_tokens).toBe(1000);
			expect(result.output_tokens).toBe(50);
			expect(result.cached_input_tokens).toBeUndefined();
		});

		it("should reject negative token counts", () => {
			const usage = {
				input_tokens: -100,
				output_tokens: 50,
			};

			expect(() => UsageSchema.parse(usage)).toThrow(ZodError);
		});

		it("should reject non-integer token counts", () => {
			const usage = {
				input_tokens: 100.5,
				output_tokens: 50,
			};

			expect(() => UsageSchema.parse(usage)).toThrow(ZodError);
		});
	});

	describe("ItemStatusSchema", () => {
		it("should validate all status values", () => {
			expect(ItemStatusSchema.parse("in_progress")).toBe("in_progress");
			expect(ItemStatusSchema.parse("completed")).toBe("completed");
			expect(ItemStatusSchema.parse("failed")).toBe("failed");
		});

		it("should reject invalid status", () => {
			expect(() => ItemStatusSchema.parse("invalid")).toThrow(ZodError);
		});
	});

	describe("ThreadStartedEventSchema", () => {
		it("should validate valid thread.started event", () => {
			const event = {
				type: "thread.started",
				thread_id: "019ae047-d040-7891-8d68-5dd42b18474e",
			};

			const result = ThreadStartedEventSchema.parse(event);
			expect(result.type).toBe("thread.started");
			expect(result.thread_id).toBe("019ae047-d040-7891-8d68-5dd42b18474e");
		});

		it("should reject missing thread_id", () => {
			const event = {
				type: "thread.started",
			};

			expect(() => ThreadStartedEventSchema.parse(event)).toThrow(ZodError);
		});

		it("should reject wrong type", () => {
			const event = {
				type: "thread.stopped",
				thread_id: "019ae047-d040-7891-8d68-5dd42b18474e",
			};

			expect(() => ThreadStartedEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("TurnStartedEventSchema", () => {
		it("should validate valid turn.started event", () => {
			const event = {
				type: "turn.started",
			};

			const result = TurnStartedEventSchema.parse(event);
			expect(result.type).toBe("turn.started");
		});

		it("should reject wrong type", () => {
			const event = {
				type: "turn.completed",
			};

			expect(() => TurnStartedEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("TurnCompletedEventSchema", () => {
		it("should validate valid turn.completed event", () => {
			const event = {
				type: "turn.completed",
				usage: {
					input_tokens: 6651,
					cached_input_tokens: 6144,
					output_tokens: 39,
				},
			};

			const result = TurnCompletedEventSchema.parse(event);
			expect(result.type).toBe("turn.completed");
			expect(result.usage.input_tokens).toBe(6651);
			expect(result.usage.output_tokens).toBe(39);
		});

		it("should reject missing usage", () => {
			const event = {
				type: "turn.completed",
			};

			expect(() => TurnCompletedEventSchema.parse(event)).toThrow(ZodError);
		});

		it("should reject invalid usage", () => {
			const event = {
				type: "turn.completed",
				usage: {
					input_tokens: "invalid",
					output_tokens: 39,
				},
			};

			expect(() => TurnCompletedEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("TurnFailedEventSchema", () => {
		it("should validate valid turn.failed event", () => {
			const event = {
				type: "turn.failed",
				error: {
					message: "Rate limit exceeded",
				},
			};

			const result = TurnFailedEventSchema.parse(event);
			expect(result.type).toBe("turn.failed");
			expect(result.error.message).toBe("Rate limit exceeded");
		});

		it("should reject missing error", () => {
			const event = {
				type: "turn.failed",
			};

			expect(() => TurnFailedEventSchema.parse(event)).toThrow(ZodError);
		});

		it("should reject error without message", () => {
			const event = {
				type: "turn.failed",
				error: {},
			};

			expect(() => TurnFailedEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("AgentMessageItemSchema", () => {
		it("should validate valid agent_message item", () => {
			const item = {
				id: "item_2",
				type: "agent_message",
				text: "README.md\n\ndone",
			};

			const result = AgentMessageItemSchema.parse(item);
			expect(result.type).toBe("agent_message");
			expect(result.text).toBe("README.md\n\ndone");
		});

		it("should reject missing text", () => {
			const item = {
				id: "item_2",
				type: "agent_message",
			};

			expect(() => AgentMessageItemSchema.parse(item)).toThrow(ZodError);
		});
	});

	describe("ReasoningItemSchema", () => {
		it("should validate valid reasoning item", () => {
			const item = {
				id: "item_0",
				type: "reasoning",
				text: "**Listing files**",
			};

			const result = ReasoningItemSchema.parse(item);
			expect(result.type).toBe("reasoning");
			expect(result.text).toBe("**Listing files**");
		});
	});

	describe("CommandExecutionItemSchema", () => {
		it("should validate valid command_execution item in progress", () => {
			const item = {
				id: "item_1",
				type: "command_execution",
				command: "/bin/zsh -lc ls",
				aggregated_output: "",
				exit_code: null,
				status: "in_progress",
			};

			const result = CommandExecutionItemSchema.parse(item);
			expect(result.type).toBe("command_execution");
			expect(result.command).toBe("/bin/zsh -lc ls");
			expect(result.exit_code).toBeNull();
			expect(result.status).toBe("in_progress");
		});

		it("should validate valid command_execution item completed", () => {
			const item = {
				id: "item_1",
				type: "command_execution",
				command: "/bin/zsh -lc ls",
				aggregated_output: "README.md\n",
				exit_code: 0,
				status: "completed",
			};

			const result = CommandExecutionItemSchema.parse(item);
			expect(result.exit_code).toBe(0);
			expect(result.status).toBe("completed");
			expect(result.aggregated_output).toBe("README.md\n");
		});

		it("should validate command with non-zero exit code", () => {
			const item = {
				id: "item_1",
				type: "command_execution",
				command: "/bin/zsh -lc 'exit 1'",
				aggregated_output: "Error message\n",
				exit_code: 1,
				status: "failed",
			};

			const result = CommandExecutionItemSchema.parse(item);
			expect(result.exit_code).toBe(1);
			expect(result.status).toBe("failed");
		});

		it("should reject missing required fields", () => {
			const item = {
				id: "item_1",
				type: "command_execution",
				command: "/bin/zsh -lc ls",
			};

			expect(() => CommandExecutionItemSchema.parse(item)).toThrow(ZodError);
		});
	});

	describe("FileChangeItemSchema", () => {
		it("should validate create file change", () => {
			const item = {
				id: "item_3",
				type: "file_change",
				file_path: "src/index.ts",
				change_type: "create",
				content: "export const hello = 'world';",
				status: "completed",
			};

			const result = FileChangeItemSchema.parse(item);
			expect(result.change_type).toBe("create");
			expect(result.file_path).toBe("src/index.ts");
			expect(result.content).toBe("export const hello = 'world';");
		});

		it("should validate update file change", () => {
			const item = {
				id: "item_4",
				type: "file_change",
				file_path: "src/index.ts",
				change_type: "update",
				content: "export const hello = 'updated';",
				status: "completed",
			};

			const result = FileChangeItemSchema.parse(item);
			expect(result.change_type).toBe("update");
		});

		it("should validate delete file change without content", () => {
			const item = {
				id: "item_5",
				type: "file_change",
				file_path: "src/old.ts",
				change_type: "delete",
				status: "completed",
			};

			const result = FileChangeItemSchema.parse(item);
			expect(result.change_type).toBe("delete");
			expect(result.content).toBeUndefined();
		});

		it("should reject invalid change_type", () => {
			const item = {
				id: "item_3",
				type: "file_change",
				file_path: "src/index.ts",
				change_type: "modify",
				status: "completed",
			};

			expect(() => FileChangeItemSchema.parse(item)).toThrow(ZodError);
		});
	});

	describe("McpToolCallItemSchema", () => {
		it("should validate valid mcp_tool_call item", () => {
			const item = {
				id: "item_4",
				type: "mcp_tool_call",
				tool_name: "linear_create_issue",
				parameters: { title: "Test Issue", description: "Test" },
				result: { success: true, issue_id: "ABC-123" },
				status: "completed",
			};

			const result = McpToolCallItemSchema.parse(item);
			expect(result.tool_name).toBe("linear_create_issue");
			expect(result.parameters).toEqual({
				title: "Test Issue",
				description: "Test",
			});
			expect(result.result).toEqual({ success: true, issue_id: "ABC-123" });
		});

		it("should validate mcp_tool_call without result", () => {
			const item = {
				id: "item_4",
				type: "mcp_tool_call",
				tool_name: "linear_create_issue",
				parameters: { title: "Test" },
				status: "in_progress",
			};

			const result = McpToolCallItemSchema.parse(item);
			expect(result.result).toBeUndefined();
		});

		it("should reject empty parameters", () => {
			const item = {
				id: "item_4",
				type: "mcp_tool_call",
				tool_name: "linear_create_issue",
				status: "completed",
			};

			expect(() => McpToolCallItemSchema.parse(item)).toThrow(ZodError);
		});
	});

	describe("WebSearchItemSchema", () => {
		it("should validate valid web_search item with results", () => {
			const item = {
				id: "item_5",
				type: "web_search",
				query: "TypeScript best practices",
				results: [
					{ title: "TS Handbook", url: "https://example.com/handbook" },
					{ title: "TS Guide", url: "https://example.com/guide" },
				],
				status: "completed",
			};

			const result = WebSearchItemSchema.parse(item);
			expect(result.query).toBe("TypeScript best practices");
			expect(result.results).toHaveLength(2);
		});

		it("should validate web_search without results", () => {
			const item = {
				id: "item_5",
				type: "web_search",
				query: "TypeScript best practices",
				status: "in_progress",
			};

			const result = WebSearchItemSchema.parse(item);
			expect(result.results).toBeUndefined();
		});
	});

	describe("TodoListItemSchema", () => {
		it("should validate valid todo_list item", () => {
			const item = {
				id: "item_6",
				type: "todo_list",
				todos: [
					{ description: "Implement feature", status: "pending" },
					{ description: "Write tests", status: "in_progress" },
					{ description: "Deploy", status: "completed" },
				],
				status: "completed",
			};

			const result = TodoListItemSchema.parse(item);
			expect(result.todos).toHaveLength(3);
			expect(result.todos[0].description).toBe("Implement feature");
			expect(result.todos[1].status).toBe("in_progress");
		});

		it("should reject invalid todo status", () => {
			const item = {
				id: "item_6",
				type: "todo_list",
				todos: [{ description: "Task", status: "invalid" }],
				status: "completed",
			};

			expect(() => TodoListItemSchema.parse(item)).toThrow(ZodError);
		});

		it("should reject empty todos array", () => {
			const item = {
				id: "item_6",
				type: "todo_list",
				status: "completed",
			};

			expect(() => TodoListItemSchema.parse(item)).toThrow(ZodError);
		});
	});

	describe("ErrorItemSchema", () => {
		it("should validate valid error item", () => {
			const item = {
				id: "item_7",
				type: "error",
				message: "Command failed with exit code 1",
			};

			const result = ErrorItemSchema.parse(item);
			expect(result.type).toBe("error");
			expect(result.message).toBe("Command failed with exit code 1");
		});
	});

	describe("ThreadItemSchema (discriminated union)", () => {
		it("should parse all item types correctly", () => {
			const items = [
				{
					id: "item_1",
					type: "agent_message",
					text: "Done",
				},
				{
					id: "item_2",
					type: "reasoning",
					text: "Thinking...",
				},
				{
					id: "item_3",
					type: "command_execution",
					command: "ls",
					aggregated_output: "",
					exit_code: null,
					status: "in_progress",
				},
				{
					id: "item_4",
					type: "file_change",
					file_path: "test.ts",
					change_type: "create",
					status: "completed",
				},
				{
					id: "item_5",
					type: "mcp_tool_call",
					tool_name: "test",
					parameters: {},
					status: "completed",
				},
				{
					id: "item_6",
					type: "web_search",
					query: "test",
					status: "completed",
				},
				{
					id: "item_7",
					type: "todo_list",
					todos: [{ description: "test", status: "pending" }],
					status: "completed",
				},
				{
					id: "item_8",
					type: "error",
					message: "Failed",
				},
			];

			for (const item of items) {
				const result = ThreadItemSchema.parse(item);
				expect(result.type).toBe(item.type);
			}
		});

		it("should reject unknown item type", () => {
			const item = {
				id: "item_1",
				type: "unknown_type",
			};

			expect(() => ThreadItemSchema.parse(item)).toThrow(ZodError);
		});
	});

	describe("ItemStartedEventSchema", () => {
		it("should validate valid item.started event", () => {
			const event = {
				type: "item.started",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "/bin/zsh -lc ls",
					aggregated_output: "",
					exit_code: null,
					status: "in_progress",
				},
			};

			const result = ItemStartedEventSchema.parse(event);
			expect(result.type).toBe("item.started");
			expect(result.item.type).toBe("command_execution");
		});
	});

	describe("ItemUpdatedEventSchema", () => {
		it("should validate valid item.updated event", () => {
			const event = {
				type: "item.updated",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "/bin/zsh -lc ls",
					aggregated_output: "README.md",
					exit_code: null,
					status: "in_progress",
				},
			};

			const result = ItemUpdatedEventSchema.parse(event);
			expect(result.type).toBe("item.updated");
			expect(result.item.type).toBe("command_execution");
		});
	});

	describe("ItemCompletedEventSchema", () => {
		it("should validate valid item.completed event", () => {
			const event = {
				type: "item.completed",
				item: {
					id: "item_0",
					type: "reasoning",
					text: "**Listing files**",
				},
			};

			const result = ItemCompletedEventSchema.parse(event);
			expect(result.type).toBe("item.completed");
			expect(result.item.type).toBe("reasoning");
		});
	});

	describe("ThreadErrorEventSchema", () => {
		it("should validate valid error event", () => {
			const event = {
				type: "error",
				message: "Thread execution failed",
			};

			const result = ThreadErrorEventSchema.parse(event);
			expect(result.type).toBe("error");
			expect(result.message).toBe("Thread execution failed");
		});
	});

	describe("ThreadEventSchema (discriminated union)", () => {
		it("should parse all event types correctly", () => {
			const events = [
				{
					type: "thread.started",
					thread_id: "019ae047-d040-7891-8d68-5dd42b18474e",
				},
				{
					type: "turn.started",
				},
				{
					type: "turn.completed",
					usage: {
						input_tokens: 6651,
						cached_input_tokens: 6144,
						output_tokens: 39,
					},
				},
				{
					type: "turn.failed",
					error: { message: "Failed" },
				},
				{
					type: "item.started",
					item: {
						id: "item_0",
						type: "reasoning",
						text: "Thinking",
					},
				},
				{
					type: "item.updated",
					item: {
						id: "item_0",
						type: "reasoning",
						text: "Still thinking",
					},
				},
				{
					type: "item.completed",
					item: {
						id: "item_0",
						type: "reasoning",
						text: "Done thinking",
					},
				},
				{
					type: "error",
					message: "Error occurred",
				},
			];

			for (const event of events) {
				const result = ThreadEventSchema.parse(event);
				expect(result.type).toBe(event.type);
			}
		});

		it("should reject unknown event type", () => {
			const event = {
				type: "unknown.event",
			};

			expect(() => ThreadEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("safeParseCodexEvent", () => {
		it("should return success for valid event", () => {
			const event = {
				type: "thread.started",
				thread_id: "019ae047-d040-7891-8d68-5dd42b18474e",
			};

			const result = safeParseCodexEvent(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.type).toBe("thread.started");
			}
		});

		it("should return error for invalid event", () => {
			const event = {
				type: "invalid.event",
			};

			const result = safeParseCodexEvent(event);
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeInstanceOf(ZodError);
			}
		});

		it("should handle null and undefined", () => {
			expect(safeParseCodexEvent(null).success).toBe(false);
			expect(safeParseCodexEvent(undefined).success).toBe(false);
		});
	});

	describe("parseCodexEvent", () => {
		it("should parse valid event", () => {
			const event = {
				type: "turn.started",
			};

			const result = parseCodexEvent(event);
			expect(result.type).toBe("turn.started");
		});

		it("should throw for invalid event", () => {
			const event = {
				type: "invalid",
			};

			expect(() => parseCodexEvent(event)).toThrow(ZodError);
		});
	});

	describe("Event Type Guards", () => {
		const threadStartedEvent = {
			type: "thread.started" as const,
			thread_id: "test-id",
		};
		const turnStartedEvent = { type: "turn.started" as const };
		const turnCompletedEvent = {
			type: "turn.completed" as const,
			usage: { input_tokens: 100, output_tokens: 50 },
		};
		const turnFailedEvent = {
			type: "turn.failed" as const,
			error: { message: "Failed" },
		};
		const itemStartedEvent = {
			type: "item.started" as const,
			item: { id: "item_1", type: "reasoning" as const, text: "Test" },
		};
		const itemUpdatedEvent = {
			type: "item.updated" as const,
			item: { id: "item_1", type: "reasoning" as const, text: "Test" },
		};
		const itemCompletedEvent = {
			type: "item.completed" as const,
			item: { id: "item_1", type: "reasoning" as const, text: "Test" },
		};
		const errorEvent = { type: "error" as const, message: "Error" };

		it("isThreadStartedEvent should identify thread.started events", () => {
			expect(isThreadStartedEvent(threadStartedEvent)).toBe(true);
			expect(isThreadStartedEvent(turnStartedEvent)).toBe(false);
		});

		it("isTurnStartedEvent should identify turn.started events", () => {
			expect(isTurnStartedEvent(turnStartedEvent)).toBe(true);
			expect(isTurnStartedEvent(turnCompletedEvent)).toBe(false);
		});

		it("isTurnCompletedEvent should identify turn.completed events", () => {
			expect(isTurnCompletedEvent(turnCompletedEvent)).toBe(true);
			expect(isTurnCompletedEvent(turnFailedEvent)).toBe(false);
		});

		it("isTurnFailedEvent should identify turn.failed events", () => {
			expect(isTurnFailedEvent(turnFailedEvent)).toBe(true);
			expect(isTurnFailedEvent(turnCompletedEvent)).toBe(false);
		});

		it("isItemStartedEvent should identify item.started events", () => {
			expect(isItemStartedEvent(itemStartedEvent)).toBe(true);
			expect(isItemStartedEvent(itemUpdatedEvent)).toBe(false);
		});

		it("isItemUpdatedEvent should identify item.updated events", () => {
			expect(isItemUpdatedEvent(itemUpdatedEvent)).toBe(true);
			expect(isItemUpdatedEvent(itemCompletedEvent)).toBe(false);
		});

		it("isItemCompletedEvent should identify item.completed events", () => {
			expect(isItemCompletedEvent(itemCompletedEvent)).toBe(true);
			expect(isItemCompletedEvent(itemStartedEvent)).toBe(false);
		});

		it("isThreadErrorEvent should identify error events", () => {
			expect(isThreadErrorEvent(errorEvent)).toBe(true);
			expect(isThreadErrorEvent(threadStartedEvent)).toBe(false);
		});
	});

	describe("Item Type Guards", () => {
		const agentMessageItem = {
			id: "item_1",
			type: "agent_message" as const,
			text: "Done",
		};
		const reasoningItem = {
			id: "item_2",
			type: "reasoning" as const,
			text: "Thinking",
		};
		const commandExecutionItem = {
			id: "item_3",
			type: "command_execution" as const,
			command: "ls",
			aggregated_output: "",
			exit_code: null,
			status: "in_progress" as const,
		};
		const fileChangeItem = {
			id: "item_4",
			type: "file_change" as const,
			file_path: "test.ts",
			change_type: "create" as const,
			status: "completed" as const,
		};
		const mcpToolCallItem = {
			id: "item_5",
			type: "mcp_tool_call" as const,
			tool_name: "test",
			parameters: {},
			status: "completed" as const,
		};
		const webSearchItem = {
			id: "item_6",
			type: "web_search" as const,
			query: "test",
			status: "completed" as const,
		};
		const todoListItem = {
			id: "item_7",
			type: "todo_list" as const,
			todos: [{ description: "test", status: "pending" as const }],
			status: "completed" as const,
		};
		const errorItem = {
			id: "item_8",
			type: "error" as const,
			message: "Failed",
		};

		it("isAgentMessageItem should identify agent_message items", () => {
			expect(isAgentMessageItem(agentMessageItem)).toBe(true);
			expect(isAgentMessageItem(reasoningItem)).toBe(false);
		});

		it("isReasoningItem should identify reasoning items", () => {
			expect(isReasoningItem(reasoningItem)).toBe(true);
			expect(isReasoningItem(agentMessageItem)).toBe(false);
		});

		it("isCommandExecutionItem should identify command_execution items", () => {
			expect(isCommandExecutionItem(commandExecutionItem)).toBe(true);
			expect(isCommandExecutionItem(fileChangeItem)).toBe(false);
		});

		it("isFileChangeItem should identify file_change items", () => {
			expect(isFileChangeItem(fileChangeItem)).toBe(true);
			expect(isFileChangeItem(commandExecutionItem)).toBe(false);
		});

		it("isMcpToolCallItem should identify mcp_tool_call items", () => {
			expect(isMcpToolCallItem(mcpToolCallItem)).toBe(true);
			expect(isMcpToolCallItem(webSearchItem)).toBe(false);
		});

		it("isWebSearchItem should identify web_search items", () => {
			expect(isWebSearchItem(webSearchItem)).toBe(true);
			expect(isWebSearchItem(mcpToolCallItem)).toBe(false);
		});

		it("isTodoListItem should identify todo_list items", () => {
			expect(isTodoListItem(todoListItem)).toBe(true);
			expect(isTodoListItem(errorItem)).toBe(false);
		});

		it("isErrorItem should identify error items", () => {
			expect(isErrorItem(errorItem)).toBe(true);
			expect(isErrorItem(todoListItem)).toBe(false);
		});
	});

	describe("Real-world JSONL sequence", () => {
		it("should parse complete JSONL sequence from example", () => {
			const lines = [
				'{"type":"thread.started","thread_id":"019ae047-d040-7891-8d68-5dd42b18474e"}',
				'{"type":"turn.started"}',
				'{"type":"item.completed","item":{"id":"item_0","type":"reasoning","text":"**Listing files**"}}',
				'{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
				'{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"README.md\\n","exit_code":0,"status":"completed"}}',
				'{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"README.md\\n\\ndone"}}',
				'{"type":"turn.completed","usage":{"input_tokens":6651,"cached_input_tokens":6144,"output_tokens":39}}',
			];

			const events = lines.map((line) => JSON.parse(line));
			const results = events.map((event) => safeParseCodexEvent(event));

			// All should parse successfully
			expect(results.every((r) => r.success)).toBe(true);

			// Verify specific events
			const parsedEvents = results.map((r) => (r.success ? r.data : null));

			expect(parsedEvents[0]?.type).toBe("thread.started");
			expect(parsedEvents[1]?.type).toBe("turn.started");
			expect(parsedEvents[2]?.type).toBe("item.completed");
			expect(parsedEvents[3]?.type).toBe("item.started");
			expect(parsedEvents[4]?.type).toBe("item.completed");
			expect(parsedEvents[5]?.type).toBe("item.completed");
			expect(parsedEvents[6]?.type).toBe("turn.completed");

			// Verify thread_id
			if (parsedEvents[0] && isThreadStartedEvent(parsedEvents[0])) {
				expect(parsedEvents[0].thread_id).toBe(
					"019ae047-d040-7891-8d68-5dd42b18474e",
				);
			}

			// Verify usage stats
			if (parsedEvents[6] && isTurnCompletedEvent(parsedEvents[6])) {
				expect(parsedEvents[6].usage.input_tokens).toBe(6651);
				expect(parsedEvents[6].usage.cached_input_tokens).toBe(6144);
				expect(parsedEvents[6].usage.output_tokens).toBe(39);
			}
		});
	});

	describe("Edge cases", () => {
		it("should handle empty strings in text fields", () => {
			const item = {
				id: "item_1",
				type: "agent_message",
				text: "",
			};

			const result = AgentMessageItemSchema.parse(item);
			expect(result.text).toBe("");
		});

		it("should handle zero token counts", () => {
			const usage = {
				input_tokens: 0,
				output_tokens: 0,
			};

			const result = UsageSchema.parse(usage);
			expect(result.input_tokens).toBe(0);
			expect(result.output_tokens).toBe(0);
		});

		it("should handle empty command output", () => {
			const item = {
				id: "item_1",
				type: "command_execution",
				command: "true",
				aggregated_output: "",
				exit_code: 0,
				status: "completed",
			};

			const result = CommandExecutionItemSchema.parse(item);
			expect(result.aggregated_output).toBe("");
		});

		it("should handle special characters in strings", () => {
			const item = {
				id: "item_1",
				type: "reasoning",
				text: "**Special chars**: \n\t\\r\\n 🎉 <>&",
			};

			const result = ReasoningItemSchema.parse(item);
			expect(result.text).toContain("🎉");
		});

		it("should handle large exit codes", () => {
			const item = {
				id: "item_1",
				type: "command_execution",
				command: "test",
				aggregated_output: "",
				exit_code: 255,
				status: "failed",
			};

			const result = CommandExecutionItemSchema.parse(item);
			expect(result.exit_code).toBe(255);
		});

		it("should handle complex nested MCP parameters", () => {
			const item = {
				id: "item_1",
				type: "mcp_tool_call",
				tool_name: "complex_tool",
				parameters: {
					nested: {
						deeply: {
							nested: "value",
						},
					},
					array: [1, 2, 3],
					mixed: { a: 1, b: "test" },
				},
				status: "completed",
			};

			const result = McpToolCallItemSchema.parse(item);
			expect(result.parameters).toHaveProperty("nested");
		});
	});
});
