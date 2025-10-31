/**
 * Linear Comment Renderer
 *
 * Implements the Renderer interface by posting agent activity to Linear issue comments.
 * This maintains the existing Cyrus behavior of providing activity updates through Linear's comment system.
 */

import type {
	AgentActivity,
	AgentActivityActionContent,
	AgentActivityElicitationContent,
	AgentActivityErrorContent,
	AgentActivityPromptContent,
	AgentActivityResponseContent,
	AgentActivityThoughtContent,
	Comment,
	IssueTracker,
	Member,
	RenderableSession,
	Renderer,
	SessionSummary,
	UserInput,
} from "cyrus-interfaces";

/**
 * Configuration options for LinearRenderer
 */
export interface LinearRendererConfig {
	/**
	 * IssueTracker instance to use for posting comments
	 */
	issueTracker: IssueTracker;

	/**
	 * Member representing the agent (for comment authorship)
	 */
	agentMember: Member;

	/**
	 * Optional root comment ID for threading all activity as replies
	 */
	rootCommentId?: string;

	/**
	 * Whether to format activities as verbose markdown (default: true)
	 */
	verboseFormatting?: boolean;
}

/**
 * Tracks session state for comment threading
 */
interface SessionState {
	sessionId: string;
	issueId: string;
	issueTitle: string;
	rootCommentId?: string;
	startTime: Date;
	activityCount: number;
}

/**
 * LinearRenderer posts agent activity to Linear issue comments
 *
 * Each method of the Renderer interface maps to posting a formatted comment to Linear.
 * This maintains the existing user experience where all agent activity appears as
 * comments on the Linear issue.
 *
 * Threading behavior:
 * - If rootCommentId is provided in config, all comments are replies to that comment
 * - Otherwise, each activity is posted as a root-level comment
 *
 * Markdown formatting:
 * - All content supports markdown (bold, italic, code blocks, lists, etc.)
 * - Activities are formatted with appropriate headings and structure
 * - Tool usage is formatted as code blocks for readability
 */
export class LinearRenderer implements Renderer {
	private sessions: Map<string, SessionState> = new Map();
	private config: LinearRendererConfig;

	constructor(config: LinearRendererConfig) {
		this.config = {
			verboseFormatting: true,
			...config,
		};
	}

	/**
	 * Render the start of an agent session
	 */
	async renderSessionStart(session: RenderableSession): Promise<void> {
		// Track session state
		this.sessions.set(session.id, {
			sessionId: session.id,
			issueId: session.issueId,
			issueTitle: session.issueTitle,
			rootCommentId: this.config.rootCommentId,
			startTime: session.startedAt,
			activityCount: 0,
		});

		// Post session start comment
		const content = this.formatSessionStart(session);
		await this.postComment(session.issueId, content, session.id);
	}

	/**
	 * Render agent activity/progress update
	 */
	async renderActivity(
		sessionId: string,
		activity: AgentActivity,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		// Format activity based on content type
		const content = this.formatActivity(activity);
		await this.postComment(session.issueId, content, sessionId);

		// Update activity count
		session.activityCount++;
	}

	/**
	 * Render text response from the agent
	 */
	async renderText(sessionId: string, text: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		await this.postComment(session.issueId, text, sessionId);
	}

	/**
	 * Render tool usage by the agent
	 */
	async renderToolUse(
		sessionId: string,
		tool: string,
		input: unknown,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		const content = this.formatToolUse(tool, input);
		await this.postComment(session.issueId, content, sessionId);
	}

	/**
	 * Render session completion
	 */
	async renderComplete(
		sessionId: string,
		summary: SessionSummary,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		const content = this.formatCompletion(summary, session);
		await this.postComment(session.issueId, content, sessionId);

		// Clean up session state
		this.sessions.delete(sessionId);
	}

	/**
	 * Render an error
	 */
	async renderError(sessionId: string, error: Error): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		const content = this.formatError(error);
		await this.postComment(session.issueId, content, sessionId);
	}

	/**
	 * Get user input stream for interactive renderers
	 *
	 * For Linear, this returns an empty async iterable since user input
	 * is handled through webhooks rather than real-time streaming.
	 * The EdgeWorker handles webhooks and feeds them into the system separately.
	 */
	async *getUserInput(_sessionId: string): AsyncIterable<UserInput> {
		// Linear doesn't support real-time user input streaming
		// User input comes through webhooks which are handled by EdgeWorker
		// This method intentionally yields nothing
		// Empty generator - no yields needed
	}

	/**
	 * Post a comment to Linear via IssueTracker
	 */
	private async postComment(
		issueId: string,
		content: string,
		sessionId: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);

		const comment: Comment = {
			author: this.config.agentMember,
			content,
			createdAt: new Date(),
			isRoot: !session?.rootCommentId,
			parentId: session?.rootCommentId,
		};

		await this.config.issueTracker.addComment(issueId, comment);
	}

	/**
	 * Format session start message
	 */
	private formatSessionStart(session: RenderableSession): string {
		if (!this.config.verboseFormatting) {
			return `Starting work on: ${session.issueTitle}`;
		}

		return `🚀 **Session Started**

Working on: **${session.issueTitle}**
Started at: ${session.startedAt.toISOString()}`;
	}

	/**
	 * Format AgentActivity into markdown comment
	 */
	private formatActivity(activity: AgentActivity): string {
		const content = activity.content;

		switch (content.type) {
			case "thought":
				return this.formatThought(
					(content as AgentActivityThoughtContent).body,
				);
			case "action": {
				const actionContent = content as AgentActivityActionContent;
				return this.formatAction(
					actionContent.action,
					actionContent.parameter,
					actionContent.result ?? undefined,
				);
			}
			case "response":
				return this.formatResponse(
					(content as AgentActivityResponseContent).body,
				);
			case "error":
				return this.formatActivityError(
					(content as AgentActivityErrorContent).body,
				);
			case "elicitation":
				return this.formatElicitation(
					(content as AgentActivityElicitationContent).body,
				);
			case "prompt":
				return this.formatPrompt((content as AgentActivityPromptContent).body);
			default:
				return `Unknown activity type: ${JSON.stringify(content)}`;
		}
	}

	/**
	 * Format thought activity
	 */
	private formatThought(body: string): string {
		if (!this.config.verboseFormatting) {
			return body;
		}
		return `💭 **Thinking**\n\n${body}`;
	}

	/**
	 * Format action activity
	 */
	private formatAction(
		action: string,
		parameter: string,
		result?: string,
	): string {
		if (!this.config.verboseFormatting) {
			const parts = [`**${action}**`, parameter];
			if (result) {
				parts.push(`\n\nResult:\n${result}`);
			}
			return parts.join("\n");
		}

		const parts = [
			`🔧 **Action: ${action}**`,
			"",
			"**Parameters:**",
			"```",
			parameter,
			"```",
		];

		if (result) {
			parts.push("", "**Result:**", "```", result, "```");
		}

		return parts.join("\n");
	}

	/**
	 * Format response activity
	 */
	private formatResponse(body: string): string {
		if (!this.config.verboseFormatting) {
			return body;
		}
		return `💬 **Response**\n\n${body}`;
	}

	/**
	 * Format error activity
	 */
	private formatActivityError(body: string): string {
		if (!this.config.verboseFormatting) {
			return `Error: ${body}`;
		}
		return `❌ **Error**\n\n${body}`;
	}

	/**
	 * Format elicitation activity (user input request)
	 */
	private formatElicitation(body: string): string {
		if (!this.config.verboseFormatting) {
			return body;
		}
		return `❓ **Input Required**\n\n${body}`;
	}

	/**
	 * Format prompt activity
	 */
	private formatPrompt(body: string): string {
		if (!this.config.verboseFormatting) {
			return body;
		}
		return `📝 **Prompt**\n\n${body}`;
	}

	/**
	 * Format tool usage
	 */
	private formatToolUse(tool: string, input: unknown): string {
		const inputStr =
			typeof input === "string" ? input : JSON.stringify(input, null, 2);

		if (!this.config.verboseFormatting) {
			return `**${tool}**\n\`\`\`\n${inputStr}\n\`\`\``;
		}

		return `🛠️ **Tool: ${tool}**

\`\`\`json
${inputStr}
\`\`\``;
	}

	/**
	 * Format session completion
	 */
	private formatCompletion(
		summary: SessionSummary,
		session: SessionState,
	): string {
		const duration = Date.now() - session.startTime.getTime();
		const durationStr = this.formatDuration(duration);

		if (!this.config.verboseFormatting) {
			const parts = [`Completed in ${durationStr}`];
			if (summary.summary) {
				parts.push("", summary.summary);
			}
			if (summary.filesModified.length > 0) {
				parts.push(
					"",
					"Files modified:",
					...summary.filesModified.map((f: string) => `- ${f}`),
				);
			}
			return parts.join("\n");
		}

		const parts = [
			"✅ **Session Complete**",
			"",
			`**Duration:** ${durationStr}`,
			`**Turns:** ${summary.turns}`,
			`**Tools Used:** ${summary.toolsUsed}`,
			`**Exit Code:** ${summary.exitCode}`,
		];

		if (summary.filesModified.length > 0) {
			parts.push("", "**Files Modified:**");
			for (const file of summary.filesModified) {
				parts.push(`- \`${file as string}\``);
			}
		}

		if (summary.summary) {
			parts.push("", "**Summary:**", summary.summary);
		}

		return parts.join("\n");
	}

	/**
	 * Format error
	 */
	private formatError(error: Error): string {
		if (!this.config.verboseFormatting) {
			return `Error: ${error.message}`;
		}

		const parts = [
			"❌ **Error Occurred**",
			"",
			`**Message:** ${error.message}`,
		];

		if (error.stack) {
			parts.push("", "**Stack Trace:**", "```", error.stack, "```");
		}

		return parts.join("\n");
	}

	/**
	 * Format duration in human-readable format
	 */
	private formatDuration(milliseconds: number): string {
		const seconds = Math.floor(milliseconds / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);

		if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		}
		if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		}
		return `${seconds}s`;
	}
}
