import type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	PostToolUseHookInput,
	SDKMessage,
} from "cyrus-claude-runner";
import type {
	AgentRunnerConfig,
	CyrusAgentSession,
	ILogger,
	OnAskUserQuestion,
	RepositoryConfig,
	RunnerType,
} from "cyrus-core";

/**
 * Subset of McpConfigService consumed by RunnerConfigBuilder.
 */
export interface IMcpConfigProvider {
	buildMcpConfig(
		repoId: string,
		linearWorkspaceId: string,
		parentSessionId?: string,
		options?: { excludeSlackMcp?: boolean },
	): Record<string, McpServerConfig>;
	buildMergedMcpConfigPath(
		repositories: RepositoryConfig | RepositoryConfig[],
	): string | string[] | undefined;
}

/**
 * Subset of ToolPermissionResolver consumed by RunnerConfigBuilder.
 */
export interface IChatToolResolver {
	buildChatAllowedTools(
		mcpConfigKeys?: string[],
		userMcpTools?: string[],
	): string[];
}

/**
 * Subset of RunnerSelectionService consumed by RunnerConfigBuilder.
 */
export interface IRunnerSelector {
	determineRunnerSelection(
		labels: string[],
		issueDescription?: string,
	): {
		runnerType: RunnerType;
		modelOverride?: string;
		fallbackModelOverride?: string;
	};
	getDefaultModelForRunner(runnerType: RunnerType): string;
	getDefaultFallbackModelForRunner(runnerType: RunnerType): string;
}

/**
 * Input for building a chat session runner config.
 */
export interface ChatRunnerConfigInput {
	workspacePath: string;
	workspaceName: string | undefined;
	systemPrompt: string;
	sessionId: string;
	resumeSessionId?: string;
	cyrusHome: string;
	/** MCP server config (pre-built by McpConfigService or passed externally) */
	mcpConfig?: Record<string, McpServerConfig>;
	/** Repository to source user-configured MCP paths from (V1: first available repo) */
	repository?: RepositoryConfig;
	/** Repository paths the chat session can read */
	repositoryPaths?: string[];
	logger: ILogger;
	onMessage: (message: SDKMessage) => void | Promise<void>;
	onError: (error: Error) => void;
}

/**
 * Input for building an issue session runner config.
 */
export interface IssueRunnerConfigInput {
	session: CyrusAgentSession;
	repository: RepositoryConfig;
	sessionId: string;
	systemPrompt: string | undefined;
	allowedTools: string[];
	allowedDirectories: string[];
	disallowedTools: string[];
	resumeSessionId?: string;
	labels?: string[];
	issueDescription?: string;
	maxTurns?: number;
	singleTurn?: boolean;
	disallowAllTools?: boolean;
	mcpOptions?: { excludeSlackMcp?: boolean };
	linearWorkspaceId?: string;
	cyrusHome: string;
	logger: ILogger;
	onMessage: (message: SDKMessage) => void | Promise<void>;
	onError: (error: Error) => void;
	/** Factory to create AskUserQuestion callback (Claude runner only) */
	createAskUserQuestionCallback?: (
		sessionId: string,
		workspaceId: string,
	) => OnAskUserQuestion;
	/** Resolve the Linear workspace ID for a repository */
	requireLinearWorkspaceId: (repo: RepositoryConfig) => string;
}

/**
 * Shared runner config assembly for both issue and chat sessions.
 *
 * Eliminates duplication between EdgeWorker.buildAgentRunnerConfig() and
 * ChatSessionHandler.buildRunnerConfig() by providing focused factory methods
 * that produce AgentRunnerConfig objects using injected services.
 */
export class RunnerConfigBuilder {
	private chatToolResolver: IChatToolResolver;
	private mcpConfigProvider: IMcpConfigProvider;
	private runnerSelector: IRunnerSelector;

	constructor(
		chatToolResolver: IChatToolResolver,
		mcpConfigProvider: IMcpConfigProvider,
		runnerSelector: IRunnerSelector,
	) {
		this.chatToolResolver = chatToolResolver;
		this.mcpConfigProvider = mcpConfigProvider;
		this.runnerSelector = runnerSelector;
	}

	/**
	 * Build a runner config for chat sessions (Slack, GitHub chat, etc.).
	 *
	 * Chat sessions get read-only tools + MCP tool prefixes, and a simplified
	 * config without hooks, model selection, or procedure context.
	 */
	buildChatConfig(input: ChatRunnerConfigInput): AgentRunnerConfig {
		// Derive user-configured MCP config path from the repository
		const mcpConfigPath = input.repository
			? this.mcpConfigProvider.buildMergedMcpConfigPath(input.repository)
			: undefined;

		// Extract MCP tool entries from the repository's allowedTools config
		const userMcpTools = (input.repository?.allowedTools ?? []).filter((tool) =>
			tool.startsWith("mcp__"),
		);

		const mcpConfigKeys = input.mcpConfig
			? Object.keys(input.mcpConfig)
			: undefined;
		const allowedTools = this.chatToolResolver.buildChatAllowedTools(
			mcpConfigKeys,
			userMcpTools,
		);

		const repositoryPaths = Array.from(
			new Set((input.repositoryPaths ?? []).filter(Boolean)),
		);

		input.logger.debug("Chat session allowed tools:", allowedTools);

		return {
			workingDirectory: input.workspacePath,
			allowedTools,
			disallowedTools: [] as string[],
			allowedDirectories: [input.workspacePath, ...repositoryPaths],
			workspaceName: input.workspaceName,
			cyrusHome: input.cyrusHome,
			appendSystemPrompt: input.systemPrompt,
			...(input.mcpConfig ? { mcpConfig: input.mcpConfig } : {}),
			...(mcpConfigPath ? { mcpConfigPath } : {}),
			...(input.resumeSessionId
				? { resumeSessionId: input.resumeSessionId }
				: {}),
			logger: input.logger,
			maxTurns: 200,
			onMessage: input.onMessage,
			onError: input.onError,
		};
	}

	/**
	 * Build a runner config for issue sessions (Linear issues, GitHub PRs).
	 *
	 * Issue sessions get full tool sets, runner type selection, model overrides,
	 * hooks, and runner-specific configuration (Chrome, Cursor, etc.).
	 */
	buildIssueConfig(input: IssueRunnerConfigInput): {
		config: AgentRunnerConfig;
		runnerType: RunnerType;
	} {
		const log = input.logger;

		// Configure PostToolUse hooks for screenshot tools to guide Claude to use linear_upload_file
		const hooks = this.buildScreenshotHooks(log);

		// Determine runner type and model override from selectors
		const runnerSelection = this.runnerSelector.determineRunnerSelection(
			input.labels || [],
			input.issueDescription,
		);
		let runnerType = runnerSelection.runnerType;
		let modelOverride = runnerSelection.modelOverride;
		let fallbackModelOverride = runnerSelection.fallbackModelOverride;

		// If the labels have changed, and we are resuming a session. Use the existing runner for the session.
		if (input.session.claudeSessionId && runnerType !== "claude") {
			runnerType = "claude";
			modelOverride = this.runnerSelector.getDefaultModelForRunner("claude");
			fallbackModelOverride =
				this.runnerSelector.getDefaultFallbackModelForRunner("claude");
		} else if (input.session.geminiSessionId && runnerType !== "gemini") {
			runnerType = "gemini";
			modelOverride = this.runnerSelector.getDefaultModelForRunner("gemini");
			fallbackModelOverride =
				this.runnerSelector.getDefaultFallbackModelForRunner("gemini");
		} else if (input.session.codexSessionId && runnerType !== "codex") {
			runnerType = "codex";
			modelOverride = this.runnerSelector.getDefaultModelForRunner("codex");
			fallbackModelOverride =
				this.runnerSelector.getDefaultFallbackModelForRunner("codex");
		} else if (input.session.cursorSessionId && runnerType !== "cursor") {
			runnerType = "cursor";
			modelOverride = this.runnerSelector.getDefaultModelForRunner("cursor");
			fallbackModelOverride =
				this.runnerSelector.getDefaultFallbackModelForRunner("cursor");
		}

		// Log model override if found
		if (modelOverride) {
			log.debug(`Model override via selector: ${modelOverride}`);
		}

		// Convert singleTurn flag to effective maxTurns value
		const effectiveMaxTurns = input.singleTurn ? 1 : input.maxTurns;

		// Determine final model from selectors, repository override, then runner-specific defaults
		const finalModel =
			modelOverride ||
			input.repository.model ||
			this.runnerSelector.getDefaultModelForRunner(runnerType);

		// When disallowAllTools is true, don't provide any MCP servers to ensure
		// the agent cannot use any tools (including MCP-provided tools like Linear create_comment)
		const resolvedWorkspaceId =
			input.linearWorkspaceId ??
			input.requireLinearWorkspaceId(input.repository);
		const mcpConfig = input.disallowAllTools
			? undefined
			: this.mcpConfigProvider.buildMcpConfig(
					input.repository.id,
					resolvedWorkspaceId,
					input.sessionId,
					input.mcpOptions,
				);
		const mcpConfigPath = input.disallowAllTools
			? undefined
			: this.mcpConfigProvider.buildMergedMcpConfigPath(input.repository);

		if (input.disallowAllTools) {
			log.info(
				`MCP tools disabled for session ${input.sessionId} (disallowAllTools=true)`,
			);
		}

		const config: AgentRunnerConfig & Record<string, unknown> = {
			workingDirectory: input.session.workspace.path,
			allowedTools: input.allowedTools,
			disallowedTools: input.disallowedTools,
			allowedDirectories: input.allowedDirectories,
			workspaceName: input.session.issue?.identifier || input.session.issueId,
			cyrusHome: input.cyrusHome,
			mcpConfigPath,
			mcpConfig,
			appendSystemPrompt: input.systemPrompt || "",
			// When disallowAllTools is true, remove all built-in tools from model context
			...(input.disallowAllTools && { tools: [] }),
			// Priority order: label override > repository config > global default
			model: finalModel,
			fallbackModel:
				fallbackModelOverride ||
				input.repository.fallbackModel ||
				this.runnerSelector.getDefaultFallbackModelForRunner(runnerType),
			logger: log,
			hooks,
			// Enable Chrome integration for Claude runner (disabled for other runners)
			...(runnerType === "claude" && { extraArgs: { chrome: null } }),
			// AskUserQuestion callback - only for Claude runner
			...(runnerType === "claude" &&
				input.createAskUserQuestionCallback && {
					onAskUserQuestion: input.createAskUserQuestionCallback(
						input.sessionId,
						resolvedWorkspaceId,
					),
				}),
			onMessage: input.onMessage,
			onError: input.onError,
		};

		// Cursor runner-specific wiring for offline/headless harness
		if (runnerType === "cursor") {
			const approvalPolicy = (process.env.CYRUS_APPROVAL_POLICY || "never") as
				| "never"
				| "on-request"
				| "on-failure"
				| "untrusted";
			config.cursorPath =
				process.env.CURSOR_AGENT_PATH || process.env.CURSOR_PATH || undefined;
			config.cursorApiKey = process.env.CURSOR_API_KEY || undefined;
			config.askForApproval = approvalPolicy;
			config.approveMcps = true;
			config.sandbox = (process.env.CYRUS_SANDBOX || "enabled") as
				| "enabled"
				| "disabled";
		}

		if (input.resumeSessionId) {
			config.resumeSessionId = input.resumeSessionId;
		}

		if (effectiveMaxTurns !== undefined) {
			config.maxTurns = effectiveMaxTurns;
			if (input.singleTurn) {
				log.debug(`Applied singleTurn maxTurns=1`);
			}
		}

		return { config, runnerType };
	}

	/**
	 * Build PostToolUse hooks for screenshot/GIF tools that guide Claude
	 * to upload files to Linear using linear_upload_file.
	 */
	private buildScreenshotHooks(
		log: ILogger,
	): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
		return {
			PostToolUse: [
				{
					matcher: "playwright_screenshot",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							log.debug(
								`Tool ${postToolUseInput.tool_name} completed with response:`,
								postToolUseInput.tool_response,
							);
							const response = postToolUseInput.tool_response as {
								path?: string;
							};
							const filePath = response?.path || "the screenshot file";
							return {
								continue: true,
								additionalContext: `Screenshot taken successfully. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown. You can also use the Read tool to view the screenshot file to analyze the visual content.`,
							};
						},
					],
				},
				{
					matcher: "mcp__claude-in-chrome__computer",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							const response = postToolUseInput.tool_response as {
								action?: string;
								imageId?: string;
								path?: string;
							};
							// Only provide upload guidance for screenshot actions
							if (response?.action === "screenshot") {
								const filePath = response?.path || "the screenshot file";
								return {
									continue: true,
									additionalContext: `Screenshot captured. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
								};
							}
							return { continue: true };
						},
					],
				},
				{
					matcher: "mcp__claude-in-chrome__gif_creator",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							const response = postToolUseInput.tool_response as {
								action?: string;
								path?: string;
							};
							// Only provide upload guidance for export actions
							if (response?.action === "export") {
								const filePath = response?.path || "the exported GIF";
								return {
									continue: true,
									additionalContext: `GIF exported successfully. To share this GIF in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
								};
							}
							return { continue: true };
						},
					],
				},
				{
					matcher: "mcp__chrome-devtools__take_screenshot",
					hooks: [
						async (input, _toolUseID, { signal: _signal }) => {
							const postToolUseInput = input as PostToolUseHookInput;
							// Extract file path from input (the tool saves to filePath parameter)
							const toolInput = postToolUseInput.tool_input as {
								filePath?: string;
							};
							const filePath = toolInput?.filePath || "the screenshot file";
							return {
								continue: true,
								additionalContext: `Screenshot saved. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
							};
						},
					],
				},
			],
		};
	}
}
