import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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
	ILogger,
	OnAskUserQuestion,
	RepositoryConfig,
	RunnerType,
} from "cyrus-core";
import { buildBashWedgeDetectorHook } from "./hooks/BashWedgeDetectorHook.js";
import { buildPrMarkerHook } from "./hooks/PrMarkerHook.js";

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
	/**
	 * Sandbox-only paths (read+write) that aren't semantically "working
	 * directories" for the agent CLI. Typically collected via
	 * GitService.getGitMetadataDirectories for every worktree so git can
	 * read/write `.git/worktrees/<name>` metadata. Passed separately from
	 * allowedDirectories on purpose: the CLI shouldn't see these as dirs
	 * it can cd into, but the sandbox must let git touch them.
	 */
	sandboxGitMetadataDirectories?: string[];
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
}

/**
 * Default home-directory allowances for node-based package managers and
 * related developer tooling. Without these, `npm install`, `pnpm install`,
 * `yarn`, and `bun install` all fail inside the sandbox because they read
 * and write shared caches/stores under the user's home directory.
 *
 * Paths use the sandbox `~/` path-prefix form (see
 * https://code.claude.com/docs/en/settings#sandbox-path-prefixes). Entries
 * for both macOS and Linux layouts are included — irrelevant paths on a
 * given OS are harmless no-ops.
 *
 * IMPORTANT — relationship to `buildHomeDirectoryDisallowedTools()`:
 * This list and the tool-permission home-directory denylist in
 * `packages/claude-runner/src/home-directory-restrictions.ts` are
 * INTENTIONALLY INDEPENDENT. They serve different consumers:
 *   - This list feeds `sandbox.filesystem.allowRead` (OS-level), so
 *     unsandboxed children like `npm`, `git`, and `gh` can read host
 *     configs they need to function.
 *   - `buildHomeDirectoryDisallowedTools()` feeds the SDK's
 *     `disallowedTools` (Claude's tool-permission layer), enumerating
 *     `~/` and denying everything that isn't on the path to the
 *     worktree or an allowed dir.
 * The same path can legitimately appear in both: e.g. `~/.gitconfig`
 * is in this list (so `git` can read it) AND in the tool-deny list (so
 * Claude's `Read` tool cannot). That is the point — defense-in-depth.
 * If you change one, do not assume the other tracks it. See CLAUDE.md § 6.
 */
export function buildPackageManagerHomeAllowances(): {
	read: string[];
	write: string[];
} {
	// Read-only config files that tools commonly consult during install/auth.
	const readOnlyConfigs = [
		"~/.gitconfig",
		// Git's XDG config dir — covers ~/.config/git/config and ~/.config/git/ignore,
		// which git tries to access on nearly every command and warns about if missing
		// from the sandbox read list.
		"~/.config/git",
		"~/.config/gh/hosts.yml",
		"~/.config/gh/config.yml",
		// SSH known_hosts — needed by git and other tools that ssh to git hosts
		// (github.com, gitlab.com, etc.) to verify host keys without an interactive
		// prompt. Only known_hosts, not the private keys in ~/.ssh.
		"~/.ssh/known_hosts",
		"~/.npmrc",
		"~/.yarnrc",
		"~/.yarnrc.yml",
		// Claude Code SDK shell snapshots. The SDK wraps every Bash tool call
		// as `bash -c "source ~/.claude/shell-snapshots/snapshot-bash-XXX.sh
		// 2>/dev/null || true && shopt -u extglob 2>/dev/null || true && eval
		// 'CMD'"`. The snapshot captures the host shell's exported functions,
		// aliases, and shopts so Claude's bash subprocesses behave like the
		// user's normal shell. Without this entry the source fails silently
		// inside the sandbox (the wrapper suppresses stderr with `|| true`)
		// and any function/alias the user expects Claude's commands to inherit
		// is missing — symptom is "the command did the wrong thing", with no
		// error to diagnose. Read-only is sufficient; the SDK regenerates
		// these files itself in unsandboxed parent-process context.
		"~/.claude/shell-snapshots",
	];

	// Package manager caches, stores, and global install dirs. These need
	// read AND write access for installs to succeed.
	const packageManagerDirs = [
		// npm
		"~/.npm",
		// yarn (classic + berry)
		"~/.yarn",
		"~/.cache/yarn",
		// pnpm (content-addressable store + state)
		"~/.pnpm-store",
		"~/.local/share/pnpm",
		"~/.cache/pnpm",
		"~/Library/pnpm",
		"~/Library/Caches/pnpm",
		// bun
		"~/.bun",
		// deno
		"~/.deno",
		"~/.cache/deno",
		// node-gyp (native addon builds)
		"~/.node-gyp",
		// nvm / version managers that write lazily
		"~/.nvm",
		// generic XDG caches — some package managers fall back here
		"~/.cache",
	];

	return {
		read: [...readOnlyConfigs, ...packageManagerDirs],
		write: [...packageManagerDirs],
	};
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

		// Configure hooks: PostToolUse for screenshot tools + PR-marker enforcement
		// + bash FD-3 wedge detection, plus the Stop hook that blocks the session
		// when work is unshipped.
		const screenshotHooks = this.buildScreenshotHooks(log);
		const prMarkerHook = buildPrMarkerHook(log);
		const bashWedgeDetectorHook = buildBashWedgeDetectorHook(log);
		const stopHook = this.buildStopHook(log);
		const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
			...stopHook,
			PostToolUse: [
				...(screenshotHooks.PostToolUse ?? []),
				...(prMarkerHook.PostToolUse ?? []),
				...(bashWedgeDetectorHook.PostToolUse ?? []),
			],
		};

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
		const mcpConfig = this.mcpConfigProvider.buildMcpConfig(
			input.repository.id,
			resolvedWorkspaceId,
			input.sessionId,
			input.mcpOptions,
		);
		const mcpConfigPath = this.mcpConfigProvider.buildMergedMcpConfigPath(
			input.repository,
		);

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
			// Priority order: label override > repository config > global default
			model: finalModel,
			fallbackModel:
				fallbackModelOverride ||
				input.repository.fallbackModel ||
				this.runnerSelector.getDefaultFallbackModelForRunner(runnerType),
			logger: log,
			hooks,
			// Plugins providing skills (Claude runner only)
			...(runnerType === "claude" &&
				input.plugins?.length && { plugins: input.plugins }),
			// SDK sandbox settings (Claude runner only):
			// - Merge base settings with per-session filesystem.allowWrite (worktree path)
			// - Pass CA cert path via env for MITM TLS termination
			...(runnerType === "claude" &&
				input.sandboxSettings &&
				this.buildSandboxConfig(input)),
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

		if (input.maxTurns !== undefined) {
			config.maxTurns = input.maxTurns;
		}

		return { config, runnerType };
	}

	/**
	 * Build a Stop hook that ensures the agent creates a PR before ending the
	 * session when code changes were made. Inspects the working tree at the
	 * session cwd and blocks the first stop attempt if there are uncommitted
	 * changes or commits ahead of the upstream branch. The `stop_hook_active`
	 * flag prevents infinite loops — once the hook has already fired, the next
	 * stop is always allowed through.
	 */
	private buildStopHook(
		log: ILogger,
	): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
		return {
			Stop: [
				{
					matcher: ".*",
					hooks: [
						async (input) => {
							const stopInput = input as StopHookInput;

							// Prevent infinite loops: if the hook already fired, allow the stop.
							if (stopInput.stop_hook_active) {
								return {};
							}

							const guardrail = inspectGitGuardrail(stopInput.cwd, log);
							if (!guardrail) {
								return {};
							}

							return {
								decision: "block",
								reason: guardrail,
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

		const tmpDir = join(input.cyrusHome, "tmp");

		if (input.sandboxSettings) {
			// Ensure the tmp dir exists before sandbox start so Bun/npm/etc. can
			// write to it atomically on first install.
			try {
				mkdirSync(tmpDir, { recursive: true });
			} catch {
				// best-effort; sandbox will surface clearer errors if this fails
			}

			const homeAllowances = buildPackageManagerHomeAllowances();

			result.sandbox = {
				...input.sandboxSettings,
				// When sandbox is enabled, do not allow commands to run unsandboxed
				allowUnsandboxedCommands: false,
				// `enableWeakerNetworkIsolation` is a macOS-only knob: it opens
				// access to `com.apple.trustd.agent` so Go-based tools (gh,
				// gcloud, terraform) can verify TLS certs when using
				// httpProxyPort with a MITM proxy and custom CA. The flag does
				// nothing on Linux, but on macOS it is also a potential data
				// exfiltration path — so we only enable it where it actually
				// buys us something. See:
				// https://code.claude.com/docs/en/settings#sandbox-settings
				...(process.platform === "darwin" && {
					enableWeakerNetworkIsolation: true,
				}),
				// Run node-based package managers outside the sandbox. They spawn
				// lifecycle scripts, compile native addons, and touch a long tail of
				// paths that are impractical to fully enumerate. The egress proxy still
				// sees their network traffic; excluding them from the filesystem
				// sandbox is the practical trade-off that makes `install` work.
				excludedCommands: [
					...(input.sandboxSettings.excludedCommands ?? []),
					"bun *",
					"npm *",
					"pnpm *",
					"yarn *",
				],
				filesystem: {
					...input.sandboxSettings.filesystem,
					// IMPORTANT: the "." path-prefix only resolves into the final
					// sandbox rules when it's declared inside a committed
					// `.claude/settings.json` file that Claude Code reads from disk.
					// When sandbox settings are passed programmatically (like we do
					// here via the SDK), "." is NOT expanded to the session cwd —
					// so we must enumerate the worktree path explicitly.
					// See: https://code.claude.com/docs/en/settings#sandbox-path-prefixes
					// allowedDirectories contains the attachments dir, repo paths, and git
					// metadata dirs — all of which need OS-level read access alongside the
					// worktree. homeAllowances.read covers common node package manager
					// caches/stores and git/gh config files. tmpDir is a dedicated session
					// tmp dir for Bun and other tools that expect TMPDIR to be writable.
					allowRead: [
						input.session.workspace.path,
						...input.allowedDirectories,
						...(input.sandboxGitMetadataDirectories ?? []),
						...Object.values(input.session.workspace.repoPaths ?? {}),
						...homeAllowances.read,
						tmpDir,
					],
					denyRead: ["~/"],
					// Writes are allowed in every worktree (primary + sub-worktrees
					// for multi-repo), each worktree's `.git`/`.git/worktrees/<name>`
					// metadata (git needs to write index.lock, HEAD, refs/...),
					// plus package manager caches/stores and the shared tmp dir.
					allowWrite: [
						input.session.workspace.path,
						...Object.values(input.session.workspace.repoPaths ?? {}),
						...(input.sandboxGitMetadataDirectories ?? []),
						...homeAllowances.write,
						tmpDir,
					],
				},
			};
		}

		// BUN_TMPDIR points at a path that is always inside allowWrite when the
		// sandbox is enabled. Bun uses it for atomic installs and will fail if
		// its default tmp dir isn't writable. We set BUN_TMPDIR rather than
		// TMPDIR because the Claude Code native binary unconditionally overrides
		// TMPDIR to its own sandbox-managed path when spawning sandboxed shells,
		// so a TMPDIR we set here never reaches Bun. BUN_TMPDIR takes precedence
		// over TMPDIR for Bun, so this is the reliable hook.
		const additionalEnv: Record<string, string> = {
			BUN_TMPDIR: tmpDir,
		};

		if (input.egressCaCertPath) {
			// Node.js (SDK, npm, etc.)
			additionalEnv.NODE_EXTRA_CA_CERTS = input.egressCaCertPath;
			// OpenSSL-based tools (general fallback — also covers Ruby)
			additionalEnv.SSL_CERT_FILE = input.egressCaCertPath;
			// Git HTTPS operations
			additionalEnv.GIT_SSL_CAINFO = input.egressCaCertPath;
			// Python requests/pip
			additionalEnv.REQUESTS_CA_BUNDLE = input.egressCaCertPath;
			additionalEnv.PIP_CERT = input.egressCaCertPath;
			// curl (when compiled against OpenSSL, not SecureTransport)
			additionalEnv.CURL_CA_BUNDLE = input.egressCaCertPath;
			// Rust/Cargo
			additionalEnv.CARGO_HTTP_CAINFO = input.egressCaCertPath;
			// AWS CLI / boto3
			additionalEnv.AWS_CA_BUNDLE = input.egressCaCertPath;
			// Deno
			additionalEnv.DENO_CERT = input.egressCaCertPath;
		}

		result.additionalEnv = additionalEnv;

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

/**
 * Inspect the working tree at `cwd` and return a guardrail message if there
 * is unshipped work (uncommitted changes or commits ahead of the upstream).
 * Returns null when the tree is clean, when `cwd` isn't a git repo, or when
 * git is unavailable — in those cases the stop should not be blocked.
 */
export function inspectGitGuardrail(cwd: string, log: ILogger): string | null {
	const runGit = (args: string): string => {
		return execSync(`git ${args}`, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	};

	let status: string;
	try {
		status = runGit("status --porcelain");
	} catch (err) {
		log.debug(
			`PR guardrail: skipping (cwd is not a git repo or git failed): ${(err as Error).message}`,
		);
		return null;
	}

	const uncommittedFiles = status
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	const hasUncommitted = uncommittedFiles.length > 0;

	let unpushedCount = 0;
	try {
		unpushedCount = parseInt(runGit("rev-list --count @{u}..HEAD"), 10) || 0;
	} catch {
		// No upstream configured — fall back to comparing against origin's default branch.
		try {
			const baseRef = runGit("rev-parse --verify --abbrev-ref origin/HEAD");
			if (baseRef) {
				unpushedCount =
					parseInt(runGit(`rev-list --count ${baseRef}..HEAD`), 10) || 0;
			}
		} catch {
			// Can't determine a base — be conservative and don't block on commits alone.
		}
	}

	if (!hasUncommitted && unpushedCount === 0) {
		return null;
	}

	const parts: string[] = [];
	if (hasUncommitted) {
		parts.push(
			`${uncommittedFiles.length} uncommitted file change${uncommittedFiles.length === 1 ? "" : "s"}`,
		);
	}
	if (unpushedCount > 0) {
		parts.push(
			`${unpushedCount} commit${unpushedCount === 1 ? "" : "s"} not yet on the remote`,
		);
	}

	return (
		`You appear to be ending the session, but the working tree has ${parts.join(" and ")}. ` +
		"Before stopping:\n" +
		"1. Commit any uncommitted changes with a descriptive message.\n" +
		"2. Push the branch to the remote.\n" +
		"3. Create or update a pull request that summarizes the change.\n\n" +
		"If the work is genuinely complete and a PR is not appropriate (for example, a question or research task with no intended code changes), you may stop again — this guardrail only blocks once per session."
	);
}
