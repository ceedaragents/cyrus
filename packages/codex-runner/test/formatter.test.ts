import { describe, expect, it } from "vitest";
import { CodexMessageFormatter } from "../src/formatter.js";

describe("CodexMessageFormatter", () => {
	const formatter = new CodexMessageFormatter();

	describe("formatTodoWriteParameter", () => {
		it("should format todos with status emojis", () => {
			const input = JSON.stringify({
				todos: [
					{ content: "Fix bug", status: "completed" },
					{ content: "Write tests", status: "in_progress" },
					{ content: "Deploy", status: "pending" },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("✅ Fix bug");
			expect(result).toContain("🔄 Write tests");
			expect(result).toContain("⏳ Deploy");
		});

		it("should handle Codex todo format with completed boolean", () => {
			const input = JSON.stringify({
				todos: [
					{ description: "Task 1", completed: true },
					{ description: "Task 2", completed: false },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("✅ Task 1");
			expect(result).toContain("⏳ Task 2");
		});

		it("should return original input on parse error", () => {
			const invalidJson = "not valid json";

			const result = formatter.formatTodoWriteParameter(invalidJson);

			expect(result).toBe(invalidJson);
		});

		it("should handle SDK format with items array and text field", () => {
			const input = JSON.stringify({
				items: [
					{ text: "Task 1", completed: true },
					{ text: "Task 2", completed: false },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("✅ Task 1");
			expect(result).toContain("⏳ Task 2");
		});

		it("should return original input when neither todos nor items exists", () => {
			const input = JSON.stringify({ somethingElse: [] });

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toBe(input);
		});
	});

	describe("formatToolParameter", () => {
		it("should format Bash command", () => {
			const result = formatter.formatToolParameter("Bash", {
				command: "npm install",
			});

			expect(result).toBe("npm install");
		});

		it("should format command_execution (SDK format)", () => {
			const result = formatter.formatToolParameter("command_execution", {
				command: "git status",
			});

			expect(result).toBe("git status");
		});

		it("should format Read with file path", () => {
			const result = formatter.formatToolParameter("Read", {
				file_path: "/src/index.ts",
			});

			expect(result).toBe("/src/index.ts");
		});

		it("should format Read with offset and limit", () => {
			const result = formatter.formatToolParameter("Read", {
				file_path: "/src/index.ts",
				offset: 10,
				limit: 20,
			});

			expect(result).toBe("/src/index.ts (lines 11-30)");
		});

		it("should format Write with file path", () => {
			const result = formatter.formatToolParameter("Write", {
				file_path: "/src/new-file.ts",
			});

			expect(result).toBe("/src/new-file.ts");
		});

		it("should format Edit with file path", () => {
			const result = formatter.formatToolParameter("Edit", {
				file_path: "/src/index.ts",
			});

			expect(result).toBe("/src/index.ts");
		});

		it("should format file_change with changes (SDK format)", () => {
			const result = formatter.formatToolParameter("file_change", {
				changes: [{ path: "src/a.ts" }, { path: "src/b.ts" }],
			});

			expect(result).toBe("src/a.ts, src/b.ts");
		});

		it("should format Grep with pattern", () => {
			const result = formatter.formatToolParameter("Grep", {
				pattern: "TODO",
				path: "/src",
			});

			expect(result).toBe("Pattern: `TODO` in /src");
		});

		it("should format Glob with pattern", () => {
			const result = formatter.formatToolParameter("Glob", {
				pattern: "**/*.ts",
			});

			expect(result).toBe("**/*.ts");
		});

		it("should format list_directory with path", () => {
			const result = formatter.formatToolParameter("list_directory", {
				dir_path: "/src",
			});

			expect(result).toBe("/src");
		});

		it("should format TodoWrite with todos", () => {
			const result = formatter.formatToolParameter("TodoWrite", {
				todos: [{ content: "Test", status: "pending" }],
			});

			expect(result).toContain("⏳ Test");
		});

		it("should format WebSearch with query", () => {
			const result = formatter.formatToolParameter("WebSearch", {
				query: "how to use TypeScript",
			});

			expect(result).toBe('Query: "how to use TypeScript"');
		});

		it("should format MCP tools with meaningful fields", () => {
			const result = formatter.formatToolParameter("mcp__linear__get_issue", {
				issueId: "ABC-123",
			});

			expect(result).toBe("issueId: ABC-123");
		});

		it("should return JSON for unknown tools", () => {
			const input = { unknownField: "value" };
			const result = formatter.formatToolParameter("unknown_tool", input);

			expect(result).toBe(JSON.stringify(input));
		});

		it("should handle string input", () => {
			const result = formatter.formatToolParameter("any_tool", "string input");

			expect(result).toBe("string input");
		});
	});

	describe("formatToolActionName", () => {
		it("should add description for Bash command", () => {
			const result = formatter.formatToolActionName(
				"Bash",
				{ command: "npm test", description: "Run tests" },
				false,
			);

			expect(result).toBe("Bash (Run tests)");
		});

		it("should add Error suffix when isError is true", () => {
			const result = formatter.formatToolActionName(
				"Bash",
				{ command: "npm test" },
				true,
			);

			expect(result).toBe("Bash (Error)");
		});

		it("should handle Bash with description and error", () => {
			const result = formatter.formatToolActionName(
				"Bash",
				{ command: "npm test", description: "Run tests" },
				true,
			);

			expect(result).toBe("Bash (Error) (Run tests)");
		});

		it("should return plain name for other tools", () => {
			const result = formatter.formatToolActionName("Read", {}, false);

			expect(result).toBe("Read");
		});
	});

	describe("formatToolResult", () => {
		it("should format error results in code block", () => {
			const result = formatter.formatToolResult(
				"any_tool",
				{},
				"Error message",
				true,
			);

			expect(result).toBe("```\nError message\n```");
		});

		it("should format Bash output with command", () => {
			const result = formatter.formatToolResult(
				"Bash",
				{ command: "ls -la" },
				"file1.txt\nfile2.txt",
				false,
			);

			expect(result).toContain("```bash\nls -la\n```");
			expect(result).toContain("file1.txt\nfile2.txt");
		});

		it("should show No output for empty Bash result", () => {
			const result = formatter.formatToolResult(
				"Bash",
				{ command: "echo", description: "Print nothing" },
				"",
				false,
			);

			expect(result).toBe("*No output*");
		});

		it("should format Read result with syntax highlighting", () => {
			const result = formatter.formatToolResult(
				"Read",
				{ file_path: "/src/index.ts" },
				"const x = 1;",
				false,
			);

			expect(result).toBe("```typescript\nconst x = 1;\n```");
		});

		it("should show File read successfully for empty Read result", () => {
			const result = formatter.formatToolResult(
				"Read",
				{ file_path: "/src/index.ts" },
				"",
				false,
			);

			expect(result).toBe("*File read successfully*");
		});

		it("should format Write success message", () => {
			const result = formatter.formatToolResult(
				"Write",
				{ file_path: "/src/new.ts" },
				"",
				false,
			);

			expect(result).toBe("*File written successfully*");
		});

		it("should format Edit with changes (SDK format)", () => {
			const result = formatter.formatToolResult(
				"Edit",
				{
					changes: [
						{ path: "index.ts", kind: "update" },
						{ path: "new-file.ts", kind: "add" },
					],
				},
				"",
				false,
			);

			expect(result).toContain("Modified: index.ts");
			expect(result).toContain("Created: new-file.ts");
		});

		it("should format Grep results with match count", () => {
			const result = formatter.formatToolResult(
				"Grep",
				{ pattern: "TODO" },
				"file1.ts\nfile2.ts\nfile3.ts",
				false,
			);

			expect(result).toContain("Found 3 matching files");
		});

		it("should show No matches found for empty Grep result", () => {
			const result = formatter.formatToolResult(
				"Grep",
				{ pattern: "NONEXISTENT" },
				"",
				false,
			);

			expect(result).toBe("*No matches found*");
		});

		it("should format Glob results with item count", () => {
			const result = formatter.formatToolResult(
				"Glob",
				{ pattern: "**/*.ts" },
				"src/a.ts\nsrc/b.ts",
				false,
			);

			expect(result).toContain("Found 2 items");
		});

		it("should show Empty directory for empty Glob result", () => {
			const result = formatter.formatToolResult(
				"Glob",
				{ pattern: "**/*.nonexistent" },
				"",
				false,
			);

			expect(result).toBe("*Empty directory*");
		});

		it("should format TodoWrite result", () => {
			const result = formatter.formatToolResult("TodoWrite", {}, "", false);

			expect(result).toBe("*Todos updated*");
		});

		it("should format WebSearch result in code block", () => {
			const result = formatter.formatToolResult(
				"WebSearch",
				{ query: "test" },
				"Result 1\nResult 2",
				false,
			);

			expect(result).toBe("```\nResult 1\nResult 2\n```");
		});

		it("should format unknown tool with code block for multiline", () => {
			// The formatter requires multiline AND > 100 characters for code block wrapping
			const longMultilineResult =
				"This is a very long line that contains a lot of text to exceed the 100 character threshold\nSecond line with more content\nThird line to make it clearly multiline";
			const result = formatter.formatToolResult(
				"custom_tool",
				{},
				longMultilineResult,
				false,
			);

			expect(result).toContain("```");
		});

		it("should show Completed for empty unknown tool result", () => {
			const result = formatter.formatToolResult("custom_tool", {}, "", false);

			expect(result).toBe("*Completed*");
		});
	});
});
