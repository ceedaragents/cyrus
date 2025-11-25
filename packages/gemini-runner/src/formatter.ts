/**
 * Message Formatter Interface
 *
 * Defines the contract for formatting tool messages into human-readable content
 * suitable for display in Linear agent activities. Each runner implementation
 * should provide its own formatter that understands its specific message format.
 */
export interface IMessageFormatter {
	/**
	 * Format TodoWrite tool parameter as a nice checklist
	 * @param jsonContent - The raw JSON content from the TodoWrite tool
	 * @returns Formatted checklist string with status emojis
	 */
	formatTodoWriteParameter(jsonContent: string): string;

	/**
	 * Format tool input for display in Linear agent activities
	 * Converts raw tool inputs into user-friendly parameter strings
	 * @param toolName - The name of the tool (e.g., "run_shell_command", "read_file", "search_file_content")
	 * @param toolInput - The raw tool input object
	 * @returns User-friendly parameter string
	 */
	formatToolParameter(toolName: string, toolInput: any): string;

	/**
	 * Format tool action name with description for shell commands
	 * Puts the description in round brackets after the tool name in the action field
	 * @param toolName - The name of the tool
	 * @param toolInput - The raw tool input object
	 * @param isError - Whether the tool result is an error
	 * @returns Formatted action name (e.g., "run_shell_command (List files)")
	 */
	formatToolActionName(
		toolName: string,
		toolInput: any,
		isError: boolean,
	): string;

	/**
	 * Format tool result for display in Linear agent activities
	 * Converts raw tool results into formatted Markdown
	 * @param toolName - The name of the tool
	 * @param toolInput - The raw tool input object
	 * @param result - The raw tool result string
	 * @param isError - Whether the result is an error
	 * @returns Formatted Markdown string
	 */
	formatToolResult(
		toolName: string,
		toolInput: any,
		result: string,
		isError: boolean,
	): string;
}

/**
 * Gemini Message Formatter
 *
 * Implements message formatting for Gemini CLI tool messages.
 * This formatter understands Gemini's specific tool format and converts
 * tool use/result messages into human-readable content for Linear.
 *
 * Gemini Tool Names (from the raw JSON in issue description):
 * - read_file (equivalent to Claude's Read)
 * - search_file_content (equivalent to Claude's Grep)
 * - list_directory (equivalent to Claude's Glob)
 * - write_file (equivalent to Claude's Write)
 * - run_shell_command (equivalent to Claude's Bash)
 * - write_todos (equivalent to Claude's TodoWrite)
 * - replace (equivalent to Claude's Edit)
 */
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
					statusEmoji = "✅ ";
				} else if (todo.status === "in_progress") {
					statusEmoji = "🔄 ";
				} else if (todo.status === "pending") {
					statusEmoji = "⏳ ";
				}

				// Gemini uses 'description' while Claude uses 'content'
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
	 * Map Gemini tool names to human-readable Claude-style names
	 */
	private normalizeToolName(toolName: string): string {
		// Remove ↪ prefix first
		const withoutPrefix = toolName.replace(/^↪ /, "");
		const prefix = toolName.startsWith("↪ ") ? "↪ " : "";

		// Map Gemini tool names to Claude-style names
		const mapping: Record<string, string> = {
			run_shell_command: "Bash",
			read_file: "Read",
			write_file: "Write",
			replace: "Edit",
			search_file_content: "Grep",
			list_directory: "Glob",
			write_todos: "TodoWrite",
		};

		return prefix + (mapping[withoutPrefix] || withoutPrefix);
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
			// Get the original tool name without prefix for matching
			const originalToolName = toolName.replace(/^↪ /, "");

			switch (originalToolName) {
				case "run_shell_command": {
					// Show command only - description goes in action field via formatToolActionName
					return toolInput.command || JSON.stringify(toolInput);
				}

				case "read_file":
					if (toolInput.file_path) {
						const param = toolInput.file_path;
						// Gemini doesn't have offset/limit parameters like Claude
						return param;
					}
					break;

				case "replace":
					if (toolInput.file_path) {
						return toolInput.file_path;
					}
					break;

				case "write_file":
					if (toolInput.file_path) {
						return toolInput.file_path;
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
						if (toolInput.file_type) {
							param += ` [${toolInput.file_type} files]`;
						}
						return param;
					}
					break;

				case "list_directory":
					if (toolInput.dir_path) {
						return `Path: ${toolInput.dir_path}`;
					}
					break;

				case "Task":
					if (toolInput.description) {
						return toolInput.description;
					}
					break;

				case "WebFetch":
					if (toolInput.url) {
						return toolInput.url;
					}
					break;

				case "WebSearch":
					if (toolInput.query) {
						return `Query: ${toolInput.query}`;
					}
					break;

				default:
					// For MCP tools or other unknown tools, try to extract meaningful info
					if (originalToolName.startsWith("mcp__")) {
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
	 * Format tool action name with description for shell commands
	 * Puts the description in round brackets after the tool name in the action field
	 */
	formatToolActionName(
		toolName: string,
		_toolInput: any,
		isError: boolean,
	): string {
		// Use normalized human-readable name
		const humanReadableName = this.normalizeToolName(toolName);

		// Default formatting
		return isError ? `${humanReadableName} (Error)` : humanReadableName;
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
			// Get the original tool name without prefix for matching
			const originalToolName = toolName.replace(/^↪ /, "");

			switch (originalToolName) {
				case "run_shell_command": {
					// Show command first if not already in parameter
					let formatted = "";
					if (toolInput.command) {
						formatted += `\`\`\`bash\n${toolInput.command}\n\`\`\`\n\n`;
					}
					// Then show output
					if (result?.trim()) {
						formatted += `\`\`\`\n${result}\n\`\`\``;
					} else {
						formatted += "*No output*";
					}
					return formatted;
				}

				case "read_file":
					// For read_file, the result is file content - use code block
					if (result?.trim()) {
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
						return `\`\`\`${lang}\n${result}\n\`\`\``;
					}
					// Return empty string for empty files (don't show "*Empty file*")
					return "";

				case "replace": {
					// For replace, show changes as a diff
					// Extract old_string and new_string from toolInput
					if (toolInput.old_string && toolInput.new_string) {
						// Format as a unified diff
						const oldLines = toolInput.old_string.split("\n");
						const newLines = toolInput.new_string.split("\n");

						let diff = "```diff\n";

						// Add context lines before changes (show all old lines with - prefix)
						for (const line of oldLines) {
							diff += `-${line}\n`;
						}

						// Add new lines with + prefix
						for (const line of newLines) {
							diff += `+${line}\n`;
						}

						diff += "```";

						return diff;
					}

					// Fallback to result if old/new strings not available
					if (result?.trim()) {
						return result;
					}
					return "*Edit completed*";
				}

				case "write_file":
					// For write_file, just confirm
					if (result?.trim()) {
						return result; // In case there's an error or message
					}
					return "*File written successfully*";

				case "search_file_content": {
					// Format search results
					if (result?.trim()) {
						const lines = result.split("\n");
						// If it looks like file paths (files_with_matches mode)
						if (
							lines.length > 0 &&
							lines[0] &&
							!lines[0].includes(":") &&
							lines[0].trim().length > 0
						) {
							return `Found ${lines.filter((l) => l.trim()).length} matching files:\n\`\`\`\n${result}\n\`\`\``;
						}
						// Otherwise it's content matches
						return `\`\`\`\n${result}\n\`\`\``;
					}
					return "*No matches found*";
				}

				case "list_directory": {
					if (result?.trim()) {
						const lines = result.split("\n").filter((l) => l.trim());
						return `Found ${lines.length} items:\n\`\`\`\n${result}\n\`\`\``;
					}
					return "*No items found*";
				}

				case "Task":
					// Task results can be complex - keep as is but in code block if multiline
					if (result?.trim()) {
						if (result.includes("\n")) {
							return `\`\`\`\n${result}\n\`\`\``;
						}
						return result;
					}
					return "*Task completed*";

				case "WebFetch":
				case "WebSearch":
					// Web results are usually formatted, keep as is
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
