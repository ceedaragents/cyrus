/**
 * Adapters for converting Codex SDK events to Cyrus SDK message format
 *
 * This module provides functions to translate Codex TypeScript SDK events
 * into the cyrus-core SDKMessage format, allowing CodexRunner to implement
 * the IAgentRunner interface.
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
	CodexAgentMessageItem,
	CodexCommandExecutionItem,
	CodexFileChangeItem,
	CodexMcpToolCallItem,
	CodexThreadEvent,
	CodexThreadItem,
	CodexTodoListItem,
	CodexUsage,
	CodexWebSearchItem,
} from "./types.js";

/**
 * Create a minimal BetaMessage for assistant responses
 *
 * Since we're adapting from Codex SDK to Claude SDK format, we create
 * a minimal valid BetaMessage structure with placeholder values for fields
 * that Codex doesn't provide.
 */
function createBetaMessage(
	content: string | Array<Record<string, unknown>>,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	// Type assertion needed because we're constructing content blocks from Codex format
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
 * Convert a Codex thread item to SDK message format
 *
 * This handles the "item.completed" events that contain the actual
 * agent outputs like messages, tool calls, and file changes.
 */
export function codexItemToSDKMessage(
	item: CodexThreadItem,
	sessionId: string | null,
): SDKMessage | null {
	switch (item.type) {
		case "agent_message": {
			// Agent's text response - SDK uses 'text' field
			const agentItem = item as CodexAgentMessageItem;
			const assistantMessage: SDKAssistantMessage = {
				type: "assistant",
				message: createBetaMessage(agentItem.text),
				parent_tool_use_id: null,
				uuid: crypto.randomUUID(),
				session_id: sessionId || "pending",
			};
			return assistantMessage;
		}

		case "command_execution": {
			// Shell command execution - map to tool_use and tool_result
			return codexCommandToSDKMessage(
				item as CodexCommandExecutionItem,
				sessionId,
			);
		}

		case "file_change": {
			// File changes - map to tool_use for Edit operations
			return codexFileChangeToSDKMessage(
				item as CodexFileChangeItem,
				sessionId,
			);
		}

		case "mcp_tool_call": {
			// MCP tool calls - map to tool_use and tool_result
			return codexMcpToolToSDKMessage(item as CodexMcpToolCallItem, sessionId);
		}

		case "todo_list": {
			// Todo list updates - map to tool_use for TodoWrite
			return codexTodoListToSDKMessage(item as CodexTodoListItem, sessionId);
		}

		case "reasoning": {
			// Reasoning is internal to the model, typically not exposed
			// Could emit as a debug message if needed
			return null;
		}

		case "web_search": {
			// Web search - could map to WebSearch tool use
			const webSearchItem = item as CodexWebSearchItem;
			const toolId = crypto.randomUUID();
			const toolUseMessage: SDKAssistantMessage = {
				type: "assistant",
				message: createBetaMessage([
					{
						type: "tool_use",
						id: toolId,
						name: "WebSearch",
						input: { query: webSearchItem.query },
					},
				]),
				parent_tool_use_id: null,
				uuid: crypto.randomUUID(),
				session_id: sessionId || "pending",
			};
			return toolUseMessage;
		}

		case "error": {
			// Non-fatal error item - emit as error result
			const errorResult: SDKResultMessage = {
				type: "result",
				subtype: "error_during_execution",
				duration_ms: 0,
				duration_api_ms: 0,
				is_error: true,
				num_turns: 0,
				errors: [item.message],
				total_cost_usd: 0,
				usage: createEmptyUsage(),
				modelUsage: {},
				permission_denials: [],
				uuid: crypto.randomUUID(),
				session_id: sessionId || "pending",
			};
			return errorResult;
		}

		default:
			return null;
	}
}

/**
 * Convert a Codex command execution item to SDK messages
 */
function codexCommandToSDKMessage(
	item: CodexCommandExecutionItem,
	sessionId: string | null,
): SDKMessage {
	const toolId = crypto.randomUUID();

	// For all command states (in_progress/completed/failed), emit as tool_use
	// The status is part of the item metadata, not the message structure
	const toolUseMessage: SDKAssistantMessage = {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: toolId,
				name: "Bash",
				input: {
					command: item.command,
					// Include status and output for completed/failed commands
					// SDK uses aggregated_output and exit_code (with underscore)
					...(item.status !== "in_progress" && {
						output: item.aggregated_output,
						exitCode: item.exit_code,
					}),
				},
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId || "pending",
	};

	return toolUseMessage;
}

/**
 * Convert a Codex file change item to SDK message
 */
function codexFileChangeToSDKMessage(
	item: CodexFileChangeItem,
	sessionId: string | null,
): SDKMessage {
	const toolId = crypto.randomUUID();

	// SDK uses 'changes' array with {path, kind} structure
	const firstChange = item.changes[0];
	const filePath = firstChange?.path || "unknown";

	const toolUseMessage: SDKAssistantMessage = {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: toolId,
				name: "Edit",
				input: {
					file_path: filePath,
					// Include all file changes with their paths and kinds
					changes: item.changes,
				},
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId || "pending",
	};

	return toolUseMessage;
}

/**
 * Convert a Codex MCP tool call item to SDK message
 */
function codexMcpToolToSDKMessage(
	item: CodexMcpToolCallItem,
	sessionId: string | null,
): SDKMessage {
	const toolId = crypto.randomUUID();

	// Format tool name as mcp__server__tool (matching Claude's format)
	// SDK uses 'server' and 'tool' fields (not serverName/toolName)
	const toolName = `mcp__${item.server}__${item.tool}`;

	const toolUseMessage: SDKAssistantMessage = {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: toolId,
				name: toolName,
				input: item.arguments,
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId || "pending",
	};

	return toolUseMessage;
}

/**
 * Convert a Codex todo list item to SDK message
 */
function codexTodoListToSDKMessage(
	item: CodexTodoListItem,
	sessionId: string | null,
): SDKMessage {
	const toolId = crypto.randomUUID();

	// Convert Codex todo format to cyrus TodoWrite format
	// SDK uses 'items' array with {text, completed} structure
	const todos = item.items.map((todo) => ({
		content: todo.text,
		status: todo.completed ? "completed" : "pending",
		activeForm: todo.text,
	}));

	const toolUseMessage: SDKAssistantMessage = {
		type: "assistant",
		message: createBetaMessage([
			{
				type: "tool_use",
				id: toolId,
				name: "TodoWrite",
				input: { todos },
			},
		]),
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId || "pending",
	};

	return toolUseMessage;
}

/**
 * Convert a Codex thread event to SDK message format
 *
 * This handles thread-level events like thread.started, turn.completed, etc.
 *
 * @param event - Codex SDK thread event
 * @param sessionId - Current session ID (may be null initially)
 * @param lastAssistantMessage - Last assistant message for result content
 * @param model - Optional model name to use in system init message
 * @returns SDKMessage or null if event type doesn't map to a message
 */
export function codexEventToSDKMessage(
	event: CodexThreadEvent,
	sessionId: string | null,
	lastAssistantMessage?: SDKAssistantMessage | null,
	model?: string,
): SDKMessage | null {
	switch (event.type) {
		case "thread.started": {
			// Thread started - create system init message
			const systemMessage: SDKSystemMessage = {
				type: "system",
				subtype: "init",
				agents: undefined,
				apiKeySource: "user",
				claude_code_version: "codex-adapter",
				cwd: cwd(),
				tools: [],
				mcp_servers: [],
				model: model || "o4-mini",
				permissionMode: "default",
				slash_commands: [],
				output_style: "default",
				skills: [],
				plugins: [],
				uuid: crypto.randomUUID(),
				session_id: event.thread_id,
			};
			return systemMessage;
		}

		case "turn.started": {
			// Turn started - no direct SDK message equivalent
			return null;
		}

		case "turn.completed": {
			// Turn completed - create success result message
			const resultContent = extractResultContent(lastAssistantMessage);

			const resultMessage: SDKResultMessage = {
				type: "result",
				subtype: "success",
				duration_ms: 0, // Codex doesn't provide duration
				duration_api_ms: 0,
				is_error: false,
				num_turns: 1,
				result: resultContent,
				total_cost_usd: 0,
				usage: convertUsage(event.usage),
				modelUsage: {},
				permission_denials: [],
				uuid: crypto.randomUUID(),
				session_id: sessionId || "pending",
			};
			return resultMessage;
		}

		case "turn.failed": {
			// Turn failed - create error result message
			const errorMessage: SDKResultMessage = {
				type: "result",
				subtype: "error_during_execution",
				duration_ms: 0,
				duration_api_ms: 0,
				is_error: true,
				num_turns: 1,
				errors: [event.error.message],
				total_cost_usd: 0,
				usage: convertUsage(event.usage),
				modelUsage: {},
				permission_denials: [],
				uuid: crypto.randomUUID(),
				session_id: sessionId || "pending",
			};
			return errorMessage;
		}

		case "item.started":
		case "item.updated": {
			// Item events during processing - we primarily handle completed items
			return null;
		}

		case "item.completed": {
			// Item completed - convert the item to SDK message
			return codexItemToSDKMessage(event.item, sessionId);
		}

		case "error": {
			// Fatal thread error
			const errorMessage: SDKResultMessage = {
				type: "result",
				subtype: "error_during_execution",
				duration_ms: 0,
				duration_api_ms: 0,
				is_error: true,
				num_turns: 0,
				errors: [event.message],
				total_cost_usd: 0,
				usage: createEmptyUsage(),
				modelUsage: {},
				permission_denials: [],
				uuid: crypto.randomUUID(),
				session_id: sessionId || "pending",
			};
			return errorMessage;
		}

		default:
			return null;
	}
}

/**
 * Extract result content from the last assistant message
 */
function extractResultContent(
	lastAssistantMessage?: SDKAssistantMessage | null,
): string {
	if (!lastAssistantMessage?.message?.content) {
		return "Session completed successfully";
	}

	const content = lastAssistantMessage.message.content;
	if (Array.isArray(content) && content.length > 0) {
		const textBlock = content.find((block) => block.type === "text");
		if (textBlock && "text" in textBlock) {
			return textBlock.text;
		}
	}

	return "Session completed successfully";
}

/**
 * Convert Codex usage to SDK usage format
 */
function convertUsage(codexUsage: CodexUsage): SDKResultMessage["usage"] {
	return {
		input_tokens: codexUsage.input_tokens,
		output_tokens: codexUsage.output_tokens,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: codexUsage.cached_input_tokens,
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
 * Create empty usage object
 */
function createEmptyUsage(): SDKResultMessage["usage"] {
	return {
		input_tokens: 0,
		output_tokens: 0,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
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
 * Create a Cyrus Core SDK UserMessage from a plain string prompt
 *
 * Helper function to create properly formatted SDKUserMessage objects
 * for the Codex SDK input.
 */
export function createUserMessage(
	content: string,
	sessionId: string | null,
): SDKUserMessage {
	return {
		type: "user",
		message: {
			role: "user",
			content: content,
		},
		parent_tool_use_id: null,
		session_id: sessionId || "pending",
	};
}

/**
 * Extract thread ID from Codex thread started event
 */
export function extractThreadId(event: CodexThreadEvent): string | null {
	if (event.type === "thread.started") {
		return event.thread_id;
	}
	return null;
}

/**
 * Create a tool result message for a completed Codex item
 */
export function createToolResultMessage(
	toolUseId: string,
	output: string,
	isError: boolean,
	sessionId: string | null,
): SDKUserMessage {
	return {
		type: "user",
		message: {
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: toolUseId,
					content: output,
					is_error: isError,
				},
			],
		},
		parent_tool_use_id: null,
		session_id: sessionId || "pending",
	};
}
