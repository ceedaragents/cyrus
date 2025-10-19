/**
 * Cyrus Interfaces Package
 *
 * TypeScript interface definitions for all Cyrus I/O abstractions.
 * This package provides the foundation for the interface-driven architecture,
 * allowing different implementations to be swapped without changing core logic.
 *
 * @packageDocumentation
 */

// User Interface - represents systems that send work to Cyrus and receive results
export type {
  IUserInterface,
  WorkItem,
  Activity,
  ActivityContent,
  WorkItemUpdate,
} from './IUserInterface.js';

// Agent Runner - represents AI/agent execution engines
export type {
  IAgentRunner,
  AgentPrompt,
  AgentMessage,
  AgentMessageContent,
  AgentSession,
  AgentResult,
  AgentRunnerConfig,
  ToolConfig,
} from './IAgentRunner.js';

// Workspace Manager - manages isolated workspaces for processing
export type {
  IWorkspaceManager,
  WorkspaceRequest,
  Workspace,
} from './IWorkspaceManager.js';

// Persistence - generic persistence interface
export type { IPersistence } from './IPersistence.js';
