import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

export type SandboxMode =
	| "read-only"
	| "workspace-write"
	| "danger-full-access";
export type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted";
export type ModelReasoningEffort =
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";
export type WebSearchMode = "disabled" | "cached" | "live";

export interface CodexUsage {
	input_tokens: number;
	output_tokens: number;
	cached_input_tokens: number;
}

export interface CodexCommandExecutionItem {
	id: string;
	type: "command_execution";
	command: string;
	aggregated_output: string;
	exit_code?: number;
	status: "in_progress" | "completed" | "failed";
}

export interface CodexFileChangeItem {
	id: string;
	type: "file_change";
	changes: Array<{ path: string; kind: "add" | "delete" | "update" }>;
	status: "completed" | "failed";
}

export interface CodexMcpToolCallItem {
	id: string;
	type: "mcp_tool_call";
	server: string;
	tool: string;
	arguments: unknown;
	result?: {
		content?: unknown[];
		structured_content?: unknown;
	};
	error?: { message: string };
	status: "in_progress" | "completed" | "failed";
}

export interface CodexWebSearchItem {
	id: string;
	type: "web_search";
	query: string;
	action?: {
		type?: string;
		url?: string;
		pattern?: string;
		query?: string;
		queries?: string[];
	} | null;
}

export interface CodexTodoListItem {
	id: string;
	type: "todo_list";
	items: Array<{
		text: string;
		completed: boolean;
		in_progress?: boolean;
	}>;
}

export interface CodexAgentMessageItem {
	id: string;
	type: "agent_message";
	text: string;
}

export type CodexThreadItem =
	| CodexCommandExecutionItem
	| CodexFileChangeItem
	| CodexMcpToolCallItem
	| CodexWebSearchItem
	| CodexTodoListItem
	| CodexAgentMessageItem;

export type CodexJsonEvent =
	| { type: "thread.started"; thread_id: string }
	| { type: "item.started"; item: CodexThreadItem }
	| { type: "item.completed"; item: CodexThreadItem }
	| { type: "turn.completed"; usage?: CodexUsage }
	| { type: "turn.failed"; error?: { message: string } }
	| { type: "error"; message: string };

export type CodexConfigValue =
	| string
	| number
	| boolean
	| CodexConfigValue[]
	| { [key: string]: CodexConfigValue };

export type CodexConfigOverrides = { [key: string]: CodexConfigValue };

export interface CodexRunnerConfig extends AgentRunnerConfig {
	/** Path to codex CLI binary (defaults to `codex` in PATH) */
	codexPath?: string;
	/**
	 * Override Codex home directory.
	 * Defaults to process `CODEX_HOME`, then `~/.codex`.
	 */
	codexHome?: string;
	/**
	 * Override Codex reasoning effort.
	 * If omitted, CodexRunner applies a safe default for known model constraints.
	 */
	modelReasoningEffort?: ModelReasoningEffort;
	/** Sandbox mode for Codex shell/tool execution */
	sandbox?: SandboxMode;
	/** Approval policy for Codex tool/shell execution */
	askForApproval?: ApprovalMode;
	/** Enable Codex web search tool */
	includeWebSearch?: boolean;
	/** Explicit Codex web search mode (takes precedence over includeWebSearch) */
	webSearchMode?: WebSearchMode;
	/** Allow execution outside git repo (defaults to true) */
	skipGitRepoCheck?: boolean;
	/** Additional global Codex config overrides passed through app-server thread config */
	configOverrides?: CodexConfigOverrides;
	/** JSON Schema for structured output (passed to turn/start as outputSchema) */
	outputSchema?: unknown;
}

export interface CodexSessionInfo extends AgentSessionInfo {
	sessionId: string | null;
}

export interface CodexRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	streamEvent: (event: CodexJsonEvent) => void;
}
