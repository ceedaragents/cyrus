/**
 * Tests for Codex Message Formatter
 *
 * Tests the IMessageFormatter implementation for Codex CLI tool messages.
 */

import { describe, expect, it } from "vitest";
import { CodexMessageFormatter } from "./formatter.js";

describe("CodexMessageFormatter", () => {
	const formatter = new CodexMessageFormatter();

	describe("formatTodoWriteParameter", () => {
		it("should format todos with status indicators", () => {
			const input = JSON.stringify({
				todos: [
					{ content: "First task", status: "completed" },
					{ content: "Second task", status: "in_progress" },
					{ content: "Third task", status: "pending" },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("✅ First task");
			expect(result).toContain("🔄 Second task");
			expect(result).toContain("⏳ Third task");
		});

		it("should handle completed boolean (Codex format)", () => {
			const input = JSON.stringify({
				todos: [
					{ text: "Done task", completed: true },
					{ text: "Not done", completed: false },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("✅ Done task");
			expect(result).toContain("⏳ Not done");
		});

		it("should handle both text and content fields", () => {
			const input = JSON.stringify({
				todos: [
					{ content: "Using content field", status: "pending" },
					{ text: "Using text field", status: "pending" },
				],
			});

			const result = formatter.formatTodoWriteParameter(input);

			expect(result).toContain("Using content field");
			expect(result).toContain("Using text field");
		});

		it("should return original on invalid JSON", () => {
			const input = "not valid json";
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe(input);
		});

		it("should return original if todos array is missing", () => {
			const input = JSON.stringify({ other: "data" });
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe(input);
		});

		it("should handle empty todos array", () => {
			const input = JSON.stringify({ todos: [] });
			const result = formatter.formatTodoWriteParameter(input);
			expect(result).toBe("\n");
		});
	});

	describe("formatToolParameter", () => {
		describe("Bash tool", () => {
			it("should format bash command", () => {
				const result = formatter.formatToolParameter("Bash", {
					command: "npm test",
					description: "Run tests",
				});
				expect(result).toBe("npm test");
			});

			it("should fall back to JSON if no command", () => {
				const result = formatter.formatToolParameter("Bash", { other: "data" });
				expect(result).toBe('{"other":"data"}');
			});
		});

		describe("Read tool", () => {
			it("should format simple file path", () => {
				const result = formatter.formatToolParameter("Read", {
					file_path: "/src/index.ts",
				});
				expect(result).toBe("/src/index.ts");
			});

			it("should include line range when offset/limit provided", () => {
				const result = formatter.formatToolParameter("Read", {
					file_path: "/src/index.ts",
					offset: 10,
					limit: 20,
				});
				expect(result).toBe("/src/index.ts (lines 11-30)");
			});

			it("should handle offset without limit", () => {
				const result = formatter.formatToolParameter("Read", {
					file_path: "/src/index.ts",
					offset: 10,
				});
				expect(result).toBe("/src/index.ts (lines 11-end)");
			});

			it("should handle limit without offset", () => {
				const result = formatter.formatToolParameter("Read", {
					file_path: "/src/index.ts",
					limit: 50,
				});
				expect(result).toBe("/src/index.ts (lines 1-50)");
			});
		});

		describe("Write tool", () => {
			it("should format file path", () => {
				const result = formatter.formatToolParameter("Write", {
					file_path: "/src/new.ts",
					content: "file content",
				});
				expect(result).toBe("/src/new.ts");
			});
		});

		describe("Edit tool", () => {
			it("should format file path", () => {
				const result = formatter.formatToolParameter("Edit", {
					file_path: "/src/index.ts",
					old_string: "old",
					new_string: "new",
				});
				expect(result).toBe("/src/index.ts");
			});

			it("should include kind if provided", () => {
				const result = formatter.formatToolParameter("Edit", {
					file_path: "/src/index.ts",
					kind: "update",
				});
				expect(result).toBe("/src/index.ts (update)");
			});
		});

		describe("Grep tool", () => {
			it("should format pattern", () => {
				const result = formatter.formatToolParameter("Grep", {
					pattern: "TODO",
				});
				expect(result).toBe("Pattern: `TODO`");
			});

			it("should include path if provided", () => {
				const result = formatter.formatToolParameter("Grep", {
					pattern: "TODO",
					path: "/src",
				});
				expect(result).toBe("Pattern: `TODO` in /src");
			});

			it("should include glob if provided", () => {
				const result = formatter.formatToolParameter("Grep", {
					pattern: "TODO",
					glob: "*.ts",
				});
				expect(result).toBe("Pattern: `TODO` (*.ts)");
			});

			it("should include both path and glob", () => {
				const result = formatter.formatToolParameter("Grep", {
					pattern: "TODO",
					path: "/src",
					glob: "*.ts",
				});
				expect(result).toBe("Pattern: `TODO` in /src (*.ts)");
			});
		});

		describe("Glob tool", () => {
			it("should format pattern", () => {
				const result = formatter.formatToolParameter("Glob", {
					pattern: "**/*.ts",
				});
				expect(result).toBe("Pattern: `**/*.ts`");
			});

			it("should include path if provided", () => {
				const result = formatter.formatToolParameter("Glob", {
					pattern: "*.md",
					path: "/docs",
				});
				expect(result).toBe("Pattern: `*.md` in /docs");
			});
		});

		describe("TodoWrite tool", () => {
			it("should use formatTodoWriteParameter", () => {
				const result = formatter.formatToolParameter("TodoWrite", {
					todos: [{ content: "Task 1", status: "pending" }],
				});
				expect(result).toContain("⏳ Task 1");
			});
		});

		describe("WebFetch tool", () => {
			it("should format URL", () => {
				const result = formatter.formatToolParameter("WebFetch", {
					url: "https://example.com/api",
				});
				expect(result).toBe("https://example.com/api");
			});
		});

		describe("WebSearch tool", () => {
			it("should format search query", () => {
				const result = formatter.formatToolParameter("WebSearch", {
					query: "TypeScript best practices",
				});
				expect(result).toBe("Query: TypeScript best practices");
			});
		});

		describe("MCP tools", () => {
			it("should extract query field", () => {
				const result = formatter.formatToolParameter(
					"mcp__linear__list_issues",
					{
						query: "assigned to me",
					},
				);
				expect(result).toBe("query: assigned to me");
			});

			it("should extract id field", () => {
				const result = formatter.formatToolParameter("mcp__linear__get_issue", {
					id: "ISSUE-123",
				});
				expect(result).toBe("id: ISSUE-123");
			});

			it("should extract title field", () => {
				const result = formatter.formatToolParameter(
					"mcp__linear__create_issue",
					{
						title: "New issue",
						description: "Details",
					},
				);
				expect(result).toBe("title: New issue");
			});

			it("should fall back to JSON for unknown fields", () => {
				const result = formatter.formatToolParameter("mcp__custom__tool", {
					unknown: "value",
				});
				expect(result).toBe('{"unknown":"value"}');
			});
		});

		describe("Unknown tools", () => {
			it("should return JSON for unknown tools", () => {
				const result = formatter.formatToolParameter("CustomTool", {
					foo: "bar",
				});
				expect(result).toBe('{"foo":"bar"}');
			});
		});

		describe("String input", () => {
			it("should return string input as-is", () => {
				const result = formatter.formatToolParameter(
					"Bash",
					"ls -la" as unknown as Record<string, unknown>,
				);
				expect(result).toBe("ls -la");
			});
		});
	});

	describe("formatToolActionName", () => {
		it("should add error suffix when isError is true", () => {
			const result = formatter.formatToolActionName("Bash", {}, true);
			expect(result).toBe("Bash (Error)");
		});

		it("should return tool name when not error", () => {
			const result = formatter.formatToolActionName("Read", {}, false);
			expect(result).toBe("Read");
		});

		it("should add Bash description when provided", () => {
			const result = formatter.formatToolActionName(
				"Bash",
				{ description: "Run tests" },
				false,
			);
			expect(result).toBe("Bash (Run tests)");
		});

		it("should add both description and error for Bash", () => {
			const result = formatter.formatToolActionName(
				"Bash",
				{ description: "Build project" },
				true,
			);
			expect(result).toBe("Bash (Error) (Build project)");
		});

		it("should not add description for non-Bash tools", () => {
			const result = formatter.formatToolActionName(
				"Read",
				{ description: "This is ignored" },
				false,
			);
			expect(result).toBe("Read");
		});
	});

	describe("formatToolResult", () => {
		describe("Error handling", () => {
			it("should wrap errors in code block", () => {
				const result = formatter.formatToolResult(
					"Bash",
					{ command: "npm test" },
					"Error: test failed",
					true,
				);
				expect(result).toBe("```\nError: test failed\n```");
			});
		});

		describe("Bash tool", () => {
			it("should format bash command and output", () => {
				const result = formatter.formatToolResult(
					"Bash",
					{ command: "ls -la" },
					"file1.txt\nfile2.txt",
					false,
				);
				expect(result).toContain("```bash\nls -la\n```");
				expect(result).toContain("```\nfile1.txt\nfile2.txt\n```");
			});

			it("should show *No output* for empty result", () => {
				const result = formatter.formatToolResult(
					"Bash",
					{ command: "mkdir test" },
					"",
					false,
				);
				expect(result).toContain("*No output*");
			});

			it("should not show command if description provided", () => {
				const result = formatter.formatToolResult(
					"Bash",
					{ command: "npm test", description: "Run tests" },
					"All passed",
					false,
				);
				expect(result).not.toContain("npm test");
				expect(result).toContain("All passed");
			});
		});

		describe("Read tool", () => {
			it("should format with detected language", () => {
				const result = formatter.formatToolResult(
					"Read",
					{ file_path: "/src/index.ts" },
					"const x = 1;",
					false,
				);
				expect(result).toBe("```typescript\nconst x = 1;\n```");
			});

			it("should handle python files", () => {
				const result = formatter.formatToolResult(
					"Read",
					{ file_path: "script.py" },
					"def main():\n    pass",
					false,
				);
				expect(result).toBe("```python\ndef main():\n    pass\n```");
			});

			it("should strip line numbers", () => {
				const result = formatter.formatToolResult(
					"Read",
					{ file_path: "test.ts" },
					"  1→const x = 1;\n  2→const y = 2;",
					false,
				);
				expect(result).toBe("```typescript\nconst x = 1;\nconst y = 2;\n```");
			});

			it("should strip system-reminder blocks", () => {
				const result = formatter.formatToolResult(
					"Read",
					{ file_path: "test.ts" },
					"code\n<system-reminder>hidden</system-reminder>\nmore code",
					false,
				);
				expect(result).not.toContain("system-reminder");
				expect(result).not.toContain("hidden");
			});

			it("should return success message for empty content", () => {
				const result = formatter.formatToolResult(
					"Read",
					{ file_path: "empty.txt" },
					"",
					false,
				);
				expect(result).toBe("*File read successfully*");
			});
		});

		describe("Write tool", () => {
			it("should return result if provided", () => {
				const result = formatter.formatToolResult(
					"Write",
					{ file_path: "new.ts" },
					"File created",
					false,
				);
				expect(result).toBe("File created");
			});

			it("should return success message for empty result", () => {
				const result = formatter.formatToolResult(
					"Write",
					{ file_path: "new.ts" },
					"",
					false,
				);
				expect(result).toBe("*File written successfully*");
			});
		});

		describe("Edit tool", () => {
			it("should format as diff", () => {
				const result = formatter.formatToolResult(
					"Edit",
					{
						file_path: "test.ts",
						old_string: "const x = 1;",
						new_string: "const x = 2;",
					},
					"",
					false,
				);
				expect(result).toBe("```diff\n-const x = 1;\n+const x = 2;\n```");
			});

			it("should handle multi-line diff", () => {
				const result = formatter.formatToolResult(
					"Edit",
					{
						old_string: "line1\nline2",
						new_string: "new1\nnew2\nnew3",
					},
					"",
					false,
				);
				expect(result).toContain("-line1");
				expect(result).toContain("-line2");
				expect(result).toContain("+new1");
				expect(result).toContain("+new2");
				expect(result).toContain("+new3");
			});

			it("should return result if no old/new string", () => {
				const result = formatter.formatToolResult(
					"Edit",
					{ file_path: "test.ts" },
					"Edit applied",
					false,
				);
				expect(result).toBe("Edit applied");
			});

			it("should return success message for empty result and no strings", () => {
				const result = formatter.formatToolResult(
					"Edit",
					{ file_path: "test.ts" },
					"",
					false,
				);
				expect(result).toBe("*Edit completed*");
			});
		});

		describe("Grep tool", () => {
			it("should format file list", () => {
				const result = formatter.formatToolResult(
					"Grep",
					{ pattern: "TODO" },
					"file1.ts\nfile2.ts\nfile3.ts",
					false,
				);
				expect(result).toContain("Found 3 matching files");
				expect(result).toContain("file1.ts");
			});

			it("should format content matches", () => {
				const result = formatter.formatToolResult(
					"Grep",
					{ pattern: "TODO" },
					"file1.ts:10: // TODO fix this\nfile1.ts:20: // TODO refactor",
					false,
				);
				expect(result).toBe(
					"```\nfile1.ts:10: // TODO fix this\nfile1.ts:20: // TODO refactor\n```",
				);
			});

			it("should return no matches for empty result", () => {
				const result = formatter.formatToolResult(
					"Grep",
					{ pattern: "NONEXISTENT" },
					"",
					false,
				);
				expect(result).toBe("*No matches found*");
			});
		});

		describe("Glob tool", () => {
			it("should format file count", () => {
				const result = formatter.formatToolResult(
					"Glob",
					{ pattern: "*.ts" },
					"src/a.ts\nsrc/b.ts",
					false,
				);
				expect(result).toContain("Found 2 items");
			});

			it("should return no matches for empty result", () => {
				const result = formatter.formatToolResult(
					"Glob",
					{ pattern: "*.xyz" },
					"",
					false,
				);
				expect(result).toBe("*No matches found*");
			});
		});

		describe("TodoWrite tool", () => {
			it("should return result if provided", () => {
				const result = formatter.formatToolResult(
					"TodoWrite",
					{ todos: [] },
					"Updated 3 todos",
					false,
				);
				expect(result).toBe("Updated 3 todos");
			});

			it("should return success message for empty result", () => {
				const result = formatter.formatToolResult(
					"TodoWrite",
					{ todos: [] },
					"",
					false,
				);
				expect(result).toBe("*Todos updated*");
			});
		});

		describe("WebFetch tool", () => {
			it("should return content directly", () => {
				const result = formatter.formatToolResult(
					"WebFetch",
					{ url: "https://example.com" },
					"Page content here",
					false,
				);
				expect(result).toBe("Page content here");
			});

			it("should truncate long content", () => {
				const longContent = "x".repeat(1500);
				const result = formatter.formatToolResult(
					"WebFetch",
					{ url: "https://example.com" },
					longContent,
					false,
				);
				expect(result).toContain("...");
				expect(result.length).toBeLessThan(longContent.length);
			});

			it("should return no results for empty content", () => {
				const result = formatter.formatToolResult(
					"WebFetch",
					{ url: "https://example.com" },
					"",
					false,
				);
				expect(result).toBe("*No results*");
			});
		});

		describe("WebSearch tool", () => {
			it("should return result directly", () => {
				const result = formatter.formatToolResult(
					"WebSearch",
					{ query: "test" },
					"Search results here",
					false,
				);
				expect(result).toBe("Search results here");
			});

			it("should return no results for empty content", () => {
				const result = formatter.formatToolResult(
					"WebSearch",
					{ query: "test" },
					"",
					false,
				);
				expect(result).toBe("*No results*");
			});
		});

		describe("Unknown tools", () => {
			it("should wrap multiline long content in code block", () => {
				const longContent = `line1\nline2\n${"x".repeat(100)}`;
				const result = formatter.formatToolResult(
					"CustomTool",
					{},
					longContent,
					false,
				);
				expect(result).toBe(`\`\`\`\n${longContent}\n\`\`\``);
			});

			it("should return short content as-is", () => {
				const result = formatter.formatToolResult(
					"CustomTool",
					{},
					"Short result",
					false,
				);
				expect(result).toBe("Short result");
			});

			it("should return completed for empty result", () => {
				const result = formatter.formatToolResult("CustomTool", {}, "", false);
				expect(result).toBe("*Completed*");
			});
		});
	});
});
