/**
 * @module cyrus-codex-runner
 *
 * OpenAI Codex CLI integration for Cyrus agent framework.
 * Provides a provider-agnostic wrapper around the Codex CLI that implements
 * the IAgentRunner interface, allowing seamless switching between Claude, Gemini, and Codex.
 *
 * @example
 * ```typescript
 * import { CodexRunner } from 'cyrus-codex-runner';
 *
 * const runner = new CodexRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'gpt-5.1-codex-max',
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
	codexEventToSDKMessages,
	createUserMessage,
	itemCompletedToMessages,
} from "./adapters.js";

// Main runner class
export { CodexRunner } from "./CodexRunner.js";

// Config generator utilities (for MCP configuration)
export {
	autoDetectMcpConfig,
	backupCodexConfig,
	type CodexConfigOptions,
	convertToCodexMcpConfig,
	deleteCodexConfig,
	loadMcpConfigFromPaths,
	restoreCodexConfig,
	setupCodexConfig,
	writeCodexConfig,
} from "./configGenerator.js";

// Formatter
export { CodexMessageFormatter } from "./formatter.js";

// Zod schemas and validation utilities
export {
	// Thread item schemas
	AgentMessageItemSchema,
	CommandExecutionItemSchema,
	CommandExecutionStatusSchema,
	ErrorItemSchema,
	// Parsing utilities
	extractThreadId,
	FileChangeItemSchema,
	FileUpdateChangeSchema,
	ItemCompletedEventSchema,
	ItemStartedEventSchema,
	ItemUpdatedEventSchema,
	// Type guards for thread events
	isAgentMessageItem,
	isCommandExecutionItem,
	isErrorItem,
	isFileChangeItem,
	isItemCompletedEvent,
	isItemStartedEvent,
	isItemUpdatedEvent,
	isMcpToolCallItem,
	isReasoningItem,
	isThreadErrorEvent,
	isThreadStartedEvent,
	isTodoListItem,
	isTurnCompletedEvent,
	isTurnFailedEvent,
	isTurnStartedEvent,
	isWebSearchItem,
	McpContentBlockSchema,
	McpToolCallErrorSchema,
	McpToolCallItemSchema,
	McpToolCallResultSchema,
	McpToolCallStatusSchema,
	PatchApplyStatusSchema,
	PatchChangeKindSchema,
	parseCodexEvent,
	ReasoningItemSchema,
	safeParseCodexEvent,
	ThreadErrorEventSchema,
	ThreadErrorSchema,
	// Thread event schemas
	ThreadEventSchema,
	ThreadItemSchema,
	ThreadStartedEventSchema,
	TodoItemSchema,
	TodoListItemSchema,
	TurnCompletedEventSchema,
	TurnFailedEventSchema,
	TurnStartedEventSchema,
	UsageSchema,
	WebSearchItemSchema,
} from "./schemas.js";

// Types
export type {
	// Thread item types
	AgentMessageItem,
	// MCP types
	CodexHttpMcpServerConfig,
	CodexMcpServerConfig,
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
	CommandExecutionItem,
	CommandExecutionStatus,
	ErrorItem,
	FileChangeItem,
	FileUpdateChange,
	// Formatter input type
	FormatterToolInput,
	ItemCompletedEvent,
	ItemStartedEvent,
	ItemUpdatedEvent,
	McpContentBlock,
	// Re-export McpServerConfig from cyrus-core for convenience
	McpServerConfig,
	McpToolCallError,
	McpToolCallItem,
	McpToolCallResult,
	McpToolCallStatus,
	PatchApplyStatus,
	PatchChangeKind,
	ReasoningItem,
	ThreadError,
	ThreadErrorEvent,
	// Thread event types
	ThreadEvent,
	ThreadItem,
	ThreadStartedEvent,
	TodoItem,
	TodoListItem,
	TurnCompletedEvent,
	TurnFailedEvent,
	TurnStartedEvent,
	Usage,
	WebSearchItem,
} from "./types.js";
