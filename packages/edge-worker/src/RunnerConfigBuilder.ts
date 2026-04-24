import type {
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	PostToolUseHookInput,
	SandboxSettings,
	SDKMessage,
	SdkPluginConfig,
	StopHookInput,
} from "cyrus-claude-runner";
import type {
	AgentRunnerConfig,
	CyrusAgentSession,
	EnvironmentConfig,
	ILogger,
	OnAskUserQuestion,
	RepositoryConfig,
	RunnerType,
} from "cyrus-core";
import {
	EnvironmentResolver,
	isEnvironmentIsolated,
} from "./EnvironmentResolver.js";

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
	/** Linear workspace ID for building fresh MCP config at session start */
	linearWorkspaceId?: string;
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
	/** Plugins to load for the session (provides skills, hooks, etc.) */
	plugins?: SdkPluginConfig[];
	/** SDK sandbox settings (enabled, network proxy ports) for Claude runner */
	sandboxSettings?: SandboxSettings;
	/** CA cert path for MITM TLS termination — passed via child process env */
	egressCaCertPath?: string;
	/**
	 * Optional environment config bound to this session. When present, its
	 * fields override repository-level defaults for systemPrompt, allowed
	 * and disallowed tools, mcpConfigPath, sandbox filesystem permissions,
	 * and plugins/skills.
	 */
	environment?: EnvironmentConfig;
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
	 * config without hooks or model selection.
	 */
	buildChatConfig(input: ChatRunnerConfigInput): AgentRunnerConfig {
		// Derive user-configured MCP config path from the repository
		const mcpConfigPath = input.repository
			? this.mcpConfigProvider.buildMergedMcpConfigPath(input.repository)
			: undefined;

		// Build fresh MCP config at session start (reads current token from config)
		// This follows the same pattern as buildIssueConfig — never use a pre-baked config
		const mcpConfig =
			input.linearWorkspaceId && input.repository
				? this.mcpConfigProvider.buildMcpConfig(
						input.repository.id,
						input.linearWorkspaceId,
						input.sessionId,
					)
				: undefined;

		// Extract MCP tool entries from the repository's allowedTools config
		const userMcpTools = (input.repository?.allowedTools ?? []).filter((tool) =>
			tool.startsWith("mcp__"),
		);

		const mcpConfigKeys = mcpConfig ? Object.keys(mcpConfig) : undefined;
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
			...(mcpConfig ? { mcpConfig } : {}),
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

		// Configure hooks: PostToolUse for screenshot tools + Stop hook for PR/summary enforcement
		const screenshotHooks = this.buildScreenshotHooks(log);
		const stopHook = this.buildStopHook(log);
		const hooks = { ...screenshotHooks, ...stopHook };

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

		// Determine final model from selectors, repository override, then runner-specific defaults
		const finalModel =
			modelOverride ||
			input.repository.model ||
			this.runnerSelector.getDefaultModelForRunner(runnerType);

		const resolvedWorkspaceId =
			input.linearWorkspaceId ??
			input.requireLinearWorkspaceId(input.repository);

		// Delegate all "env vs default" resolution to EnvironmentResolver.
		// In isolated mode it strips dynamic MCP servers, hooks, the
		// Chrome arg, and default settingSources; in merge mode it
		// preserves the legacy behavior. Either way, this method is now
		// just orchestration — the rules live in one place.
		const env = input.environment;
		const baseMcpConfig = this.mcpConfigProvider.buildMcpConfig(
			input.repository.id,
			resolvedWorkspaceId,
			input.sessionId,
			input.mcpOptions,
		);
		const baseMcpConfigPath = this.mcpConfigProvider.buildMergedMcpConfigPath(
			input.repository,
		);
		const resolver = new EnvironmentResolver(log);
		const resolved = resolver.resolve(env, {
			systemPrompt: input.systemPrompt,
			allowedTools: input.allowedTools,
			disallowedTools: input.disallowedTools,
			mcpConfigPath: baseMcpConfigPath,
			mcpConfig: baseMcpConfig,
			plugins: input.plugins,
			sandboxSettings: input.sandboxSettings,
			hooks,
			settingSources: undefined,
			addChromeExtraArg: true,
			defaultAllowedDirectories: input.allowedDirectories,
			envReadOnlyRepoPaths: [],
			worktreePath: input.session.workspace.path,
			restrictHomeDirectoryReads: true,
		});

		// Build a shadow input that buildSandboxConfig can consume.
		const sandboxInput: IssueRunnerConfigInput = {
			...input,
			sandboxSettings: resolved.sandboxSettings,
		};

		const config: AgentRunnerConfig & Record<string, unknown> = {
			workingDirectory: input.session.workspace.path,
			allowedTools: resolved.allowedTools,
			disallowedTools: resolved.disallowedTools,
			allowedDirectories: resolved.allowedDirectories,
			workspaceName: input.session.issue?.identifier || input.session.issueId,
			cyrusHome: input.cyrusHome,
			...(resolved.mcpConfigPath !== undefined && {
				mcpConfigPath: resolved.mcpConfigPath,
			}),
			...(resolved.mcpConfig !== undefined && {
				mcpConfig: resolved.mcpConfig,
			}),
			appendSystemPrompt: resolved.systemPrompt || "",
			// Priority order: label override > repository config > global default
			model: finalModel,
			fallbackModel:
				fallbackModelOverride ||
				input.repository.fallbackModel ||
				this.runnerSelector.getDefaultFallbackModelForRunner(runnerType),
			logger: log,
			hooks: resolved.hooks,
			// Plugins providing skills (Claude runner only)
			...(runnerType === "claude" &&
				resolved.plugins?.length && { plugins: resolved.plugins }),
			// SDK sandbox settings (Claude runner only):
			// - Merge base settings with per-session filesystem.allowWrite (worktree path)
			// - Pass CA cert path via env for MITM TLS termination
			...(runnerType === "claude" &&
				resolved.sandboxSettings &&
				this.buildSandboxConfig(sandboxInput)),
			// Enable Chrome integration for Claude runner (disabled in
			// isolated environments and for other runners).
			...(runnerType === "claude" &&
				resolved.addChromeExtraArg && { extraArgs: { chrome: null } }),
			// Forward `settingSources` only when explicitly resolved (env
			// said so, or isolation forced `[]`). Omitted lets the
			// ClaudeRunner default of `["user","project","local"]` apply.
			...(runnerType === "claude" &&
				resolved.settingSources !== undefined && {
					settingSources: resolved.settingSources,
				}),
			// Forward the home-directory restriction toggle. Only set when
			// the env opted out (false) — leaving it undefined lets the
			// ClaudeRunner default (true, restrict) apply.
			...(runnerType === "claude" &&
				resolved.restrictHomeDirectoryReads === false && {
					restrictHomeDirectoryReads: false,
				}),
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

		if (input.maxTurns !== undefined) {
			config.maxTurns = input.maxTurns;
		}

		// Layer env variables in precedence order (lowest to highest):
		//   1. Environment file's `env` field (admin-declared defaults)
		//   2. Per-session inline overrides parsed from the issue
		//      description (`env=name$K=V`) — pre-filtered by the env's
		//      `allowInlineOverrides` allowlist upstream.
		//   3. Sandbox-managed variables (NODE_EXTRA_CA_CERTS etc.) —
		//      must stay intact for TLS interception.
		const sessionOverrides = input.session.environmentOverrides;
		const hasEnvBase = env?.env && Object.keys(env.env).length > 0;
		const hasOverrides =
			sessionOverrides && Object.keys(sessionOverrides).length > 0;
		if (runnerType === "claude" && (hasEnvBase || hasOverrides)) {
			const existing =
				(config.additionalEnv as Record<string, string> | undefined) ?? {};
			config.additionalEnv = {
				...(env?.env ?? {}),
				...(sessionOverrides ?? {}),
				...existing,
			};
		}

		return { config, runnerType };
	}

	/**
	 * Build a Stop hook that ensures the agent creates a PR and posts a summary
	 * before ending the session. Uses the `stop_hook_active` flag to prevent
	 * infinite loops — on the first stop attempt it blocks with guidance,
	 * on subsequent attempts (where the hook already fired) it allows the stop.
	 */
	private buildStopHook(
		_log: ILogger,
	): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
		return {
			Stop: [
				{
					matcher: ".*",
					hooks: [
						async (input) => {
							const stopInput = input as StopHookInput;

							// CRITICAL: Prevent infinite loops — if the stop hook already
							// fired once and the agent is trying to stop again, let it through.
							if (stopInput.stop_hook_active) {
								return { continue: false };
							}

							// Block the first stop attempt and guide the agent to create a PR and summary
							return {
								continue: true,
								additionalContext:
									"Before stopping, ensure you have committed and pushed all code changes and created/updated a PR (if you made any code changes).\n\n" +
									"If you have already done this (or no code changes were made), you may stop again.",
							};
						},
					],
				},
			],
		};
	}

	/**
	 * Build sandbox and env config for a Claude runner session.
	 * Merges base sandbox settings with per-session filesystem restrictions
	 * (worktree as the only writable directory) and passes the CA cert
	 * for MITM TLS termination via additionalEnv instead of process.env.
	 */
	private buildSandboxConfig(
		input: IssueRunnerConfigInput,
	): Record<string, unknown> {
		const result: Record<string, unknown> = {};

		if (input.sandboxSettings) {
			const isolated = isEnvironmentIsolated(input.environment);
			const baseFilesystem = (input.sandboxSettings.filesystem ?? {}) as Record<
				string,
				string[] | undefined
			>;
			result.sandbox = {
				...input.sandboxSettings,
				// When sandbox is enabled, do not allow commands to run unsandboxed
				allowUnsandboxedCommands: false,
				// Required for Go-based tools (gh, gcloud, terraform) to verify TLS certs
				// when using httpProxyPort with a MITM proxy and custom CA. macOS only —
				// opens access to com.apple.trustd.agent, which is a potential data
				// exfiltration path. See: https://code.claude.com/docs/en/settings#sandbox-settings
				enableWeakerNetworkIsolation: true,
				filesystem: isolated
					? {
							// Isolation mode: env-supplied filesystem rules are the
							// sole source of truth. The only runtime-safety addition
							// is the worktree path in `allowWrite` so the agent can
							// persist its own work.
							...baseFilesystem,
							allowWrite: Array.from(
								new Set([
									...(baseFilesystem.allowWrite ?? []),
									input.session.workspace.path,
								]),
							),
						}
					: {
							...baseFilesystem,
							// "." resolves to the cwd of the primary folder Claude is working in.
							// See: https://code.claude.com/docs/en/settings#sandbox-path-prefixes
							// allowedDirectories contains the attachments dir, repo paths, and git
							// metadata dirs — all of which need OS-level read access alongside the worktree.
							allowRead: [".", ...input.allowedDirectories],
							denyRead: ["~/"],
							// Restrict subprocess writes to the session worktree only
							allowWrite: [input.session.workspace.path],
						},
			};
		}

		if (input.egressCaCertPath) {
			result.additionalEnv = {
				// Node.js (SDK, npm, etc.)
				NODE_EXTRA_CA_CERTS: input.egressCaCertPath,
				// OpenSSL-based tools (general fallback — also covers Ruby)
				SSL_CERT_FILE: input.egressCaCertPath,
				// Git HTTPS operations
				GIT_SSL_CAINFO: input.egressCaCertPath,
				// Python requests/pip
				REQUESTS_CA_BUNDLE: input.egressCaCertPath,
				PIP_CERT: input.egressCaCertPath,
				// curl (when compiled against OpenSSL, not SecureTransport)
				CURL_CA_BUNDLE: input.egressCaCertPath,
				// Rust/Cargo
				CARGO_HTTP_CAINFO: input.egressCaCertPath,
				// AWS CLI / boto3
				AWS_CA_BUNDLE: input.egressCaCertPath,
				// Deno
				DENO_CERT: input.egressCaCertPath,
			};
		}

		return result;
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
