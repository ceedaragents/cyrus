/**
 * OpenCode Runner Types
 *
 * Type definitions for the OpenCode SDK integration with Cyrus.
 * OpenCode is an SDK-based AI coding agent that provides:
 * - Managed server lifecycle via createOpencode()
 * - SSE event streaming
 * - True streaming input support
 *
 * @packageDocumentation
 */

import type { AgentRunnerConfig, AgentSessionInfo } from "cyrus-core";

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration options for the OpenCode SDK server.
 * These are passed to the createOpencode() function.
 */
export interface OpenCodeServerConfig {
	/**
	 * Port number for the OpenCode server.
	 * If not specified, a random available port will be allocated.
	 */
	port?: number;

	/**
	 * Base URL for the OpenCode server.
	 * Defaults to http://localhost:{port}
	 */
	baseURL?: string;

	/**
	 * Request timeout in milliseconds.
	 * @default 60000
	 */
	timeout?: number;

	/**
	 * Maximum number of automatic retry attempts for transient failures.
	 * @default 2
	 */
	maxRetries?: number;

	/**
	 * Log level for the SDK client.
	 */
	logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * Configuration for the OpenCode Runner.
 * Extends the base AgentRunnerConfig with OpenCode-specific options.
 */
export interface OpenCodeRunnerConfig extends AgentRunnerConfig {
	/**
	 * OpenCode server configuration options.
	 */
	serverConfig?: OpenCodeServerConfig;

	/**
	 * Enable debug logging for the runner.
	 * @default false
	 */
	debug?: boolean;

	/**
	 * Auto-approve all tool executions.
	 * @default false
	 */
	autoApprove?: boolean;

	/**
	 * Provider ID for the AI model.
	 * OpenCode supports multiple AI providers.
	 */
	providerId?: string;
}

// ============================================================================
// Session Types
// ============================================================================

/**
 * Session information for an OpenCode session.
 * Extends the base AgentSessionInfo with OpenCode-specific fields.
 */
export interface OpenCodeSessionInfo extends AgentSessionInfo {
	/**
	 * The session ID assigned by OpenCode.
	 * This is different from the Cyrus session ID.
	 */
	openCodeSessionId: string | null;

	/**
	 * The port the OpenCode server is running on.
	 */
	serverPort: number | null;

	/**
	 * Session title (if set).
	 */
	title?: string;

	/**
	 * Version identifier for the session.
	 */
	version?: string;
}

// ============================================================================
// Message Types
// ============================================================================

/**
 * OpenCode message part types.
 * Messages in OpenCode are composed of multiple parts.
 */
export type OpenCodeMessagePartType =
	| "text"
	| "file"
	| "tool"
	| "snapshot"
	| "patch";

/**
 * Base interface for message parts.
 */
export interface OpenCodeMessagePartBase {
	type: OpenCodeMessagePartType;
	timing?: {
		start: number;
		end: number;
	};
}

/**
 * Text content part.
 */
export interface OpenCodeTextPart extends OpenCodeMessagePartBase {
	type: "text";
	content: string;
}

/**
 * File reference part.
 */
export interface OpenCodeFilePart extends OpenCodeMessagePartBase {
	type: "file";
	path: string;
	sourceLocation?: {
		file: string;
		line: number;
	};
}

/**
 * Tool execution part.
 */
export interface OpenCodeToolPart extends OpenCodeMessagePartBase {
	type: "tool";
	name: string;
	state: OpenCodeToolState;
	input?: Record<string, unknown>;
	output?: unknown;
	error?: string;
}

/**
 * Tool execution states.
 */
export type OpenCodeToolState = "pending" | "running" | "completed" | "error";

/**
 * Snapshot part for application state capture.
 */
export interface OpenCodeSnapshotPart extends OpenCodeMessagePartBase {
	type: "snapshot";
	data?: Record<string, unknown>;
}

/**
 * Patch part for code modifications.
 */
export interface OpenCodePatchPart extends OpenCodeMessagePartBase {
	type: "patch";
	path?: string;
	content?: string;
	hash?: string;
}

/**
 * Union type for all message part types.
 */
export type OpenCodeMessagePart =
	| OpenCodeTextPart
	| OpenCodeFilePart
	| OpenCodeToolPart
	| OpenCodeSnapshotPart
	| OpenCodePatchPart;

/**
 * User message from OpenCode.
 */
export interface OpenCodeUserMessage {
	type: "user";
	timestamp?: Date;
	content: string;
	parts?: OpenCodeMessagePart[];
}

/**
 * Assistant message from OpenCode.
 */
export interface OpenCodeAssistantMessage {
	type: "assistant";
	content: string;
	parts?: OpenCodeMessagePart[];
	tokenMetrics?: {
		inputTokens: number;
		outputTokens: number;
	};
	error?: OpenCodeMessageError;
}

/**
 * Message error information.
 */
export interface OpenCodeMessageError {
	type: string;
	message: string;
}

/**
 * Union type for OpenCode messages.
 */
export type OpenCodeMessage = OpenCodeUserMessage | OpenCodeAssistantMessage;

// ============================================================================
// Event Types
// ============================================================================

/**
 * OpenCode event types for SSE streaming.
 */
export type OpenCodeEventType =
	| "installation"
	| "ide_installation"
	| "diagnostics"
	| "message_update"
	| "message_remove"
	| "message_part_update"
	| "session_update"
	| "session_delete"
	| "session_idle"
	| "session_error"
	| "file_edit"
	| "file_watcher"
	| "storage_write"
	| "permission_update";

/**
 * Base interface for OpenCode events.
 */
export interface OpenCodeEventBase {
	type: OpenCodeEventType;
	timestamp?: Date;
	properties: Record<string, unknown>;
}

/**
 * Session update event.
 */
export interface OpenCodeSessionUpdateEvent extends OpenCodeEventBase {
	type: "session_update";
	properties: {
		sessionId: string;
		[key: string]: unknown;
	};
}

/**
 * Message update event.
 */
export interface OpenCodeMessageUpdateEvent extends OpenCodeEventBase {
	type: "message_update";
	properties: {
		sessionId: string;
		messageId: string;
		[key: string]: unknown;
	};
}

/**
 * Session error event.
 */
export interface OpenCodeSessionErrorEvent extends OpenCodeEventBase {
	type: "session_error";
	properties: {
		sessionId: string;
		error: {
			name: string;
			message: string;
			data?: unknown;
		};
		[key: string]: unknown;
	};
}

/**
 * Union type for OpenCode events.
 */
export type OpenCodeEvent =
	| OpenCodeSessionUpdateEvent
	| OpenCodeMessageUpdateEvent
	| OpenCodeSessionErrorEvent
	| OpenCodeEventBase;

// ============================================================================
// Error Types
// ============================================================================

/**
 * OpenCode error types.
 */
export type OpenCodeErrorType =
	| "MessageAbortedError"
	| "ProviderAuthError"
	| "UnknownError"
	| "BadRequestError"
	| "AuthenticationError"
	| "PermissionDeniedError"
	| "NotFoundError"
	| "ConflictError"
	| "UnprocessableEntityError"
	| "RateLimitError"
	| "InternalServerError"
	| "ConnectionError"
	| "TimeoutError";

/**
 * OpenCode error information.
 */
export interface OpenCodeError {
	name: OpenCodeErrorType;
	message: string;
	data?: unknown;
}

// ============================================================================
// Runner Event Types
// ============================================================================

/**
 * Events emitted by the OpenCode Runner.
 */
export interface OpenCodeRunnerEvents {
	/**
	 * Emitted when a message is received.
	 */
	message: (message: OpenCodeMessage) => void;

	/**
	 * Emitted when an error occurs.
	 */
	error: (error: Error) => void;

	/**
	 * Emitted when the session completes.
	 */
	complete: (messages: OpenCodeMessage[]) => void;

	/**
	 * Emitted when an SSE event is received from the server.
	 */
	streamEvent: (event: OpenCodeEvent) => void;

	/**
	 * Emitted when the server starts.
	 */
	serverStart: (port: number) => void;

	/**
	 * Emitted when the server stops.
	 */
	serverStop: () => void;
}

// ============================================================================
// SDK Client Types (for reference)
// ============================================================================

/**
 * Options for creating an OpenCode client.
 * Based on the @opencode-ai/sdk ClientOptions.
 */
export interface OpenCodeClientOptions {
	baseURL?: string;
	timeout?: number;
	maxRetries?: number;
	fetch?: (request: RequestInit) => Promise<Response>;
	defaultHeaders?: Record<string, string>;
	defaultQuery?: Record<string, string>;
	logLevel?: "debug" | "info" | "warn" | "error";
}

/**
 * OpenCode session from the SDK.
 */
export interface OpenCodeSession {
	id: string;
	createdAt: Date;
	updatedAt: Date;
	title?: string;
	version?: string;
}

/**
 * Chat request body for the session.chat() method.
 */
export interface OpenCodeChatRequest {
	content: string;
	attachments?: Array<{
		type: string;
		path?: string;
		content?: string;
	}>;
}

/**
 * Type guard to check if a message is a user message.
 */
export function isOpenCodeUserMessage(
	message: OpenCodeMessage,
): message is OpenCodeUserMessage {
	return message.type === "user";
}

/**
 * Type guard to check if a message is an assistant message.
 */
export function isOpenCodeAssistantMessage(
	message: OpenCodeMessage,
): message is OpenCodeAssistantMessage {
	return message.type === "assistant";
}

/**
 * Type guard to check if a message part is a tool part.
 */
export function isOpenCodeToolPart(
	part: OpenCodeMessagePart,
): part is OpenCodeToolPart {
	return part.type === "tool";
}

/**
 * Type guard to check if a message part is a text part.
 */
export function isOpenCodeTextPart(
	part: OpenCodeMessagePart,
): part is OpenCodeTextPart {
	return part.type === "text";
}

/**
 * Type guard to check if a tool part has completed.
 */
export function isToolCompleted(part: OpenCodeToolPart): boolean {
	return part.state === "completed";
}

/**
 * Type guard to check if a tool part has errored.
 */
export function isToolErrored(part: OpenCodeToolPart): boolean {
	return part.state === "error";
}
