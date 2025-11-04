/**
 * Custom formatters for different tool types in Linear Agent Activities
 * Formats tool inputs in a human-readable way instead of raw JSON
 */

export type ToolInput = Record<string, any>;

/**
 * Format a Bash command execution
 */
function formatBashInput(input: ToolInput): string {
	const command = input.command || "";
	const description = input.description;

	let formatted = "";
	if (description) {
		formatted += `${description}\n\n`;
	}
	formatted += `\`\`\`bash\n${command}\n\`\`\``;

	return formatted;
}

/**
 * Format a Read file operation
 */
function formatReadInput(input: ToolInput): string {
	const filePath = input.file_path || "";
	const offset = input.offset;
	const limit = input.limit;

	let formatted = `**File:** \`${filePath}\``;

	if (offset !== undefined || limit !== undefined) {
		formatted += "\n\n**Range:**";
		if (offset !== undefined) {
			formatted += ` offset=${offset}`;
		}
		if (limit !== undefined) {
			formatted += ` limit=${limit}`;
		}
	}

	return formatted;
}

/**
 * Format an Edit file operation
 */
function formatEditInput(input: ToolInput): string {
	const filePath = input.file_path || "";
	const oldString = input.old_string || "";
	const newString = input.new_string || "";
	const replaceAll = input.replace_all;

	let formatted = `**File:** \`${filePath}\``;

	if (replaceAll) {
		formatted += "\n**Mode:** Replace all occurrences";
	}

	// Show a preview of the change (truncate if too long)
	const maxPreviewLength = 100;

	formatted += "\n\n**Old:**";
	if (oldString.length > maxPreviewLength) {
		formatted += `\n\`\`\`\n${oldString.substring(0, maxPreviewLength)}...\n\`\`\``;
	} else {
		formatted += `\n\`\`\`\n${oldString}\n\`\`\``;
	}

	formatted += "\n\n**New:**";
	if (newString.length > maxPreviewLength) {
		formatted += `\n\`\`\`\n${newString.substring(0, maxPreviewLength)}...\n\`\`\``;
	} else {
		formatted += `\n\`\`\`\n${newString}\n\`\`\``;
	}

	return formatted;
}

/**
 * Format a Write file operation
 */
function formatWriteInput(input: ToolInput): string {
	const filePath = input.file_path || "";
	const content = input.content || "";

	let formatted = `**File:** \`${filePath}\``;

	// Show content preview (truncate if too long)
	const maxPreviewLength = 200;

	formatted += "\n\n**Content:**";
	if (content.length > maxPreviewLength) {
		const lines = content.split("\n");
		const lineCount = lines.length;
		formatted += `\n\`\`\`\n${content.substring(0, maxPreviewLength)}...\n\`\`\`\n*(${lineCount} lines total)*`;
	} else {
		formatted += `\n\`\`\`\n${content}\n\`\`\``;
	}

	return formatted;
}

/**
 * Format a Glob pattern search
 */
function formatGlobInput(input: ToolInput): string {
	const pattern = input.pattern || "";
	const path = input.path;

	let formatted = `**Pattern:** \`${pattern}\``;

	if (path) {
		formatted += `\n**Path:** \`${path}\``;
	}

	return formatted;
}

/**
 * Format a Grep search operation
 */
function formatGrepInput(input: ToolInput): string {
	const pattern = input.pattern || "";
	const path = input.path;
	const glob = input.glob;
	const type = input.type;
	const outputMode = input.output_mode;
	const caseInsensitive = input["-i"];

	let formatted = `**Pattern:** \`${pattern}\``;

	if (caseInsensitive) {
		formatted += " (case-insensitive)";
	}

	if (path) {
		formatted += `\n**Path:** \`${path}\``;
	}

	if (glob) {
		formatted += `\n**Glob:** \`${glob}\``;
	}

	if (type) {
		formatted += `\n**Type:** \`${type}\``;
	}

	if (outputMode) {
		formatted += `\n**Mode:** ${outputMode}`;
	}

	return formatted;
}

/**
 * Format a Task agent operation
 */
function formatTaskInput(input: ToolInput): string {
	const prompt = input.prompt || "";
	const description = input.description;
	const subagentType = input.subagent_type;

	let formatted = "";

	if (description) {
		formatted += `**${description}**\n\n`;
	}

	if (subagentType) {
		formatted += `Agent: \`${subagentType}\`\n\n`;
	}

	// Show prompt preview (truncate if too long)
	const maxPreviewLength = 300;

	if (prompt.length > maxPreviewLength) {
		formatted += `${prompt.substring(0, maxPreviewLength)}...`;
	} else {
		formatted += prompt;
	}

	return formatted;
}

/**
 * Format a WebFetch operation
 */
function formatWebFetchInput(input: ToolInput): string {
	const url = input.url || "";
	const prompt = input.prompt || "";

	let formatted = `**URL:** ${url}`;

	if (prompt) {
		formatted += `\n\n**Query:** ${prompt}`;
	}

	return formatted;
}

/**
 * Format a WebSearch operation
 */
function formatWebSearchInput(input: ToolInput): string {
	const query = input.query || "";
	const allowedDomains = input.allowed_domains;
	const blockedDomains = input.blocked_domains;

	let formatted = `**Query:** ${query}`;

	if (allowedDomains && allowedDomains.length > 0) {
		formatted += `\n**Allowed domains:** ${allowedDomains.join(", ")}`;
	}

	if (blockedDomains && blockedDomains.length > 0) {
		formatted += `\n**Blocked domains:** ${blockedDomains.join(", ")}`;
	}

	return formatted;
}

/**
 * Format NotebookEdit operation
 */
function formatNotebookEditInput(input: ToolInput): string {
	const notebookPath = input.notebook_path || "";
	const cellId = input.cell_id;
	const cellType = input.cell_type;
	const editMode = input.edit_mode || "replace";
	const newSource = input.new_source || "";

	let formatted = `**Notebook:** \`${notebookPath}\``;

	formatted += `\n**Mode:** ${editMode}`;

	if (cellType) {
		formatted += `\n**Cell type:** ${cellType}`;
	}

	if (cellId) {
		formatted += `\n**Cell ID:** \`${cellId}\``;
	}

	// Show content preview (truncate if too long)
	const maxPreviewLength = 150;

	if (editMode !== "delete") {
		formatted += "\n\n**Source:**";
		if (newSource.length > maxPreviewLength) {
			formatted += `\n\`\`\`\n${newSource.substring(0, maxPreviewLength)}...\n\`\`\``;
		} else {
			formatted += `\n\`\`\`\n${newSource}\n\`\`\``;
		}
	}

	return formatted;
}

/**
 * Format SlashCommand operation
 */
function formatSlashCommandInput(input: ToolInput): string {
	const command = input.command || "";

	return `**Command:** \`${command}\``;
}

/**
 * Format Linear MCP operations
 */
function formatLinearMcpInput(toolName: string, input: ToolInput): string {
	// Common Linear operations
	if (toolName.includes("list_issues")) {
		const query = input.query;
		const assignee = input.assignee;
		const state = input.state;
		const team = input.team;

		let formatted = "**List Issues**";

		if (query) {
			formatted += `\n**Search:** ${query}`;
		}
		if (assignee) {
			formatted += `\n**Assignee:** ${assignee}`;
		}
		if (state) {
			formatted += `\n**State:** ${state}`;
		}
		if (team) {
			formatted += `\n**Team:** ${team}`;
		}

		return formatted;
	}

	if (toolName.includes("create_issue")) {
		const title = input.title || "";
		const team = input.team;
		const description = input.description;

		let formatted = `**Create Issue:** ${title}`;

		if (team) {
			formatted += `\n**Team:** ${team}`;
		}

		if (description) {
			const maxPreviewLength = 100;
			formatted += "\n\n**Description:**";
			if (description.length > maxPreviewLength) {
				formatted += ` ${description.substring(0, maxPreviewLength)}...`;
			} else {
				formatted += ` ${description}`;
			}
		}

		return formatted;
	}

	if (toolName.includes("create_comment")) {
		const body = input.body || "";
		const issueId = input.issueId;

		let formatted = `**Comment on:** ${issueId}`;

		const maxPreviewLength = 100;
		if (body.length > maxPreviewLength) {
			formatted += `\n\n${body.substring(0, maxPreviewLength)}...`;
		} else {
			formatted += `\n\n${body}`;
		}

		return formatted;
	}

	// Default for other Linear MCP operations
	return formatDefaultInput(input);
}

/**
 * Default formatter for unknown tools - falls back to JSON but with better formatting
 */
function formatDefaultInput(input: ToolInput): string {
	// For simple inputs with just one or two fields, show them inline
	const keys = Object.keys(input);

	if (keys.length === 0) {
		return "*(no parameters)*";
	}

	if (keys.length === 1) {
		const key = keys[0] as keyof ToolInput;
		const value = input[key];

		// If it's a simple value, show it inline
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			return `**${key}:** ${value}`;
		}
	}

	// For complex inputs, show as formatted JSON
	return `\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``;
}

/**
 * Main formatter function - routes to specific formatter based on tool name
 */
export function formatToolInput(toolName: string, input: ToolInput): string {
	// Remove arrow prefix if present (for subtasks)
	const cleanToolName = toolName.replace(/^↪\s*/, "");

	// Route to specific formatter
	switch (cleanToolName) {
		case "Bash":
			return formatBashInput(input);
		case "Read":
			return formatReadInput(input);
		case "Edit":
			return formatEditInput(input);
		case "Write":
			return formatWriteInput(input);
		case "Glob":
			return formatGlobInput(input);
		case "Grep":
			return formatGrepInput(input);
		case "Task":
			return formatTaskInput(input);
		case "WebFetch":
			return formatWebFetchInput(input);
		case "WebSearch":
			return formatWebSearchInput(input);
		case "NotebookEdit":
			return formatNotebookEditInput(input);
		case "SlashCommand":
			return formatSlashCommandInput(input);
		default:
			// Handle MCP tools (they have prefixes like "mcp__linear__")
			if (cleanToolName.startsWith("mcp__linear__")) {
				return formatLinearMcpInput(cleanToolName, input);
			}

			// Fall back to default formatter
			return formatDefaultInput(input);
	}
}
