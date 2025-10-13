import type { ClaudeRunnerConfig } from "cyrus-claude-runner";

export type RunnerType = "claude" | "codex";

export interface RunnerConfigBase {
	type: RunnerType;
	cwd: string;
	prompt: string;
}

export interface ClaudeRunnerAdapterConfig extends RunnerConfigBase {
	type: "claude";
	claudeConfig: ClaudeRunnerConfig;
}

export interface CodexRunnerOptions extends RunnerConfigBase {
	type: "codex";
	model?: string;
	sandbox?: "read-only" | "workspace-write" | "danger-full-access";
	approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "never";
	fullAuto?: boolean;
	/** Existing Codex session id to resume (when continuing a conversation). */
	resumeSessionId?: string;
	/**
	 * Environment variables to pass through to the spawned process. Defaults to process.env.
	 */
	env?: NodeJS.ProcessEnv;
}

export type RunnerConfig = ClaudeRunnerAdapterConfig | CodexRunnerOptions;

export type RunnerEvent =
	| { kind: "thought"; text: string }
	| {
			kind: "action";
			name: string;
			detail?: string;
			itemType?: string;
			icon?: string;
	  }
	| { kind: "response"; text: string }
	| { kind: "final"; text: string }
	| { kind: "log"; text: string }
	| { kind: "error"; error: Error }
	| { kind: "session"; id: string };

export interface RunnerStartResult {
	sessionId?: string;
	capabilities?: {
		jsonStream?: boolean;
	};
}

export interface Runner {
	start(onEvent: (event: RunnerEvent) => void): Promise<RunnerStartResult>;
	stop(): Promise<void>;
}

export interface RunnerFactory {
	create(config: RunnerConfig): Runner;
}
