/**
 * Agent Session types for Linear Agent Sessions integration
 * These types represent the core data structures for tracking agent sessions in Linear
 */

import type { IAgentRunner } from "./agent-runner-types.js";
import type {
	AgentSessionStatus,
	AgentSessionType,
} from "./issue-tracker/types.js";

export interface IssueMinimal {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	branchName: string;
}

export interface Workspace {
	path: string;
	isGitWorktree: boolean;
	historyPath?: string;
}

/**
 * Repository-specific configuration and context for a session.
 * Enables consolidating managers while maintaining per-session repository context.
 */
export interface RepositoryContext {
	/** Unique identifier for the repository */
	repositoryId: string;
	/** Absolute path to the repository root */
	repositoryPath: string;
	/** Base directory for worktrees */
	workspaceBaseDir: string;
	/** Optional tool configuration */
	allowedTools?: string[];
	disallowedTools?: string[];
	/** Optional path to MCP configuration file */
	mcpConfigPath?: string;
	/** Optional path to prompt template file */
	promptTemplatePath?: string;
	/** Preferred model for this repository */
	model?: string;
	/** Fallback model if preferred model is unavailable */
	fallbackModel?: string;
}

export interface CyrusAgentSession {
	linearAgentActivitySessionId: string;
	type: AgentSessionType.CommentThread;
	status: AgentSessionStatus;
	context: AgentSessionType.CommentThread;
	createdAt: number; // e.g. Date.now()
	updatedAt: number; // e.g. Date.now()
	issueId: string;
	issue: IssueMinimal;
	workspace: Workspace;
	// NOTE: Only one of these will be populated
	claudeSessionId?: string; // Claude-specific session ID (assigned once it initializes)
	geminiSessionId?: string; // Gemini-specific session ID (assigned once it initializes)
	agentRunner?: IAgentRunner;
	/** Repository-specific configuration for this session (optional for backwards compatibility) */
	repositoryContext?: RepositoryContext;
	metadata?: {
		model?: string;
		tools?: string[];
		permissionMode?: string;
		apiKeySource?: string;
		totalCostUsd?: number;
		usage?: any;
		commentId?: string;
		procedure?: {
			procedureName: string;
			currentSubroutineIndex: number;
			subroutineHistory: Array<{
				subroutine: string;
				completedAt: number;
				claudeSessionId: string | null;
				geminiSessionId: string | null;
			}>;
			/** State for validation loop (when current subroutine uses usesValidationLoop) */
			validationLoop?: {
				/** Current iteration (1-based) */
				iteration: number;
				/** Whether the loop is in fixer mode (running validation-fixer) */
				inFixerMode: boolean;
				/** Results from each validation attempt */
				attempts: Array<{
					iteration: number;
					pass: boolean;
					reason: string;
					timestamp: number;
				}>;
			};
		};
	};
}

export interface CyrusAgentSessionEntry {
	claudeSessionId?: string; // originated in this Claude session (if using Claude)
	geminiSessionId?: string; // originated in this Gemini session (if using Gemini)
	linearAgentActivityId?: string; // got assigned this ID in linear, after creation, for this 'agent activity'
	type: "user" | "assistant" | "system" | "result";
	content: string;
	metadata?: {
		toolUseId?: string;
		toolName?: string;
		toolInput?: any;
		parentToolUseId?: string;
		toolResultError?: boolean; // Error status from tool_result blocks
		timestamp: number; // e.g. Date.now()
		durationMs?: number;
		isError?: boolean;
	};
}
