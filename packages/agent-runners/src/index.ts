/**
 * @cyrus/agent-runners
 *
 * Adapters for various agent runners to implement the AgentRunner interface.
 */

// Re-export interface types for convenience
export type {
	AgentEvent,
	AgentRunner,
	AgentSession,
	AgentSessionConfig,
	Attachment,
	CompleteEvent,
	ErrorEvent,
	SessionSummary,
	TextEvent,
	ToolResultEvent,
	ToolUseEvent,
	UserMessage,
} from "cyrus-interfaces";
// Re-export ClaudeAgentRunner
export { ClaudeAgentRunner } from "./claude/ClaudeAgentRunner.js";
