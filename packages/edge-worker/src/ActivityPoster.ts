import type {
	AgentActivityCreateInput,
	IIssueTrackerService,
	ILogger,
	RepositoryConfig,
} from "cyrus-core";

type RepositorySelectionMethod =
	| "description-tag"
	| "label-based"
	| "project-based"
	| "team-based"
	| "team-prefix"
	| "catch-all"
	| "workspace-fallback"
	| "user-selected";

type RepositorySelectionActivityInput = {
	id: string;
	name: string;
	routingMethod: RepositorySelectionMethod;
};

export class ActivityPoster {
	private getIssueTracker: () => IIssueTrackerService;
	private repositories: Map<string, RepositoryConfig>;
	private logger: ILogger;

	constructor(
		getIssueTracker: () => IIssueTrackerService,
		repositories: Map<string, RepositoryConfig>,
		logger: ILogger,
	) {
		this.getIssueTracker = getIssueTracker;
		this.repositories = repositories;
		this.logger = logger;
	}

	async postActivityDirect(
		issueTracker: IIssueTrackerService,
		input: AgentActivityCreateInput,
		label: string,
	): Promise<string | null> {
		try {
			const result = await issueTracker.createAgentActivity(input);
			if (result.success) {
				if (result.agentActivity) {
					const activity = await result.agentActivity;
					this.logger.debug(`Created ${label} activity ${activity.id}`);
					return activity.id;
				}
				this.logger.debug(`Created ${label}`);
				return null;
			}
			this.logger.error(`Failed to create ${label}:`, result);
			return null;
		} catch (error) {
			this.logger.error(`Error creating ${label}:`, error);
			return null;
		}
	}

	async postInstantAcknowledgment(
		sessionId: string,
		repositoryId: string,
	): Promise<void> {
		const issueTracker = this.getIssueTracker();
		this.logger.debug(
			`Posting instant acknowledgment for session ${sessionId} in repository ${repositoryId}`,
		);

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: "I've received your request and I'm starting to work on it. Let me analyze the issue and prepare my approach.",
				},
			},
			"instant acknowledgment",
		);
	}

	async postParentResumeAcknowledgment(
		sessionId: string,
		repositoryId: string,
	): Promise<void> {
		const issueTracker = this.getIssueTracker();
		this.logger.debug(
			`Posting parent resume acknowledgment for session ${sessionId} in repository ${repositoryId}`,
		);

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: { type: "thought", body: "Resuming from child session" },
			},
			"parent resume acknowledgment",
		);
	}

	async postRepositorySelectionActivity(
		sessionId: string,
		repositoryId: string,
		repositoryName: string,
		selectionMethod: RepositorySelectionMethod,
	): Promise<void> {
		await this.postRepositorySelectionActivities(sessionId, [
			{
				id: repositoryId,
				name: repositoryName,
				routingMethod: selectionMethod,
			},
		]);
	}

	async postRepositorySelectionActivities(
		sessionId: string,
		repositories: RepositorySelectionActivityInput[],
	): Promise<void> {
		if (repositories.length === 0) {
			return;
		}

		const issueTracker = this.getIssueTracker();
		this.logger.debug(
			`Posting repository selection activity for session ${sessionId} (${repositories.length} repositories)`,
		);

		const uniqueRoutingMethods = Array.from(
			new Set(repositories.map((repository) => repository.routingMethod)),
		);
		const body = this.buildRepositorySelectionBody(
			repositories,
			uniqueRoutingMethods,
		);

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body,
				},
			},
			"repository selection",
		);
	}

	private getSelectionMethodDisplay(
		selectionMethod: RepositorySelectionMethod,
	): string {
		if (selectionMethod === "user-selected") {
			return "selected by user";
		}
		if (selectionMethod === "description-tag") {
			return "matched via [repo=...] tag in issue description";
		}
		if (selectionMethod === "label-based") {
			return "matched via label-based routing";
		}
		if (selectionMethod === "project-based") {
			return "matched via project-based routing";
		}
		if (selectionMethod === "team-based") {
			return "matched via team-based routing";
		}
		if (selectionMethod === "team-prefix") {
			return "matched via team prefix routing";
		}
		if (selectionMethod === "catch-all") {
			return "matched via catch-all routing";
		}
		return "matched via workspace fallback";
	}

	private buildRepositorySelectionBody(
		repositories: RepositorySelectionActivityInput[],
		uniqueRoutingMethods: RepositorySelectionMethod[],
	): string {
		if (repositories.length === 1) {
			const selection = repositories[0];
			if (!selection) {
				return "A repository was selected.";
			}
			const methodDisplay = this.getSelectionMethodDisplay(
				selection.routingMethod,
			);
			return `Repository "${selection.name}" has been ${methodDisplay}.`;
		}

		if (uniqueRoutingMethods.length === 1 && uniqueRoutingMethods[0]) {
			const methodDisplay = this.getSelectionMethodDisplay(
				uniqueRoutingMethods[0],
			);
			return `Selected ${repositories.length} repositories (${methodDisplay}):\n- ${repositories
				.map((repository) => repository.name)
				.join("\n- ")}`;
		}

		return `Selected ${repositories.length} repositories via mixed routing:\n- ${repositories
			.map(
				(repository) =>
					`${repository.name} (${this.getSelectionMethodDisplay(repository.routingMethod)})`,
			)
			.join("\n- ")}`;
	}

	async postSystemPromptSelectionThought(
		sessionId: string,
		labels: string[],
		repositoryId: string,
	): Promise<void> {
		const issueTracker = this.getIssueTracker();

		// Determine which prompt type was selected and which label triggered it
		let selectedPromptType: string | null = null;
		let triggerLabel: string | null = null;
		const repository = Array.from(this.repositories.values()).find(
			(r) => r.id === repositoryId,
		);

		if (repository?.labelPrompts) {
			// Check debugger labels
			const debuggerConfig = repository.labelPrompts.debugger;
			const debuggerLabels = Array.isArray(debuggerConfig)
				? debuggerConfig
				: debuggerConfig?.labels;
			const debuggerLabel = debuggerLabels?.find((label) =>
				labels.includes(label),
			);
			if (debuggerLabel) {
				selectedPromptType = "debugger";
				triggerLabel = debuggerLabel;
			} else {
				// Check builder labels
				const builderConfig = repository.labelPrompts.builder;
				const builderLabels = Array.isArray(builderConfig)
					? builderConfig
					: builderConfig?.labels;
				const builderLabel = builderLabels?.find((label) =>
					labels.includes(label),
				);
				if (builderLabel) {
					selectedPromptType = "builder";
					triggerLabel = builderLabel;
				} else {
					// Check scoper labels
					const scoperConfig = repository.labelPrompts.scoper;
					const scoperLabels = Array.isArray(scoperConfig)
						? scoperConfig
						: scoperConfig?.labels;
					const scoperLabel = scoperLabels?.find((label) =>
						labels.includes(label),
					);
					if (scoperLabel) {
						selectedPromptType = "scoper";
						triggerLabel = scoperLabel;
					} else {
						// Check orchestrator labels
						const orchestratorConfig = repository.labelPrompts.orchestrator;
						const orchestratorLabels = Array.isArray(orchestratorConfig)
							? orchestratorConfig
							: (orchestratorConfig?.labels ?? ["orchestrator"]);
						const orchestratorLabel = orchestratorLabels?.find((label) =>
							labels.includes(label),
						);
						if (orchestratorLabel) {
							selectedPromptType = "orchestrator";
							triggerLabel = orchestratorLabel;
						}
					}
				}
			}
		}

		// Only post if a role was actually triggered
		if (!selectedPromptType || !triggerLabel) {
			return;
		}

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: {
					type: "thought",
					body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
				},
			},
			"system prompt selection",
		);
	}

	async postInstantPromptedAcknowledgment(
		sessionId: string,
		repositoryId: string,
		isStreaming: boolean,
	): Promise<void> {
		const issueTracker = this.getIssueTracker();
		this.logger.debug(
			`Posting prompted acknowledgment for session ${sessionId} in repository ${repositoryId}`,
		);

		const message = isStreaming
			? "I've queued up your message as guidance"
			: "Getting started on that...";

		await this.postActivityDirect(
			issueTracker,
			{
				agentSessionId: sessionId,
				content: { type: "thought", body: message },
			},
			"prompted acknowledgment",
		);
	}

	async postComment(
		issueId: string,
		body: string,
		repositoryId: string,
		parentId?: string,
	): Promise<void> {
		// Get the issue tracker for this repository
		const issueTracker = this.getIssueTracker();
		this.logger.debug(
			`Posting comment for issue ${issueId} in repository ${repositoryId}`,
		);
		const commentInput: { body: string; parentId?: string } = {
			body,
		};
		// Add parent ID if provided (for reply)
		if (parentId) {
			commentInput.parentId = parentId;
		}
		await issueTracker.createComment(issueId, commentInput);
	}
}
