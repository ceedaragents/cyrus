import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
	GeminiErrorEventSchema,
	GeminiInitEventSchema,
	GeminiMessageEventSchema,
	GeminiResultEventSchema,
	GeminiStreamEventSchema,
	GeminiToolResultEventSchema,
	GeminiToolUseEventSchema,
	isGeminiErrorEvent,
	isGeminiInitEvent,
	isGeminiMessageEvent,
	isGeminiResultEvent,
	isGeminiToolResultEvent,
	isGeminiToolUseEvent,
	parseGeminiStreamEvent,
	safeParseGeminiStreamEvent,
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
