import type {
	EventMessagePartUpdated,
	EventPermissionUpdated,
	EventSessionError,
	EventSessionIdle,
	Event as OpenCodeEvent,
} from "@opencode-ai/sdk";
import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

/**
 * Re-export OpenCode event types for convenience.
 */
export type {
	EventMessagePartUpdated,
	EventPermissionUpdated,
	EventSessionError,
	EventSessionIdle,
	OpenCodeEvent,
};

/**
 * Configuration for OpenCodeRunner.
 */
export interface OpenCodeRunnerConfig extends AgentRunnerConfig {
	/**
	 * AI model to use in OpenCode format (e.g. "anthropic/claude-sonnet-4-5",
	 * "openai/gpt-4o"). Passed as the `model` field in SessionPromptData.body.
	 * When omitted, OpenCode uses its configured default.
	 */
	model?: string;

	/**
	 * Optional system prompt override passed directly to the OpenCode session.
	 */
	systemPrompt?: string;

	/**
	 * Maximum number of agentic steps before completing.
	 * Maps to OpenCode AgentConfig.maxSteps.
	 */
	maxSteps?: number;
}

/**
 * Session metadata for OpenCodeRunner.
 */
export interface OpenCodeSessionInfo extends AgentSessionInfo {
	sessionId: string | null;
	/** Internal OpenCode session ID returned by session.create() */
	opencodeSessionId: string | null;
}

/**
 * Event emitter interface for OpenCodeRunner.
 */
export interface OpenCodeRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	streamEvent: (event: OpenCodeEvent) => void;
}
