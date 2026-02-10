import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

/**
 * Raw JSON event shape emitted by `codex exec --json`.
 * The CLI emits multiple event types and can evolve over time, so this
 * keeps the payload open while preserving the stable `type` discriminator.
 */
export interface CodexJsonEvent {
	type: string;
	[key: string]: unknown;
}

/**
 * Configuration for CodexRunner.
 */
export interface CodexRunnerConfig extends AgentRunnerConfig {
	/** Path to codex CLI binary (defaults to `codex` in PATH) */
	codexPath?: string;
	/**
	 * Override Codex home directory.
	 * Defaults to process `CODEX_HOME`, then `~/.codex`.
	 */
	codexHome?: string;
	/**
	 * Override Codex reasoning effort via `-c model_reasoning_effort=...`.
	 * If omitted, CodexRunner applies a safe default for known model constraints.
	 */
	modelReasoningEffort?: "low" | "medium" | "high" | "xhigh";
	/** Sandbox mode for Codex shell/tool execution */
	sandbox?: "read-only" | "workspace-write" | "danger-full-access";
	/** Approval policy for Codex tool/shell execution */
	askForApproval?: "untrusted" | "on-failure" | "on-request" | "never";
	/** Enable Codex web search tool */
	includeWebSearch?: boolean;
	/** Allow execution outside git repo (defaults to true) */
	skipGitRepoCheck?: boolean;
}

/**
 * Session metadata for CodexRunner.
 */
export interface CodexSessionInfo extends AgentSessionInfo {
	sessionId: string | null;
}

/**
 * Event emitter interface for CodexRunner.
 */
export interface CodexRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	streamEvent: (event: CodexJsonEvent) => void;
}
