import { describe, expect, it } from "vitest";
import {
	codexEventToSDKMessage,
	convertItemToMessage,
	createErrorResultMessage,
	createResultMessage,
	createSystemMessage,
	createUserMessage,
	extractSessionId,
} from "../src/adapters.js";
import type {
	AgentMessageItem,
	CommandExecutionItem,
	ErrorItem,
	FileChangeItem,
	ItemCompletedEvent,
	McpToolCallItem,
	ReasoningItem,
	ThreadErrorEvent,
	ThreadStartedEvent,
	TurnCompletedEvent,
	TurnFailedEvent,
	TurnStartedEvent,
	Usage,
} from "../src/schemas.js";

describe("Adapters", () => {
	const TEST_SESSION_ID = "test-session-123";
	const TEST_THREAD_ID = "thread-abc-456";

	describe("createSystemMessage", () => {
		it("should create a valid SDKSystemMessage from thread_id", () => {
			const message = createSystemMessage(TEST_THREAD_ID);

			expect(message.type).toBe("system");
			expect(message.subtype).toBe("init");
			expect(message.session_id).toBe(TEST_THREAD_ID);
			expect(message.model).toBe("codex");
			expect(message.claude_code_version).toBe("codex-adapter");
			expect(message.tools).toEqual([]);
			expect(message.mcp_servers).toEqual([]);
			expect(message.uuid).toBeDefined();
		});
	});

	describe("createUserMessage", () => {
		it("should create a valid SDKUserMessage with session ID", () => {
			const content = "Test prompt";
			const message = createUserMessage(content, TEST_SESSION_ID);

			expect(message.type).toBe("user");
			expect(message.message.role).toBe("user");
			expect(message.message.content).toBe(content);
			expect(message.session_id).toBe(TEST_SESSION_ID);
			expect(message.parent_tool_use_id).toBeNull();
		});

		it("should use 'pending' session ID when null is provided", () => {
			const message = createUserMessage("Test", null);
			expect(message.session_id).toBe("pending");
		});
	});

	describe("createResultMessage", () => {
		const usage: Usage = {
			input_tokens: 1000,
			output_tokens: 500,
			cached_input_tokens: 200,
		};

		it("should create success result with usage statistics", () => {
			const result = createResultMessage(usage);

			expect(result.type).toBe("result");
			expect(result.subtype).toBe("success");
			expect(result.is_error).toBe(false);
			expect(result.usage.input_tokens).toBe(1000);
			expect(result.usage.output_tokens).toBe(500);
			expect(result.usage.cache_read_input_tokens).toBe(200);
			expect(result.result).toBe("Session completed successfully");
		});

		it("should extract result content from last assistant message", () => {
			const lastMessage = {
				type: "assistant" as const,
				message: {
					id: "msg-123",
					type: "message" as const,
					role: "assistant" as const,
					content: [{ type: "text" as const, text: "Final output text" }],
					model: "codex" as const,
					stop_reason: null,
					stop_sequence: null,
					usage: {
						input_tokens: 0,
						output_tokens: 0,
						cache_creation_input_tokens: 0,
						cache_read_input_tokens: 0,
						cache_creation: null,
						server_tool_use: null,
						service_tier: null,
					},
					container: null,
					context_management: null,
				},
				parent_tool_use_id: null,
				uuid: "uuid-123",
				session_id: TEST_SESSION_ID,
			};

			const result = createResultMessage(usage, lastMessage);
			expect(result.result).toBe("Final output text");
		});

		it("should handle missing cached_input_tokens", () => {
			const usageWithoutCache: Usage = {
				input_tokens: 1000,
				output_tokens: 500,
			};
			const result = createResultMessage(usageWithoutCache);
			expect(result.usage.cache_read_input_tokens).toBe(0);
		});
	});

	describe("createErrorResultMessage", () => {
		it("should create error result from string message", () => {
			const errorMsg = "Connection timeout";
			const result = createErrorResultMessage(errorMsg);

			expect(result.type).toBe("result");
			expect(result.subtype).toBe("error_during_execution");
			expect(result.is_error).toBe(true);
			expect(result.errors).toEqual([errorMsg]);
		});

		it("should create error result from error object", () => {
			const error = { message: "Rate limit exceeded" };
			const result = createErrorResultMessage(error);

			expect(result.is_error).toBe(true);
			expect(result.errors).toEqual(["Rate limit exceeded"]);
		});
	});

	describe("convertItemToMessage", () => {
		it("should convert agent_message item to text message", () => {
			const item: AgentMessageItem = {
				id: "item_1",
				type: "agent_message",
				text: "Hello, world!",
			};

			const message = convertItemToMessage(item, TEST_SESSION_ID);

			expect(message).not.toBeNull();
			expect(message?.type).toBe("assistant");
			expect(message?.session_id).toBe(TEST_SESSION_ID);
			expect(message?.message.content).toHaveLength(1);
			expect(message?.message.content[0]).toMatchObject({
				type: "text",
				text: "Hello, world!",
			});
		});

		it("should convert reasoning item to text message", () => {
			const item: ReasoningItem = {
				id: "item_2",
				type: "reasoning",
				text: "Thinking about the problem...",
			};

			const message = convertItemToMessage(item, TEST_SESSION_ID);

			expect(message).not.toBeNull();
			expect(message?.type).toBe("assistant");
			expect(message?.message.content[0]).toMatchObject({
				type: "text",
				text: "Thinking about the problem...",
			});
		});

		it("should convert command_execution item to tool_use message", () => {
			const item: CommandExecutionItem = {
				id: "item_3",
				type: "command_execution",
				command: "ls -la",
				aggregated_output: "file1.txt\nfile2.txt\n",
				exit_code: 0,
				status: "completed",
			};

			const message = convertItemToMessage(item, TEST_SESSION_ID);

			expect(message).not.toBeNull();
			expect(message?.type).toBe("assistant");
			expect(message?.message.content[0]).toMatchObject({
				type: "tool_use",
				name: "command_execution",
			});
			const toolUse = message?.message.content[0] as {
				type: string;
				id: string;
				name: string;
				input: unknown;
			};
			expect(toolUse.id).toMatch(/^toolu_/);
			expect(toolUse.input).toMatchObject({
				command: "ls -la",
				output: "file1.txt\nfile2.txt\n",
				exit_code: 0,
				status: "completed",
			});
		});

		it("should convert file_change item to tool_use message", () => {
			const item: FileChangeItem = {
				id: "item_4",
				type: "file_change",
				file_path: "src/index.ts",
				change_type: "update",
				content: "export const x = 1;",
				status: "completed",
			};

			const message = convertItemToMessage(item, TEST_SESSION_ID);

			expect(message).not.toBeNull();
			expect(message?.type).toBe("assistant");
			const toolUse = message?.message.content[0] as {
				type: string;
				name: string;
				input: unknown;
			};
			expect(toolUse.name).toBe("file_change");
			expect(toolUse.input).toMatchObject({
				file_path: "src/index.ts",
				change_type: "update",
				content: "export const x = 1;",
				status: "completed",
			});
		});

		it("should convert mcp_tool_call item to tool_use message", () => {
			const item: McpToolCallItem = {
				id: "item_5",
				type: "mcp_tool_call",
				tool_name: "linear_create_issue",
				parameters: { title: "Test Issue" },
				result: { success: true },
				status: "completed",
			};

			const message = convertItemToMessage(item, TEST_SESSION_ID);

			expect(message).not.toBeNull();
			expect(message?.type).toBe("assistant");
			const toolUse = message?.message.content[0] as {
				type: string;
				name: string;
				input: unknown;
			};
			expect(toolUse.name).toBe("linear_create_issue");
			expect(toolUse.input).toEqual({ title: "Test Issue" });
		});

		it("should convert error item to text message", () => {
			const item: ErrorItem = {
				id: "item_6",
				type: "error",
				message: "Command failed",
			};

			const message = convertItemToMessage(item, TEST_SESSION_ID);

			expect(message).not.toBeNull();
			expect(message?.type).toBe("assistant");
			expect(message?.message.content[0]).toMatchObject({
				type: "text",
				text: "Error: Command failed",
			});
		});

		it("should generate consistent tool IDs for same item ID", () => {
			const item: CommandExecutionItem = {
				id: "item_consistent",
				type: "command_execution",
				command: "echo test",
				aggregated_output: "test\n",
				exit_code: 0,
				status: "completed",
			};

			const message1 = convertItemToMessage(item, TEST_SESSION_ID);
			const message2 = convertItemToMessage(item, TEST_SESSION_ID);

			const toolUse1 = message1?.message.content[0] as { id: string };
			const toolUse2 = message2?.message.content[0] as { id: string };

			expect(toolUse1.id).toBe(toolUse2.id);
		});
	});

	describe("extractSessionId", () => {
		it("should extract thread_id from thread.started event", () => {
			const event: ThreadStartedEvent = {
				type: "thread.started",
				thread_id: "thread-xyz-789",
			};

			const sessionId = extractSessionId(event);
			expect(sessionId).toBe("thread-xyz-789");
		});

		it("should return null for non-thread.started events", () => {
			const event: TurnStartedEvent = {
				type: "turn.started",
			};

			const sessionId = extractSessionId(event);
			expect(sessionId).toBeNull();
		});
	});

	describe("codexEventToSDKMessage", () => {
		describe("thread.started event", () => {
			it("should convert to SDKSystemMessage", () => {
				const event: ThreadStartedEvent = {
					type: "thread.started",
					thread_id: TEST_THREAD_ID,
				};

				const message = codexEventToSDKMessage(event, null);

				expect(message).not.toBeNull();
				expect(message?.type).toBe("system");
				if (message?.type === "system") {
					expect(message.subtype).toBe("init");
					expect(message.session_id).toBe(TEST_THREAD_ID);
				}
			});
		});

		describe("turn.started event", () => {
			it("should return null (no SDK message needed)", () => {
				const event: TurnStartedEvent = {
					type: "turn.started",
				};

				const message = codexEventToSDKMessage(event, TEST_SESSION_ID);
				expect(message).toBeNull();
			});
		});

		describe("turn.completed event", () => {
			it("should convert to success SDKResultMessage", () => {
				const event: TurnCompletedEvent = {
					type: "turn.completed",
					usage: {
						input_tokens: 1500,
						output_tokens: 750,
						cached_input_tokens: 300,
					},
				};

				const message = codexEventToSDKMessage(event, TEST_SESSION_ID);

				expect(message).not.toBeNull();
				expect(message?.type).toBe("result");
				if (message?.type === "result") {
					expect(message.subtype).toBe("success");
					expect(message.is_error).toBe(false);
					expect(message.session_id).toBe(TEST_SESSION_ID);
					expect(message.usage.input_tokens).toBe(1500);
					expect(message.usage.output_tokens).toBe(750);
				}
			});

			it("should include last assistant message content in result", () => {
				const event: TurnCompletedEvent = {
					type: "turn.completed",
					usage: {
						input_tokens: 100,
						output_tokens: 50,
					},
				};

				const lastMessage = {
					type: "assistant" as const,
					message: {
						id: "msg-123",
						type: "message" as const,
						role: "assistant" as const,
						content: [{ type: "text" as const, text: "Task completed!" }],
						model: "codex" as const,
						stop_reason: null,
						stop_sequence: null,
						usage: {
							input_tokens: 0,
							output_tokens: 0,
							cache_creation_input_tokens: 0,
							cache_read_input_tokens: 0,
							cache_creation: null,
							server_tool_use: null,
							service_tier: null,
						},
						container: null,
						context_management: null,
					},
					parent_tool_use_id: null,
					uuid: "uuid-123",
					session_id: TEST_SESSION_ID,
				};

				const message = codexEventToSDKMessage(
					event,
					TEST_SESSION_ID,
					lastMessage,
				);

				if (message?.type === "result") {
					expect(message.result).toBe("Task completed!");
				}
			});
		});

		describe("turn.failed event", () => {
			it("should convert to error SDKResultMessage", () => {
				const event: TurnFailedEvent = {
					type: "turn.failed",
					error: {
						message: "API rate limit exceeded",
					},
				};

				const message = codexEventToSDKMessage(event, TEST_SESSION_ID);

				expect(message).not.toBeNull();
				expect(message?.type).toBe("result");
				if (message?.type === "result") {
					expect(message.subtype).toBe("error_during_execution");
					expect(message.is_error).toBe(true);
					expect(message.session_id).toBe(TEST_SESSION_ID);
					expect(message.errors).toEqual(["API rate limit exceeded"]);
				}
			});
		});

		describe("item.completed event", () => {
			it("should convert agent_message item to assistant message", () => {
				const event: ItemCompletedEvent = {
					type: "item.completed",
					item: {
						id: "item_1",
						type: "agent_message",
						text: "Response text",
					},
				};

				const message = codexEventToSDKMessage(event, TEST_SESSION_ID);

				expect(message).not.toBeNull();
				expect(message?.type).toBe("assistant");
				if (message?.type === "assistant") {
					expect(message.session_id).toBe(TEST_SESSION_ID);
					expect(message.message.content[0]).toMatchObject({
						type: "text",
						text: "Response text",
					});
				}
			});

			it("should convert command_execution item to tool_use message", () => {
				const event: ItemCompletedEvent = {
					type: "item.completed",
					item: {
						id: "item_2",
						type: "command_execution",
						command: "npm test",
						aggregated_output: "All tests passed\n",
						exit_code: 0,
						status: "completed",
					},
				};

				const message = codexEventToSDKMessage(event, TEST_SESSION_ID);

				expect(message).not.toBeNull();
				expect(message?.type).toBe("assistant");
				if (message?.type === "assistant") {
					const toolUse = message.message.content[0] as {
						type: string;
						name: string;
					};
					expect(toolUse.type).toBe("tool_use");
					expect(toolUse.name).toBe("command_execution");
				}
			});

			it("should handle null session ID by using 'pending'", () => {
				const event: ItemCompletedEvent = {
					type: "item.completed",
					item: {
						id: "item_1",
						type: "agent_message",
						text: "Test",
					},
				};

				const message = codexEventToSDKMessage(event, null);

				expect(message).not.toBeNull();
				if (message?.type === "assistant") {
					expect(message.session_id).toBe("pending");
				}
			});
		});

		describe("error event", () => {
			it("should convert to error SDKResultMessage", () => {
				const event: ThreadErrorEvent = {
					type: "error",
					message: "Thread execution failed",
				};

				const message = codexEventToSDKMessage(event, TEST_SESSION_ID);

				expect(message).not.toBeNull();
				expect(message?.type).toBe("result");
				if (message?.type === "result") {
					expect(message.subtype).toBe("error_during_execution");
					expect(message.is_error).toBe(true);
					expect(message.errors).toEqual(["Thread execution failed"]);
				}
			});
		});
	});

	describe("Real-world event sequence", () => {
		it("should process a complete thread lifecycle", () => {
			const messages: Array<
				NonNullable<ReturnType<typeof codexEventToSDKMessage>>
			> = [];

			// 1. Thread starts
			const threadStart: ThreadStartedEvent = {
				type: "thread.started",
				thread_id: "thread-real-001",
			};
			const msg1 = codexEventToSDKMessage(threadStart, null);
			if (msg1) messages.push(msg1);

			// Extract session ID
			const sessionId = extractSessionId(threadStart);
			expect(sessionId).toBe("thread-real-001");

			// 2. Turn starts (no message)
			const turnStart: TurnStartedEvent = {
				type: "turn.started",
			};
			const msg2 = codexEventToSDKMessage(turnStart, sessionId);
			expect(msg2).toBeNull();

			// 3. Reasoning item completes
			const reasoningComplete: ItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "item_0",
					type: "reasoning",
					text: "Analyzing the request...",
				},
			};
			const msg3 = codexEventToSDKMessage(reasoningComplete, sessionId);
			if (msg3) messages.push(msg3);

			// 4. Command execution completes
			const cmdComplete: ItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "item_1",
					type: "command_execution",
					command: "ls -la",
					aggregated_output: "file1.txt\n",
					exit_code: 0,
					status: "completed",
				},
			};
			const msg4 = codexEventToSDKMessage(cmdComplete, sessionId);
			if (msg4) messages.push(msg4);

			// 5. Agent message completes
			const agentComplete: ItemCompletedEvent = {
				type: "item.completed",
				item: {
					id: "item_2",
					type: "agent_message",
					text: "Listed files successfully",
				},
			};
			const msg5 = codexEventToSDKMessage(agentComplete, sessionId);
			if (msg5) messages.push(msg5);

			// Track last assistant message
			const lastAssistantMessage =
				msg5?.type === "assistant" ? msg5 : undefined;

			// 6. Turn completes
			const turnComplete: TurnCompletedEvent = {
				type: "turn.completed",
				usage: {
					input_tokens: 2000,
					output_tokens: 100,
					cached_input_tokens: 500,
				},
			};
			const msg6 = codexEventToSDKMessage(
				turnComplete,
				sessionId,
				lastAssistantMessage,
			);
			if (msg6) messages.push(msg6);

			// Verify sequence
			expect(messages).toHaveLength(5);
			expect(messages[0].type).toBe("system");
			expect(messages[1].type).toBe("assistant"); // reasoning
			expect(messages[2].type).toBe("assistant"); // command
			expect(messages[3].type).toBe("assistant"); // agent message
			expect(messages[4].type).toBe("result"); // turn complete

			// Verify result includes final message
			if (messages[4].type === "result") {
				expect(messages[4].result).toBe("Listed files successfully");
			}
		});
	});
});
