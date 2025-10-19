/**
 * Cyrus Interfaces Package
 *
 * TypeScript interface definitions for all Cyrus I/O abstractions.
 * This package provides the foundation for the interface-driven architecture,
 * allowing different implementations to be swapped without changing core logic.
 *
 * @packageDocumentation
 */

// Agent Runner - represents AI/agent execution engines
export type {
	AgentMessage,
	AgentMessageContent,
	AgentPrompt,
	AgentResult,
	AgentRunnerConfig,
	AgentSession,
	IAgentRunner,
	ToolConfig,
} from "./IAgentRunner.js";
// Persistence - generic persistence interface
export type { IPersistence } from "./IPersistence.js";
// User Interface - represents systems that send work to Cyrus and receive results
export type {
	Activity,
	ActivityContent,
	IUserInterface,
	WorkItem,
	WorkItemUpdate,
} from "./IUserInterface.js";
// Workspace Manager - manages isolated workspaces for processing
export type {
	IWorkspaceManager,
	Workspace,
	WorkspaceRequest,
} from "./IWorkspaceManager.js";
