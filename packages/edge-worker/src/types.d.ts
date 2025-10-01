import type { Issue as LinearIssue } from "@linear/sdk";
import type { SDKMessage } from "cyrus-claude-runner";
import type { CyrusAgentSession, Workspace } from "cyrus-core";
import type { OAuthCallbackHandler } from "./SharedApplicationServer.js";
export type RunnerType = "claude" | "codex" | "opencode";
export interface ClaudeRunnerModelConfig {
	model?: string;
	fallbackModel?: string;
}
export interface CodexRunnerModelConfig {
	model?: string;
}
export interface OpenCodeRunnerModelConfig {
	provider?: string;
	model?: string;
}
export interface CodexCliDefaults extends CodexRunnerModelConfig {
	approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
	sandbox?: "read-only" | "workspace-write" | "danger-full-access";
}
export interface OpenCodeCliDefaults extends OpenCodeRunnerModelConfig {
	serverUrl?: string;
}
export interface CliDefaults {
	claude?: ClaudeRunnerModelConfig;
	codex?: CodexCliDefaults;
	opencode?: OpenCodeCliDefaults;
}
export interface EdgeCredentials {
	openaiApiKey?: string;
}
export interface RepositoryRunnerModels {
	claude?: ClaudeRunnerModelConfig;
	codex?: CodexRunnerModelConfig;
	opencode?: OpenCodeRunnerModelConfig;
}
export interface RepositoryLabelAgentRoutingRule {
	labels: string[];
	runner: RunnerType;
	model?: string;
	provider?: string;
}
/**
 * Configuration for a single repository/workspace pair
 */
export type PromptToolPreset =
	| string[]
	| "readOnly"
	| "safe"
	| "all"
	| "coordinator";
export interface PromptRuleConfig {
	labels?: string[];
	allowedTools?: PromptToolPreset;
	disallowedTools?: string[];
	promptPath?: string;
}
export interface RepositoryConfig {
	id: string;
	name: string;
	runner?: RunnerType;
	repositoryPath: string;
	baseBranch: string;
	linearWorkspaceId: string;
	linearWorkspaceName?: string;
	linearToken: string;
	teamKeys?: string[];
	routingLabels?: string[];
	projectKeys?: string[];
	workspaceBaseDir: string;
	isActive?: boolean;
	promptTemplatePath?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	mcpConfigPath?: string | string[];
	appendInstruction?: string;
	model?: string;
	fallbackModel?: string;
	runnerModels?: RepositoryRunnerModels;
	labelAgentRouting?: RepositoryLabelAgentRoutingRule[];
	labelPrompts?: {
		debugger?: PromptRuleConfig | string[];
		builder?: PromptRuleConfig | string[];
		scoper?: PromptRuleConfig | string[];
		orchestrator?: PromptRuleConfig | string[];
		[key: string]: PromptRuleConfig | string[] | undefined;
	};
}
/**
 * Configuration for the EdgeWorker supporting multiple repositories
 */
export interface EdgeWorkerConfig {
	proxyUrl: string;
	baseUrl?: string;
	webhookBaseUrl?: string;
	webhookPort?: number;
	serverPort?: number;
	serverHost?: string;
	ngrokAuthToken?: string;
	defaultAllowedTools?: string[];
	defaultDisallowedTools?: string[];
	defaultModel?: string;
	defaultFallbackModel?: string;
	defaultCli?: RunnerType;
	cliDefaults?: CliDefaults;
	credentials?: EdgeCredentials;
	promptDefaults?: {
		debugger?: PromptRuleConfig;
		builder?: PromptRuleConfig;
		scoper?: PromptRuleConfig;
		orchestrator?: PromptRuleConfig;
		[key: string]: PromptRuleConfig | undefined;
	};
	repositories: RepositoryConfig[];
	cyrusHome: string;
	handlers?: {
		createWorkspace?: (
			issue: LinearIssue,
			repository: RepositoryConfig,
		) => Promise<Workspace>;
		onClaudeMessage?: (
			issueId: string,
			message: SDKMessage,
			repositoryId: string,
		) => void;
		onSessionStart?: (
			issueId: string,
			issue: LinearIssue,
			repositoryId: string,
		) => void;
		onSessionEnd?: (
			issueId: string,
			exitCode: number | null,
			repositoryId: string,
		) => void;
		onError?: (error: Error, context?: any) => void;
		onOAuthCallback?: OAuthCallbackHandler;
	};
	features?: {
		enableContinuation?: boolean;
		enableTokenLimitHandling?: boolean;
		enableAttachmentDownload?: boolean;
		promptTemplatePath?: string;
	};
}
/**
 * Events emitted by EdgeWorker
 */
export interface EdgeWorkerEvents {
	connected: (token: string) => void;
	disconnected: (token: string, reason?: string) => void;
	"session:started": (
		issueId: string,
		issue: LinearIssue,
		repositoryId: string,
	) => void;
	"session:ended": (
		issueId: string,
		exitCode: number | null,
		repositoryId: string,
	) => void;
	"claude:message": (
		issueId: string,
		message: SDKMessage,
		repositoryId: string,
	) => void;
	"claude:response": (
		issueId: string,
		text: string,
		repositoryId: string,
	) => void;
	"claude:tool-use": (
		issueId: string,
		tool: string,
		input: any,
		repositoryId: string,
	) => void;
	error: (error: Error, context?: any) => void;
}
/**
 * Data returned from createLinearAgentSession
 */
export interface LinearAgentSessionData {
	session: CyrusAgentSession;
	fullIssue: LinearIssue;
	workspace: Workspace;
	attachmentResult: {
		manifest: string;
		attachmentsDir: string | null;
	};
	attachmentsDir: string;
	allowedDirectories: string[];
	allowedTools: string[];
	disallowedTools: string[];
}
//# sourceMappingURL=types.d.ts.map
