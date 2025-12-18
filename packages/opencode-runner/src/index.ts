/**
 * OpenCode Runner Package
 *
 * SDK integration for the OpenCode AI coding agent with Cyrus.
 *
 * This package provides:
 * - Type definitions for OpenCode configuration and sessions
 * - Port allocation utilities for the OpenCode server
 * - Message and event type definitions
 *
 * @example
 * ```typescript
 * import {
 *   type OpenCodeRunnerConfig,
 *   type OpenCodeSessionInfo,
 *   allocateOpenCodePort,
 * } from "cyrus-opencode-runner";
 *
 * // Allocate a port for the OpenCode server
 * const { port } = await allocateOpenCodePort();
 *
 * // Configure the runner
 * const config: OpenCodeRunnerConfig = {
 *   cyrusHome: "~/.cyrus",
 *   workingDirectory: "/path/to/project",
 *   serverConfig: {
 *     port,
 *     timeout: 60000,
 *   },
 * };
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Type Exports
// ============================================================================

// Configuration types
// Message types
// Event types
// Error types
// Runner event types
// SDK reference types
export type {
	OpenCodeAssistantMessage,
	OpenCodeChatRequest,
	OpenCodeClientOptions,
	OpenCodeError,
	OpenCodeErrorType,
	OpenCodeEvent,
	OpenCodeEventBase,
	OpenCodeEventType,
	OpenCodeFilePart,
	OpenCodeMessage,
	OpenCodeMessageError,
	OpenCodeMessagePart,
	OpenCodeMessagePartBase,
	OpenCodeMessagePartType,
	OpenCodeMessageUpdateEvent,
	OpenCodePatchPart,
	OpenCodeRunnerConfig,
	OpenCodeRunnerEvents,
	OpenCodeServerConfig,
	OpenCodeSession,
	OpenCodeSessionErrorEvent,
	OpenCodeSessionInfo,
	OpenCodeSessionUpdateEvent,
	OpenCodeSnapshotPart,
	OpenCodeTextPart,
	OpenCodeToolPart,
	OpenCodeToolState,
	OpenCodeUserMessage,
} from "./types.js";

// ============================================================================
// Type Guards
// ============================================================================

export {
	isOpenCodeAssistantMessage,
	isOpenCodeTextPart,
	isOpenCodeToolPart,
	isOpenCodeUserMessage,
	isToolCompleted,
	isToolErrored,
} from "./types.js";

// ============================================================================
// Port Allocation
// ============================================================================

export {
	allocateOpenCodePort,
	buildServerUrl,
	DEFAULT_PORT_RANGE,
	findAvailablePort,
	getRandomAvailablePort,
	isPortAvailable,
	OPENCODE_DEFAULT_PORT,
	PortAllocationError,
	type PortAllocationOptions,
	type PortAllocationResult,
} from "./portAllocator.js";

// ============================================================================
// Event Adapters (CYPACK-634)
// ============================================================================

// Type exports
export type { AccumulatedMessage, ProcessableEvent } from "./adapters.js";
// Main adapter function
// Part conversion functions
// Message conversion functions
// Event type guards
// Helper functions
export {
	createUserMessage,
	errorEventToSDKMessage,
	extractSessionId,
	isMessagePartUpdated,
	isMessageUpdated,
	isSessionError,
	isSessionIdle,
	isSessionStatus,
	isTextPart,
	isToolPart,
	isToolStateCompleted,
	isToolStateError,
	messageEventToSDKMessage,
	openCodeEventToSDKMessage,
	partEventToSDKMessage,
	synthesizeResultMessage,
	textPartToContentBlock,
	toolPartToToolResultBlock,
	toolPartToToolUseBlock,
} from "./adapters.js";

// ============================================================================
// Placeholder Exports for Future Implementation
// ============================================================================

/**
 * Placeholder for the OpenCode Runner class.
 * Will be implemented in a future issue.
 *
 * @todo CYPACK-634 - Implement OpenCodeRunner class
 */
export const OpenCodeRunner = undefined as unknown as new (
	config: import("./types.js").OpenCodeRunnerConfig,
) => {
	readonly supportsStreamingInput: boolean;
	start(prompt: string): Promise<import("./types.js").OpenCodeSessionInfo>;
	stop(): void;
	isRunning(): boolean;
};

/**
 * Placeholder for the Simple OpenCode Runner class.
 * Will be implemented in a future issue.
 *
 * @todo CYPACK-637 - Implement SimpleOpenCodeRunner class
 */
export const SimpleOpenCodeRunner = undefined as unknown as new <
	T extends string,
>(
	config: import("./types.js").OpenCodeRunnerConfig,
) => {
	executeAgent(prompt: string): Promise<T[]>;
};
