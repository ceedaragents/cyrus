/**
 * OpenCode Message Formatter
 *
 * Implements message formatting for OpenCode tool messages.
 * This formatter understands OpenCode's specific tool format and converts
 * tool use/result messages into human-readable content for Linear.
 *
 * OpenCode tool names (lowercase):
 * - read: Read file contents
 * - write: Write content to a file
 * - edit: Edit/replace content in files
 * - list: List directory contents
 * - bash: Execute shell commands
 * - glob: Find files by pattern
 * - grep: Search for patterns in files
 * - webfetch: Fetch URL content
 * - todo: Update task list
 */

import type { IMessageFormatter } from "cyrus-core";

/**
 * Type for tool input parameters
 */
export type FormatterToolInput = Record<string, unknown>;

/**
 * Helper to safely get a string property from tool input
 */
function getString(input: FormatterToolInput, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

/**
 * Helper to safely get a number property from tool input
 */
function getNumber(input: FormatterToolInput, key: string): number | undefined {
	const value = input[key];
	return typeof value === "number" ? value : undefined;
}

/**
 * Helper to check if a property exists and is truthy
 */
function hasProperty(input: FormatterToolInput, key: string): boolean {
	return key in input && input[key] !== undefined && input[key] !== null;
}

/**
 * Map of file extensions to language identifiers for syntax highlighting
 */
const LANGUAGE_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	mjs: "javascript",
	cjs: "javascript",
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
	fish: "bash",
	yml: "yaml",
	yaml: "yaml",
	json: "json",
	xml: "xml",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	sass: "scss",
	less: "less",
	md: "markdown",
	markdown: "markdown",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	toml: "toml",
	ini: "ini",
	dockerfile: "dockerfile",
	makefile: "makefile",
	vue: "vue",
	svelte: "svelte",
};

/**
 * Maximum length for tool results before truncation
 */
const MAX_RESULT_LENGTH = 10000;

/**
 * Truncate long content with an ellipsis indicator
 */
function truncateContent(
	content: string,
	maxLength: number = MAX_RESULT_LENGTH,
): string {
	if (content.length <= maxLength) {
		return content;
	}
	const truncated = content.substring(0, maxLength);
	// Try to truncate at a line boundary for cleaner output
	const lastNewline = truncated.lastIndexOf("\n");
	if (lastNewline > maxLength * 0.8) {
		return `${truncated.substring(0, lastNewline)}\n\n... (truncated)`;
	}
	return `${truncated}\n\n... (truncated)`;
}

/**
 * Detect language from file path for syntax highlighting
 */
function detectLanguage(filePath: string | undefined): string {
	if (!filePath) return "";
	const ext = filePath.split(".").pop()?.toLowerCase();
	return LANGUAGE_MAP[ext || ""] || "";
}

/**
 * Clean file content by removing line numbers and system-reminder tags
 */
function cleanFileContent(content: string): string {
	let cleaned = content;

	// Remove line numbers (format: "  123→" or "123\t")
	cleaned = cleaned.replace(/^\s*\d+[→\t]/gm, "");

	// Remove system-reminder blocks
	cleaned = cleaned.replace(
		/<system-reminder>[\s\S]*?<\/system-reminder>/g,
		"",
	);

	// Trim only blank lines (not horizontal whitespace) to preserve indentation
	cleaned = cleaned.replace(/^\n+/, "").replace(/\n+$/, "");

	return cleaned;
}

/**
 * Format MCP tool name for display
 * Extracts server and tool name from format: mcp_{server}_{tool}
 */
function formatMcpToolName(toolName: string): string {
	// Handle mcp_{server}_{tool} format
	const match = toolName.match(/^mcp_([^_]+)_(.+)$/);
	if (match?.[1] && match[2]) {
		const server = match[1];
		const tool = match[2];
		// Capitalize server name and format tool name
		const formattedServer = server.charAt(0).toUpperCase() + server.slice(1);
		const formattedTool = tool
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join(" ");
		return `${formattedServer}: ${formattedTool}`;
	}
	return toolName;
}

/**
 * OpenCode Message Formatter
 *
 * Implements IMessageFormatter for OpenCode tool messages.
 */
export class OpenCodeMessageFormatter implements IMessageFormatter {
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
				content?: string;
				description?: string;
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

				// Support both 'content' and 'description' fields
				const todoText = todo.content || todo.description || "";
				formatted += `${statusEmoji}${todoText}`;
				if (index < todos.length - 1) {
					formatted += "\n";
				}
			});

			return formatted;
		} catch (error) {
			console.error(
				"[OpenCodeMessageFormatter] Failed to format TodoWrite parameter:",
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
				// OpenCode tool names (lowercase)
				case "bash": {
					// Show command only - description goes in action field via formatToolActionName
					const command = getString(toolInput, "command");
					return command || JSON.stringify(toolInput);
				}

				case "read": {
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

				case "write": {
					const filePath =
						getString(toolInput, "file_path") || getString(toolInput, "path");
					if (filePath) {
						return filePath;
					}
					break;
				}

				case "edit": {
					const filePath =
						getString(toolInput, "file_path") || getString(toolInput, "path");
					if (filePath) {
						return filePath;
					}
					break;
				}

				case "grep": {
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
						const type = getString(toolInput, "type");
						if (type) {
							param += ` [${type} files]`;
						}
						return param;
					}
					break;
				}

				case "glob": {
					const pattern = getString(toolInput, "pattern");
					if (pattern) {
						let param = `Pattern: \`${pattern}\``;
						const path = getString(toolInput, "path");
						if (path) {
							param += ` in ${path}`;
						}
						return param;
					}
					break;
				}

				case "list": {
					const dirPath =
						getString(toolInput, "dir_path") ||
						getString(toolInput, "path") ||
						getString(toolInput, "directory");
					return dirPath || ".";
				}

				case "webfetch": {
					const url = getString(toolInput, "url");
					if (url) {
						return url;
					}
					break;
				}

				case "todo": {
					if (
						hasProperty(toolInput, "todos") &&
						Array.isArray(toolInput.todos)
					) {
						return this.formatTodoWriteParameter(JSON.stringify(toolInput));
					}
					break;
				}

				default:
					// Handle MCP tools (format: mcp_{server}_{tool})
					if (toolName.startsWith("mcp_")) {
						// Extract key fields that are commonly meaningful
						const meaningfulFields = [
							"query",
							"id",
							"issueId",
							"title",
							"name",
							"path",
							"file",
							"body",
							"content",
						];
						for (const field of meaningfulFields) {
							const value = getString(toolInput, field);
							if (value) {
								// Truncate long values
								const displayValue =
									value.length > 100 ? `${value.substring(0, 100)}...` : value;
								return `${field}: ${displayValue}`;
							}
						}
					}
					break;
			}

			// Fallback to JSON but make it compact
			return JSON.stringify(toolInput);
		} catch (error) {
			console.error(
				"[OpenCodeMessageFormatter] Failed to format tool parameter:",
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
		toolInput: FormatterToolInput,
		isError: boolean,
	): string {
		// Handle bash tool with description
		if (toolName === "bash") {
			const description = getString(toolInput, "description");
			if (description) {
				const baseName = isError ? "bash (Error)" : "bash";
				return `${baseName} (${description})`;
			}
		}

		// Handle MCP tools - format the name nicely
		if (toolName.startsWith("mcp_")) {
			const formattedName = formatMcpToolName(toolName);
			return isError ? `${formattedName} (Error)` : formattedName;
		}

		// Default formatting for other tools
		return isError ? `${toolName} (Error)` : toolName;
	}

	/**
	 * Format tool result for display in Linear agent activities
	 * Converts raw tool results into formatted Markdown with truncation for long outputs
	 */
	formatToolResult(
		toolName: string,
		toolInput: FormatterToolInput,
		result: string,
		isError: boolean,
	): string {
		// If there's an error, wrap in error formatting
		if (isError) {
			const truncatedResult = truncateContent(result);
			return `\`\`\`\n${truncatedResult}\n\`\`\``;
		}

		try {
			switch (toolName) {
				// OpenCode tool names (lowercase)
				case "bash": {
					let formatted = "";
					const command = getString(toolInput, "command");
					const description = getString(toolInput, "description");
					if (command && !description) {
						formatted += `\`\`\`bash\n${command}\n\`\`\`\n\n`;
					}
					if (result?.trim()) {
						const truncatedResult = truncateContent(result);
						formatted += `\`\`\`\n${truncatedResult}\n\`\`\``;
					} else {
						formatted += "*No output*";
					}
					return formatted;
				}

				case "read": {
					if (result?.trim()) {
						// Clean up the result: remove line numbers and system-reminder tags
						const cleanedResult = cleanFileContent(result);
						const truncatedResult = truncateContent(cleanedResult);

						// Try to detect language from file extension
						const filePath =
							getString(toolInput, "file_path") || getString(toolInput, "path");
						const lang = detectLanguage(filePath);
						return `\`\`\`${lang}\n${truncatedResult}\n\`\`\``;
					}
					return "*Empty file*";
				}

				case "write": {
					if (result?.trim()) {
						return result;
					}
					return "*File written successfully*";
				}

				case "edit": {
					// For Edit, show changes as a diff
					const oldString = getString(toolInput, "old_string");
					const newString = getString(toolInput, "new_string");
					if (oldString && newString) {
						// Format as a unified diff
						const oldLines = oldString.split("\n");
						const newLines = newString.split("\n");

						let diff = "```diff\n";

						// Add old lines with - prefix
						for (const line of oldLines) {
							diff += `-${line}\n`;
						}

						// Add new lines with + prefix
						for (const line of newLines) {
							diff += `+${line}\n`;
						}

						diff += "```";

						return truncateContent(diff);
					}

					// Fallback to result if old/new strings not available
					if (result?.trim()) {
						return truncateContent(result);
					}
					return "*Edit completed*";
				}

				case "grep": {
					if (result?.trim()) {
						const lines = result.split("\n");
						const truncatedResult = truncateContent(result);
						// If it looks like file paths (files_with_matches mode)
						if (
							lines.length > 0 &&
							lines[0] &&
							!lines[0].includes(":") &&
							lines[0].trim().length > 0
						) {
							return `Found ${lines.filter((l) => l.trim()).length} matching files:\n\`\`\`\n${truncatedResult}\n\`\`\``;
						}
						// Otherwise it's content matches
						return `\`\`\`\n${truncatedResult}\n\`\`\``;
					}
					return "*No matches found*";
				}

				case "glob": {
					if (result?.trim()) {
						const lines = result.split("\n").filter((l) => l.trim());
						const truncatedResult = truncateContent(result);
						return `Found ${lines.length} matching files:\n\`\`\`\n${truncatedResult}\n\`\`\``;
					}
					return "*No files found*";
				}

				case "list": {
					if (result?.trim()) {
						const lines = result.split("\n").filter((l) => l.trim());
						const truncatedResult = truncateContent(result);
						return `Found ${lines.length} items:\n\`\`\`\n${truncatedResult}\n\`\`\``;
					}
					return "*Empty directory*";
				}

				case "webfetch": {
					if (result?.trim()) {
						return truncateContent(result);
					}
					return "*No content fetched*";
				}

				case "todo": {
					if (result?.trim()) {
						return result;
					}
					return "*Todos updated*";
				}

				default:
					// For unknown tools (including MCP), use code block if result has multiple lines
					if (result?.trim()) {
						if (result.includes("\n") && result.length > 100) {
							const truncatedResult = truncateContent(result);
							return `\`\`\`\n${truncatedResult}\n\`\`\``;
						}
						return truncateContent(result);
					}
					return "*Completed*";
			}
		} catch (error) {
			console.error(
				"[OpenCodeMessageFormatter] Failed to format tool result:",
				error,
			);
			return result || "";
		}
	}
}
