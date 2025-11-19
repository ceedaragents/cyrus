import type { LinearClient } from "@linear/sdk";
import { describe, expect, test, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";

describe("AgentSessionManager - Tool Formatting", () => {
	// Create a mock LinearClient
	const mockLinearClient = {
		createAgentActivity: vi.fn().mockResolvedValue({
			success: true,
			agentActivity: Promise.resolve({ id: "test-activity-id" }),
		}),
	} as unknown as LinearClient;

	// Helper to access private methods for testing
	function getPrivateMethod(obj: any, methodName: string) {
		return obj[methodName].bind(obj);
	}

	test("formatToolParameter - Bash tool with description", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("Bash", {
			command: "ls -la /home/user",
			description: "List files in home directory",
		});

		// Should show command only - description goes in action field via formatToolActionName
		expect(result).toBe("ls -la /home/user");
	});

	test("formatToolParameter - Bash tool without description", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("Bash", {
			command: "ls -la /home/user",
		});

		expect(result).toBe("ls -la /home/user");
	});

	test("formatToolParameter - Read tool with file path", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("Read", {
			file_path: "/home/user/test.ts",
		});

		expect(result).toBe("/home/user/test.ts");
	});

	test("formatToolParameter - Read tool with line range", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("Read", {
			file_path: "/home/user/test.ts",
			offset: 10,
			limit: 20,
		});

		expect(result).toBe("/home/user/test.ts (lines 11-30)");
	});

	test("formatToolParameter - Grep tool with pattern", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("Grep", {
			pattern: "TODO",
			path: "/home/user",
			glob: "*.ts",
		});

		expect(result).toBe("Pattern: `TODO` in /home/user (*.ts)");
	});

	test("formatToolParameter - Glob tool with pattern", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("Glob", {
			pattern: "**/*.ts",
			path: "/home/user",
		});

		expect(result).toBe("Pattern: `**/*.ts` in /home/user");
	});

	test("formatToolParameter - WebSearch tool with query", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("WebSearch", {
			query: "Linear API documentation",
		});

		expect(result).toBe("Query: Linear API documentation");
	});

	test("formatToolParameter - MCP tool extracts meaningful field", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("mcp__linear__get_issue", {
			id: "CYPACK-395",
			someOtherField: "value",
		});

		expect(result).toBe("id: CYPACK-395");
	});

	test("formatToolResult - Bash tool with output", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Bash",
			{ command: "echo hello", description: "Test command" },
			"hello\nworld",
			false,
		);

		expect(result).toContain("```\nhello\nworld\n```");
	});

	test("formatToolResult - Bash tool without output", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Bash",
			{ command: "touch file.txt", description: "Create file" },
			"",
			false,
		);

		expect(result).toContain("*No output*");
	});

	test("formatToolResult - Read tool with TypeScript file", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Read",
			{ file_path: "/home/user/test.ts" },
			"const x = 1;\nconsole.log(x);",
			false,
		);

		expect(result).toContain(
			"```typescript\nconst x = 1;\nconsole.log(x);\n```",
		);
	});

	test("formatToolResult - Read tool removes line numbers and system-reminder", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const resultWithLineNumbers =
			"  25→def foo():\n  26→    return 1\n\n<system-reminder>\nThis is a reminder\n</system-reminder>";

		const result = formatToolResult(
			"Read",
			{ file_path: "/home/user/test.py" },
			resultWithLineNumbers,
			false,
		);

		// Should not contain line numbers or system-reminder
		expect(result).not.toContain("25→");
		expect(result).not.toContain("26→");
		expect(result).not.toContain("<system-reminder>");
		expect(result).toContain("```python\ndef foo():\n    return 1\n```");
	});

	test("formatToolResult - Edit tool shows diff format", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Edit",
			{
				file_path: "/home/user/test.ts",
				old_string: "const x = 1;",
				new_string: "const x = 2;",
			},
			"",
			false,
		);

		// Should be formatted as a diff
		expect(result).toContain("```diff");
		expect(result).toContain("-const x = 1;");
		expect(result).toContain("+const x = 2;");
	});

	test("formatToolResult - Grep tool with file matches", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Grep",
			{ pattern: "TODO" },
			"file1.ts\nfile2.ts\nfile3.ts",
			false,
		);

		expect(result).toContain("Found 3 matching files:");
		expect(result).toContain("```\nfile1.ts\nfile2.ts\nfile3.ts\n```");
	});

	test("formatToolResult - Glob tool with results", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Glob",
			{ pattern: "*.ts" },
			"file1.ts\nfile2.ts",
			false,
		);

		expect(result).toContain("Found 2 matching files:");
		expect(result).toContain("```\nfile1.ts\nfile2.ts\n```");
	});

	test("formatToolResult - Error result", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Bash",
			{ command: "invalid command" },
			"Error: command not found",
			true,
		);

		expect(result).toBe("```\nError: command not found\n```");
	});

	test("formatToolResult - Write tool success", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"Write",
			{ file_path: "/home/user/test.ts" },
			"",
			false,
		);

		expect(result).toBe("*File written successfully*");
	});

	test("formatToolParameter - handles arrow prefix for subtasks", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolParameter = getPrivateMethod(
			manager,
			"formatToolParameter",
		);

		const result = formatToolParameter("↪ Bash", {
			command: "pwd",
			description: "Get current directory",
		});

		// Should show command only - description goes in action field via formatToolActionName
		expect(result).toBe("pwd");
	});

	test("formatToolResult - handles arrow prefix for subtasks", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolResult = getPrivateMethod(manager, "formatToolResult");

		const result = formatToolResult(
			"↪ Read",
			{ file_path: "/home/user/test.js" },
			"console.log('test');",
			false,
		);

		expect(result).toContain("```javascript\nconsole.log('test');\n```");
	});

	test("formatToolActionName - Bash tool with description", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolActionName = getPrivateMethod(
			manager,
			"formatToolActionName",
		);

		const result = formatToolActionName(
			"Bash",
			{
				command: "ls -la",
				description: "List all files",
			},
			false,
		);

		// Should show action name with description in round brackets
		expect(result).toBe("Bash (List all files)");
	});

	test("formatToolActionName - Bash tool without description", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolActionName = getPrivateMethod(
			manager,
			"formatToolActionName",
		);

		const result = formatToolActionName(
			"Bash",
			{
				command: "ls -la",
			},
			false,
		);

		// Should show action name without description
		expect(result).toBe("Bash");
	});

	test("formatToolActionName - Bash tool with error and description", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolActionName = getPrivateMethod(
			manager,
			"formatToolActionName",
		);

		const result = formatToolActionName(
			"Bash",
			{
				command: "invalid command",
				description: "Test command",
			},
			true,
		);

		// Should show error with description
		expect(result).toBe("Bash (Error) (Test command)");
	});

	test("formatToolActionName - subtask Bash tool with description", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolActionName = getPrivateMethod(
			manager,
			"formatToolActionName",
		);

		const result = formatToolActionName(
			"↪ Bash",
			{
				command: "pwd",
				description: "Get current directory",
			},
			false,
		);

		// Should show subtask action name with description
		expect(result).toBe("↪ Bash (Get current directory)");
	});

	test("formatToolActionName - other tools without special formatting", () => {
		const manager = new AgentSessionManager(mockLinearClient);
		const formatToolActionName = getPrivateMethod(
			manager,
			"formatToolActionName",
		);

		const result = formatToolActionName("Read", { file_path: "/test" }, false);

		// Should show action name without modification for non-Bash tools
		expect(result).toBe("Read");
	});
});
