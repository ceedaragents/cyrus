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
}

/**
 * Configuration for the EdgeWorker supporting multiple repositories
 */
export interface EdgeWorkerConfig {
	// Proxy connection config
	proxyUrl?: string; // Optional - defaults to DEFAULT_PROXY_URL for OAuth flows
	baseUrl?: string;
	webhookBaseUrl?: string; // Legacy support - use baseUrl instead
	webhookPort?: number; // Legacy support - now uses serverPort
	serverPort?: number; // Unified server port for both webhooks and OAuth callbacks (default: 3456)
	serverHost?: string; // Server host address ('localhost' or '0.0.0.0', default: 'localhost')
	ngrokAuthToken?: string; // Ngrok auth token for tunnel creation

	// Issue tracker platform configuration
	/**
	 * Issue tracker platform type (default: "linear")
	 * - "linear": Uses Linear as the issue tracker (default production mode)
	 * - "cli": Uses an in-memory issue tracker for CLI-based testing and development
	 */
	platform?: "linear" | "cli";

	// Linear configuration (global)
	linearWorkspaceSlug?: string; // Linear workspace URL slug (e.g., "ceedar" from "https://linear.app/ceedar/...")

	// Claude config (shared across all repos)
	defaultAllowedTools?: string[];
	defaultDisallowedTools?: string[]; // Tools to explicitly disallow across all repositories (no defaults)
	defaultModel?: string; // Default Claude model to use across all repositories (e.g., "opus", "sonnet", "haiku")
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable

	// Global defaults for prompt types
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

	// Repository configurations
	repositories: RepositoryConfig[];

	// Cyrus home directory
	cyrusHome: string;

	// Agent configuration (for CLI mode)
	agentHandle?: string; // The name/handle the agent responds to (e.g., "john", "cyrus")
	agentUserId?: string; // The user ID of the agent (for CLI mode)

	// Optional handlers that apps can implement
	handlers?: {
		// Called when workspace needs to be created
		// Now includes repository context
		createWorkspace?: (
			issue: Issue,
			repository: RepositoryConfig,
		) => Promise<Workspace>;

		// Called with Claude messages (for UI updates, logging, etc)
		// Now includes repository ID
		onClaudeMessage?: (
			issueId: string,
			message: SDKMessage,
			repositoryId: string,
		) => void;

		// Called when session starts/ends
		// Now includes repository ID
		onSessionStart?: (
			issueId: string,
			issue: Issue,
			repositoryId: string,
		) => void;
		onSessionEnd?: (
			issueId: string,
			exitCode: number | null,
			repositoryId: string,
		) => void;

		// Called on errors
		onError?: (error: Error, context?: any) => void;

		// Called when OAuth callback is received
		onOAuthCallback?: OAuthCallbackHandler;
	};

	// Optional features (can be overridden per repository)
	features?: {
		enableContinuation?: boolean; // Support --continue flag (default: true)
		enableTokenLimitHandling?: boolean; // Auto-handle token limits (default: true)
		enableAttachmentDownload?: boolean; // Download issue attachments (default: false)
		promptTemplatePath?: string; // Path to custom prompt template
	};
}

/**
 * Edge configuration containing all repositories and global settings
 */
export interface EdgeConfig {
	repositories: RepositoryConfig[];
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	linearWorkspaceSlug?: string; // Linear workspace URL slug (e.g., "ceedar" from "https://linear.app/ceedar/...")
	defaultModel?: string; // Default Claude model to use across all repositories
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable
	global_setup_script?: string; // Optional path to global setup script that runs for all repositories
}
