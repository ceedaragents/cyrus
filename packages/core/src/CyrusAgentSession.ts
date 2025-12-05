/**
 * Agent Session types for Linear Agent Sessions integration
 * These types represent the core data structures for tracking agent sessions in Linear
 */

import type { IAgentRunner } from "./agent-runner-types.js";
import type {
	AgentSessionStatus,
	AgentSessionType,
} from "./issue-tracker/types.js";
import type { CyrusSessionStatus } from "./session/CyrusSessionStatus.js";
import type { SessionStateMachine } from "./session/SessionStateMachine.js";

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

export interface CyrusAgentSession {
	linearAgentActivitySessionId: string;
	type: AgentSessionType.CommentThread;
	/**
	 * Linear's AgentSessionStatus - used for API interactions
	 * @deprecated Use cyrusStatus for internal state management
	 */
	status: AgentSessionStatus;
	/**
	 * Internal Cyrus session status - provides finer-grained state tracking
	 * Optional for backwards compatibility during migration
	 */
	cyrusStatus?: CyrusSessionStatus;
	/**
	 * State machine for managing session lifecycle transitions
	 * Optional - will be populated when using the new state machine API
	 */
	stateMachine?: SessionStateMachine;
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
