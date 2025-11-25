import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
	// Parsing utilities
	extractToolNameFromId,
	// Event schemas
	GeminiErrorEventSchema,
	GeminiInitEventSchema,
	GeminiMessageEventSchema,
	GeminiResultEventSchema,
	GeminiStreamEventSchema,
	GeminiToolResultEventSchema,
	GeminiToolUseEventSchema,
	// Event type guards
	isGeminiErrorEvent,
	isGeminiInitEvent,
	isGeminiMessageEvent,
	isGeminiResultEvent,
	isGeminiToolResultEvent,
	isGeminiToolUseEvent,
	// Tool result type guards
	isListDirectoryToolResult,
	// Tool use type guards
	isReadFileTool,
	isReadFileToolResult,
	isWriteFileTool,
	isWriteFileToolResult,
	// Tool parameter schemas
	ListDirectoryParametersSchema,
	// Typed tool use event schemas
	ListDirectoryToolUseEventSchema,
	parseAsReadFileTool,
	parseAsWriteFileTool,
	parseGeminiStreamEvent,
	ReadFileParametersSchema,
	ReadFileToolUseEventSchema,
	ReplaceParametersSchema,
	ReplaceToolUseEventSchema,
	RunShellCommandParametersSchema,
	RunShellCommandToolUseEventSchema,
	SearchFileContentParametersSchema,
	SearchFileContentToolUseEventSchema,
	safeParseGeminiStreamEvent,
	WriteFileParametersSchema,
	WriteFileToolUseEventSchema,
	WriteTodosParametersSchema,
	WriteTodosToolUseEventSchema,
} from "../src/schemas.js";

describe("Gemini Stream Event Schemas", () => {
	describe("GeminiInitEventSchema", () => {
		it("should validate a valid init event", () => {
			const event = {
				type: "init",
				timestamp: "2025-11-25T03:27:51.000Z",
				session_id: "c25acda3-b51f-41f9-9bc5-954c70c17bf4",
				model: "auto",
			};

			const result = GeminiInitEventSchema.parse(event);
			expect(result.type).toBe("init");
			expect(result.session_id).toBe("c25acda3-b51f-41f9-9bc5-954c70c17bf4");
			expect(result.model).toBe("auto");
		});

		it("should validate with different model names", () => {
			const models = [
				"auto",
				"gemini-2.5-pro",
				"gemini-2.5-flash",
				"gemini-3-pro-preview",
			];

			for (const model of models) {
				const event = {
					type: "init",
					timestamp: "2025-11-25T03:27:51.000Z",
					session_id: "c25acda3-b51f-41f9-9bc5-954c70c17bf4",
					model,
				};
				const result = GeminiInitEventSchema.parse(event);
				expect(result.model).toBe(model);
			}
		});

		it("should reject invalid session_id (not UUID)", () => {
			const event = {
				type: "init",
				timestamp: "2025-11-25T03:27:51.000Z",
				session_id: "invalid-session-id",
				model: "auto",
			};

			expect(() => GeminiInitEventSchema.parse(event)).toThrow(ZodError);
		});

		it("should reject missing required fields", () => {
			const event = {
				type: "init",
				timestamp: "2025-11-25T03:27:51.000Z",
			};

			expect(() => GeminiInitEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("GeminiMessageEventSchema", () => {
		it("should validate a user message", () => {
			const event = {
				type: "message",
				timestamp: "2025-11-25T03:27:51.001Z",
				role: "user",
				content: "What is 2 + 2?",
			};

			const result = GeminiMessageEventSchema.parse(event);
			expect(result.type).toBe("message");
			expect(result.role).toBe("user");
			expect(result.content).toBe("What is 2 + 2?");
			expect(result.delta).toBeUndefined();
		});

		it("should validate an assistant message with delta", () => {
			const event = {
				type: "message",
				timestamp: "2025-11-25T03:28:05.256Z",
				role: "assistant",
				content: "2 + 2 = 4.",
				delta: true,
			};

			const result = GeminiMessageEventSchema.parse(event);
			expect(result.role).toBe("assistant");
			expect(result.delta).toBe(true);
		});

		it("should validate assistant message without delta", () => {
			const event = {
				type: "message",
				timestamp: "2025-11-25T03:28:05.256Z",
				role: "assistant",
				content: "Full response",
				delta: false,
			};

			const result = GeminiMessageEventSchema.parse(event);
			expect(result.delta).toBe(false);
		});

		it("should reject invalid role", () => {
			const event = {
				type: "message",
				timestamp: "2025-11-25T03:27:51.001Z",
				role: "system",
				content: "Invalid role",
			};

			expect(() => GeminiMessageEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("GeminiToolUseEventSchema", () => {
		it("should validate a tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-25T03:27:54.691Z",
				tool_name: "list_directory",
				tool_id: "list_directory-1764041274691-eabd3cbcdee66",
				parameters: { dir_path: "." },
			};

			const result = GeminiToolUseEventSchema.parse(event);
			expect(result.type).toBe("tool_use");
			expect(result.tool_name).toBe("list_directory");
			expect(result.tool_id).toBe("list_directory-1764041274691-eabd3cbcdee66");
			expect(result.parameters).toEqual({ dir_path: "." });
		});

		it("should validate read_file tool", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-25T03:27:54.691Z",
				tool_name: "read_file",
				tool_id: "read_file-1764041274691-e1084c2fd73dc",
				parameters: { file_path: "test.ts" },
			};

			const result = GeminiToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("read_file");
			expect(result.parameters).toEqual({ file_path: "test.ts" });
		});

		it("should validate tool with complex parameters", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-25T03:27:54.691Z",
				tool_name: "write_file",
				tool_id: "write_file-123456-abc",
				parameters: {
					file_path: "/path/to/file.ts",
					content: "const x = 1;\n",
					overwrite: true,
				},
			};

			const result = GeminiToolUseEventSchema.parse(event);
			expect(result.parameters).toEqual({
				file_path: "/path/to/file.ts",
				content: "const x = 1;\n",
				overwrite: true,
			});
		});

		it("should validate tool with empty parameters", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-25T03:27:54.691Z",
				tool_name: "some_tool",
				tool_id: "some_tool-123-abc",
				parameters: {},
			};

			const result = GeminiToolUseEventSchema.parse(event);
			expect(result.parameters).toEqual({});
		});
	});

	describe("GeminiToolResultEventSchema", () => {
		it("should validate a success result", () => {
			const event = {
				type: "tool_result",
				timestamp: "2025-11-25T03:27:54.724Z",
				tool_id: "list_directory-1764041274691-eabd3cbcdee66",
				status: "success",
				output: "Listed 2 item(s).",
			};

			const result = GeminiToolResultEventSchema.parse(event);
			expect(result.type).toBe("tool_result");
			expect(result.status).toBe("success");
			expect(result.output).toBe("Listed 2 item(s).");
			expect(result.error).toBeUndefined();
		});

		it("should validate a success result with empty output", () => {
			const event = {
				type: "tool_result",
				timestamp: "2025-11-25T03:27:54.727Z",
				tool_id: "read_file-1764041274691-e1084c2fd73dc",
				status: "success",
				output: "",
			};

			const result = GeminiToolResultEventSchema.parse(event);
			expect(result.status).toBe("success");
			expect(result.output).toBe("");
		});

		it("should validate an error result with error details", () => {
			const event = {
				type: "tool_result",
				timestamp: "2025-11-25T03:28:13.200Z",
				tool_id: "read_file-1764041293170-fd5f6da4bd4a1",
				status: "error",
				output: "File path must be within one of the workspace directories",
				error: {
					type: "invalid_tool_params",
					message: "File path must be within one of the workspace directories",
				},
			};

			const result = GeminiToolResultEventSchema.parse(event);
			expect(result.status).toBe("error");
			expect(result.error?.type).toBe("invalid_tool_params");
			expect(result.error?.message).toContain("workspace directories");
		});

		it("should validate error with code", () => {
			const event = {
				type: "tool_result",
				timestamp: "2025-11-25T03:28:13.200Z",
				tool_id: "some_tool-123-abc",
				status: "error",
				error: {
					type: "permission_denied",
					message: "Access denied",
					code: "403",
				},
			};

			const result = GeminiToolResultEventSchema.parse(event);
			expect(result.error?.code).toBe("403");
		});

		it("should reject invalid status", () => {
			const event = {
				type: "tool_result",
				timestamp: "2025-11-25T03:27:54.724Z",
				tool_id: "some_tool-123-abc",
				status: "pending",
			};

			expect(() => GeminiToolResultEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("GeminiErrorEventSchema", () => {
		it("should validate an error event", () => {
			const event = {
				type: "error",
				timestamp: "2025-11-25T03:28:00.000Z",
				message: "Rate limit exceeded",
				code: 429,
			};

			const result = GeminiErrorEventSchema.parse(event);
			expect(result.type).toBe("error");
			expect(result.message).toBe("Rate limit exceeded");
			expect(result.code).toBe(429);
		});

		it("should validate error without code", () => {
			const event = {
				type: "error",
				timestamp: "2025-11-25T03:28:00.000Z",
				message: "Unknown error occurred",
			};

			const result = GeminiErrorEventSchema.parse(event);
			expect(result.code).toBeUndefined();
		});
	});

	describe("GeminiResultEventSchema", () => {
		it("should validate a success result with stats", () => {
			const event = {
				type: "result",
				timestamp: "2025-11-25T03:28:05.262Z",
				status: "success",
				stats: {
					total_tokens: 8064,
					input_tokens: 7854,
					output_tokens: 58,
					duration_ms: 2534,
					tool_calls: 0,
				},
			};

			const result = GeminiResultEventSchema.parse(event);
			expect(result.type).toBe("result");
			expect(result.status).toBe("success");
			expect(result.stats?.total_tokens).toBe(8064);
			expect(result.stats?.tool_calls).toBe(0);
			expect(result.error).toBeUndefined();
		});

		it("should validate an error result with error details", () => {
			const event = {
				type: "result",
				timestamp: "2025-11-25T03:27:54.727Z",
				status: "error",
				error: {
					type: "FatalTurnLimitedError",
					message: "Reached max session turns for this session.",
				},
				stats: {
					total_tokens: 8255,
					input_tokens: 7862,
					output_tokens: 90,
					duration_ms: 0,
					tool_calls: 2,
				},
			};

			const result = GeminiResultEventSchema.parse(event);
			expect(result.status).toBe("error");
			expect(result.error?.type).toBe("FatalTurnLimitedError");
			expect(result.stats?.tool_calls).toBe(2);
		});

		it("should validate result without stats", () => {
			const event = {
				type: "result",
				timestamp: "2025-11-25T03:28:05.262Z",
				status: "success",
			};

			const result = GeminiResultEventSchema.parse(event);
			expect(result.stats).toBeUndefined();
		});

		it("should validate partial stats", () => {
			const event = {
				type: "result",
				timestamp: "2025-11-25T03:28:05.262Z",
				status: "success",
				stats: {
					duration_ms: 1000,
				},
			};

			const result = GeminiResultEventSchema.parse(event);
			expect(result.stats?.duration_ms).toBe(1000);
			expect(result.stats?.total_tokens).toBeUndefined();
		});
	});

	describe("GeminiStreamEventSchema (discriminated union)", () => {
		it("should parse init event", () => {
			const event = {
				type: "init",
				timestamp: "2025-11-25T03:27:51.000Z",
				session_id: "c25acda3-b51f-41f9-9bc5-954c70c17bf4",
				model: "auto",
			};

			const result = GeminiStreamEventSchema.parse(event);
			expect(result.type).toBe("init");
		});

		it("should parse message event", () => {
			const event = {
				type: "message",
				timestamp: "2025-11-25T03:27:51.001Z",
				role: "user",
				content: "Hello",
			};

			const result = GeminiStreamEventSchema.parse(event);
			expect(result.type).toBe("message");
		});

		it("should parse tool_use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-25T03:27:54.691Z",
				tool_name: "read_file",
				tool_id: "read_file-123-abc",
				parameters: {},
			};

			const result = GeminiStreamEventSchema.parse(event);
			expect(result.type).toBe("tool_use");
		});

		it("should parse tool_result event", () => {
			const event = {
				type: "tool_result",
				timestamp: "2025-11-25T03:27:54.724Z",
				tool_id: "read_file-123-abc",
				status: "success",
			};

			const result = GeminiStreamEventSchema.parse(event);
			expect(result.type).toBe("tool_result");
		});

		it("should parse error event", () => {
			const event = {
				type: "error",
				timestamp: "2025-11-25T03:28:00.000Z",
				message: "Error",
			};

			const result = GeminiStreamEventSchema.parse(event);
			expect(result.type).toBe("error");
		});

		it("should parse result event", () => {
			const event = {
				type: "result",
				timestamp: "2025-11-25T03:28:05.262Z",
				status: "success",
			};

			const result = GeminiStreamEventSchema.parse(event);
			expect(result.type).toBe("result");
		});

		it("should reject unknown event type", () => {
			const event = {
				type: "unknown",
				timestamp: "2025-11-25T03:28:00.000Z",
			};

			expect(() => GeminiStreamEventSchema.parse(event)).toThrow(ZodError);
		});
	});

	describe("parseGeminiStreamEvent", () => {
		it("should parse valid JSON string", () => {
			const json =
				'{"type":"init","timestamp":"2025-11-25T03:27:51.000Z","session_id":"c25acda3-b51f-41f9-9bc5-954c70c17bf4","model":"auto"}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("init");
		});

		it("should throw on invalid JSON", () => {
			const json = "not valid json";
			expect(() => parseGeminiStreamEvent(json)).toThrow();
		});

		it("should throw on invalid event structure", () => {
			const json = '{"type":"unknown"}';
			expect(() => parseGeminiStreamEvent(json)).toThrow(ZodError);
		});
	});

	describe("safeParseGeminiStreamEvent", () => {
		it("should return parsed event on valid input", () => {
			const json =
				'{"type":"init","timestamp":"2025-11-25T03:27:51.000Z","session_id":"c25acda3-b51f-41f9-9bc5-954c70c17bf4","model":"auto"}';
			const result = safeParseGeminiStreamEvent(json);
			expect(result).not.toBeNull();
			expect(result?.type).toBe("init");
		});

		it("should return null on invalid JSON", () => {
			const json = "not valid json";
			const result = safeParseGeminiStreamEvent(json);
			expect(result).toBeNull();
		});

		it("should return null on invalid event structure", () => {
			const json = '{"type":"unknown"}';
			const result = safeParseGeminiStreamEvent(json);
			expect(result).toBeNull();
		});

		it("should return null on empty string", () => {
			const result = safeParseGeminiStreamEvent("");
			expect(result).toBeNull();
		});
	});

	describe("Type guards", () => {
		const initEvent = {
			type: "init" as const,
			timestamp: "2025-11-25T03:27:51.000Z",
			session_id: "c25acda3-b51f-41f9-9bc5-954c70c17bf4",
			model: "auto",
		};

		const messageEvent = {
			type: "message" as const,
			timestamp: "2025-11-25T03:27:51.001Z",
			role: "user" as const,
			content: "Hello",
		};

		const toolUseEvent = {
			type: "tool_use" as const,
			timestamp: "2025-11-25T03:27:54.691Z",
			tool_name: "read_file",
			tool_id: "read_file-123-abc",
			parameters: {},
		};

		const toolResultEvent = {
			type: "tool_result" as const,
			timestamp: "2025-11-25T03:27:54.724Z",
			tool_id: "read_file-123-abc",
			status: "success" as const,
		};

		const errorEvent = {
			type: "error" as const,
			timestamp: "2025-11-25T03:28:00.000Z",
			message: "Error",
		};

		const resultEvent = {
			type: "result" as const,
			timestamp: "2025-11-25T03:28:05.262Z",
			status: "success" as const,
		};

		it("isGeminiInitEvent", () => {
			expect(isGeminiInitEvent(initEvent)).toBe(true);
			expect(isGeminiInitEvent(messageEvent)).toBe(false);
		});

		it("isGeminiMessageEvent", () => {
			expect(isGeminiMessageEvent(messageEvent)).toBe(true);
			expect(isGeminiMessageEvent(initEvent)).toBe(false);
		});

		it("isGeminiToolUseEvent", () => {
			expect(isGeminiToolUseEvent(toolUseEvent)).toBe(true);
			expect(isGeminiToolUseEvent(messageEvent)).toBe(false);
		});

		it("isGeminiToolResultEvent", () => {
			expect(isGeminiToolResultEvent(toolResultEvent)).toBe(true);
			expect(isGeminiToolResultEvent(toolUseEvent)).toBe(false);
		});

		it("isGeminiErrorEvent", () => {
			expect(isGeminiErrorEvent(errorEvent)).toBe(true);
			expect(isGeminiErrorEvent(resultEvent)).toBe(false);
		});

		it("isGeminiResultEvent", () => {
			expect(isGeminiResultEvent(resultEvent)).toBe(true);
			expect(isGeminiResultEvent(errorEvent)).toBe(false);
		});
	});

	describe("Tool Parameter Schemas", () => {
		describe("ReadFileParametersSchema", () => {
			it("should validate read_file parameters", () => {
				const params = { file_path: "test.ts" };
				const result = ReadFileParametersSchema.parse(params);
				expect(result.file_path).toBe("test.ts");
			});

			it("should reject missing file_path", () => {
				expect(() => ReadFileParametersSchema.parse({})).toThrow(ZodError);
			});
		});

		describe("WriteFileParametersSchema", () => {
			it("should validate write_file parameters", () => {
				const params = {
					file_path: "test.ts",
					content: "console.log('hello');",
				};
				const result = WriteFileParametersSchema.parse(params);
				expect(result.file_path).toBe("test.ts");
				expect(result.content).toBe("console.log('hello');");
			});

			it("should reject missing content", () => {
				expect(() =>
					WriteFileParametersSchema.parse({ file_path: "test.ts" }),
				).toThrow(ZodError);
			});
		});

		describe("ListDirectoryParametersSchema", () => {
			it("should validate list_directory parameters", () => {
				const params = { dir_path: "." };
				const result = ListDirectoryParametersSchema.parse(params);
				expect(result.dir_path).toBe(".");
			});
		});

		describe("SearchFileContentParametersSchema", () => {
			it("should validate search_file_content parameters", () => {
				const params = { pattern: "(TODO|FIXME)" };
				const result = SearchFileContentParametersSchema.parse(params);
				expect(result.pattern).toBe("(TODO|FIXME)");
			});
		});

		describe("RunShellCommandParametersSchema", () => {
			it("should validate run_shell_command parameters", () => {
				const params = { command: "git status" };
				const result = RunShellCommandParametersSchema.parse(params);
				expect(result.command).toBe("git status");
			});
		});

		describe("WriteTodosParametersSchema", () => {
			it("should validate write_todos parameters with status", () => {
				const params = {
					todos: [
						{ description: "Task 1", status: "in_progress" },
						{ description: "Task 2", status: "pending" },
					],
				};
				const result = WriteTodosParametersSchema.parse(params);
				expect(result.todos).toHaveLength(2);
				expect(result.todos[0].status).toBe("in_progress");
			});

			it("should validate write_todos parameters without status", () => {
				const params = { todos: [{ description: "Task 1" }] };
				const result = WriteTodosParametersSchema.parse(params);
				expect(result.todos[0].status).toBeUndefined();
			});

			it("should reject invalid status", () => {
				expect(() =>
					WriteTodosParametersSchema.parse({
						todos: [{ description: "Task", status: "invalid" }],
					}),
				).toThrow(ZodError);
			});
		});

		describe("ReplaceParametersSchema", () => {
			it("should validate instruction-based replace parameters", () => {
				const params = {
					instruction: "Add a comment",
					file_path: "test.ts",
				};
				const result = ReplaceParametersSchema.parse(params);
				expect(result.instruction).toBe("Add a comment");
			});

			it("should validate literal replace parameters", () => {
				const params = {
					file_path: "test.ts",
					old_string: "foo",
					new_string: "bar",
				};
				const result = ReplaceParametersSchema.parse(params);
				expect(result.old_string).toBe("foo");
				expect(result.new_string).toBe("bar");
			});
		});
	});

	describe("Typed Tool Use Events", () => {
		it("should parse read_file tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T20:12:40.012Z",
				tool_name: "read_file",
				tool_id: "read_file-1764015160012-767cb93e436f3",
				parameters: { file_path: "package.json" },
			};
			const result = ReadFileToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("read_file");
			expect(result.parameters.file_path).toBe("package.json");
		});

		it("should parse write_file tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T20:13:54.674Z",
				tool_name: "write_file",
				tool_id: "write_file-1764015234674-0581b9629931a",
				parameters: {
					file_path: "tests/test_snake.py",
					content: "import unittest",
				},
			};
			const result = WriteFileToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("write_file");
			expect(result.parameters.content).toBe("import unittest");
		});

		it("should parse list_directory tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T20:12:53.255Z",
				tool_name: "list_directory",
				tool_id: "list_directory-1764015173255-396a90dd79fa6",
				parameters: { dir_path: "." },
			};
			const result = ListDirectoryToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("list_directory");
		});

		it("should parse search_file_content tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T20:12:40.072Z",
				tool_name: "search_file_content",
				tool_id: "search_file_content-1764015160072-c1e0f530591f6",
				parameters: { pattern: "(TODO|FIXME)" },
			};
			const result = SearchFileContentToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("search_file_content");
		});

		it("should parse run_shell_command tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T20:13:14.969Z",
				tool_name: "run_shell_command",
				tool_id: "run_shell_command-1764015194969-e79bcda1d6e9",
				parameters: { command: "/usr/bin/python3 -m pytest" },
			};
			const result = RunShellCommandToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("run_shell_command");
		});

		it("should parse write_todos tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T19:29:56.037Z",
				tool_name: "write_todos",
				tool_id: "write_todos-1764012596037-37082c9903ce7",
				parameters: {
					todos: [{ description: "Explore codebase", status: "in_progress" }],
				},
			};
			const result = WriteTodosToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("write_todos");
		});

		it("should parse replace tool use event", () => {
			const event = {
				type: "tool_use",
				timestamp: "2025-11-24T19:31:12.140Z",
				tool_name: "replace",
				tool_id: "replace-1764012672140-c56f46960e14a",
				parameters: {
					instruction: "Modify get_other_snake_heads to return a list",
					file_path: "app/mcts.py",
				},
			};
			const result = ReplaceToolUseEventSchema.parse(event);
			expect(result.tool_name).toBe("replace");
		});
	});

	describe("Tool Use Type Guards", () => {
		const readFileEvent = {
			type: "tool_use" as const,
			timestamp: "2025-11-24T20:12:40.012Z",
			tool_name: "read_file",
			tool_id: "read_file-1764015160012-767cb93e436f3",
			parameters: { file_path: "package.json" },
		};

		const writeFileEvent = {
			type: "tool_use" as const,
			timestamp: "2025-11-24T20:13:54.674Z",
			tool_name: "write_file",
			tool_id: "write_file-1764015234674-0581b9629931a",
			parameters: { file_path: "test.ts", content: "content" },
		};

		it("isReadFileTool", () => {
			expect(isReadFileTool(readFileEvent)).toBe(true);
			expect(isReadFileTool(writeFileEvent)).toBe(false);
		});

		it("isWriteFileTool", () => {
			expect(isWriteFileTool(writeFileEvent)).toBe(true);
			expect(isWriteFileTool(readFileEvent)).toBe(false);
		});

		it("should reject invalid parameters", () => {
			const invalidReadFile = {
				type: "tool_use" as const,
				timestamp: "2025-11-24T20:12:40.012Z",
				tool_name: "read_file",
				tool_id: "read_file-123-abc",
				parameters: { wrong_field: "test" },
			};
			expect(isReadFileTool(invalidReadFile)).toBe(false);
		});
	});

	describe("Tool Result Type Guards", () => {
		const readFileResult = {
			type: "tool_result" as const,
			timestamp: "2025-11-24T20:12:40.148Z",
			tool_id: "read_file-1764015160012-767cb93e436f3",
			status: "success" as const,
			output: "",
		};

		const writeFileResult = {
			type: "tool_result" as const,
			timestamp: "2025-11-24T20:13:55.193Z",
			tool_id: "write_file-1764015234674-0581b9629931a",
			status: "success" as const,
		};

		const listDirResult = {
			type: "tool_result" as const,
			timestamp: "2025-11-24T20:12:53.273Z",
			tool_id: "list_directory-1764015173255-396a90dd79fa6",
			status: "success" as const,
			output: "Listed 4 item(s). (1 ignored)",
		};

		it("isReadFileToolResult", () => {
			expect(isReadFileToolResult(readFileResult)).toBe(true);
			expect(isReadFileToolResult(writeFileResult)).toBe(false);
		});

		it("isWriteFileToolResult", () => {
			expect(isWriteFileToolResult(writeFileResult)).toBe(true);
			expect(isWriteFileToolResult(readFileResult)).toBe(false);
		});

		it("isListDirectoryToolResult", () => {
			expect(isListDirectoryToolResult(listDirResult)).toBe(true);
			expect(isListDirectoryToolResult(readFileResult)).toBe(false);
		});
	});

	describe("extractToolNameFromId", () => {
		it("should extract read_file from tool_id", () => {
			expect(
				extractToolNameFromId("read_file-1764015160012-767cb93e436f3"),
			).toBe("read_file");
		});

		it("should extract write_file from tool_id", () => {
			expect(
				extractToolNameFromId("write_file-1764015234674-0581b9629931a"),
			).toBe("write_file");
		});

		it("should extract list_directory from tool_id", () => {
			expect(
				extractToolNameFromId("list_directory-1764015173255-396a90dd79fa6"),
			).toBe("list_directory");
		});

		it("should extract search_file_content from tool_id", () => {
			expect(
				extractToolNameFromId(
					"search_file_content-1764015160072-c1e0f530591f6",
				),
			).toBe("search_file_content");
		});

		it("should extract run_shell_command from tool_id", () => {
			expect(
				extractToolNameFromId("run_shell_command-1764015194969-e79bcda1d6e9"),
			).toBe("run_shell_command");
		});

		it("should return null for invalid format", () => {
			expect(extractToolNameFromId("invalid")).toBeNull();
			expect(extractToolNameFromId("only-one")).toBeNull();
		});
	});

	describe("parseAs* functions", () => {
		it("parseAsReadFileTool should parse valid event", () => {
			const event = {
				type: "tool_use" as const,
				timestamp: "2025-11-24T20:12:40.012Z",
				tool_name: "read_file",
				tool_id: "read_file-123-abc",
				parameters: { file_path: "test.ts" },
			};
			const result = parseAsReadFileTool(event);
			expect(result).not.toBeNull();
			expect(result?.parameters.file_path).toBe("test.ts");
		});

		it("parseAsReadFileTool should return null for wrong tool", () => {
			const event = {
				type: "tool_use" as const,
				timestamp: "2025-11-24T20:12:40.012Z",
				tool_name: "write_file",
				tool_id: "write_file-123-abc",
				parameters: { file_path: "test.ts", content: "x" },
			};
			const result = parseAsReadFileTool(event);
			expect(result).toBeNull();
		});

		it("parseAsWriteFileTool should parse valid event", () => {
			const event = {
				type: "tool_use" as const,
				timestamp: "2025-11-24T20:13:54.674Z",
				tool_name: "write_file",
				tool_id: "write_file-123-abc",
				parameters: { file_path: "test.ts", content: "console.log('hello');" },
			};
			const result = parseAsWriteFileTool(event);
			expect(result).not.toBeNull();
			expect(result?.parameters.content).toBe("console.log('hello');");
		});
	});

	describe("Real-world examples from Gemini CLI", () => {
		it("should parse real init event", () => {
			const json =
				'{"type":"init","timestamp":"2025-11-25T03:27:51.000Z","session_id":"c25acda3-b51f-41f9-9bc5-954c70c17bf4","model":"auto"}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("init");
		});

		it("should parse real user message", () => {
			const json =
				'{"type":"message","timestamp":"2025-11-25T03:27:51.001Z","role":"user","content":"List the files in the current directory and read test.ts"}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("message");
		});

		it("should parse real tool_use for list_directory", () => {
			const json =
				'{"type":"tool_use","timestamp":"2025-11-25T03:27:54.691Z","tool_name":"list_directory","tool_id":"list_directory-1764041274691-eabd3cbcdee66","parameters":{"dir_path":"."}}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("tool_use");
		});

		it("should parse real tool_result success", () => {
			const json =
				'{"type":"tool_result","timestamp":"2025-11-25T03:27:54.724Z","tool_id":"list_directory-1764041274691-eabd3cbcdee66","status":"success","output":"Listed 2 item(s)."}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("tool_result");
		});

		it("should parse real assistant message with delta", () => {
			const json =
				'{"type":"message","timestamp":"2025-11-25T03:28:05.256Z","role":"assistant","content":"2 + 2 = 4.","delta":true}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("message");
			if (result.type === "message") {
				expect(result.delta).toBe(true);
			}
		});

		it("should parse real success result", () => {
			const json =
				'{"type":"result","timestamp":"2025-11-25T03:28:05.262Z","status":"success","stats":{"total_tokens":8064,"input_tokens":7854,"output_tokens":58,"duration_ms":2534,"tool_calls":0}}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("result");
		});

		it("should parse real error result with FatalTurnLimitedError", () => {
			const json =
				'{"type":"result","timestamp":"2025-11-25T03:27:54.727Z","status":"error","error":{"type":"FatalTurnLimitedError","message":"Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json."},"stats":{"total_tokens":8255,"input_tokens":7862,"output_tokens":90,"duration_ms":0,"tool_calls":2}}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("result");
			if (result.type === "result") {
				expect(result.status).toBe("error");
				expect(result.error?.type).toBe("FatalTurnLimitedError");
			}
		});

		it("should parse real tool_result error with invalid_tool_params", () => {
			const json =
				'{"type":"tool_result","timestamp":"2025-11-25T03:28:13.200Z","tool_id":"read_file-1764041293170-fd5f6da4bd4a1","status":"error","output":"File path must be within one of the workspace directories: /private/tmp/gemini-test","error":{"type":"invalid_tool_params","message":"File path must be within one of the workspace directories: /private/tmp/gemini-test"}}';
			const result = parseGeminiStreamEvent(json);
			expect(result.type).toBe("tool_result");
			if (result.type === "tool_result") {
				expect(result.status).toBe("error");
				expect(result.error?.type).toBe("invalid_tool_params");
			}
		});
	});
});
