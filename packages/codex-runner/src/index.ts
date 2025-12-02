/**
 * @module cyrus-codex-runner
 *
 * Codex TypeScript SDK integration for Cyrus agent framework.
 * Provides a provider-agnostic wrapper around the OpenAI Codex SDK
 * that implements the IAgentRunner interface.
 *
 * @example
 * ```typescript
 * import { CodexRunner } from 'cyrus-codex-runner';
 *
 * const runner = new CodexRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'o4-mini',
 *   sandboxMode: 'workspace-write'
 * });
 *
 * // Start a session
 * const session = await runner.start("Analyze this codebase");
 * console.log(`Thread ID: ${session.threadId}`);
 *
 * // Get messages
 * const messages = runner.getMessages();
 * console.log(`Received ${messages.length} messages`);
 * ```
 */

// Adapter functions
export {
	codexEventToSDKMessage,
	codexItemToSDKMessage,
	createToolResultMessage,
	createUserMessage,
	extractThreadId,
} from "./adapters.js";
// Main runner class
export { CodexRunner } from "./CodexRunner.js";

// Formatter
export { CodexMessageFormatter } from "./formatter.js";

// Types
export type {
	// Item types
	CodexAgentMessageItem,
	CodexCommandExecutionItem,
	CodexErrorItem,
	CodexFileChangeItem,
	// Event types
	CodexItemCompletedEvent,
	CodexItemStartedEvent,
	CodexItemUpdatedEvent,
	CodexMcpToolCallItem,
	CodexReasoningItem,
	// Configuration types
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
	CodexThreadError,
	CodexThreadErrorEvent,
	CodexThreadEvent,
	CodexThreadItem,
	CodexThreadOptions,
	CodexThreadStartedEvent,
	CodexTodoListItem,
	CodexTurnCompletedEvent,
	CodexTurnFailedEvent,
	CodexTurnStartedEvent,
	CodexUsage,
	CodexWebSearchItem,
	// Formatter types
	FormatterToolInput,
} from "./types.js";

// Type guards
export {
	isCodexAgentMessageItem,
	isCodexCommandExecutionItem,
	isCodexErrorItem,
	isCodexFileChangeItem,
	isCodexMcpToolCallItem,
	isCodexReasoningItem,
	isCodexTodoListItem,
	isCodexWebSearchItem,
} from "./types.js";
