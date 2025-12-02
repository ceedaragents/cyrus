/**
 * Codex Message Formatter
 *
 * Implements message formatting for Codex SDK tool messages.
 * This formatter understands Codex's specific tool format and converts
 * tool use/result messages into human-readable content for Linear.
 *
 * Codex SDK tool types (from ThreadItem):
 * - command-execution: Execute shell commands
 * - file-change: Apply file patches
 * - mcp-tool-call: MCP server tool calls
 * - todo-list: Task management
 * - web-search: Web search queries
 */

import type { IMessageFormatter } from "cyrus-core";
import type { FormatterToolInput } from "./types.js";

/**
 * Helper to safely get a string property from tool input
 */
function getString(input: FormatterToolInput, key: string): string | undefined {
	if (typeof input === "string") return undefined;
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

/**
 * Helper to safely get a number property from tool input
 */
function getNumber(input: FormatterToolInput, key: string): number | undefined {
	if (typeof input === "string") return undefined;
	const value = input[key];
	return typeof value === "number" ? value : undefined;
}

/**
 * Helper to check if a property exists and is truthy
 */
function hasProperty(input: FormatterToolInput, key: string): boolean {
	if (typeof input === "string") return false;
	return key in input && input[key] !== undefined && input[key] !== null;
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
				id?: string;
				description?: string;
				content?: string;
				status?: string;
				completed?: boolean;
			}>;

			let formatted = "\n";

			todos.forEach((todo, index) => {
				let statusEmoji = "";
				// Handle both Codex format (completed boolean) and cyrus format (status string)
				const isCompleted =
					todo.completed === true || todo.status === "completed";
				const isInProgress = todo.status === "in_progress";
				const isPending = todo.completed === false || todo.status === "pending";

				if (isCompleted) {
					statusEmoji = "✅ ";
				} else if (isInProgress) {
					statusEmoji = "🔄 ";
				} else if (isPending) {
					statusEmoji = "⏳ ";
				}

				const todoText = todo.description || todo.content || "";
				formatted += `${statusEmoji}${todoText}`;
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
	formatToolParameter(toolName: string, toolInput: FormatterToolInput): string {
		// If input is already a string, return it
		if (typeof toolInput === "string") {
			return toolInput;
		}

		try {
			switch (toolName) {
				// Codex tool names (from ThreadItem types)
				case "Bash":
				case "command-execution": {
					// Show command only
					const command = getString(toolInput, "command");
					return command || JSON.stringify(toolInput);
				}

				case "Read":
				case "read_file": {
					const filePath =
						getString(toolInput, "file_path") || getString(toolInput, "path");
					if (filePath) {
						let param = filePath;
						const offset = getNumber(toolInput, "offset");
						const limit = getNumber(toolInput, "limit");
						if (offset !== undefined || limit !== undefined) {
							const start = offset || 0;
							const end = limit ? start + limit : "end";
							param += ` (lines ${start + 1}-${end})`;
						}
						return param;
					}
					break;
				}

				case "Write":
				case "write_file": {
					const filePath =
						getString(toolInput, "file_path") || getString(toolInput, "path");
					if (filePath) {
						return filePath;
					}
					break;
				}

				case "Edit":
				case "file-change": {
					// Handle file patches from Codex
					const filePath =
						getString(toolInput, "file_path") || getString(toolInput, "file");
					if (filePath) {
						return filePath;
					}
					// Check for patches array
					if (hasProperty(toolInput, "patches")) {
						const patches = (toolInput as Record<string, unknown>)
							.patches as Array<{ file?: string }>;
						if (Array.isArray(patches) && patches.length > 0) {
							const files = patches
								.map((p) => p.file)
								.filter(Boolean)
								.join(", ");
							return files || JSON.stringify(toolInput);
						}
					}
					break;
				}

				case "Grep":
				case "search_file_content": {
					const pattern = getString(toolInput, "pattern");
					if (pattern) {
						let param = `Pattern: \`${pattern}\``;
						const path = getString(toolInput, "path");
						if (path) {
							param += ` in ${path}`;
						}
						const glob = getString(toolInput, "glob");
						if (glob) {
							param += ` (${glob})`;
						}
						return param;
					}
					break;
				}

				case "Glob":
				case "list_directory": {
					const pattern = getString(toolInput, "pattern");
					if (pattern) {
						return pattern;
					}
					const dirPath =
						getString(toolInput, "dir_path") || getString(toolInput, "path");
					if (dirPath) {
						return dirPath;
					}
					return ".";
				}

				case "TodoWrite":
				case "todo-list": {
					if (hasProperty(toolInput, "todos")) {
						return this.formatTodoWriteParameter(JSON.stringify(toolInput));
					}
					break;
				}

				case "WebSearch":
				case "web-search": {
					const query = getString(toolInput, "query");
					if (query) {
						return `Query: "${query}"`;
					}
					break;
				}

				default:
					// For MCP tools or other unknown tools
					if (toolName.startsWith("mcp__")) {
						// Extract key fields that are commonly meaningful
						const meaningfulFields = [
							"query",
							"id",
							"issueId",
							"title",
							"name",
							"path",
							"file",
						];
						for (const field of meaningfulFields) {
							const value = getString(toolInput, field);
							if (value) {
								return `${field}: ${value}`;
							}
						}
					}
					break;
			}

			// Fallback to JSON but make it compact
			return JSON.stringify(toolInput);
		} catch (error) {
			console.error(
				"[CodexMessageFormatter] Failed to format tool parameter:",
				error,
			);
			return JSON.stringify(toolInput);
		}
	}

	/**
	 * Format tool action name with description
	 */
	formatToolActionName(
		toolName: string,
		toolInput: FormatterToolInput,
		isError: boolean,
	): string {
		// Handle Bash/command-execution with description
		if (toolName === "Bash" || toolName === "command-execution") {
			const description = getString(toolInput, "description");
			if (description) {
				const baseName = isError ? `${toolName} (Error)` : toolName;
				return `${baseName} (${description})`;
			}
		}

		// Default formatting
		return isError ? `${toolName} (Error)` : toolName;
	}

	/**
	 * Format tool result for display in Linear agent activities
	 * Converts raw tool results into formatted Markdown
	 */
	formatToolResult(
		toolName: string,
		toolInput: FormatterToolInput,
		result: string,
		isError: boolean,
	): string {
		// If there's an error, wrap in error formatting
		if (isError) {
			return `\`\`\`\n${result}\n\`\`\``;
		}

		try {
			switch (toolName) {
				case "Bash":
				case "command-execution": {
					let formatted = "";
					const command = getString(toolInput, "command");
					const description = getString(toolInput, "description");
					if (command && !description) {
						formatted += `\`\`\`bash\n${command}\n\`\`\`\n\n`;
					}
					if (result?.trim()) {
						formatted += `\`\`\`\n${result}\n\`\`\``;
					} else {
						formatted += "*No output*";
					}
					return formatted;
				}

				case "Read":
				case "read_file": {
					if (result?.trim()) {
						// Try to detect language from file extension
						let lang = "";
						const filePath =
							getString(toolInput, "file_path") || getString(toolInput, "path");
						if (filePath) {
							const ext = filePath.split(".").pop()?.toLowerCase();
							const langMap: Record<string, string> = {
								ts: "typescript",
								tsx: "typescript",
								js: "javascript",
								jsx: "javascript",
								py: "python",
								rb: "ruby",
								go: "go",
								rs: "rust",
								java: "java",
								c: "c",
								cpp: "cpp",
								cs: "csharp",
								php: "php",
								swift: "swift",
								kt: "kotlin",
								scala: "scala",
								sh: "bash",
								bash: "bash",
								zsh: "bash",
								yml: "yaml",
								yaml: "yaml",
								json: "json",
								xml: "xml",
								html: "html",
								css: "css",
								scss: "scss",
								md: "markdown",
								sql: "sql",
							};
							lang = langMap[ext || ""] || "";
						}
						return `\`\`\`${lang}\n${result}\n\`\`\``;
					}
					return "*File read successfully*";
				}

				case "Write":
				case "write_file":
					if (result?.trim()) {
						return result;
					}
					return "*File written successfully*";

				case "Edit":
				case "file-change": {
					// Check for patches in input
					if (hasProperty(toolInput, "patches")) {
						const patches = (toolInput as Record<string, unknown>)
							.patches as Array<{ file?: string; patch?: string }>;
						if (Array.isArray(patches) && patches.length > 0) {
							let diff = "```diff\n";
							for (const p of patches) {
								if (p.file) {
									diff += `--- ${p.file}\n+++ ${p.file}\n`;
								}
								if (p.patch) {
									diff += `${p.patch}\n`;
								}
							}
							diff += "```";
							return diff;
						}
					}

					if (result?.trim()) {
						return result;
					}
					return "*Edit completed*";
				}

				case "Grep":
				case "search_file_content": {
					if (result?.trim()) {
						const lines = result.split("\n");
						if (
							lines.length > 0 &&
							lines[0] &&
							!lines[0].includes(":") &&
							lines[0].trim().length > 0
						) {
							return `Found ${lines.filter((l) => l.trim()).length} matching files:\n\`\`\`\n${result}\n\`\`\``;
						}
						return `\`\`\`\n${result}\n\`\`\``;
					}
					return "*No matches found*";
				}

				case "Glob":
				case "list_directory": {
					if (result?.trim()) {
						const lines = result.split("\n").filter((l) => l.trim());
						return `Found ${lines.length} items:\n\`\`\`\n${result}\n\`\`\``;
					}
					return "*Empty directory*";
				}

				case "TodoWrite":
				case "todo-list":
					if (result?.trim()) {
						return result;
					}
					return "*Todos updated*";

				case "WebSearch":
				case "web-search":
					if (result?.trim()) {
						return `\`\`\`\n${result}\n\`\`\``;
					}
					return "*Search completed*";

				default:
					// For unknown tools, use code block if result has multiple lines
					if (result?.trim()) {
						if (result.includes("\n") && result.length > 100) {
							return `\`\`\`\n${result}\n\`\`\``;
						}
						return result;
					}
					return "*Completed*";
			}
		} catch (error) {
			console.error(
				"[CodexMessageFormatter] Failed to format tool result:",
				error,
			);
			return result || "";
		}
	}
}
