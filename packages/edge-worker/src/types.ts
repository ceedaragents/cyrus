import type { SDKMessage } from "cyrus-claude-runner";
import type { CyrusAgentSession, Issue, Workspace } from "cyrus-core";

/**
 * Events emitted by EdgeWorker
 */
export interface EdgeWorkerEvents {
	// Connection events (now includes token to identify which connection)
	connected: (token: string) => void;
	disconnected: (token: string, reason?: string) => void;

	// Session events (includes repository IDs - can be 0, 1, or N)
	"session:started": (
		issueId: string,
		issue: Issue,
		repositoryIds: string[],
	) => void;
	"session:ended": (
		issueId: string,
		exitCode: number | null,
		repositoryIds: string[],
	) => void;

	// Claude messages (includes repository IDs - can be 0, 1, or N)
	"claude:message": (
		issueId: string,
		message: SDKMessage,
		repositoryIds: string[],
	) => void;
	"claude:response": (
		issueId: string,
		text: string,
		repositoryIds: string[],
	) => void;
	"claude:tool-use": (
		issueId: string,
		tool: string,
		input: any,
		repositoryIds: string[],
	) => void;

	// Error events
	error: (error: Error, context?: any) => void;
}

/**
 * Data returned from createAgentSession
 */
export interface AgentSessionData {
	session: CyrusAgentSession;
	fullIssue: Issue;
	workspace: Workspace;
	attachmentResult: { manifest: string; attachmentsDir: string | null };
	attachmentsDir: string;
	allowedDirectories: string[];
	allowedTools: string[];
	disallowedTools: string[];
}
