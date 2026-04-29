import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

export interface CursorRunnerConfig extends AgentRunnerConfig {
	/** API key for Cursor SDK authentication (falls back to CURSOR_API_KEY env). */
	cursorApiKey?: string;

	/**
	 * Whether to request the SDK's filesystem sandbox. Currently a no-op
	 * pending SDK exposure of `configureSandboxPrereqs` (see CYPACK-1149
	 * bug filed with Cursor team). Defaults to disabled at the SDK layer;
	 * Cyrus's existing bubblewrap/egress proxy still applies on Linux.
	 */
	sandbox?: "enabled" | "disabled";
}

export interface CursorSessionInfo extends AgentSessionInfo {
	/** The SDK agentId (local-prefix `agent-<uuid>`). */
	sessionId: string | null;
}

export interface CursorRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
}
