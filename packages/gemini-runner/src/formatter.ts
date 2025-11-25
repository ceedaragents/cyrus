/**
 * Gemini Message Formatter
 *
 * Implements message formatting for Gemini CLI tool messages.
 * This formatter understands Gemini's specific tool format and converts
 * tool use/result messages into human-readable content for Linear.
 *
 * Gemini CLI tool names differ from Claude's:
 * - read_file (Claude: Read)
 * - write_file (Claude: Write)
 * - list_directory (Claude: Glob/ls)
 * - search_file_content (Claude: Grep)
 * - run_shell_command (Claude: Bash)
 * - write_todos (Claude: TodoWrite)
 * - replace (Claude: Edit)
 */

import type { IMessageFormatter } from "cyrus-core";

export class GeminiMessageFormatter implements IMessageFormatter {
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
				status: string;
				priority?: string;
			}>;

			// Keep original order but add status indicators
			let formatted = "\n";

			todos.forEach((todo, index) => {
				let statusEmoji = "";
				if (todo.status === "completed") {
					statusEmoji = "\u2705 "; // ✅
				} else if (todo.status === "in_progress") {
					statusEmoji = "\uD83D\uDD04 "; // 🔄
				} else if (todo.status === "pending") {
					statusEmoji = "\u23F3 "; // ⏳
				}

				// Gemini uses 'description' instead of 'content' for todo items
				const todoText = todo.description || todo.content || "";
				formatted += `${statusEmoji}${todoText}`;
				if (index < todos.length - 1) {
					formatted += "\n";
				}
			});

			return formatted;
		} catch (error) {
			console.error(
				"[GeminiMessageFormatter] Failed to format TodoWrite parameter:",
				error,
			);
			return jsonContent;
		}
	}

	/**
	 * Format tool input for display in Linear agent activities
	 * Converts raw tool inputs into user-friendly parameter strings
	 */
	formatToolParameter(toolName: string, toolInput: any): string {
		// If input is already a string, return it
		if (typeof toolInput === "string") {
			return toolInput;
		}

		try {
			switch (toolName) {
				// Gemini tool names
				case "run_shell_command": {
					// Show command only
					return toolInput.command || JSON.stringify(toolInput);
				}

				case "read_file":
					if (toolInput.file_path) {
						let param = toolInput.file_path;
						if (
							toolInput.offset !== undefined ||
							toolInput.limit !== undefined
						) {
							const start = toolInput.offset || 0;
							const end = toolInput.limit ? start + toolInput.limit : "end";
							param += ` (lines ${start + 1}-${end})`;
						}
						return param;
					}
					break;

				case "write_file":
					if (toolInput.file_path) {
						return toolInput.file_path;
					}
					break;

				case "replace":
					// Gemini's replace tool has instruction and file_path
					if (toolInput.file_path) {
						let param = toolInput.file_path;
						if (toolInput.instruction) {
							param += ` - ${toolInput.instruction.substring(0, 50)}${toolInput.instruction.length > 50 ? "..." : ""}`;
						}
						return param;
					}
					break;

				case "search_file_content":
					if (toolInput.pattern) {
						let param = `Pattern: \`${toolInput.pattern}\``;
						if (toolInput.path) {
							param += ` in ${toolInput.path}`;
						}
						if (toolInput.glob) {
							param += ` (${toolInput.glob})`;
						}
						return param;
					}
					break;

				case "list_directory":
					if (toolInput.dir_path) {
						return toolInput.dir_path;
					}
					if (toolInput.path) {
						return toolInput.path;
					}
					return ".";

				case "write_todos":
					if (toolInput.todos && Array.isArray(toolInput.todos)) {
						return this.formatTodoWriteParameter(JSON.stringify(toolInput));
					}
					break;

				// Claude-style tool names (for backward compatibility)
				case "Bash":
				case "\u21AA Bash": {
					return toolInput.command || JSON.stringify(toolInput);
				}

				case "Read":
				case "\u21AA Read":
					if (toolInput.file_path) {
						let param = toolInput.file_path;
						if (
							toolInput.offset !== undefined ||
							toolInput.limit !== undefined
						) {
							const start = toolInput.offset || 0;
							const end = toolInput.limit ? start + toolInput.limit : "end";
							param += ` (lines ${start + 1}-${end})`;
						}
						return param;
					}
					break;

				case "Edit":
				case "\u21AA Edit":
					if (toolInput.file_path) {
						return toolInput.file_path;
					}
					break;

				case "Write":
				case "\u21AA Write":
					if (toolInput.file_path) {
						return toolInput.file_path;
					}
					break;

				case "Grep":
				case "\u21AA Grep":
					if (toolInput.pattern) {
						let param = `Pattern: \`${toolInput.pattern}\``;
						if (toolInput.path) {
							param += ` in ${toolInput.path}`;
						}
						if (toolInput.glob) {
							param += ` (${toolInput.glob})`;
						}
						if (toolInput.type) {
							param += ` [${toolInput.type} files]`;
						}
						return param;
					}
					break;

				case "Glob":
				case "\u21AA Glob":
					if (toolInput.pattern) {
						let param = `Pattern: \`${toolInput.pattern}\``;
						if (toolInput.path) {
							param += ` in ${toolInput.path}`;
						}
						return param;
					}
					break;

				case "Task":
				case "\u21AA Task":
					if (toolInput.description) {
						return toolInput.description;
					}
					break;

				case "WebFetch":
				case "\u21AA WebFetch":
					if (toolInput.url) {
						return toolInput.url;
					}
					break;

				case "WebSearch":
				case "\u21AA WebSearch":
					if (toolInput.query) {
						return `Query: ${toolInput.query}`;
					}
					break;

				case "NotebookEdit":
				case "\u21AA NotebookEdit":
					if (toolInput.notebook_path) {
						let param = toolInput.notebook_path;
						if (toolInput.cell_id) {
							param += ` (cell ${toolInput.cell_id})`;
						}
						return param;
					}
					break;

				default:
					// For MCP tools or other unknown tools, try to extract meaningful info
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
							if (toolInput[field]) {
								return `${field}: ${toolInput[field]}`;
							}
						}
					}
					break;
			}

			// Fallback to JSON but make it compact
			return JSON.stringify(toolInput);
		} catch (error) {
			console.error(
				"[GeminiMessageFormatter] Failed to format tool parameter:",
				error,
			);
			return JSON.stringify(toolInput);
		}
	}

	/**
	 * Format tool action name with description for shell command tool
	 * Puts the description in round brackets after the tool name in the action field
	 */
	formatToolActionName(
		toolName: string,
		toolInput: any,
		isError: boolean,
	): string {
		// Handle run_shell_command tool with description
		if (toolName === "run_shell_command") {
			// Check if toolInput has a description field
			if (
				toolInput &&
				typeof toolInput === "object" &&
				"description" in toolInput &&
				toolInput.description
			) {
				const baseName = isError ? `${toolName} (Error)` : toolName;
				return `${baseName} (${toolInput.description})`;
			}
		}

		// Handle Bash tool (Claude-style) with description
		if (toolName === "Bash" || toolName === "\u21AA Bash") {
			if (
				toolInput &&
				typeof toolInput === "object" &&
				"description" in toolInput &&
				toolInput.description
			) {
				const baseName = isError ? `${toolName} (Error)` : toolName;
				return `${baseName} (${toolInput.description})`;
			}
		}

		// Default formatting for other tools
		return isError ? `${toolName} (Error)` : toolName;
	}

	/**
	 * Format tool result for display in Linear agent activities
	 * Converts raw tool results into formatted Markdown
	 */
	formatToolResult(
		toolName: string,
		toolInput: any,
		result: string,
		isError: boolean,
	): string {
		// If there's an error, wrap in error formatting
		if (isError) {
			return `\`\`\`\n${result}\n\`\`\``;
		}

		try {
			switch (toolName) {
				// Gemini tool names
				case "run_shell_command": {
					let formatted = "";
					if (toolInput.command && !toolInput.description) {
						formatted += `\`\`\`bash\n${toolInput.command}\n\`\`\`\n\n`;
					}
					if (result?.trim()) {
						formatted += `\`\`\`\n${result}\n\`\`\``;
					} else {
						formatted += "*No output*";
					}
					return formatted;
				}

				case "read_file":
					if (result?.trim()) {
						// Clean up the result: remove line numbers and system-reminder tags
						let cleanedResult = result;

						// Remove line numbers (format: "  123\u2192")
						cleanedResult = cleanedResult.replace(/^\s*\d+\u2192/gm, "");

						// Remove system-reminder blocks
						cleanedResult = cleanedResult.replace(
							/<system-reminder>[\s\S]*?<\/system-reminder>/g,
							"",
						);

						// Trim only blank lines (not horizontal whitespace) to preserve indentation
						cleanedResult = cleanedResult
							.replace(/^\n+/, "")
							.replace(/\n+$/, "");

						// Try to detect language from file extension
						let lang = "";
						if (toolInput.file_path) {
							const ext = toolInput.file_path.split(".").pop()?.toLowerCase();
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
						return `\`\`\`${lang}\n${cleanedResult}\n\`\`\``;
					}
					return "*Empty file*";

				case "write_file":
					if (result?.trim()) {
						return result;
					}
					return "*File written successfully*";

				case "replace": {
					// For replace/edit, show the instruction if available
					if (toolInput.old_string && toolInput.new_string) {
						// Format as a unified diff
						const oldLines = toolInput.old_string.split("\n");
						const newLines = toolInput.new_string.split("\n");

						let diff = "```diff\n";

						for (const line of oldLines) {
							diff += `-${line}\n`;
						}
						for (const line of newLines) {
							diff += `+${line}\n`;
						}

						diff += "```";
						return diff;
					}

					if (toolInput.instruction) {
						return `*${toolInput.instruction}*\n\n${result || "Edit completed"}`;
					}

					if (result?.trim()) {
						return result;
					}
					return "*Edit completed*";
				}

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

				case "list_directory": {
					if (result?.trim()) {
						const lines = result.split("\n").filter((l) => l.trim());
						return `Found ${lines.length} items:\n\`\`\`\n${result}\n\`\`\``;
					}
					return "*Empty directory*";
				}

				case "write_todos":
					if (result?.trim()) {
						return result;
					}
					return "*Todos updated*";

				// Claude-style tool names (for backward compatibility)
				case "Bash":
				case "\u21AA Bash": {
					let formatted = "";
					if (toolInput.command && !toolInput.description) {
						formatted += `\`\`\`bash\n${toolInput.command}\n\`\`\`\n\n`;
					}
					if (result?.trim()) {
						formatted += `\`\`\`\n${result}\n\`\`\``;
					} else {
						formatted += "*No output*";
					}
					return formatted;
				}

				case "Read":
				case "\u21AA Read":
					if (result?.trim()) {
						let cleanedResult = result;
						cleanedResult = cleanedResult.replace(/^\s*\d+\u2192/gm, "");
						cleanedResult = cleanedResult.replace(
							/<system-reminder>[\s\S]*?<\/system-reminder>/g,
							"",
						);
						cleanedResult = cleanedResult
							.replace(/^\n+/, "")
							.replace(/\n+$/, "");

						let lang = "";
						if (toolInput.file_path) {
							const ext = toolInput.file_path.split(".").pop()?.toLowerCase();
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
						return `\`\`\`${lang}\n${cleanedResult}\n\`\`\``;
					}
					return "*Empty file*";

				case "Edit":
				case "\u21AA Edit": {
					if (toolInput.old_string && toolInput.new_string) {
						const oldLines = toolInput.old_string.split("\n");
						const newLines = toolInput.new_string.split("\n");

						let diff = "```diff\n";

						for (const line of oldLines) {
							diff += `-${line}\n`;
						}
						for (const line of newLines) {
							diff += `+${line}\n`;
						}

						diff += "```";
						return diff;
					}

					if (result?.trim()) {
						return result;
					}
					return "*Edit completed*";
				}

				case "Write":
				case "\u21AA Write":
					if (result?.trim()) {
						return result;
					}
					return "*File written successfully*";

				case "Grep":
				case "\u21AA Grep": {
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
				case "\u21AA Glob": {
					if (result?.trim()) {
						const lines = result.split("\n").filter((l) => l.trim());
						return `Found ${lines.length} matching files:\n\`\`\`\n${result}\n\`\`\``;
					}
					return "*No files found*";
				}

				case "Task":
				case "\u21AA Task":
					if (result?.trim()) {
						if (result.includes("\n")) {
							return `\`\`\`\n${result}\n\`\`\``;
						}
						return result;
					}
					return "*Task completed*";

				case "WebFetch":
				case "\u21AA WebFetch":
				case "WebSearch":
				case "\u21AA WebSearch":
					return result || "*No results*";

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
				"[GeminiMessageFormatter] Failed to format tool result:",
				error,
			);
			return result || "";
		}
	}
}
