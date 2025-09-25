/**
 * Agent Session types for Linear Agent Sessions integration
 * These types represent the core data structures for tracking Claude Code sessions in Linear
 */
import type { LinearDocument } from "@linear/sdk";
import type { ClaudeRunner } from "cyrus-claude-runner";
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
	type: LinearDocument.AgentSessionType.CommentThread;
	status: LinearDocument.AgentSessionStatus;
	context: LinearDocument.AgentSessionType.CommentThread;
	createdAt: number;
	updatedAt: number;
	issueId: string;
	issue: IssueMinimal;
	workspace: Workspace;
	claudeSessionId?: string;
	claudeRunner?: ClaudeRunner;
	metadata?: {
		model?: string;
		tools?: string[];
		permissionMode?: string;
		apiKeySource?: string;
		totalCostUsd?: number;
		usage?: any;
		commentId?: string;
	};
}
export interface CyrusAgentSessionEntry {
	claudeSessionId: string;
	linearAgentActivityId?: string;
	type: "user" | "assistant" | "system" | "result";
	content: string;
	metadata?: {
		toolUseId?: string;
		toolName?: string;
		toolInput?: any;
		parentToolUseId?: string;
		timestamp: number;
		durationMs?: number;
		isError?: boolean;
	};
}
//# sourceMappingURL=CyrusAgentSession.d.ts.map
