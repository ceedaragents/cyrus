/**
 * Type definitions for Gemini Runner
 *
 * Event types are derived from Zod schemas in schemas.ts for runtime validation.
 * Configuration and session types remain as interfaces.
 */

import type {
	AgentRunnerConfig,
	AgentSessionInfo,
	SDKMessage,
} from "cyrus-core";

// Re-export event types from schemas (derived from Zod schemas)
export type {
	GeminiErrorEvent,
	GeminiInitEvent,
	GeminiMessageEvent,
	GeminiResultEvent,
	GeminiStreamEvent,
	GeminiToolResultEvent,
	GeminiToolUseEvent,
} from "./schemas.js";

// Re-export schemas for runtime validation
export {
	GeminiErrorEventSchema,
	GeminiInitEventSchema,
	GeminiMessageEventSchema,
	GeminiResultEventSchema,
	GeminiStreamEventSchema,
	GeminiToolResultEventSchema,
	GeminiToolUseEventSchema,
	isGeminiErrorEvent,
	isGeminiInitEvent,
	isGeminiMessageEvent,
	isGeminiResultEvent,
	isGeminiToolResultEvent,
	isGeminiToolUseEvent,
	parseGeminiStreamEvent,
	safeParseGeminiStreamEvent,
} from "./schemas.js";

/**
 * Configuration for GeminiRunner
 * Extends the base AgentRunnerConfig with Gemini-specific options
 */
export interface GeminiRunnerConfig extends AgentRunnerConfig {
	/** Path to gemini CLI binary (defaults to 'gemini' in PATH) */
	geminiPath?: string;
	/** Whether to auto-approve all actions (--yolo flag) */
	autoApprove?: boolean;
	/** Approval mode for tool use */
	approvalMode?: "auto_edit" | "auto" | "manual";
	/** Enable debug output */
	debug?: boolean;
	/** Additional directories to include in workspace context (--include-directories flag) */
	includeDirectories?: string[];
	/** Enable single-turn mode (sets maxSessionTurns=1 in settings.json) */
	singleTurn?: boolean;
}

/**
 * Session information for Gemini runner
 */
export interface GeminiSessionInfo extends AgentSessionInfo {
	/** Gemini-specific session ID */
	sessionId: string | null;
}

/**
 * Event emitter interface for GeminiRunner
 */
export interface GeminiRunnerEvents {
	message: (message: SDKMessage) => void;
	error: (error: Error) => void;
	complete: (messages: SDKMessage[]) => void;
	streamEvent: (event: import("./schemas.js").GeminiStreamEvent) => void;
}
