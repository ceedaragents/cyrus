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
	AgentResult,
	AgentRunnerConfig,
} from "cyrus-interfaces";
/**
 * Translate IAgentRunner config to ClaudeRunner config
 */
export declare function translateConfig(
	config: AgentRunnerConfig,
): ClaudeRunnerConfig;
/**
 * Translate SDK message to generic AgentMessage
 */
export declare function translateSDKMessage(
	sdkMessage: SDKMessage,
): AgentMessage;
/**
 * Translate string or async iterable prompt to ClaudeRunner format
 */
export declare function translatePromptToSDKMessages(
	prompt: string | AsyncIterable<AgentMessage>,
): AsyncIterable<SDKUserMessage>;
/**
 * Create AgentResult from SDK messages
 */
export declare function createAgentResult(
	sessionId: string,
	messages: SDKMessage[],
	error?: Error,
	metadata?: Record<string, unknown>,
): AgentResult;
//# sourceMappingURL=translators.d.ts.map
