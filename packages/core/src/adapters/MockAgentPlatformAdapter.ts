/**
 * Mock implementation of the agent platform adapter for testing
 * This allows tests to run without real Linear API calls
 */

import type {
	AgentSessionCreateResult,
	ChildIssueData,
	CommentData,
	FileUploadResult,
	GetChildIssuesOptions,
	IAgentPlatformAdapter,
	IssueData,
} from "./types.js";

/**
 * Mock implementation of the agent platform adapter
 */
export class MockAgentPlatformAdapter implements IAgentPlatformAdapter {
	private mockIssues: Map<string, IssueData> = new Map();
	private mockComments: Map<string, CommentData> = new Map();
	private mockSessions: Map<
		string,
		{ status: string; metadata?: Record<string, any> }
	> = new Map();
	private uploadedFiles: Array<{
		filePath: string;
		filename: string;
		contentType: string;
		makePublic: boolean;
	}> = [];

	/**
	 * Set mock issue data for testing
	 */
	setMockIssue(issue: IssueData): void {
		this.mockIssues.set(issue.id, issue);
	}

	/**
	 * Set mock comment data for testing
	 */
	setMockComment(comment: CommentData): void {
		this.mockComments.set(comment.id, comment);
	}

	/**
	 * Get uploaded files for assertions
	 */
	getUploadedFiles() {
		return this.uploadedFiles;
	}

	/**
	 * Get mock sessions for assertions
	 */
	getMockSessions() {
		return this.mockSessions;
	}

	/**
	 * Clear all mock data
	 */
	reset(): void {
		this.mockIssues.clear();
		this.mockComments.clear();
		this.mockSessions.clear();
		this.uploadedFiles = [];
	}

	/**
	 * Fetch an issue by ID or identifier
	 */
	async getIssue(issueId: string): Promise<IssueData | null> {
		return this.mockIssues.get(issueId) || null;
	}

	/**
	 * Get child issues (sub-issues) of a parent issue
	 */
	async getChildIssues(
		_issueId: string,
		_options?: GetChildIssuesOptions,
	): Promise<ChildIssueData[]> {
		// Return empty list by default for mock
		return [];
	}

	/**
	 * Fetch a comment by ID
	 */
	async getComment(commentId: string): Promise<CommentData | null> {
		return this.mockComments.get(commentId) || null;
	}

	/**
	 * Create an agent session on an issue
	 */
	async createSessionOnIssue(
		issueId: string,
		_externalLink?: string,
	): Promise<AgentSessionCreateResult> {
		const sessionId = `mock-session-${issueId}-${Date.now()}`;
		this.mockSessions.set(sessionId, { status: "pending" });
		return {
			success: true,
			agentSessionId: sessionId,
			lastSyncId: "mock-sync-id",
		};
	}

	/**
	 * Create an agent session on a comment
	 */
	async createSessionOnComment(
		commentId: string,
		_externalLink?: string,
	): Promise<AgentSessionCreateResult> {
		const sessionId = `mock-comment-session-${commentId}-${Date.now()}`;
		this.mockSessions.set(sessionId, { status: "pending" });
		return {
			success: true,
			agentSessionId: sessionId,
			lastSyncId: "mock-sync-id",
		};
	}

	/**
	 * Update agent session status
	 */
	async updateSessionStatus(
		sessionId: string,
		status: string,
		metadata?: Record<string, any>,
	): Promise<void> {
		const session = this.mockSessions.get(sessionId);
		if (session) {
			session.status = status;
			if (metadata) {
				session.metadata = metadata;
			}
		}
	}

	/**
	 * Post agent activity to a session
	 */
	async postAgentActivity(
		_sessionId: string,
		_content: string,
		_contentType:
			| "prompt"
			| "observation"
			| "action"
			| "error"
			| "elicitation"
			| "response",
	): Promise<void> {
		// Mock: do nothing
	}

	/**
	 * Upload a file for use in Linear
	 */
	async uploadFile(
		filePath: string,
		filename?: string,
		contentType?: string,
		makePublic?: boolean,
	): Promise<FileUploadResult> {
		this.uploadedFiles.push({
			filePath,
			filename: filename || filePath,
			contentType: contentType || "application/octet-stream",
			makePublic: makePublic || false,
		});

		return {
			success: true,
			assetUrl: `mock://asset-${Date.now()}`,
			filename: filename || filePath,
			size: 1024,
			contentType: contentType || "application/octet-stream",
		};
	}

	/**
	 * Give feedback to a child agent session
	 */
	async giveFeedback(_sessionId: string, _message: string): Promise<void> {
		// Mock: do nothing
	}
}
