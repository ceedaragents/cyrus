/**
 * Codex Event to SDK Message Adapters
 *
 * Converts OpenAI Codex CLI JSONL events to cyrus-core SDK message format.
 * This adapter enables CodexRunner to implement the IAgentRunner interface.
 *
 * Key Differences from GeminiRunner:
 * - No delta message accumulation needed (Codex sends complete items)
 * - No result coercion needed (agent_message item contains final text)
 * - Uses thread_id instead of session_id
 * - Item-based model vs event-based model
 */

import crypto from "node:crypto";
import { cwd } from "node:process";
import type { SDKSystemMessage } from "cyrus-claude-runner";
import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import type {
	AgentMessageItem,
	CommandExecutionItem,
	FileChangeItem,
	ItemCompletedEvent,
	McpToolCallItem,
	ThreadEvent,
	TodoListItem,
	TurnCompletedEvent,
	TurnFailedEvent,
	Usage,
} from "./schemas.js";
import {
	isAgentMessageItem,
	isCommandExecutionItem,
	isFileChangeItem,
	isItemCompletedEvent,
	isMcpToolCallItem,
	isThreadErrorEvent,
	isThreadStartedEvent,
	isTodoListItem,
	isTurnCompletedEvent,
	isTurnFailedEvent,
} from "./schemas.js";

/**
 * Create a minimal BetaMessage for assistant responses
 *
 * Since we're adapting from Codex CLI to Claude SDK format, we create
 * a minimal valid BetaMessage structure with placeholder values for fields
 * that Codex doesn't provide (model, usage, etc.).
 */
function createBetaMessage(
	content: string | Array<Record<string, unknown>>,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	// Type assertion needed because we're constructing content blocks from Codex format
	// which has the same structure but TypeScript can't verify the runtime types
	const contentBlocks = (typeof content === "string"
		? [{ type: "text", text: content }]
		: content) as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message" as const,
		role: "assistant" as const,
		content: contentBlocks,
		model: "codex" as const,
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			server_tool_use: null,
			service_tier: null,
		},
		container: null,
		context_management: null,
	};
}

/**
 * Convert a command execution item to tool use format
 */
function commandExecutionToToolUse(
	item: CommandExecutionItem,
): SDKAssistantMessage {
	return {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: item.id,
				name: "Bash",
				input: {
					command: item.command,
				},
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: "pending",
	};
}

/**
 * Convert a command execution result to tool result format
 */
function commandExecutionToToolResult(
	item: CommandExecutionItem,
	threadId: string | null,
): SDKUserMessage {
	const isError =
		item.status === "failed" ||
		(item.exit_code !== undefined && item.exit_code !== 0);

	return {
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: item.id,
					content: item.aggregated_output,
					is_error: isError,
				},
			],
		},
		parent_tool_use_id: null,
		session_id: threadId || "pending",
	};
}

/**
 * Convert a file change item to tool use format
 */
function fileChangeToToolUse(item: FileChangeItem): SDKAssistantMessage {
	// Format the changes as Edit tool uses
	const toolUses = item.changes.map((change, index) => ({
		type: "tool_use",
		id: `${item.id}-${index}`,
		name:
			change.kind === "add"
				? "Write"
				: change.kind === "delete"
					? "Bash"
					: "Edit",
		input: {
			file_path: change.path,
			kind: change.kind,
		},
	}));

	return {
		type: "assistant",
		message: createBetaMessage(toolUses),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: "pending",
	};
}

/**
 * Convert a file change result to tool result format
 */
function fileChangeToToolResult(
	item: FileChangeItem,
	threadId: string | null,
): SDKUserMessage {
	const isError = item.status === "failed";
	const results = item.changes.map((change, index) => ({
		type: "tool_result" as const,
		tool_use_id: `${item.id}-${index}`,
		content: isError
			? "Failed to apply change"
			: `${change.kind}: ${change.path}`,
		is_error: isError,
	}));

	return {
		type: "user",
		message: {
			role: "user",
			content: results,
		},
		parent_tool_use_id: null,
		session_id: threadId || "pending",
	};
}

/**
 * Convert an MCP tool call item to tool use format
 */
function mcpToolCallToToolUse(item: McpToolCallItem): SDKAssistantMessage {
	// Format MCP tool name as mcp__{server}__{tool}
	const toolName = `mcp__${item.server}__${item.tool}`;

	return {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: item.id,
				name: toolName,
				input: item.arguments,
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: "pending",
	};
}

/**
 * Convert an MCP tool call result to tool result format
 */
function mcpToolCallToToolResult(
	item: McpToolCallItem,
	threadId: string | null,
): SDKUserMessage {
	let content: string;
	let isError = false;

	if (item.error) {
		content = `Error: ${item.error.message}`;
		isError = true;
	} else if (item.result?.content) {
		// Extract text content from MCP result
		const textBlocks = item.result.content
			.filter((block) => block.type === "text" && block.text)
			.map((block) => block.text);
		content = textBlocks.join("\n") || JSON.stringify(item.result);
	} else if (item.result?.structured_content) {
		content = JSON.stringify(item.result.structured_content);
	} else {
		content = "Success";
	}

	return {
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: item.id,
					content,
					is_error: isError,
				},
			],
		},
		parent_tool_use_id: null,
		session_id: threadId || "pending",
	};
}

/**
 * Convert a todo list item to tool use format
 */
function todoListToToolUse(item: TodoListItem): SDKAssistantMessage {
	return {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: item.id,
				name: "TodoWrite",
				input: {
					todos: item.items.map((todo) => ({
						content: todo.text,
						status: todo.completed ? "completed" : "pending",
					})),
				},
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: "pending",
	};
}

/**
 * Convert a todo list result to tool result format
 */
function todoListToToolResult(
	item: TodoListItem,
	threadId: string | null,
): SDKUserMessage {
	return {
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: item.id,
					content: "Todos updated",
					is_error: false,
				},
			],
		},
		parent_tool_use_id: null,
		session_id: threadId || "pending",
	};
}

/**
 * Convert an agent message item to assistant message
 */
function agentMessageToAssistant(
	item: AgentMessageItem,
	threadId: string | null,
): SDKAssistantMessage {
	return {
		type: "assistant",
		message: createBetaMessage(item.text),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: threadId || "pending",
	};
}

/**
 * Create usage object for result messages
 */
function createUsage(usage?: Usage): SDKResultMessage["usage"] {
	return {
		input_tokens: usage?.input_tokens || 0,
		output_tokens: usage?.output_tokens || 0,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: usage?.cached_input_tokens || 0,
		cache_creation: {
			ephemeral_1h_input_tokens: 0,
			ephemeral_5m_input_tokens: 0,
		},
		server_tool_use: {
			web_fetch_requests: 0,
			web_search_requests: 0,
		},
		service_tier: "standard" as const,
	};
}

/**
 * Convert a turn completed event to result message
 */
function turnCompletedToResult(
	event: TurnCompletedEvent,
	threadId: string | null,
	lastAgentMessage?: string,
): SDKResultMessage {
	return {
		type: "result",
		subtype: "success",
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: false,
		num_turns: 1,
		result: lastAgentMessage || "Session completed successfully",
		total_cost_usd: 0,
		usage: createUsage(event.usage),
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: threadId || "pending",
	};
}

/**
 * Convert a turn failed event to error result message
 */
function turnFailedToResult(
	event: TurnFailedEvent,
	threadId: string | null,
): SDKResultMessage {
	return {
		type: "result",
		subtype: "error_during_execution",
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: true,
		num_turns: 1,
		errors: [event.error.message],
		total_cost_usd: 0,
		usage: createUsage(),
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: threadId || "pending",
	};
}

/**
 * Convert a thread error event to error result message
 */
function threadErrorToResult(
	message: string,
	threadId: string | null,
): SDKResultMessage {
	return {
		type: "result",
		subtype: "error_during_execution",
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: true,
		num_turns: 0,
		errors: [message],
		total_cost_usd: 0,
		usage: createUsage(),
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: threadId || "pending",
	};
}

/**
 * Convert a thread started event to system message
 */
function threadStartedToSystem(
	threadId: string,
	model?: string,
): SDKSystemMessage {
	return {
		type: "system",
		subtype: "init",
		agents: undefined,
		apiKeySource: "user",
		claude_code_version: "codex-adapter",
		cwd: cwd(),
		tools: [],
		mcp_servers: [],
		model: model || "codex",
		permissionMode: "default",
		slash_commands: [],
		output_style: "default",
		skills: [],
		plugins: [],
		uuid: crypto.randomUUID(),
		session_id: threadId,
	};
}

/**
 * Convert an item.completed event to SDK messages
 *
 * Returns an array of messages because some items produce both
 * a tool use message AND a tool result message.
 */
export function itemCompletedToMessages(
	event: ItemCompletedEvent,
	threadId: string | null,
): SDKMessage[] {
	const item = event.item;
	const messages: SDKMessage[] = [];

	if (isCommandExecutionItem(item)) {
		// Command execution produces tool use + tool result
		messages.push(commandExecutionToToolUse(item));
		messages.push(commandExecutionToToolResult(item, threadId));
	} else if (isFileChangeItem(item)) {
		// File change produces tool use + tool result
		messages.push(fileChangeToToolUse(item));
		messages.push(fileChangeToToolResult(item, threadId));
	} else if (isMcpToolCallItem(item)) {
		// MCP tool call produces tool use + tool result
		messages.push(mcpToolCallToToolUse(item));
		messages.push(mcpToolCallToToolResult(item, threadId));
	} else if (isTodoListItem(item)) {
		// Todo list produces tool use + tool result
		messages.push(todoListToToolUse(item));
		messages.push(todoListToToolResult(item, threadId));
	} else if (isAgentMessageItem(item)) {
		// Agent message produces assistant message
		messages.push(agentMessageToAssistant(item, threadId));
	}
	// Reasoning and WebSearch items don't produce SDK messages directly
	// Error items are handled separately

	return messages;
}

/**
 * Convert a Codex thread event to cyrus-core SDKMessage format
 *
 * This adapter maps Codex CLI's JSONL events to the cyrus-core SDKMessage
 * format, allowing CodexRunner to implement the IAgentRunner interface.
 *
 * @param event - Codex CLI thread event
 * @param threadId - Current thread ID (may be null initially)
 * @param model - Model name for system message
 * @param lastAgentMessage - Last agent message text for result coercion
 * @returns Array of SDKMessages or empty array if event doesn't map
 */
export function codexEventToSDKMessages(
	event: ThreadEvent,
	threadId: string | null,
	model?: string,
	lastAgentMessage?: string,
): SDKMessage[] {
	if (isThreadStartedEvent(event)) {
		return [threadStartedToSystem(event.thread_id, model)];
	}

	if (isTurnCompletedEvent(event)) {
		return [turnCompletedToResult(event, threadId, lastAgentMessage)];
	}

	if (isTurnFailedEvent(event)) {
		return [turnFailedToResult(event, threadId)];
	}

	if (isThreadErrorEvent(event)) {
		return [threadErrorToResult(event.message, threadId)];
	}

	if (isItemCompletedEvent(event)) {
		return itemCompletedToMessages(event, threadId);
	}

	// turn.started, item.started, item.updated don't produce SDK messages
	return [];
}

/**
 * Create a Cyrus Core SDK UserMessage from a plain string prompt
 *
 * Helper function to create properly formatted SDKUserMessage objects
 * for the Codex CLI input.
 *
 * @param content - The prompt text
 * @param threadId - Current thread ID (may be null for initial message)
 * @returns Formatted SDKUserMessage
 */
export function createUserMessage(
	content: string,
	threadId: string | null,
): SDKUserMessage {
	return {
		type: "user",
		message: {
			role: "user",
			content: content,
		},
		parent_tool_use_id: null,
		session_id: threadId || "pending",
	};
}
