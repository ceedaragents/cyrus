import { homedir } from "node:os";
import { resolve } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Workspace } from "./CyrusAgentSession.js";
import type { Issue } from "./issue-tracker/types.js";

/**
 * Resolve path with tilde (~) expansion
 * Expands ~ to the user's home directory and resolves to absolute path
 *
 * @param path - Path that may contain ~ prefix (e.g., "~/.cyrus/repos/myrepo")
 * @returns Absolute path with ~ expanded
 *
 * @example
 * resolvePath("~/projects/myapp") // "/home/user/projects/myapp"
 * resolvePath("/absolute/path") // "/absolute/path"
 * resolvePath("relative/path") // "/current/working/dir/relative/path"
 */
export function resolvePath(path: string): string {
	if (path.startsWith("~/")) {
		return resolve(homedir(), path.slice(2));
	}
	return resolve(path);
}

/**
 * OAuth callback handler type
 */
export type OAuthCallbackHandler = (
	token: string,
	workspaceId: string,
	workspaceName: string,
) => Promise<void>;

/**
 * Configuration for a single repository/workspace pair
 */
export interface RepositoryConfig {
	// Repository identification
	id: string; // Unique identifier for this repo config
	name: string; // Display name (e.g., "Frontend App")

	// Git configuration
	repositoryPath: string; // Local git repository path
	baseBranch: string; // Branch to create worktrees from (main, master, etc.)
	githubUrl?: string; // GitHub repository URL (e.g., "https://github.com/org/repo") - used for Linear select signal

	// Linear configuration
	linearWorkspaceId: string; // Linear workspace/team ID
	linearWorkspaceName?: string; // Linear workspace display name (optional, for UI)
	linearToken: string; // OAuth token for this Linear workspace
	linearRefreshToken?: string; // OAuth refresh token for automatic token renewal
	teamKeys?: string[]; // Linear team keys for routing (e.g., ["CEE", "BOOK"])
	routingLabels?: string[]; // Linear labels for routing issues to this repository (e.g., ["backend", "api"])
	projectKeys?: string[]; // Linear project names for routing (e.g., ["Mobile App", "API"])

	// Workspace configuration
	workspaceBaseDir: string; // Where to create issue workspaces for this repo

	// Optional settings
	isActive?: boolean; // Whether to process webhooks for this repo (default: true)
	promptTemplatePath?: string; // Custom prompt template for this repo
	allowedTools?: string[]; // Override Claude tools for this repository (overrides defaultAllowedTools)
	disallowedTools?: string[]; // Tools to explicitly disallow for this repository (no defaults)
	mcpConfigPath?: string | string[]; // Path(s) to MCP configuration JSON file(s) (format: {"mcpServers": {...}})
	appendInstruction?: string; // Additional instruction to append to the prompt in XML-style wrappers
	model?: string; // Claude model to use for this repository (e.g., "opus", "sonnet", "haiku")
	fallbackModel?: string; // Fallback model if primary model is unavailable

	// OpenAI configuration (for Sora video generation and DALL-E image generation)
	openaiApiKey?: string; // OpenAI API key for Sora and DALL-E
	openaiOutputDirectory?: string; // Directory to save generated media (defaults to workspace path)

	// Label-based system prompt configuration
	labelPrompts?: {
		debugger?: {
			labels: string[]; // Labels that trigger debugger mode (e.g., ["Bug"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for debugger mode
			disallowedTools?: string[]; // Tools to explicitly disallow in debugger mode
		};
		builder?: {
			labels: string[]; // Labels that trigger builder mode (e.g., ["Feature", "Improvement"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for builder mode
			disallowedTools?: string[]; // Tools to explicitly disallow in builder mode
		};
		scoper?: {
			labels: string[]; // Labels that trigger scoper mode (e.g., ["PRD"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for scoper mode
			disallowedTools?: string[]; // Tools to explicitly disallow in scoper mode
		};
		orchestrator?: {
			labels: string[]; // Labels that trigger orchestrator mode (e.g., ["Orchestrator"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for orchestrator mode
			disallowedTools?: string[]; // Tools to explicitly disallow in orchestrator mode
		};
		"graphite-orchestrator"?: {
			labels: string[]; // Labels that trigger graphite-orchestrator mode (requires both "graphite" AND "orchestrator" labels)
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for graphite-orchestrator mode
			disallowedTools?: string[]; // Tools to explicitly disallow in graphite-orchestrator mode
		};
		/** Label that indicates an issue should use the 'blocked by' issue as the 'base branch' for this issue worktree*/
		graphite?: {
			labels: string[]; // Labels that indicate Graphite stacking (e.g., ["graphite"])
		};
	};

	/**
	 * Repository-specific user access control.
	 * - allowedUsers: OVERRIDES global allowlist (not merged)
	 * - blockedUsers: EXTENDS global blocklist (merged/additive)
	 * - blockBehavior: OVERRIDES global setting
	 * - blockMessage: OVERRIDES global message
	 */
	userAccessControl?: UserAccessControlConfig;
}

/**
 * Runtime-only configuration fields for EdgeWorker.
 *
 * These fields are NOT serializable to JSON and are only available at runtime.
 * They include callbacks, handlers, and runtime-specific settings that cannot
 * be persisted to config.json.
 */
export interface EdgeWorkerRuntimeConfig {
	/** Cyrus CLI version (e.g., "1.2.3"), used in /health endpoint */
	version?: string;

	/** Cyrus home directory - required at runtime */
	cyrusHome: string;

	// --- Server/Network Configuration (runtime-specific) ---

	/** Optional proxy URL - defaults to DEFAULT_PROXY_URL for OAuth flows */
	proxyUrl?: string;

	/** Base URL for the server */
	baseUrl?: string;

	/** @deprecated Use baseUrl instead */
	webhookBaseUrl?: string;

	/** @deprecated Use serverPort instead */
	webhookPort?: number;

	/** Unified server port for both webhooks and OAuth callbacks (default: 3456) */
	serverPort?: number;

	/** Server host address ('localhost' or '0.0.0.0', default: 'localhost') */
	serverHost?: string;

	// --- Platform Configuration ---

	/**
	 * Issue tracker platform type (default: "linear")
	 * - "linear": Uses Linear as the issue tracker (default production mode)
	 * - "cli": Uses an in-memory issue tracker for CLI-based testing and development
	 */
	platform?: "linear" | "cli";

	// --- Agent Configuration (for CLI mode) ---

	/** The name/handle the agent responds to (e.g., "john", "cyrus") */
	agentHandle?: string;

	/** The user ID of the agent (for CLI mode) */
	agentUserId?: string;

	// --- Runtime Handlers (non-serializable callbacks) ---

	/**
	 * Optional handlers that apps can implement.
	 * These are callback functions that cannot be serialized to JSON.
	 */
	handlers?: {
		/** Called when workspace needs to be created. Includes repository context. */
		createWorkspace?: (
			issue: Issue,
			repository: RepositoryConfig,
		) => Promise<Workspace>;

		/** Called with Claude messages (for UI updates, logging, etc). Includes repository ID. */
		onClaudeMessage?: (
			issueId: string,
			message: SDKMessage,
			repositoryId: string,
		) => void;

		/** Called when session starts. Includes repository ID. */
		onSessionStart?: (
			issueId: string,
			issue: Issue,
			repositoryId: string,
		) => void;

		/** Called when session ends. Includes repository ID. */
		onSessionEnd?: (
			issueId: string,
			exitCode: number | null,
			repositoryId: string,
		) => void;

		/** Called on errors */
		onError?: (error: Error, context?: unknown) => void;

		/** Called when OAuth callback is received */
		onOAuthCallback?: OAuthCallbackHandler;
	};
}

/**
 * Configuration for the EdgeWorker supporting multiple repositories.
 *
 * This is the complete runtime configuration that combines:
 * - EdgeConfig: Serializable settings from ~/.cyrus/config.json
 * - EdgeWorkerRuntimeConfig: Runtime-only fields (callbacks, handlers, server config)
 *
 * The separation exists because EdgeConfig can be persisted to disk as JSON,
 * while EdgeWorkerRuntimeConfig contains callback functions and other
 * non-serializable runtime state that must be provided programmatically.
 *
 * @example
 * // EdgeConfig is loaded from config.json
 * const fileConfig: EdgeConfig = JSON.parse(fs.readFileSync('config.json'));
 *
 * // EdgeWorkerConfig adds runtime handlers
 * const runtimeConfig: EdgeWorkerConfig = {
 *   ...fileConfig,
 *   cyrusHome: '/home/user/.cyrus',
 *   handlers: {
 *     onSessionStart: (issueId, issue, repoId) => console.log('Started'),
 *     onError: (error) => console.error(error),
 *   },
 * };
 */
export type EdgeWorkerConfig = EdgeConfig & EdgeWorkerRuntimeConfig;

/**
 * User identifier for access control matching.
 * Supports multiple formats for flexibility:
 * - String: treated as user ID (e.g., "usr_abc123")
 * - Object with id: explicit user ID match
 * - Object with email: email-based match
 */
export type UserIdentifier =
	| string // Treated as user ID
	| { id: string } // Explicit user ID
	| { email: string }; // Email address

/**
 * User access control configuration for whitelisting/blacklisting users.
 */
export interface UserAccessControlConfig {
	/**
	 * Users allowed to delegate issues.
	 * If specified, ONLY these users can trigger Cyrus sessions.
	 * Empty array means no one is allowed (effectively disables Cyrus).
	 * Omitting this field means everyone is allowed (unless blocked).
	 */
	allowedUsers?: UserIdentifier[];

	/**
	 * Users blocked from delegating issues.
	 * These users cannot trigger Cyrus sessions.
	 * Takes precedence over allowedUsers.
	 */
	blockedUsers?: UserIdentifier[];

	/**
	 * What happens when a blocked user tries to delegate.
	 * - 'silent': Ignore the webhook quietly (default)
	 * - 'comment': Post an activity explaining the user is not authorized
	 */
	blockBehavior?: "silent" | "comment";

	/**
	 * Custom message to post when blockBehavior is 'comment'.
	 * Defaults to: "You are not authorized to delegate issues to this agent."
	 */
	blockMessage?: string;
}

/**
 * Edge configuration - the serializable configuration stored in ~/.cyrus/config.json
 *
 * This interface defines all settings that can be persisted to disk.
 * It contains global settings that apply across all repositories,
 * plus the array of repository-specific configurations.
 *
 * For runtime configuration that includes non-serializable callbacks,
 * see EdgeWorkerConfig which extends this interface.
 */
export interface EdgeConfig {
	/** Array of repository configurations */
	repositories: RepositoryConfig[];

	/** Ngrok auth token for tunnel creation */
	ngrokAuthToken?: string;

	/** Stripe customer ID for billing */
	stripeCustomerId?: string;

	/** Linear workspace URL slug (e.g., "ceedar" from "https://linear.app/ceedar/...") */
	linearWorkspaceSlug?: string;

	/** Default Claude model to use across all repositories (e.g., "opus", "sonnet", "haiku") */
	defaultModel?: string;

	/** Default fallback model if primary model is unavailable */
	defaultFallbackModel?: string;

	/** Optional path to global setup script that runs for all repositories */
	global_setup_script?: string;

	/** Default tools to allow across all repositories */
	defaultAllowedTools?: string[];

	/** Tools to explicitly disallow across all repositories */
	defaultDisallowedTools?: string[];

	/**
	 * Whether to trigger agent sessions when issue title, description, or attachments are updated.
	 * When enabled, the agent receives context showing what changed (old vs new values).
	 * Defaults to true if not specified.
	 */
	issueUpdateTrigger?: boolean;

	/**
	 * Global user access control settings.
	 * Applied to all repositories unless overridden.
	 */
	userAccessControl?: UserAccessControlConfig;

	/** Global defaults for prompt types (tool restrictions per prompt type) */
	promptDefaults?: {
		debugger?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		builder?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		scoper?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		orchestrator?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		"graphite-orchestrator"?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
	};

	/** Optional features (can be overridden per repository) */
	features?: {
		/** Support --continue flag (default: true) */
		enableContinuation?: boolean;
		/** Auto-handle token limits (default: true) */
		enableTokenLimitHandling?: boolean;
		/** Download issue attachments (default: false) */
		enableAttachmentDownload?: boolean;
		/** Path to custom prompt template */
		promptTemplatePath?: string;
	};
}
