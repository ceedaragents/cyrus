/**
 * Cyrus Core I/O Interfaces
 *
 * This package provides pure TypeScript interface definitions for the Cyrus architecture.
 * All interfaces are implementation-agnostic and designed for maximum testability and extensibility.
 *
 * @packageDocumentation
 */

// Agent Runner
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
} from "./agent-runner.js";
// Issue Tracker
// Re-export Attachment from issue-tracker (it's used in multiple places)
export type {
	AgentSignal,
	Attachment as IssueAttachment,
	Comment,
	CommentAddedEvent,
	FeedbackSignal,
	Issue,
	IssueAssignedEvent,
	IssueEvent,
	IssueFilters,
	IssueState,
	IssueTracker,
	IssueUnassignedEvent,
	Label,
	Member,
	SignalEvent,
	StartSignal,
	StateChangedEvent,
	StopSignal,
} from "./issue-tracker.js";
// Renderer
// Re-export SessionSummary from renderer
export type {
	AgentActivity,
	AgentActivityActionContent,
	AgentActivityContent,
	AgentActivityElicitationContent,
	AgentActivityErrorContent,
	AgentActivityPromptContent,
	AgentActivityResponseContent,
	AgentActivitySignal,
	AgentActivityThoughtContent,
	AgentActivityType,
	MessageInput,
	RenderableSession,
	Renderer,
	SessionSummary as RendererSessionSummary,
	SignalInput,
	UserInput,
} from "./renderer.js";

// Storage
export type {
	Message,
	MessageAttachment,
	MessageRole,
	SessionFilters,
	SessionState,
	SessionStatus,
	SessionStorage,
} from "./storage.js";
