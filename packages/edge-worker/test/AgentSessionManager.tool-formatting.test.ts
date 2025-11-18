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

		expect(result).toBe("List files in home directory");
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

		expect(result).toBe("Get current directory");
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
});
