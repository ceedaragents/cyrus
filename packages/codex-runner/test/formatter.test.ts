/**
 * Tests for CodexMessageFormatter
 *
 * Verifies that the formatter correctly transforms Codex tool outputs
 * into human-readable markdown for Linear comments.
 */

import { describe, expect, it } from "vitest";
import { CodexMessageFormatter } from "../src/formatter.js";

describe("CodexMessageFormatter", () => {
	const formatter = new CodexMessageFormatter();

	describe("formatTodoWriteParameter", () => {
		it("should format todos with status emojis", () => {
			const input = JSON.stringify({
				todos: [
					{ content: "Task 1", status: "completed" },
					{ content: "Task 2", status: "in_progress" },
					{ content: "Task 3", status: "pending" },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("✅ Task 1");
			expect(result).toContain("🔄 Task 2");
			expect(result).toContain("⏳ Task 3");
		});

		it("should handle empty todos array", () => {
			const input = JSON.stringify({ todos: [] });
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe("\n");
		});

		it("should return original string on parse error", () => {
			const input = "invalid json";
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe(input);
		});

		it("should handle missing todos field", () => {
			const input = JSON.stringify({ other: "data" });
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe(input);
		});
	});

	describe("formatToolParameter", () => {
		it("should format command_execution tool input", () => {
			const result = formatter.formatToolParameter("command_execution", {
				command: "npm test",
				output: "Tests passed",
				exit_code: 0,
			});

			expect(result).toBe("npm test");
		});

		it("should format file_change tool input with change type", () => {
			const result = formatter.formatToolParameter("file_change", {
				file_path: "/path/to/file.ts",
				change_type: "update",
				content: "console.log('hello')",
			});

			expect(result).toBe("/path/to/file.ts (update)");
		});

		it("should format file_change tool input without change type", () => {
			const result = formatter.formatToolParameter("file_change", {
				file_path: "/path/to/file.ts",
				content: "console.log('hello')",
			});

			expect(result).toBe("/path/to/file.ts");
		});

		it("should truncate reasoning text", () => {
			const longText = "a".repeat(150);
			const result = formatter.formatToolParameter("reasoning", {
				text: longText,
			});

			expect(result).toHaveLength(100);
			expect(result).toContain("...");
		});

		it("should format MCP tool with meaningful fields", () => {
			const result = formatter.formatToolParameter(
				"mcp__linear__create_issue",
				{
					title: "New issue",
					description: "Issue description",
					team: "CYPACK",
				},
			);

			expect(result).toContain("title: New issue");
		});

		it("should truncate MCP tool field values", () => {
			const longTitle = "a".repeat(100);
			const result = formatter.formatToolParameter(
				"mcp__linear__create_issue",
				{
					title: longTitle,
				},
			);

			expect(result).toContain("...");
			expect(result.length).toBeLessThan(100);
		});

		it("should return JSON string for unknown tools", () => {
			const result = formatter.formatToolParameter("unknown_tool", {
				foo: "bar",
			});

			expect(result).toContain("foo");
			expect(result).toContain("bar");
		});

		it("should return string input as-is", () => {
			const result = formatter.formatToolParameter(
				"some_tool",
				"already a string" as any,
			);
			expect(result).toBe("already a string");
		});

		it("should truncate very long JSON strings", () => {
			const largeObject = { data: "x".repeat(500) };
			const result = formatter.formatToolParameter("unknown_tool", largeObject);

			expect(result.length).toBeLessThanOrEqual(203); // 200 + "..."
		});
	});

	describe("formatToolActionName", () => {
		it("should format command_execution with command", () => {
			const result = formatter.formatToolActionName(
				"command_execution",
				{ command: "npm install" },
				false,
			);

			expect(result).toBe("$ npm install");
		});

		it("should truncate long commands", () => {
			const longCommand = `command ${"arg ".repeat(50)}`;
			const result = formatter.formatToolActionName(
				"command_execution",
				{ command: longCommand },
				false,
			);

			expect(result).toContain("$ ");
			expect(result).toContain("...");
			expect(result.length).toBeLessThanOrEqual(63); // "$ " + 60 + "..."
		});

		it("should format file_change with file name", () => {
			const result = formatter.formatToolActionName(
				"file_change",
				{
					file_path: "/long/path/to/file.ts",
					change_type: "update",
				},
				false,
			);

			expect(result).toBe("update file.ts");
		});

		it("should format reasoning tool", () => {
			const result = formatter.formatToolActionName(
				"reasoning",
				{ text: "thinking..." },
				false,
			);

			expect(result).toBe("💭 Thinking");
		});

		it("should format MCP tools as server:tool", () => {
			const result = formatter.formatToolActionName(
				"mcp__linear__create_issue",
				{ title: "Test" },
				false,
			);

			expect(result).toBe("linear:create_issue");
		});

		it("should format MCP tools with multiple underscores", () => {
			const result = formatter.formatToolActionName(
				"mcp__server__tool_with_underscores",
				{},
				false,
			);

			expect(result).toBe("server:tool_with_underscores");
		});

		it("should add error indicator for failed tools", () => {
			const result = formatter.formatToolActionName(
				"command_execution",
				{ command: "test" },
				true,
			);

			expect(result).toContain("❌");
			expect(result).toContain("failed");
		});

		it("should return tool name as fallback", () => {
			const result = formatter.formatToolActionName("unknown_tool", {}, false);
			expect(result).toBe("unknown_tool");
		});
	});

	describe("formatToolResult", () => {
		it("should format command_execution result with command and output", () => {
			const result = formatter.formatToolResult(
				"command_execution",
				{
					command: "echo hello",
					output: "hello",
					exit_code: 0,
				},
				"hello",
				false,
			);

			expect(result).toContain("```bash");
			expect(result).toContain("$ echo hello");
			expect(result).toContain("hello");
		});

		it("should show exit code for non-zero exits", () => {
			const result = formatter.formatToolResult(
				"command_execution",
				{
					command: "false",
					output: "",
					exit_code: 1,
				},
				"",
				false,
			);

			expect(result).toContain("**Exit code:** 1");
		});

		it("should show 'No output' for empty command output", () => {
			const result = formatter.formatToolResult(
				"command_execution",
				{
					command: "true",
					output: "",
					exit_code: 0,
				},
				"",
				false,
			);

			expect(result).toContain("_No output_");
		});

		it("should format file_change result with language detection", () => {
			const result = formatter.formatToolResult(
				"file_change",
				{
					file_path: "src/test.ts",
					change_type: "create",
					content: 'console.log("test");',
				},
				"",
				false,
			);

			expect(result).toContain("**File:** `src/test.ts`");
			expect(result).toContain("**Change type:** create");
			expect(result).toContain("```typescript");
			expect(result).toContain('console.log("test");');
		});

		it("should truncate very long file content", () => {
			const longContent = "x".repeat(6000);
			const result = formatter.formatToolResult(
				"file_change",
				{
					file_path: "test.txt",
					change_type: "create",
					content: longContent,
				},
				"",
				false,
			);

			expect(result).toContain("(truncated)");
		});

		it("should format reasoning as blockquote", () => {
			const result = formatter.formatToolResult(
				"reasoning",
				{ text: "I need to\nthink about\nthis problem" },
				"",
				false,
			);

			expect(result).toContain("> I need to");
			expect(result).toContain("> think about");
			expect(result).toContain("> this problem");
		});

		it("should format JSON results for unknown tools", () => {
			const jsonResult = JSON.stringify({ status: "success", data: [1, 2, 3] });
			const result = formatter.formatToolResult(
				"unknown_tool",
				{},
				jsonResult,
				false,
			);

			expect(result).toContain("```json");
			expect(result).toContain('"status": "success"');
			expect(result).toContain('"data"');
		});

		it("should format non-JSON results as code block", () => {
			const textResult = "Some plain text output";
			const result = formatter.formatToolResult(
				"unknown_tool",
				{},
				textResult,
				false,
			);

			expect(result).toContain("```");
			expect(result).toContain("Some plain text output");
		});

		it("should truncate very long non-JSON results", () => {
			const longResult = "x".repeat(6000);
			const result = formatter.formatToolResult(
				"unknown_tool",
				{},
				longResult,
				false,
			);

			expect(result).toContain("...");
			expect(result.length).toBeLessThan(5100); // Truncated + code block markers
		});

		it("should format errors with code block", () => {
			const result = formatter.formatToolResult(
				"command_execution",
				{ command: "fail" },
				"Error: command not found",
				true,
			);

			expect(result).toContain("```");
			expect(result).toContain("Error: command not found");
		});

		it("should detect language from file extension", () => {
			const testCases = [
				{ ext: "test.py", lang: "python" },
				{ ext: "test.js", lang: "javascript" },
				{ ext: "test.go", lang: "go" },
				{ ext: "test.rs", lang: "rust" },
				{ ext: "test.java", lang: "java" },
				{ ext: "test.rb", lang: "ruby" },
			];

			for (const { ext, lang } of testCases) {
				const result = formatter.formatToolResult(
					"file_change",
					{
						file_path: ext,
						change_type: "create",
						content: "code here",
					},
					"",
					false,
				);

				expect(result).toContain(`\`\`\`${lang}`);
			}
		});
	});

	describe("edge cases", () => {
		it("should handle null/undefined values gracefully", () => {
			const result = formatter.formatToolParameter("command_execution", {
				command: null,
				output: undefined,
			});

			expect(result).toBeDefined();
		});

		it("should handle empty objects", () => {
			const result = formatter.formatToolParameter("unknown_tool", {});
			expect(result).toBe("{}");
		});

		it("should handle circular references in tool input", () => {
			const circular: any = { name: "test" };
			circular.self = circular;

			// Should not throw
			expect(() => {
				formatter.formatToolParameter("test_tool", circular);
			}).not.toThrow();
		});
	});
});
