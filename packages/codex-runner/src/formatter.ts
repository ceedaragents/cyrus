/**
 * Codex Message Formatter
 *
 * Implements message formatting for Codex CLI tool messages.
 * This formatter understands Codex's specific tool format and converts
 * tool use/result messages into human-readable content for Linear.
 *
 * Codex CLI tool names:
 * - command_execution: Execute shell commands
 * - file_change: Modify files (create, update, delete)
 * - mcp_tool_call: Call MCP server tools
 * - reasoning: AI reasoning/thinking
 */

import type { IMessageFormatter } from "cyrus-core";

/**
 * Type for Codex tool inputs (Record of unknown values)
 */
export type CodexToolInput = Record<string, unknown>;

/**
 * Helper to safely get a string property from tool input
 */
function getString(input: CodexToolInput, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

/**
 * Helper to safely get a number property from tool input
 */
function getNumber(input: CodexToolInput, key: string): number | undefined {
	const value = input[key];
	return typeof value === "number" ? value : undefined;
}

/**
 * Detect programming language from file path or content
 */
function detectLanguage(filePath?: string, content?: string): string {
	if (filePath) {
		const ext = filePath.split(".").pop()?.toLowerCase();
		const langMap: Record<string, string> = {
			ts: "typescript",
			tsx: "tsx",
			js: "javascript",
			jsx: "jsx",
			py: "python",
			rb: "ruby",
			go: "go",
			rs: "rust",
			java: "java",
			c: "c",
			cpp: "cpp",
			h: "c",
			hpp: "cpp",
			cs: "csharp",
			php: "php",
			swift: "swift",
			kt: "kotlin",
			scala: "scala",
			sh: "bash",
			bash: "bash",
			zsh: "bash",
			fish: "fish",
			ps1: "powershell",
			yaml: "yaml",
			yml: "yaml",
			json: "json",
			xml: "xml",
			html: "html",
			css: "css",
			scss: "scss",
			sass: "sass",
			md: "markdown",
			sql: "sql",
		};
		if (ext && langMap[ext]) {
			return langMap[ext];
		}
	}

	// Fallback to content-based detection
	if (content) {
		if (content.includes("#!/bin/bash") || content.includes("#!/bin/sh")) {
			return "bash";
		}
		if (content.includes("#!/usr/bin/env python")) {
			return "python";
		}
		if (content.includes("#!/usr/bin/env node")) {
			return "javascript";
		}
	}

	return "";
}

/**
 * Truncate long strings with ellipsis
 */
function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}
	return `${text.substring(0, maxLength - 3)}...`;
}

export class CodexMessageFormatter implements IMessageFormatter {
	/**
	 * Format TodoWrite tool parameter as a nice checklist
	 */
	formatTodoWriteParameter(jsonContent: string): string {
		try {
			const data = JSON.parse(jsonContent);
			if (!data.todos || !Array.isArray(data.todos)) {
				return jsonContent;
			}

			const todos = data.todos as Array<{
				content: string;
				status: string;
				activeForm?: string;
			}>;

			// Keep original order but add status indicators
			let formatted = "\n";

			todos.forEach((todo, index) => {
				let statusEmoji = "";
				if (todo.status === "completed") {
					statusEmoji = "✅ ";
				} else if (todo.status === "in_progress") {
					statusEmoji = "🔄 ";
				} else if (todo.status === "pending") {
					statusEmoji = "⏳ ";
				}

				formatted += `${statusEmoji}${todo.content}`;
				if (index < todos.length - 1) {
					formatted += "\n";
				}
			});

			return formatted;
		} catch (error) {
			console.error(
				"[CodexMessageFormatter] Failed to format TodoWrite parameter:",
				error,
			);
			return jsonContent;
		}
	}

	/**
	 * Format tool input for display in Linear agent activities
	 * Converts raw tool inputs into user-friendly parameter strings
	 */
	formatToolParameter(toolName: string, toolInput: CodexToolInput): string {
		// If input is already a string, return it
		if (typeof toolInput === "string") {
			return toolInput;
		}

		try {
			switch (toolName) {
				case "command_execution": {
					// Show command only
					const command = getString(toolInput, "command");
					return command || JSON.stringify(toolInput);
				}

				case "file_change": {
					const filePath = getString(toolInput, "file_path");
					const changeType = getString(toolInput, "change_type");
					if (filePath) {
						let param = filePath;
						if (changeType) {
							param += ` (${changeType})`;
						}
						return param;
					}
					break;
				}

				case "reasoning": {
					// Truncate reasoning text for parameter display
					const text = getString(toolInput, "text");
					if (text) {
						return truncate(text, 100);
					}
					break;
				}

				default:
					// For MCP tools (mcp__server__tool format), extract meaningful info
					if (toolName.includes("__")) {
						// Extract key fields that are commonly meaningful
						const meaningfulFields = [
							"query",
							"id",
							"issueId",
							"title",
							"name",
							"path",
							"file",
							"command",
							"message",
							"url",
						];

						const extracted: string[] = [];
						for (const field of meaningfulFields) {
							const value = getString(toolInput, field);
							if (value) {
								// Truncate long values
								extracted.push(`${field}: ${truncate(value, 50)}`);
							}
						}

						if (extracted.length > 0) {
							return extracted.join(", ");
						}
					}
					break;
			}

			// Fallback: return JSON string (truncated)
			const jsonStr = JSON.stringify(toolInput);
			return truncate(jsonStr, 200);
		} catch (error) {
			console.error(
				"[CodexMessageFormatter] Failed to format tool parameter:",
				error,
			);
			// Handle circular references or other JSON stringify errors
			try {
				return truncate(String(toolInput), 200);
			} catch {
				return "[complex object]";
			}
		}
	}

	/**
	 * Format tool action name with description
	 * Shows what the tool is doing in a human-readable way
	 */
	formatToolActionName(
		toolName: string,
		toolInput: CodexToolInput,
		isError: boolean,
	): string {
		if (isError) {
			return `❌ ${toolName} (failed)`;
		}

		try {
			switch (toolName) {
				case "command_execution": {
					const command = getString(toolInput, "command");
					if (command) {
						// Truncate command for display
						const cmdDisplay = truncate(command, 60);
						return `$ ${cmdDisplay}`;
					}
					return "Execute command";
				}

				case "file_change": {
					const filePath = getString(toolInput, "file_path");
					const changeType = getString(toolInput, "change_type");
					if (filePath && changeType) {
						const fileName = filePath.split("/").pop() || filePath;
						return `${changeType} ${fileName}`;
					}
					return "File change";
				}

				case "reasoning": {
					return "💭 Thinking";
				}

				default:
					// For MCP tools, format as server:tool
					if (toolName.includes("__")) {
						const parts = toolName.split("__");
						if (parts.length >= 3) {
							// Format: mcp__server__tool -> server:tool
							const serverName = parts[1];
							const toolNamePart = parts.slice(2).join("_");
							return `${serverName}:${toolNamePart}`;
						}
					}
					return toolName;
			}
		} catch (error) {
			console.error(
				"[CodexMessageFormatter] Failed to format tool action name:",
				error,
			);
			return toolName;
		}
	}

	/**
	 * Format tool result for display in Linear
	 * Converts tool outputs into formatted markdown
	 */
	formatToolResult(
		toolName: string,
		toolInput: CodexToolInput,
		result: string,
		isError: boolean,
	): string {
		if (isError) {
			// Format error output
			return `\`\`\`\n${result}\n\`\`\``;
		}

		try {
			switch (toolName) {
				case "command_execution": {
					const command = getString(toolInput, "command");
					const exitCode = getNumber(toolInput, "exit_code");
					const output = getString(toolInput, "output") || result;

					let formatted = "";
					if (command) {
						formatted += `\`\`\`bash\n$ ${command}\n\`\`\`\n\n`;
					}

					if (output?.trim()) {
						// Detect if output looks like code
						const language = command?.includes("cat")
							? detectLanguage(command)
							: "";
						formatted += `\`\`\`${language}\n${output}\n\`\`\``;
					} else {
						formatted += "_No output_";
					}

					if (exitCode !== undefined && exitCode !== 0) {
						formatted += `\n\n**Exit code:** ${exitCode}`;
					}

					return formatted;
				}

				case "file_change": {
					const filePath = getString(toolInput, "file_path");
					const changeType = getString(toolInput, "change_type");
					const content = getString(toolInput, "content");

					let formatted = "";

					if (filePath) {
						formatted += `**File:** \`${filePath}\`\n`;
					}

					if (changeType) {
						formatted += `**Change type:** ${changeType}\n\n`;
					}

					if (content) {
						const language = detectLanguage(filePath, content);
						// Truncate very long content
						const displayContent =
							content.length > 5000
								? `${content.substring(0, 5000)}\n... (truncated)`
								: content;
						formatted += `\`\`\`${language}\n${displayContent}\n\`\`\``;
					}

					return formatted;
				}

				case "reasoning": {
					// Format reasoning as blockquote for better visual distinction
					const text = getString(toolInput, "text") || result;
					if (text) {
						return `> ${text.split("\n").join("\n> ")}`;
					}
					return result;
				}

				default:
					// For MCP tools or unknown tools, format result as code block if it looks like JSON
					try {
						const parsed = JSON.parse(result);
						return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
					} catch {
						// Not JSON, return as plain code block
						if (result.length > 5000) {
							return `\`\`\`\n${result.substring(0, 5000)}...\n\`\`\``;
						}
						return `\`\`\`\n${result}\n\`\`\``;
					}
			}
		} catch (error) {
			console.error(
				"[CodexMessageFormatter] Failed to format tool result:",
				error,
			);
			return `\`\`\`\n${result}\n\`\`\``;
		}
	}
}
