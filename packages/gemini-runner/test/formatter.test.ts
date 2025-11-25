import { describe, expect, it } from "vitest";
import { GeminiMessageFormatter } from "../src/formatter.js";

describe("GeminiMessageFormatter", () => {
	const formatter = new GeminiMessageFormatter();

	describe("formatTodoWriteParameter", () => {
		it("should format todos with status emojis (description field)", () => {
			const input = JSON.stringify({
				todos: [
					{ description: "First task", status: "completed" },
					{ description: "Second task", status: "in_progress" },
					{ description: "Third task", status: "pending" },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("\u2705"); // ✅
			expect(result).toContain("\uD83D\uDD04"); // 🔄
			expect(result).toContain("\u23F3"); // ⏳
			expect(result).toContain("First task");
			expect(result).toContain("Second task");
			expect(result).toContain("Third task");
		});

		it("should format todos with content field (Claude-style)", () => {
			const input = JSON.stringify({
				todos: [{ content: "Task with content field", status: "completed" }],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("Task with content field");
			expect(result).toContain("\u2705"); // ✅
		});

		it("should return original content for invalid JSON", () => {
			const input = "not valid json";
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe(input);
		});

		it("should return original content when todos is not an array", () => {
			const input = JSON.stringify({ todos: "not an array" });
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe(input);
		});
	});

	describe("formatToolParameter", () => {
		describe("Gemini tool names", () => {
			it("should format run_shell_command with command", () => {
				const result = formatter.formatToolParameter("run_shell_command", {
					command: "ls -la",
				});
				expect(result).toBe("ls -la");
			});

			it("should format read_file with file_path", () => {
				const result = formatter.formatToolParameter("read_file", {
					file_path: "/path/to/file.ts",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format read_file with offset and limit", () => {
				const result = formatter.formatToolParameter("read_file", {
					file_path: "/path/to/file.ts",
					offset: 10,
					limit: 50,
				});
				expect(result).toBe("/path/to/file.ts (lines 11-60)");
			});

			it("should format write_file with file_path", () => {
				const result = formatter.formatToolParameter("write_file", {
					file_path: "/path/to/file.ts",
					content: "file content",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format replace with file_path and instruction", () => {
				const result = formatter.formatToolParameter("replace", {
					file_path: "/path/to/file.ts",
					instruction: "Replace function name from foo to bar",
				});
				expect(result).toContain("/path/to/file.ts");
				expect(result).toContain("Replace function name from foo to bar");
			});

			it("should truncate long instruction in replace", () => {
				const longInstruction = "A".repeat(100);
				const result = formatter.formatToolParameter("replace", {
					file_path: "/path/to/file.ts",
					instruction: longInstruction,
				});
				expect(result).toContain("...");
				expect(result.length).toBeLessThan(longInstruction.length);
			});

			it("should format search_file_content with pattern", () => {
				const result = formatter.formatToolParameter("search_file_content", {
					pattern: "(TODO|FIXME)",
				});
				expect(result).toBe("Pattern: `(TODO|FIXME)`");
			});

			it("should format search_file_content with pattern and path", () => {
				const result = formatter.formatToolParameter("search_file_content", {
					pattern: "TODO",
					path: "/src",
				});
				expect(result).toBe("Pattern: `TODO` in /src");
			});

			it("should format list_directory with dir_path", () => {
				const result = formatter.formatToolParameter("list_directory", {
					dir_path: "/path/to/dir",
				});
				expect(result).toBe("/path/to/dir");
			});

			it("should format list_directory with path", () => {
				const result = formatter.formatToolParameter("list_directory", {
					path: "/path/to/dir",
				});
				expect(result).toBe("/path/to/dir");
			});

			it("should format list_directory with empty input to .", () => {
				const result = formatter.formatToolParameter("list_directory", {});
				expect(result).toBe(".");
			});

			it("should format write_todos with todo list", () => {
				const result = formatter.formatToolParameter("write_todos", {
					todos: [
						{ description: "Task 1", status: "completed" },
						{ description: "Task 2", status: "pending" },
					],
				});
				expect(result).toContain("Task 1");
				expect(result).toContain("Task 2");
			});
		});

		describe("Claude-style tool names (backward compatibility)", () => {
			it("should format Bash with command", () => {
				const result = formatter.formatToolParameter("Bash", {
					command: "npm install",
				});
				expect(result).toBe("npm install");
			});

			it("should format Read with file_path", () => {
				const result = formatter.formatToolParameter("Read", {
					file_path: "/path/to/file.ts",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format Edit with file_path", () => {
				const result = formatter.formatToolParameter("Edit", {
					file_path: "/path/to/file.ts",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format Write with file_path", () => {
				const result = formatter.formatToolParameter("Write", {
					file_path: "/path/to/file.ts",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format Grep with pattern", () => {
				const result = formatter.formatToolParameter("Grep", {
					pattern: "function",
					path: "/src",
					type: "ts",
				});
				expect(result).toBe("Pattern: `function` in /src [ts files]");
			});

			it("should format Glob with pattern", () => {
				const result = formatter.formatToolParameter("Glob", {
					pattern: "**/*.ts",
					path: "/src",
				});
				expect(result).toBe("Pattern: `**/*.ts` in /src");
			});

			it("should format Task with description", () => {
				const result = formatter.formatToolParameter("Task", {
					description: "Search for errors",
				});
				expect(result).toBe("Search for errors");
			});

			it("should format WebFetch with url", () => {
				const result = formatter.formatToolParameter("WebFetch", {
					url: "https://example.com",
				});
				expect(result).toBe("https://example.com");
			});

			it("should format WebSearch with query", () => {
				const result = formatter.formatToolParameter("WebSearch", {
					query: "typescript best practices",
				});
				expect(result).toBe("Query: typescript best practices");
			});
		});

		describe("MCP tools", () => {
			it("should extract meaningful fields from MCP tools", () => {
				const result = formatter.formatToolParameter("mcp__linear__get_issue", {
					id: "ISSUE-123",
				});
				expect(result).toBe("id: ISSUE-123");
			});

			it("should fallback to JSON for MCP tools without meaningful fields", () => {
				const result = formatter.formatToolParameter("mcp__custom__tool", {
					foo: "bar",
				});
				expect(result).toBe('{"foo":"bar"}');
			});
		});

		it("should return string input as-is", () => {
			const result = formatter.formatToolParameter("any_tool", "string input");
			expect(result).toBe("string input");
		});

		it("should fallback to JSON for unknown tools", () => {
			const result = formatter.formatToolParameter("unknown_tool", {
				some: "data",
			});
			expect(result).toBe('{"some":"data"}');
		});
	});

	describe("formatToolActionName", () => {
		it("should format run_shell_command with description", () => {
			const result = formatter.formatToolActionName(
				"run_shell_command",
				{ command: "ls", description: "List files" },
				false,
			);
			expect(result).toBe("run_shell_command (List files)");
		});

		it("should format run_shell_command with description and error", () => {
			const result = formatter.formatToolActionName(
				"run_shell_command",
				{ command: "ls", description: "List files" },
				true,
			);
			expect(result).toBe("run_shell_command (Error) (List files)");
		});

		it("should format Bash with description", () => {
			const result = formatter.formatToolActionName(
				"Bash",
				{ command: "npm test", description: "Run tests" },
				false,
			);
			expect(result).toBe("Bash (Run tests)");
		});

		it("should return tool name without description", () => {
			const result = formatter.formatToolActionName(
				"read_file",
				{ file_path: "/path/to/file" },
				false,
			);
			expect(result).toBe("read_file");
		});

		it("should add (Error) suffix for errors", () => {
			const result = formatter.formatToolActionName(
				"read_file",
				{ file_path: "/path/to/file" },
				true,
			);
			expect(result).toBe("read_file (Error)");
		});
	});

	describe("formatToolResult", () => {
		describe("Gemini tool names", () => {
			it("should format run_shell_command result with output", () => {
				const result = formatter.formatToolResult(
					"run_shell_command",
					{ command: "ls" },
					"file1.ts\nfile2.ts",
					false,
				);
				expect(result).toContain("```bash");
				expect(result).toContain("ls");
				expect(result).toContain("file1.ts");
			});

			it("should format run_shell_command result with no output", () => {
				const result = formatter.formatToolResult(
					"run_shell_command",
					{ command: "mkdir test" },
					"",
					false,
				);
				expect(result).toContain("*No output*");
			});

			it("should format read_file result with TypeScript content", () => {
				const result = formatter.formatToolResult(
					"read_file",
					{ file_path: "/path/to/file.ts" },
					"const x = 1;",
					false,
				);
				expect(result).toContain("```typescript");
				expect(result).toContain("const x = 1;");
			});

			it("should format read_file result with Python content", () => {
				const result = formatter.formatToolResult(
					"read_file",
					{ file_path: "/path/to/file.py" },
					"def hello():\n    pass",
					false,
				);
				expect(result).toContain("```python");
				expect(result).toContain("def hello():");
			});

			it("should format empty read_file result", () => {
				const result = formatter.formatToolResult(
					"read_file",
					{ file_path: "/path/to/file.ts" },
					"",
					false,
				);
				expect(result).toBe("*Empty file*");
			});

			it("should format write_file success", () => {
				const result = formatter.formatToolResult(
					"write_file",
					{ file_path: "/path/to/file.ts" },
					"",
					false,
				);
				expect(result).toBe("*File written successfully*");
			});

			it("should format replace with old_string and new_string", () => {
				const result = formatter.formatToolResult(
					"replace",
					{
						file_path: "/path/to/file.ts",
						old_string: "const x = 1;",
						new_string: "const y = 2;",
					},
					"",
					false,
				);
				expect(result).toContain("```diff");
				expect(result).toContain("-const x = 1;");
				expect(result).toContain("+const y = 2;");
			});

			it("should format replace with instruction", () => {
				const result = formatter.formatToolResult(
					"replace",
					{
						file_path: "/path/to/file.ts",
						instruction: "Rename variable x to y",
					},
					"",
					false,
				);
				expect(result).toContain("*Rename variable x to y*");
			});

			it("should format search_file_content with matches", () => {
				const result = formatter.formatToolResult(
					"search_file_content",
					{ pattern: "TODO" },
					"file1.ts\nfile2.ts",
					false,
				);
				expect(result).toContain("Found 2 matching files");
			});

			it("should format search_file_content with no matches", () => {
				const result = formatter.formatToolResult(
					"search_file_content",
					{ pattern: "TODO" },
					"",
					false,
				);
				expect(result).toBe("*No matches found*");
			});

			it("should format list_directory with items", () => {
				const result = formatter.formatToolResult(
					"list_directory",
					{ dir_path: "/src" },
					"file1.ts\nfile2.ts\ndir1",
					false,
				);
				expect(result).toContain("Found 3 items");
			});

			it("should format list_directory empty", () => {
				const result = formatter.formatToolResult(
					"list_directory",
					{ dir_path: "/empty" },
					"",
					false,
				);
				expect(result).toBe("*Empty directory*");
			});

			it("should format write_todos result", () => {
				const result = formatter.formatToolResult(
					"write_todos",
					{ todos: [] },
					"",
					false,
				);
				expect(result).toBe("*Todos updated*");
			});
		});

		describe("Claude-style tool names (backward compatibility)", () => {
			it("should format Bash result", () => {
				const result = formatter.formatToolResult(
					"Bash",
					{ command: "echo hello" },
					"hello",
					false,
				);
				expect(result).toContain("```bash");
				expect(result).toContain("echo hello");
				expect(result).toContain("hello");
			});

			it("should format Read result", () => {
				const result = formatter.formatToolResult(
					"Read",
					{ file_path: "/path/to/file.js" },
					"const x = 1;",
					false,
				);
				expect(result).toContain("```javascript");
			});

			it("should format Edit result with diff", () => {
				const result = formatter.formatToolResult(
					"Edit",
					{
						file_path: "/path/to/file.ts",
						old_string: "old code",
						new_string: "new code",
					},
					"",
					false,
				);
				expect(result).toContain("```diff");
				expect(result).toContain("-old code");
				expect(result).toContain("+new code");
			});

			it("should format Write result", () => {
				const result = formatter.formatToolResult(
					"Write",
					{ file_path: "/path/to/file.ts" },
					"",
					false,
				);
				expect(result).toBe("*File written successfully*");
			});

			it("should format Grep result", () => {
				const result = formatter.formatToolResult(
					"Grep",
					{ pattern: "TODO" },
					"file1.ts\nfile2.ts",
					false,
				);
				expect(result).toContain("Found 2 matching files");
			});

			it("should format Glob result", () => {
				const result = formatter.formatToolResult(
					"Glob",
					{ pattern: "**/*.ts" },
					"file1.ts\nfile2.ts\nfile3.ts",
					false,
				);
				expect(result).toContain("Found 3 matching files");
			});

			it("should format Task result", () => {
				const result = formatter.formatToolResult(
					"Task",
					{ description: "Search task" },
					"Task output",
					false,
				);
				expect(result).toBe("Task output");
			});

			it("should format multiline Task result", () => {
				const result = formatter.formatToolResult(
					"Task",
					{ description: "Search task" },
					"Line 1\nLine 2\nLine 3",
					false,
				);
				expect(result).toContain("```");
			});
		});

		describe("Error handling", () => {
			it("should wrap error results in code block", () => {
				const result = formatter.formatToolResult(
					"any_tool",
					{},
					"Error: Something went wrong",
					true,
				);
				expect(result).toBe("```\nError: Something went wrong\n```");
			});
		});

		describe("Unknown tools", () => {
			it("should format short unknown tool result as plain text", () => {
				const result = formatter.formatToolResult(
					"unknown_tool",
					{},
					"Short result",
					false,
				);
				expect(result).toBe("Short result");
			});

			it("should format long multiline unknown tool result in code block", () => {
				const longResult = "Line ".repeat(30) + "\n".repeat(5);
				const result = formatter.formatToolResult(
					"unknown_tool",
					{},
					longResult,
					false,
				);
				expect(result).toContain("```");
			});

			it("should return *Completed* for empty unknown tool result", () => {
				const result = formatter.formatToolResult(
					"unknown_tool",
					{},
					"",
					false,
				);
				expect(result).toBe("*Completed*");
			});
		});
	});
});
