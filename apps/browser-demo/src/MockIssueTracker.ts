import type {
	AgentSignal,
	Comment,
	Issue,
	IssueAttachment,
	IssueEvent,
	IssueFilters,
	IssueState,
	IssueTracker,
	Member,
} from "cyrus-interfaces";

// Alias for consistency
type Attachment = IssueAttachment;

/**
 * Mock IssueTracker for demo/testing purposes
 *
 * Simulates an issue tracker without requiring real Linear/GitHub connections.
 * Useful for:
 * - Demos and presentations
 * - Testing without API credentials
 * - Local development
 */
export class MockIssueTracker implements IssueTracker {
	private issues: Map<string, Issue> = new Map();
	private comments: Map<string, Comment[]> = new Map();
	private eventCallbacks: Array<(event: IssueEvent) => void> = [];

	constructor() {
		// Initialize with a default issue for demo
		this.createDefaultIssue();
	}

	/**
	 * Create a default demo issue
	 */
	private createDefaultIssue(): void {
		const demoIssue: Issue = {
			id: "demo-issue-1",
			identifier: "DEMO-1",
			title: "Demo: Build a new feature",
			description: `This is a demonstration issue showing the Cyrus CLI interactive renderer.

**What to do:**
- Analyze the requirements
- Create a basic implementation
- Write tests
- Document the changes

This demo simulates how Cyrus would work on a real Linear issue.`,
			state: {
				type: "started",
				name: "In Progress",
				id: "state-started",
			},
			priority: 2, // High priority
			assignee: {
				id: "agent-1",
				name: "Cyrus Demo Agent",
				email: "demo@cyrus.ai",
			},
			labels: [
				{
					id: "label-demo",
					name: "Demo",
					color: "#5E6AD2",
					description: "Demo label",
				},
			],
			url: "https://demo.cyrus.ai/issue/DEMO-1",
			createdAt: new Date(),
			updatedAt: new Date(),
			projectId: "demo-project",
			teamId: "demo-team",
		};

		this.issues.set(demoIssue.id, demoIssue);
		this.comments.set(demoIssue.id, []);
	}

	async getIssue(issueId: string): Promise<Issue> {
		// Try to find by ID
		let issue = this.issues.get(issueId);

		// If not found, try to find by identifier
		if (!issue) {
			for (const [, iss] of this.issues) {
				if (iss.identifier === issueId) {
					issue = iss;
					break;
				}
			}
		}

		if (!issue) {
			throw new Error(`Issue not found: ${issueId}`);
		}

		return issue;
	}

	async listAssignedIssues(
		memberId: string,
		filters?: IssueFilters,
	): Promise<Issue[]> {
		const assigned = Array.from(this.issues.values()).filter(
			(issue) => issue.assignee?.id === memberId,
		);

		if (!filters) {
			return assigned;
		}

		// Apply filters
		return assigned.filter((issue) => {
			if (filters.state) {
				const states = Array.isArray(filters.state)
					? filters.state
					: [filters.state];
				if (!states.includes(issue.state.type)) {
					return false;
				}
			}

			if (filters.priority !== undefined) {
				const priorities = Array.isArray(filters.priority)
					? filters.priority
					: [filters.priority];
				if (!priorities.includes(issue.priority)) {
					return false;
				}
			}

			if (filters.projectId && issue.projectId !== filters.projectId) {
				return false;
			}

			if (filters.teamId && issue.teamId !== filters.teamId) {
				return false;
			}

			return true;
		});
	}

	async updateIssueState(issueId: string, state: IssueState): Promise<void> {
		const issue = await this.getIssue(issueId);
		const oldState = issue.state;
		issue.state = state;
		issue.updatedAt = new Date();

		// Emit state changed event
		this.emitEvent({
			type: "state-changed",
			issue,
			oldState,
			newState: state,
		});
	}

	async addComment(issueId: string, comment: Comment): Promise<string> {
		const issue = await this.getIssue(issueId);
		const comments = this.comments.get(issue.id) || [];

		const newComment: Comment = {
			...comment,
			id: `comment-${Date.now()}-${Math.random().toString(36).substring(7)}`,
			createdAt: comment.createdAt || new Date(),
		};

		comments.push(newComment);
		this.comments.set(issue.id, comments);

		// Emit comment added event
		this.emitEvent({
			type: "comment-added",
			issue,
			comment: newComment,
		});

		return newComment.id!;
	}

	async getComments(issueId: string): Promise<Comment[]> {
		const issue = await this.getIssue(issueId);
		return this.comments.get(issue.id) || [];
	}

	async *watchIssues(memberId: string): AsyncIterable<IssueEvent> {
		// Create a queue for events
		const eventQueue: IssueEvent[] = [];
		let resolver: ((value: IteratorResult<IssueEvent>) => void) | null = null;

		// Register callback to add events to queue
		const callback = (event: IssueEvent) => {
			eventQueue.push(event);
			if (resolver) {
				const currentResolver = resolver;
				resolver = null;
				currentResolver({ value: eventQueue.shift()!, done: false });
			}
		};

		this.eventCallbacks.push(callback);

		// Emit initial assignment event for existing issues
		const assignedIssues = await this.listAssignedIssues(memberId);
		for (const issue of assignedIssues) {
			if (issue.assignee) {
				this.emitEvent({
					type: "assigned",
					issue,
					assignee: issue.assignee,
				});
			}
		}

		try {
			while (true) {
				if (eventQueue.length > 0) {
					yield eventQueue.shift()!;
				} else {
					// Wait for next event
					await new Promise<IteratorResult<IssueEvent>>((resolve) => {
						resolver = resolve;
					});
				}
			}
		} finally {
			// Clean up callback on completion
			const index = this.eventCallbacks.indexOf(callback);
			if (index > -1) {
				this.eventCallbacks.splice(index, 1);
			}
		}
	}

	async getAttachments(_issueId: string): Promise<Attachment[]> {
		// Mock implementation - no attachments in demo
		return [];
	}

	async sendSignal(issueId: string, signal: AgentSignal): Promise<void> {
		const issue = await this.getIssue(issueId);

		// Emit signal event
		this.emitEvent({
			type: "signal",
			issue,
			signal,
		});
	}

	/**
	 * Emit an event to all watchers
	 */
	private emitEvent(event: IssueEvent): void {
		console.log(
			`[MockIssueTracker] Emitting ${event.type} event for issue ${event.issue.identifier} to ${this.eventCallbacks.length} callback(s)`,
		);
		for (const callback of this.eventCallbacks) {
			callback(event);
		}
	}

	/**
	 * Simulate a user comment being added (for demo purposes)
	 */
	simulateUserComment(issueId: string, content: string): void {
		const member: Member = {
			id: "user-1",
			name: "Demo User",
			email: "user@demo.com",
		};

		const comment: Comment = {
			author: member,
			content,
			createdAt: new Date(),
			isRoot: true,
		};

		this.addComment(issueId, comment).catch(console.error);
	}

	/**
	 * Get all issues (for testing/debugging)
	 */
	getAllIssues(): Issue[] {
		return Array.from(this.issues.values());
	}
}
