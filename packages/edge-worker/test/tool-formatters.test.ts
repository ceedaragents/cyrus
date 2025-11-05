import { describe, expect, test } from "vitest";
import { formatToolInput } from "../src/tool-formatters.js";

describe("Tool Formatters", () => {
	test("formats Bash tool input", () => {
		const input = {
			command: "npm install",
			description: "Install dependencies",
		};

		const result = formatToolInput("Bash", input);

		expect(result).toContain("Install dependencies");
		expect(result).toContain("```bash");
		expect(result).toContain("npm install");
	});

	test("formats Read tool input", () => {
		const input = {
			file_path: "/path/to/file.ts",
			offset: 10,
			limit: 50,
		};

		const result = formatToolInput("Read", input);

		expect(result).toContain("**File:** `/path/to/file.ts`");
		expect(result).toContain("offset=10");
		expect(result).toContain("limit=50");
	});

	test("formats Edit tool input", () => {
		const input = {
			file_path: "/path/to/file.ts",
			old_string: "const foo = 'bar'",
			new_string: "const foo = 'baz'",
			replace_all: false,
		};

		const result = formatToolInput("Edit", input);

		expect(result).toContain("**File:** `/path/to/file.ts`");
		expect(result).toContain("**Old:**");
		expect(result).toContain("const foo = 'bar'");
		expect(result).toContain("**New:**");
		expect(result).toContain("const foo = 'baz'");
	});

	test("formats Write tool input with short content", () => {
		const input = {
			file_path: "/path/to/file.ts",
			content: "console.log('hello');",
		};

		const result = formatToolInput("Write", input);

		expect(result).toContain("**File:** `/path/to/file.ts`");
		expect(result).toContain("**Content:**");
		expect(result).toContain("console.log('hello');");
	});

	test("formats Write tool input with long content", () => {
		const input = {
			file_path: "/path/to/file.ts",
			content: "a".repeat(300),
		};

		const result = formatToolInput("Write", input);

		expect(result).toContain("**File:** `/path/to/file.ts`");
		expect(result).toContain("...");
		expect(result).toContain("lines total");
	});

	test("formats Glob tool input", () => {
		const input = {
			pattern: "**/*.ts",
			path: "/src",
		};

		const result = formatToolInput("Glob", input);

		expect(result).toContain("**Pattern:** `**/*.ts`");
		expect(result).toContain("**Path:** `/src`");
	});

	test("formats Grep tool input", () => {
		const input = {
			pattern: "function.*test",
			output_mode: "content",
			"-i": true,
		};

		const result = formatToolInput("Grep", input);

		expect(result).toContain("**Pattern:** `function.*test`");
		expect(result).toContain("case-insensitive");
		expect(result).toContain("**Mode:** content");
	});

	test("formats Task tool input", () => {
		const input = {
			prompt: "Find all TODO comments in the codebase",
			description: "Search for TODOs",
			subagent_type: "Explore",
		};

		const result = formatToolInput("Task", input);

		expect(result).toContain("**Search for TODOs**");
		expect(result).toContain("Agent: `Explore`");
		expect(result).toContain("Find all TODO comments");
	});

	test("formats WebFetch tool input", () => {
		const input = {
			url: "https://example.com/api",
			prompt: "Get the latest docs",
		};

		const result = formatToolInput("WebFetch", input);

		expect(result).toContain("**URL:** https://example.com/api");
		expect(result).toContain("**Query:** Get the latest docs");
	});

	test("formats WebSearch tool input", () => {
		const input = {
			query: "typescript best practices",
			allowed_domains: ["github.com", "stackoverflow.com"],
		};

		const result = formatToolInput("WebSearch", input);

		expect(result).toContain("**Query:** typescript best practices");
		expect(result).toContain(
			"**Allowed domains:** github.com, stackoverflow.com",
		);
	});

	test("formats NotebookEdit tool input", () => {
		const input = {
			notebook_path: "/path/to/notebook.ipynb",
			cell_type: "code",
			edit_mode: "replace",
			new_source: "print('hello')",
		};

		const result = formatToolInput("NotebookEdit", input);

		expect(result).toContain("**Notebook:** `/path/to/notebook.ipynb`");
		expect(result).toContain("**Mode:** replace");
		expect(result).toContain("**Cell type:** code");
		expect(result).toContain("print('hello')");
	});

	test("formats Linear MCP list_issues input", () => {
		const input = {
			query: "bug",
			assignee: "me",
			state: "in_progress",
		};

		const result = formatToolInput("mcp__linear__list_issues", input);

		expect(result).toContain("**List Issues**");
		expect(result).toContain("**Search:** bug");
		expect(result).toContain("**Assignee:** me");
		expect(result).toContain("**State:** in_progress");
	});

	test("formats Linear MCP create_issue input", () => {
		const input = {
			title: "Fix authentication bug",
			team: "engineering",
			description: "Users are unable to login when using OAuth",
		};

		const result = formatToolInput("mcp__linear__create_issue", input);

		expect(result).toContain("**Create Issue:** Fix authentication bug");
		expect(result).toContain("**Team:** engineering");
		expect(result).toContain("**Description:**");
		expect(result).toContain("Users are unable to login");
	});

	test("handles subtask tools with arrow prefix", () => {
		const input = {
			file_path: "/path/to/file.ts",
		};

		const result = formatToolInput("↪ Read", input);

		expect(result).toContain("**File:** `/path/to/file.ts`");
	});

	test("formats unknown tools with simple input", () => {
		const input = {
			name: "test-value",
		};

		const result = formatToolInput("UnknownTool", input);

		expect(result).toBe("**name:** test-value");
	});

	test("formats unknown tools with complex input as JSON", () => {
		const input = {
			field1: "value1",
			field2: { nested: "value" },
		};

		const result = formatToolInput("UnknownTool", input);

		expect(result).toContain("```json");
		expect(result).toContain('"field1": "value1"');
		expect(result).toContain('"nested": "value"');
	});

	test("formats empty input", () => {
		const input = {};

		const result = formatToolInput("AnyTool", input);

		expect(result).toBe("*(no parameters)*");
	});
});
