/**
 * Type translation utilities for converting between Anthropic Claude SDK types
 * and generic IAgentRunner interface types.
 */

import type {
	ClaudeRunnerConfig,
	SDKMessage,
	SDKUserMessage,
} from "cyrus-claude-runner";
import type {
	AgentMessage,
	AgentMessageContent,
	AgentResult,
	AgentRunnerConfig,
} from "cyrus-interfaces";

/**
 * Content block types from Claude SDK messages
 */
type ContentBlock =
	| { type: "text"; text: string }
	| { type: "tool_use"; id: string; name: string; input: any };

/**
 * Translate IAgentRunner config to ClaudeRunner config
 */
export function translateConfig(config: AgentRunnerConfig): ClaudeRunnerConfig {
	const claudeConfig: ClaudeRunnerConfig = {
		cyrusHome: (config as any).cyrusHome || `${process.env.HOME}/.cyrus`,
		workingDirectory: config.workingDirectory,
		systemPrompt: config.systemPrompt,
		model: config.modelId,
	};

	// Pass through additional config options (excluding environment and tools which don't exist in ClaudeRunnerConfig)
	const additionalKeys = Object.keys(config).filter(
		(key) =>
			![
				"workingDirectory",
				"environment",
				"tools",
				"systemPrompt",
				"modelId",
				"cyrusHome",
			].includes(key),
	);

	for (const key of additionalKeys) {
		(claudeConfig as any)[key] = config[key];
	}

	return claudeConfig;
}

/**
 * Translate SDK message to generic AgentMessage
 */
export function translateSDKMessage(sdkMessage: SDKMessage): AgentMessage {
	const timestamp = new Date();
	const msg = sdkMessage as any;

	// Handle system messages
	if ("system" in msg) {
		return {
			role: "system",
			content: { type: "text", text: String(msg.system) },
			timestamp,
		};
	}

	// Handle user messages
	if ("role" in msg && msg.role === "user") {
		const content = extractFirstContent(msg.content);
		return {
			role: "user",
			content,
			timestamp,
		};
	}

	// Handle assistant messages
	if ("role" in msg && msg.role === "assistant") {
		const content = extractFirstContent(msg.content);
		return {
			role: "assistant",
			content,
			timestamp,
		};
	}

	// Handle result messages
	if ("role" in msg && msg.role === "result") {
		return {
			role: "tool_result",
			content: {
				type: "tool_result",
				tool_use_id: msg.tool_use_id,
				content: msg.content,
			},
			timestamp,
		};
	}

	// Fallback for unknown message types
	return {
		role: "assistant",
		content: { type: "text", text: JSON.stringify(msg) },
		timestamp,
		metadata: { original_type: "unknown" },
	};
}

/**
 * Extract the first content block from SDK message content
 */
function extractFirstContent(
	content: string | ContentBlock | Array<ContentBlock>,
): AgentMessageContent {
	// String content
	if (typeof content === "string") {
		return { type: "text", text: content };
	}

	// Single content block
	if (!Array.isArray(content)) {
		return translateContentBlock(content);
	}

	// Array of content blocks - take first one
	if (content.length > 0 && content[0]) {
		return translateContentBlock(content[0]);
	}

	// Empty content
	return { type: "text", text: "" };
}

/**
 * Translate a single content block
 */
function translateContentBlock(block: ContentBlock): AgentMessageContent {
	if (block.type === "text") {
		return { type: "text", text: block.text };
	}

	if (block.type === "tool_use") {
		return {
			type: "tool_use",
			id: block.id,
			name: block.name,
			input: block.input,
		};
	}

	// Unknown block type
	return { type: "text", text: JSON.stringify(block) };
}

/**
 * Translate string or async iterable prompt to ClaudeRunner format
 */
export async function* translatePromptToSDKMessages(
	prompt: string | AsyncIterable<AgentMessage>,
): AsyncIterable<SDKUserMessage> {
	// Simple string prompt
	if (typeof prompt === "string") {
		yield {
			content: prompt,
		} as unknown as SDKUserMessage;
		return;
	}

	// AsyncIterable of messages
	for await (const message of prompt) {
		// Only translate user messages
		if (message.role === "user") {
			yield {
				content: translateAgentMessageToContent(message),
			} as unknown as SDKUserMessage;
		}
	}
}

/**
 * Translate AgentMessage content to SDK format
 */
function translateAgentMessageToContent(
	message: AgentMessage,
): string | ContentBlock[] {
	const content = message.content;

	if (content.type === "text") {
		return content.text;
	}

	if (content.type === "tool_use") {
		return [
			{
				type: "tool_use" as const,
				id: content.id,
				name: content.name,
				input: content.input,
			},
		];
	}

	if (content.type === "tool_result") {
		// Tool results are not supported in user messages, convert to text
		return `[Tool Result: ${JSON.stringify(content.content)}]`;
	}

	return "";
}

/**
 * Create AgentResult from SDK messages
 */
export function createAgentResult(
	sessionId: string,
	messages: SDKMessage[],
	error?: Error,
	metadata?: Record<string, unknown>,
): AgentResult {
	const translatedMessages = messages.map(translateSDKMessage);

	return {
		sessionId,
		status: error ? "error" : "success",
		messages: translatedMessages,
		error,
		metadata: metadata || {},
	};
}
