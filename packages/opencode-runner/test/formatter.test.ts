import { describe, expect, it } from "vitest";
import { OpenCodeMessageFormatter } from "../src/formatter.js";

describe("OpenCodeMessageFormatter", () => {
	const formatter = new OpenCodeMessageFormatter();

	describe("formatTodoWriteParameter", () => {
		it("should format todos with status emojis using content field", () => {
			const input = JSON.stringify({
				todos: [
					{ content: "First task", status: "completed" },
					{ content: "Second task", status: "in_progress" },
					{ content: "Third task", status: "pending" },
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

		it("should format todos with description field", () => {
			const input = JSON.stringify({
				todos: [
					{ description: "Task with description field", status: "completed" },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("Task with description field");
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

		it("should handle empty todos array", () => {
			const input = JSON.stringify({ todos: [] });
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe("\n");
		});

		it("should handle todos without status field", () => {
			const input = JSON.stringify({
				todos: [{ content: "Task without status", status: "" }],
			});
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toContain("Task without status");
			// No emoji prefix for unknown status
			expect(result).not.toContain("✅");
			expect(result).not.toContain("🔄");
			expect(result).not.toContain("⏳");
		});
	});

	describe("formatToolParameter", () => {
		describe("OpenCode tool names (lowercase)", () => {
			it("should format bash with command", () => {
				const result = formatter.formatToolParameter("bash", {
					command: "ls -la",
				});
				expect(result).toBe("ls -la");
			});

			it("should format read with file_path", () => {
				const result = formatter.formatToolParameter("read", {
					file_path: "/path/to/file.ts",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format read with path", () => {
				const result = formatter.formatToolParameter("read", {
					path: "/path/to/file.ts",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format read with offset and limit", () => {
				const result = formatter.formatToolParameter("read", {
					file_path: "/path/to/file.ts",
					offset: 10,
					limit: 50,
				});
				expect(result).toBe("/path/to/file.ts (lines 11-60)");
			});

			it("should format read with only offset", () => {
				const result = formatter.formatToolParameter("read", {
					file_path: "/path/to/file.ts",
					offset: 10,
				});
				expect(result).toBe("/path/to/file.ts (lines 11-end)");
			});

			it("should format write with file_path", () => {
				const result = formatter.formatToolParameter("write", {
					file_path: "/path/to/file.ts",
					content: "file content",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format edit with file_path", () => {
				const result = formatter.formatToolParameter("edit", {
					file_path: "/path/to/file.ts",
					old_string: "old",
					new_string: "new",
				});
				expect(result).toBe("/path/to/file.ts");
			});

			it("should format grep with pattern", () => {
				const result = formatter.formatToolParameter("grep", {
					pattern: "(TODO|FIXME)",
				});
				expect(result).toBe("Pattern: `(TODO|FIXME)`");
			});

			it("should format grep with pattern and path", () => {
				const result = formatter.formatToolParameter("grep", {
					pattern: "TODO",
					path: "/src",
				});
				expect(result).toBe("Pattern: `TODO` in /src");
			});

			it("should format grep with pattern, path, and glob", () => {
				const result = formatter.formatToolParameter("grep", {
					pattern: "TODO",
					path: "/src",
					glob: "*.ts",
				});
				expect(result).toBe("Pattern: `TODO` in /src (*.ts)");
			});

			it("should format grep with pattern and type filter", () => {
				const result = formatter.formatToolParameter("grep", {
					pattern: "TODO",
					type: "typescript",
				});
				expect(result).toBe("Pattern: `TODO` [typescript files]");
			});

			it("should format glob with pattern", () => {
				const result = formatter.formatToolParameter("glob", {
					pattern: "**/*.ts",
				});
				expect(result).toBe("Pattern: `**/*.ts`");
			});

			it("should format glob with pattern and path", () => {
				const result = formatter.formatToolParameter("glob", {
					pattern: "*.ts",
					path: "/src",
				});
				expect(result).toBe("Pattern: `*.ts` in /src");
			});

			it("should format list with dir_path", () => {
				const result = formatter.formatToolParameter("list", {
					dir_path: "/path/to/dir",
				});
				expect(result).toBe("/path/to/dir");
			});

			it("should format list with path", () => {
				const result = formatter.formatToolParameter("list", {
					path: "/path/to/dir",
				});
				expect(result).toBe("/path/to/dir");
			});

			it("should format list with directory", () => {
				const result = formatter.formatToolParameter("list", {
					directory: "/path/to/dir",
				});
				expect(result).toBe("/path/to/dir");
			});

			it("should format list with empty input to .", () => {
				const result = formatter.formatToolParameter("list", {});
				expect(result).toBe(".");
			});

			it("should format webfetch with url", () => {
				const result = formatter.formatToolParameter("webfetch", {
					url: "https://example.com",
				});
				expect(result).toBe("https://example.com");
			});

			it("should format todo with todo list", () => {
				const result = formatter.formatToolParameter("todo", {
					todos: [
						{ content: "Task 1", status: "completed" },
						{ content: "Task 2", status: "pending" },
					],
				});
				expect(result).toContain("Task 1");
				expect(result).toContain("Task 2");
			});
		});

		describe("MCP tools", () => {
			it("should extract query field from MCP tools", () => {
				const result = formatter.formatToolParameter(
					"mcp_linear_search_issues",
					{
						query: "bug report",
					},
				);
				expect(result).toBe("query: bug report");
			});

			it("should extract id field from MCP tools", () => {
				const result = formatter.formatToolParameter("mcp_linear_get_issue", {
					id: "ISSUE-123",
				});
				expect(result).toBe("id: ISSUE-123");
			});

			it("should extract issueId field from MCP tools", () => {
				const result = formatter.formatToolParameter(
					"mcp_linear_update_issue",
					{
						issueId: "ISSUE-456",
						status: "done",
					},
				);
				expect(result).toBe("issueId: ISSUE-456");
			});

			it("should truncate long values from MCP tools", () => {
				const longValue = "A".repeat(150);
				const result = formatter.formatToolParameter("mcp_custom_tool", {
					query: longValue,
				});
				expect(result).toContain("...");
				expect(result.length).toBeLessThan(120);
			});

			it("should fallback to JSON for MCP tools without meaningful fields", () => {
				const result = formatter.formatToolParameter("mcp_custom_tool", {
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
		it("should format bash with description", () => {
			const result = formatter.formatToolActionName(
				"bash",
				{ command: "ls", description: "List files" },
				false,
			);
			expect(result).toBe("bash (List files)");
		});

		it("should format bash with description and error", () => {
			const result = formatter.formatToolActionName(
				"bash",
				{ command: "ls", description: "List files" },
				true,
			);
			expect(result).toBe("bash (Error) (List files)");
		});

		it("should format bash without description", () => {
			const result = formatter.formatToolActionName(
				"bash",
				{ command: "ls" },
				false,
			);
			expect(result).toBe("bash");
		});

		it("should return tool name without description for other tools", () => {
			const result = formatter.formatToolActionName(
				"read",
				{ file_path: "/path/to/file" },
				false,
			);
			expect(result).toBe("read");
		});

		it("should add (Error) suffix for errors", () => {
			const result = formatter.formatToolActionName(
				"read",
				{ file_path: "/path/to/file" },
				true,
			);
			expect(result).toBe("read (Error)");
		});

		describe("MCP tool name formatting", () => {
			it("should format mcp_linear_get_issue as Linear: Get Issue", () => {
				const result = formatter.formatToolActionName(
					"mcp_linear_get_issue",
					{ id: "123" },
					false,
				);
				expect(result).toBe("Linear: Get Issue");
			});

			it("should format mcp_github_create_pr as Github: Create Pr", () => {
				const result = formatter.formatToolActionName(
					"mcp_github_create_pr",
					{ title: "Fix bug" },
					false,
				);
				expect(result).toBe("Github: Create Pr");
			});

			it("should format mcp_trigger_list_runs as Trigger: List Runs", () => {
				const result = formatter.formatToolActionName(
					"mcp_trigger_list_runs",
					{},
					false,
				);
				expect(result).toBe("Trigger: List Runs");
			});

			it("should add (Error) suffix to MCP tool errors", () => {
				const result = formatter.formatToolActionName(
					"mcp_linear_get_issue",
					{ id: "123" },
					true,
				);
				expect(result).toBe("Linear: Get Issue (Error)");
			});
		});
	});

	describe("formatToolResult", () => {
		describe("OpenCode tool names (lowercase)", () => {
			it("should format bash result with output", () => {
				const result = formatter.formatToolResult(
					"bash",
					{ command: "ls" },
					"file1.ts\nfile2.ts",
					false,
				);
				expect(result).toContain("```bash");
				expect(result).toContain("ls");
				expect(result).toContain("file1.ts");
			});

			it("should format bash result with no output", () => {
				const result = formatter.formatToolResult(
					"bash",
					{ command: "mkdir test" },
					"",
					false,
				);
				expect(result).toContain("*No output*");
			});

			it("should format bash result with description (no command block)", () => {
				const result = formatter.formatToolResult(
					"bash",
					{ command: "ls", description: "List files" },
					"file1.ts",
					false,
				);
				expect(result).not.toContain("```bash");
				expect(result).toContain("```");
				expect(result).toContain("file1.ts");
			});

			it("should format read result with TypeScript content", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.ts" },
					"const x = 1;",
					false,
				);
				expect(result).toContain("```typescript");
				expect(result).toContain("const x = 1;");
			});

			it("should format read result with Python content", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.py" },
					"def hello():\n    pass",
					false,
				);
				expect(result).toContain("```python");
				expect(result).toContain("def hello():");
			});

			it("should format read result with JavaScript content", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.js" },
					"function foo() { return 1; }",
					false,
				);
				expect(result).toContain("```javascript");
			});

			it("should format read result with unknown extension", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.xyz" },
					"some content",
					false,
				);
				expect(result).toContain("```\n");
			});

			it("should format empty read result as *Empty file*", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.ts" },
					"",
					false,
				);
				expect(result).toBe("*Empty file*");
			});

			it("should clean line numbers from read result", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.ts" },
					"  1→const x = 1;\n  2→const y = 2;",
					false,
				);
				expect(result).toContain("const x = 1;");
				expect(result).toContain("const y = 2;");
				expect(result).not.toContain("→");
			});

			it("should remove system-reminder tags from read result", () => {
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/path/to/file.ts" },
					"const x = 1;\n<system-reminder>Some reminder</system-reminder>\nconst y = 2;",
					false,
				);
				expect(result).toContain("const x = 1;");
				expect(result).toContain("const y = 2;");
				expect(result).not.toContain("system-reminder");
			});

			it("should format write success", () => {
				const result = formatter.formatToolResult(
					"write",
					{ file_path: "/path/to/file.ts" },
					"",
					false,
				);
				expect(result).toBe("*File written successfully*");
			});

			it("should format write with custom message", () => {
				const result = formatter.formatToolResult(
					"write",
					{ file_path: "/path/to/file.ts" },
					"File written to /path/to/file.ts",
					false,
				);
				expect(result).toBe("File written to /path/to/file.ts");
			});

			it("should format edit with old_string and new_string", () => {
				const result = formatter.formatToolResult(
					"edit",
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

			it("should format edit with multiline changes", () => {
				const result = formatter.formatToolResult(
					"edit",
					{
						file_path: "/path/to/file.ts",
						old_string: "line1\nline2",
						new_string: "newLine1\nnewLine2\nnewLine3",
					},
					"",
					false,
				);
				expect(result).toContain("-line1");
				expect(result).toContain("-line2");
				expect(result).toContain("+newLine1");
				expect(result).toContain("+newLine2");
				expect(result).toContain("+newLine3");
			});

			it("should format edit without old/new strings", () => {
				const result = formatter.formatToolResult(
					"edit",
					{ file_path: "/path/to/file.ts" },
					"",
					false,
				);
				expect(result).toBe("*Edit completed*");
			});

			it("should format grep with file matches", () => {
				const result = formatter.formatToolResult(
					"grep",
					{ pattern: "TODO" },
					"file1.ts\nfile2.ts",
					false,
				);
				expect(result).toContain("Found 2 matching files");
				expect(result).toContain("```");
			});

			it("should format grep with content matches", () => {
				const result = formatter.formatToolResult(
					"grep",
					{ pattern: "TODO" },
					"file1.ts:10: TODO: fix this",
					false,
				);
				expect(result).toContain("```");
				expect(result).toContain("file1.ts:10:");
			});

			it("should format grep with no matches", () => {
				const result = formatter.formatToolResult(
					"grep",
					{ pattern: "TODO" },
					"",
					false,
				);
				expect(result).toBe("*No matches found*");
			});

			it("should format glob with matches", () => {
				const result = formatter.formatToolResult(
					"glob",
					{ pattern: "**/*.ts" },
					"file1.ts\nfile2.ts\nfile3.ts",
					false,
				);
				expect(result).toContain("Found 3 matching files");
				expect(result).toContain("```");
			});

			it("should format glob with no matches", () => {
				const result = formatter.formatToolResult(
					"glob",
					{ pattern: "**/*.xyz" },
					"",
					false,
				);
				expect(result).toBe("*No files found*");
			});

			it("should format list with items", () => {
				const result = formatter.formatToolResult(
					"list",
					{ dir_path: "/src" },
					"file1.ts\nfile2.ts\ndir1",
					false,
				);
				expect(result).toContain("Found 3 items");
				expect(result).toContain("```");
			});

			it("should format list empty", () => {
				const result = formatter.formatToolResult(
					"list",
					{ dir_path: "/empty" },
					"",
					false,
				);
				expect(result).toBe("*Empty directory*");
			});

			it("should format webfetch with content", () => {
				const result = formatter.formatToolResult(
					"webfetch",
					{ url: "https://example.com" },
					"Page content here",
					false,
				);
				expect(result).toBe("Page content here");
			});

			it("should format webfetch with no content", () => {
				const result = formatter.formatToolResult(
					"webfetch",
					{ url: "https://example.com" },
					"",
					false,
				);
				expect(result).toBe("*No content fetched*");
			});

			it("should format todo result", () => {
				const result = formatter.formatToolResult(
					"todo",
					{ todos: [] },
					"",
					false,
				);
				expect(result).toBe("*Todos updated*");
			});

			it("should format todo with custom message", () => {
				const result = formatter.formatToolResult(
					"todo",
					{ todos: [] },
					"Todos updated successfully",
					false,
				);
				expect(result).toBe("Todos updated successfully");
			});
		});

		describe("Truncation", () => {
			it("should truncate very long results", () => {
				const longResult = "x".repeat(15000);
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/file.txt" },
					longResult,
					false,
				);
				expect(result).toContain("... (truncated)");
				expect(result.length).toBeLessThan(12000);
			});

			it("should truncate at line boundary when possible", () => {
				const lines = Array(500).fill("This is a line of text").join("\n");
				const result = formatter.formatToolResult(
					"read",
					{ file_path: "/file.txt" },
					lines,
					false,
				);
				expect(result).toContain("... (truncated)");
			});

			it("should truncate error results", () => {
				const longError = `Error: ${"x".repeat(15000)}`;
				const result = formatter.formatToolResult(
					"any_tool",
					{},
					longError,
					true,
				);
				expect(result).toContain("... (truncated)");
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

		describe("Language detection", () => {
			const testCases = [
				{ ext: "ts", lang: "typescript" },
				{ ext: "tsx", lang: "typescript" },
				{ ext: "js", lang: "javascript" },
				{ ext: "jsx", lang: "javascript" },
				{ ext: "mjs", lang: "javascript" },
				{ ext: "py", lang: "python" },
				{ ext: "rb", lang: "ruby" },
				{ ext: "go", lang: "go" },
				{ ext: "rs", lang: "rust" },
				{ ext: "java", lang: "java" },
				{ ext: "yml", lang: "yaml" },
				{ ext: "yaml", lang: "yaml" },
				{ ext: "json", lang: "json" },
				{ ext: "md", lang: "markdown" },
				{ ext: "sh", lang: "bash" },
				{ ext: "sql", lang: "sql" },
				{ ext: "graphql", lang: "graphql" },
			];

			testCases.forEach(({ ext, lang }) => {
				it(`should detect ${lang} for .${ext} files`, () => {
					const result = formatter.formatToolResult(
						"read",
						{ file_path: `/path/to/file.${ext}` },
						"content",
						false,
					);
					expect(result).toContain(`\`\`\`${lang}`);
				});
			});
		});
	});
});
