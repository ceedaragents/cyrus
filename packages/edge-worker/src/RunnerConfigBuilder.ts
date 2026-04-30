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
	NetworkPolicy,
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
	/**
	 * When true, the GitHub credential brokering session env is injected
	 * (sentinel `GH_TOKEN`, git credential helper) and `GITHUB_TOKEN` /
	 * `GH_TOKEN` / `GH_ENTERPRISE_TOKEN` are stripped from the inherited
	 * `repositoryEnv`. EdgeWorker decides this based on
	 * `sandbox.brokerGitHubCredentials` AND a successfully-resolved token.
	 *
	 * The proxy-side policy update happens separately in EdgeWorker via
	 * `egressProxy.updateNetworkPolicy(buildGitHubBrokeredPolicy(...))`.
	 */
	brokerGitHubCredentials?: boolean;
}

/**
 * Per-session CA env vars for the egress proxy's TLS interception cert.
 *
 * The egress proxy generates its own CA at `~/.cyrus/certs/cyrus-egress-ca.pem`
 * and uses it to MITM HTTPS for transformed domains (header injection /
 * credentials brokering). For tools running inside a sandboxed Bash command
 * to verify the proxy's fake server certs, they need to trust that CA. There
 * are two paths:
 *
 *  1. **Per-session env vars** (default) — this function. Each tool family
 *     reads its CA bundle path from a different env var, so we set them all
 *     to the same proxy CA path. The proxy lifts the trust boundary only
 *     for that session's children.
 *
 *  2. **System-wide trust** — set `sandbox.systemWideCert: true` in
 *     config.json AFTER copying the cert into the OS trust store. On
 *     Ubuntu/Debian:
 *       sudo cp ~/.cyrus/certs/cyrus-egress-ca.pem \\
 *               /usr/local/share/ca-certificates/cyrus-egress-ca.crt
 *       sudo update-ca-certificates
 *     With that flag set, EdgeWorker passes `egressCaCertPath: null` to this
 *     function and the env vars stay empty — the OS cert store handles it.
 *
 * **Tools that ignore env vars regardless** (require system-wide trust):
 * Bun (own opaque TLS stack), .NET/nuget (OS keychain), curl on macOS
 * (compiled against SecureTransport).
 *
 * **Don't set these in Cyrus's own parent process env** — they would break
 * Cyrus's own outbound git/HTTPS because the parent doesn't go through the
 * egress proxy. Setting them here only affects child sessions.
 */
export function buildEgressCaEnv(
	egressCaCertPath: string | null | undefined,
): Record<string, string> {
	if (!egressCaCertPath) return {};
	return {
		// Node.js (SDK, npm, etc.)
		NODE_EXTRA_CA_CERTS: egressCaCertPath,
		// OpenSSL-based tools (general fallback — also covers Ruby)
		SSL_CERT_FILE: egressCaCertPath,
		// Git HTTPS operations
		GIT_SSL_CAINFO: egressCaCertPath,
		// Python requests/pip
		REQUESTS_CA_BUNDLE: egressCaCertPath,
		PIP_CERT: egressCaCertPath,
		// curl (when compiled against OpenSSL, not SecureTransport)
		CURL_CA_BUNDLE: egressCaCertPath,
		// Rust/Cargo
		CARGO_HTTP_CAINFO: egressCaCertPath,
		// AWS CLI / boto3
		AWS_CA_BUNDLE: egressCaCertPath,
		// Deno
		DENO_CERT: egressCaCertPath,
	};
}

// ─── GitHub credential brokering ───────────────────────────────────────────
//
// When `sandbox.brokerGitHubCredentials` is true (default), the egress proxy
// rewrites Authorization headers on outbound requests to GitHub so the real
// token never enters the sandboxed session env. The Cloudflare "Outbound
// Workers TLS auth" model: agent code calls fetch() with no real auth, the
// proxy intercepts and injects the credentials at request time.
//
// The three exports below are the building blocks:
//   - GITHUB_BROKER_SENTINEL_TOKEN — the placeholder agents see.
//   - GITHUB_BROKERED_STRIP_ENV_KEYS — env vars to scrub from session env.
//   - buildGitHubBrokeredPolicy / buildGitHubBrokeredEnv — pure functions
//     that produce the proxy-side and session-side state respectively.

/**
 * The placeholder string that takes the place of a real token in the
 * sandboxed session's environment. gh CLI checks "is GH_TOKEN set?" before
 * making API calls; this satisfies that check without exposing anything
 * usable. The proxy's transform overwrites the Authorization header at
 * request time with the real token. Any value would work as long as it's:
 *   - non-empty (otherwise gh CLI's auth check fails)
 *   - obviously identifiable in transcripts and logs as a sentinel
 *   - not interpretable as a real GitHub token format (i.e. not starting
 *     with `ghp_`, `ghs_`, `gho_`, etc.)
 */
export const GITHUB_BROKER_SENTINEL_TOKEN = "x-cyrus-brokered";

/**
 * Env var names that carry real GitHub credentials. When brokering is on,
 * these are filtered out of the session's `repositoryEnv` (loaded from
 * `.env` files in the worktree) so an agent that reads `process.env`
 * inside the sandbox can never see a real token.
 */
export const GITHUB_BROKERED_STRIP_ENV_KEYS = [
	"GITHUB_TOKEN",
	"GH_TOKEN",
	"GH_ENTERPRISE_TOKEN",
] as const;

/**
 * Build a `NetworkPolicy` that layers GitHub credential-brokering transforms
 * onto a base policy, given a real GitHub token resolved from the App
 * installation or PAT. Pure function; the caller (EdgeWorker) is responsible
 * for resolving the token and pushing the result via `updateNetworkPolicy`.
 *
 * Brokered transforms:
 *   - `api.github.com` → `Authorization: Bearer <token>` (gh CLI shape).
 *   - `github.com`     → `Authorization: Basic base64("x-access-token:<token>")`
 *     (git over HTTPS shape; `x-access-token` is the canonical username for
 *     GitHub App installation tokens, also accepted for PATs).
 *
 * Composition rules:
 *   - If `basePolicy` is undefined or has no `allow` entries, returns a
 *     deny-all-with-allow policy containing only the two brokered domains.
 *   - If `basePolicy.preset === "trusted"` is set, the preset is preserved
 *     untouched — `parsePolicy()` in EgressProxy will expand it as usual,
 *     and the explicit api.github.com / github.com entries we add here will
 *     take precedence over the preset's empty rule for those same domains
 *     (per the existing `{ ...presetAllow, ...explicitAllow }` merge order).
 *   - If `basePolicy.allow` already contains entries for these domains, the
 *     brokered transform is APPENDED as an additional rule. Per
 *     `parsePolicy()`'s merge order (later rules win on key conflict), this
 *     means a user-supplied `Authorization` transform would be overridden
 *     by the broker. Other user-supplied headers on the same domain merge
 *     in unchanged.
 *
 * Pre-conditions: `token` must be non-empty. Caller checks for a null/empty
 * token and skips brokering — this function does not no-op silently.
 */
export function buildGitHubBrokeredPolicy(
	basePolicy: NetworkPolicy | undefined,
	token: string,
): NetworkPolicy {
	if (!token) {
		throw new Error(
			"buildGitHubBrokeredPolicy requires a non-empty token; caller must " +
				"check token resolution before invoking",
		);
	}

	// Bearer for the API surface. `Authorization: Bearer <token>` is what
	// gh CLI sends when GH_TOKEN is set.
	const bearerHeader = `Bearer ${token}`;

	// Basic for git over HTTPS. Username is "x-access-token" (GitHub's
	// canonical pattern for installation tokens; PATs also work with this
	// or any other non-empty username).
	const basicHeader = `Basic ${Buffer.from(`x-access-token:${token}`, "utf8").toString("base64")}`;

	const brokeredEntries: NonNullable<NetworkPolicy["allow"]> = {
		"api.github.com": [
			{ transform: [{ headers: { Authorization: bearerHeader } }] },
		],
		"github.com": [
			{ transform: [{ headers: { Authorization: basicHeader } }] },
		],
	};

	// Compose with the base policy. Existing rules for these two domains
	// are preserved; the brokered rule is appended so its transform is the
	// last-merged (and therefore winning) Authorization value per
	// EgressProxy.parsePolicy()'s Object.assign-based merge.
	const baseAllow = basePolicy?.allow ?? {};
	const composedAllow: NonNullable<NetworkPolicy["allow"]> = { ...baseAllow };
	for (const [host, brokeredRules] of Object.entries(brokeredEntries)) {
		const existing = composedAllow[host] ?? [];
		composedAllow[host] = [...existing, ...brokeredRules];
	}

	return {
		...basePolicy,
		allow: composedAllow,
	};
}

/**
 * Dependencies + previous state for `refreshGitHubBrokerPolicy`.
 *
 * Extracted as an explicit interface so the function is testable without an
 * EdgeWorker instance — the caller (EdgeWorker.refreshBrokeredGitHubPolicy)
 * threads its own state in and persists the returned result. Pure in the
 * sense that the function has no internal state; all branching is a
 * function of the deps it is handed.
 */
export interface GitHubBrokerRefreshDeps {
	/**
	 * Whether brokering is enabled for this configuration. When false, the
	 * helper short-circuits to `{ token: null, warningEmittedNow: false }`.
	 * Caller is still expected to call this on each refresh tick — making
	 * the gating local to the helper means EdgeWorker doesn't have to
	 * duplicate the gate logic at every call site.
	 */
	brokerEnabled: boolean;
	/**
	 * The user-configured base policy. The helper composes the brokered
	 * transforms on top via `buildGitHubBrokeredPolicy(basePolicy, token)`.
	 */
	basePolicy: NetworkPolicy | undefined;
	/**
	 * Workspace-stable token resolver. Returns `undefined` when no token
	 * is resolvable. `EdgeWorker.resolveStableGitHubToken` is the
	 * production binding.
	 */
	resolveToken: () => Promise<string | undefined>;
	/**
	 * Push the resulting policy to the proxy. The production binding is
	 * `egressProxy.updateNetworkPolicy(policy)`.
	 */
	pushPolicy: (policy: NetworkPolicy) => void;
	/** Last token successfully pushed (for change-detection). */
	prevToken: string | null;
	/** True if the WARN-once for "no token" has already fired. */
	warningEmittedAlready: boolean;
	/** Bound logger.warn — called only when emitting the WARN-once. */
	emitWarning: () => void;
	/** Bound logger.info — called when a fresh policy is actually pushed. */
	emitInfo: () => void;
}

/**
 * Resolve and (if changed) push a brokered GitHub `NetworkPolicy` onto the
 * proxy. Returns the new token + WARN-latch state for the caller to persist.
 *
 * Behavior:
 *   - `brokerEnabled: false` → no-op, returns `{ newToken: null, warningEmittedNow: false }`.
 *   - resolver returns falsy → if `warningEmittedAlready` is false, emit WARN
 *     once; return `{ newToken: null, warningEmittedNow: true }` so the
 *     latch persists on subsequent calls. The latch is reset (via
 *     `newToken !== null && !warningEmittedAlready` semantics in the
 *     caller) once a token resolves successfully.
 *   - resolver returns same token as `prevToken` → no policy push, return
 *     `{ newToken: token, warningEmittedNow: false }` (the policy is
 *     already current; just clear the latch).
 *   - resolver returns a NEW token → call `buildGitHubBrokeredPolicy` and
 *     `pushPolicy`, return the new token.
 */
export async function refreshGitHubBrokerPolicy(
	deps: GitHubBrokerRefreshDeps,
): Promise<{ newToken: string | null; warningEmittedNow: boolean }> {
	if (!deps.brokerEnabled) {
		return { newToken: null, warningEmittedNow: false };
	}

	const token = await deps.resolveToken();
	if (!token) {
		if (!deps.warningEmittedAlready) deps.emitWarning();
		return { newToken: null, warningEmittedNow: true };
	}

	if (deps.prevToken === token) {
		// Token is current; just clear the WARN latch (token resolution is
		// healthy). No policy push.
		return { newToken: token, warningEmittedNow: false };
	}

	const brokeredPolicy = buildGitHubBrokeredPolicy(deps.basePolicy, token);
	deps.pushPolicy(brokeredPolicy);
	deps.emitInfo();
	return { newToken: token, warningEmittedNow: false };
}

/**
 * Build the per-session env vars that make sandboxed `gh` and `git`
 * unconditionally route GitHub auth through the egress proxy.
 *
 * Returns:
 *   - `GH_TOKEN` — sentinel placeholder. gh CLI's auth check passes; the
 *     proxy overwrites the Authorization header with the real token at
 *     request time. The sandboxed agent can read this env var, but it's
 *     not usable for anything outside the proxy's reach.
 *   - `GIT_TERMINAL_PROMPT=0` — git never opens an interactive prompt,
 *     even if the credential-helper handshake somehow misroutes. Prevents
 *     a sandboxed git push from hanging.
 *   - `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` —
 *     register an inline credential helper for `https://github.com` that
 *     always returns `username=x-access-token` and a sentinel password.
 *     git then sends `Authorization: Basic base64("x-access-token:<sentinel>")`,
 *     which the proxy overwrites with the real Basic header. (The env-var
 *     route is the only way to inject git config without writing to disk;
 *     see git-config(1) §"GIT_CONFIG_COUNT".)
 *
 * Returns `{}` when `enabled: false` — caller spreads unconditionally.
 */
export function buildGitHubBrokeredEnv(opts: {
	enabled: boolean;
}): Record<string, string> {
	if (!opts.enabled) return {};

	// Inline credential helper: a single shell function that prints the
	// helper protocol response. git invokes it as `<helper> get` and reads
	// `username=...` and `password=...` lines from stdout. The leading `!`
	// tells git this is a shell snippet, not a binary path.
	const credentialHelper = `!f() { echo username=x-access-token; echo password=${GITHUB_BROKER_SENTINEL_TOKEN}; }; f`;

	return {
		// gh CLI auth marker. Real Authorization header is overwritten by
		// the proxy's transform at request time.
		GH_TOKEN: GITHUB_BROKER_SENTINEL_TOKEN,
		// Belt: prevent any interactive prompt if the helper somehow misfires.
		GIT_TERMINAL_PROMPT: "0",
		// Suspenders: register the credential helper without touching disk.
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "credential.https://github.com.helper",
		GIT_CONFIG_VALUE_0: credentialHelper,
	};
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
			// GitHub credential brokering — strip real GITHUB_TOKEN/GH_TOKEN
			// from `repositoryEnv` (loaded from .env files) so they never
			// reach the sandboxed agent. The sentinel GH_TOKEN replacement
			// is set in additionalEnv via buildGitHubBrokeredEnv (above).
			// EdgeWorker only sets brokerGitHubCredentials true after
			// resolving a real token; otherwise this stays unset.
			...(input.brokerGitHubCredentials === true && {
				stripEnvKeys: GITHUB_BROKERED_STRIP_ENV_KEYS,
			}),
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
			// CA-trust env vars (empty when systemWideCert is true and
			// EdgeWorker passes egressCaCertPath: null).
			...buildEgressCaEnv(input.egressCaCertPath),
			// GitHub credential-brokering session env (empty when EdgeWorker
			// can't resolve a token, or when brokerGitHubCredentials is false).
			// The matching proxy-side policy update happens in EdgeWorker via
			// updateNetworkPolicy.
			...buildGitHubBrokeredEnv({
				enabled: input.brokerGitHubCredentials === true,
			}),
		};

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
