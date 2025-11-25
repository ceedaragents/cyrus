import { describe, expect, it } from "vitest";
import { GeminiMessageFormatter } from "../src/formatter.js";

describe("GeminiMessageFormatter", () => {
	const formatter = new GeminiMessageFormatter();

	describe("formatToolParameter", () => {
		it("should format run_shell_command parameter", () => {
			const result = formatter.formatToolParameter("run_shell_command", {
				command: "ls -la",
			});
			expect(result).toBe("ls -la");
		});

		it("should format read_file parameter", () => {
			const result = formatter.formatToolParameter("read_file", {
				file_path: "/path/to/file.ts",
			});
			expect(result).toBe("/path/to/file.ts");
		});

		it("should format search_file_content parameter with pattern", () => {
			const result = formatter.formatToolParameter("search_file_content", {
				pattern: "TODO",
			});
			expect(result).toBe("Pattern: `TODO`");
		});

		it("should format search_file_content parameter with pattern and path", () => {
			const result = formatter.formatToolParameter("search_file_content", {
				pattern: "TODO",
				path: "/src",
			});
			expect(result).toBe("Pattern: `TODO` in /src");
		});

		it("should format list_directory parameter", () => {
			const result = formatter.formatToolParameter("list_directory", {
				dir_path: "/home/user",
			});
			expect(result).toBe("Path: /home/user");
		});

		it("should format write_file parameter", () => {
			const result = formatter.formatToolParameter("write_file", {
				file_path: "/path/to/new-file.ts",
			});
			expect(result).toBe("/path/to/new-file.ts");
		});

		it("should handle tool names with ↪ prefix", () => {
			const result = formatter.formatToolParameter("↪ run_shell_command", {
				command: "pwd",
			});
			expect(result).toBe("pwd");
		});
	});

	describe("formatToolActionName", () => {
		it("should format action name without error", () => {
			const result = formatter.formatToolActionName(
				"run_shell_command",
				{ command: "ls" },
				false,
			);
			expect(result).toBe("run_shell_command");
		});

		it("should format action name with error", () => {
			const result = formatter.formatToolActionName(
				"run_shell_command",
				{ command: "ls" },
				true,
			);
			expect(result).toBe("run_shell_command (Error)");
		});

		it("should handle ↪ prefix", () => {
			const result = formatter.formatToolActionName(
				"↪ read_file",
				{ file_path: "/test" },
				false,
			);
			expect(result).toBe("↪ read_file");
		});
	});

	describe("formatToolResult", () => {
		it("should format run_shell_command result", () => {
			const result = formatter.formatToolResult(
				"run_shell_command",
				{ command: "ls" },
				"file1.txt\nfile2.txt",
				false,
			);
			expect(result).toContain("```bash");
			expect(result).toContain("ls");
			expect(result).toContain("file1.txt");
		});

		it("should format read_file result with language detection", () => {
			const result = formatter.formatToolResult(
				"read_file",
				{ file_path: "test.ts" },
				"const x = 1;",
				false,
			);
			expect(result).toContain("```typescript");
			expect(result).toContain("const x = 1;");
		});

		it("should format error results", () => {
			const result = formatter.formatToolResult(
				"run_shell_command",
				{ command: "invalid" },
				"Error: command not found",
				true,
			);
			expect(result).toBe("```\nError: command not found\n```");
		});

		it("should format list_directory results", () => {
			const result = formatter.formatToolResult(
				"list_directory",
				{ dir_path: "/home" },
				"file1\nfile2\nfile3",
				false,
			);
			expect(result).toContain("Found 3 items:");
			expect(result).toContain("file1");
		});

		it("should format empty results", () => {
			const result = formatter.formatToolResult(
				"list_directory",
				{ dir_path: "/empty" },
				"",
				false,
			);
			expect(result).toBe("*No items found*");
		});
	});

	describe("formatTodoWriteParameter", () => {
		it("should format todos with status emojis", () => {
			const todos = {
				todos: [
					{ description: "Task 1", status: "completed" },
					{ description: "Task 2", status: "in_progress" },
					{ description: "Task 3", status: "pending" },
				],
			};

			const result = formatter.formatTodoWriteParameter(JSON.stringify(todos));

			expect(result).toContain("✅ Task 1");
			expect(result).toContain("🔄 Task 2");
			expect(result).toContain("⏳ Task 3");
		});

		it("should handle Claude-style todos with content field", () => {
			const todos = {
				todos: [
					{ content: "Task 1", status: "completed" },
					{ content: "Task 2", status: "pending" },
				],
			};

			const result = formatter.formatTodoWriteParameter(JSON.stringify(todos));

			expect(result).toContain("✅ Task 1");
			expect(result).toContain("⏳ Task 2");
		});

		it("should handle invalid JSON gracefully", () => {
			const result = formatter.formatTodoWriteParameter("invalid json");
			expect(result).toBe("invalid json");
		});
	});
});
