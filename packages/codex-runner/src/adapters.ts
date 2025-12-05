import crypto from "node:crypto";
import { cwd } from "node:process";
import type { SDKSystemMessage } from "cyrus-claude-runner";
import type {
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import type { ThreadEvent, ThreadItem, Usage } from "./schemas.js";
import {
	isAgentMessageItem,
	isCommandExecutionItem,
	isErrorItem,
	isFileChangeItem,
	isItemCompletedEvent,
	isMcpToolCallItem,
	isReasoningItem,
	isThreadErrorEvent,
	isThreadStartedEvent,
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
 * Generate a unique tool ID for tool_use blocks
 *
 * Codex items have IDs but we need to create tool IDs that follow
 * Claude's conventions for tool_use/tool_result correlation.
 *
 * @param itemId - The Codex item ID (e.g., "item_1")
 * @returns A tool ID (e.g., "toolu_01abc123...")
 */
function generateToolId(itemId: string): string {
	// Create a deterministic tool ID based on the item ID
	// This ensures we can correlate tool_use and tool_result events
	const hash = crypto.createHash("sha256").update(itemId).digest("hex");
	return `toolu_${hash.substring(0, 22)}`;
}

/**
 * Convert a Codex thread item to SDK message content
 *
 * Maps different item types to appropriate content blocks for SDK messages.
 * Tool-related items (command_execution, file_change, mcp_tool_call) are
 * converted to tool_use content blocks.
 *
 * @param item - Codex thread item from item.completed event
 * @param sessionId - Current session ID
 * @returns SDKAssistantMessage or null if item type doesn't map to a message
 */
export function convertItemToMessage(
	item: ThreadItem,
	sessionId: string,
): SDKAssistantMessage | null {
	// Agent message - final response text
	if (isAgentMessageItem(item)) {
		return {
			type: "assistant",
			message: createBetaMessage(item.text, crypto.randomUUID()),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};
	}

	// Reasoning - thinking/reasoning summaries
	if (isReasoningItem(item)) {
		return {
			type: "assistant",
			message: createBetaMessage(item.text, crypto.randomUUID()),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};
	}

	// Command execution - map to tool_use block
	if (isCommandExecutionItem(item)) {
		const toolId = generateToolId(item.id);
		return {
			type: "assistant",
			message: createBetaMessage(
				[
					{
						type: "tool_use",
						id: toolId,
						name: "command_execution",
						input: {
							command: item.command,
							output: item.aggregated_output,
							exit_code: item.exit_code,
							status: item.status,
						},
					},
				],
				crypto.randomUUID(),
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};
	}

	// File change - map to tool_use block
	if (isFileChangeItem(item)) {
		const toolId = generateToolId(item.id);
		return {
			type: "assistant",
			message: createBetaMessage(
				[
					{
						type: "tool_use",
						id: toolId,
						name: "file_change",
						input: {
							file_path: item.file_path,
							change_type: item.change_type,
							content: item.content,
							status: item.status,
						},
					},
				],
				crypto.randomUUID(),
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};
	}

	// MCP tool call - map to tool_use block
	if (isMcpToolCallItem(item)) {
		const toolId = generateToolId(item.id);
		return {
			type: "assistant",
			message: createBetaMessage(
				[
					{
						type: "tool_use",
						id: toolId,
						name: item.tool_name,
						input: item.parameters,
					},
				],
				crypto.randomUUID(),
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};
	}

	// Error item - convert to text message
	if (isErrorItem(item)) {
		return {
			type: "assistant",
			message: createBetaMessage(`Error: ${item.message}`, crypto.randomUUID()),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};
	}

	// Web search and todo list items don't map to SDK messages
	// Return null for these types
	return null;
}

/**
 * Create a system message for thread.started events
 *
 * @param threadId - The thread ID from thread.started event
 * @returns SDKSystemMessage with thread initialization info
 */
export function createSystemMessage(threadId: string): SDKSystemMessage {
	return {
		type: "system",
		subtype: "init",
		agents: undefined,
		apiKeySource: "user",
		claude_code_version: "codex-adapter",
		cwd: cwd(),
		tools: [],
		mcp_servers: [],
		model: "codex",
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
 * Create a result message for turn.completed events
 *
 * Extracts content from the last assistant message to include in the result.
 * This ensures the result contains the actual final output, not just metadata.
 *
 * @param usage - Usage statistics from turn.completed event
 * @param lastAgentMessage - Last assistant message for result coercion
 * @returns SDKResultMessage with success status and usage stats
 */
export function createResultMessage(
	usage: Usage,
	lastAgentMessage?: SDKAssistantMessage | null,
): SDKResultMessage {
	// Extract result content from last assistant message if available
	let resultContent = "Session completed successfully";
	if (lastAgentMessage?.message?.content) {
		const content = lastAgentMessage.message.content;
		if (Array.isArray(content) && content.length > 0) {
			const textBlock = content.find((block) => block.type === "text");
			if (textBlock && "text" in textBlock) {
				resultContent = textBlock.text;
			}
		}
	}

	return {
		type: "result",
		subtype: "success",
		duration_ms: 0, // Codex doesn't provide duration
		duration_api_ms: 0,
		is_error: false,
		num_turns: 1, // Codex has single turn per completion
		result: resultContent,
		total_cost_usd: 0,
		usage: {
			input_tokens: usage.input_tokens,
			output_tokens: usage.output_tokens,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: usage.cached_input_tokens || 0,
			cache_creation: {
				ephemeral_1h_input_tokens: 0,
				ephemeral_5m_input_tokens: 0,
			},
			server_tool_use: {
				web_fetch_requests: 0,
				web_search_requests: 0,
			},
			service_tier: "standard" as const,
		},
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: "pending", // Will be set by caller
	};
}

/**
 * Create an error result message for turn.failed or error events
 *
 * @param error - Error message or object with message property
 * @returns SDKResultMessage with error status
 */
export function createErrorResultMessage(
	error: string | { message: string },
): SDKResultMessage {
	const errorMessage = typeof error === "string" ? error : error.message;

	return {
		type: "result",
		subtype: "error_during_execution",
		duration_ms: 0,
		duration_api_ms: 0,
		is_error: true,
		num_turns: 0,
		errors: [errorMessage],
		total_cost_usd: 0,
		usage: {
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
		},
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: "pending", // Will be set by caller
	};
}

/**
 * Convert a Codex JSONL event to cyrus-core SDKMessage format
 *
 * This adapter maps Codex CLI's JSONL events to the cyrus-core SDKMessage
 * format, allowing CodexRunner to implement the IAgentRunner interface.
 *
 * Event Mapping:
 * - thread.started → SDKSystemMessage (init)
 * - turn.started → null (no SDK message)
 * - turn.completed → SDKResultMessage (success with usage)
 * - turn.failed → SDKResultMessage (error)
 * - item.started → null (wait for item.completed)
 * - item.updated → null (wait for item.completed)
 * - item.completed → SDKAssistantMessage (via convertItemToMessage)
 * - error → SDKResultMessage (error)
 *
 * @param event - Codex CLI JSONL event
 * @param sessionId - Current session ID (may be null initially)
 * @param lastAssistantMessage - Last assistant message for result coercion (optional)
 * @returns SDKMessage or null if event type doesn't map to a message
 */
export function codexEventToSDKMessage(
	event: ThreadEvent,
	sessionId: string | null,
	lastAssistantMessage?: SDKAssistantMessage | null,
): SDKMessage | null {
	// thread.started - initialize session with system message
	if (isThreadStartedEvent(event)) {
		return createSystemMessage(event.thread_id);
	}

	// turn.completed - create success result message
	if (isTurnCompletedEvent(event)) {
		const resultMessage = createResultMessage(
			event.usage,
			lastAssistantMessage,
		);
		resultMessage.session_id = sessionId || "pending";
		return resultMessage;
	}

	// turn.failed - create error result message
	if (isTurnFailedEvent(event)) {
		const errorMessage = createErrorResultMessage(event.error);
		errorMessage.session_id = sessionId || "pending";
		return errorMessage;
	}

	// item.completed - convert item to appropriate message type
	if (isItemCompletedEvent(event)) {
		return convertItemToMessage(event.item, sessionId || "pending");
	}

	// error - thread-level error
	if (isThreadErrorEvent(event)) {
		const errorMessage = createErrorResultMessage(event.message);
		errorMessage.session_id = sessionId || "pending";
		return errorMessage;
	}

	// turn.started, item.started, item.updated don't map to SDK messages
	return null;
}

/**
 * Create a Cyrus Core SDK UserMessage from a plain string prompt
 *
 * Helper function to create properly formatted SDKUserMessage objects
 * for the Codex CLI input.
 *
 * @param content - The prompt text
 * @param sessionId - Current session ID (may be null for initial message)
 * @returns Formatted SDKUserMessage
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
 * Extract session ID from Codex thread.started event
 *
 * @param event - Codex thread event
 * @returns Session ID (thread_id) if event is thread.started type, null otherwise
 */
export function extractSessionId(event: ThreadEvent): string | null {
	if (isThreadStartedEvent(event)) {
		return event.thread_id;
	}
	return null;
}
