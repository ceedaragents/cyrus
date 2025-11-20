/**
 * @module cyrus-gemini-runner
 *
 * Gemini CLI integration for Cyrus agent framework.
 * Provides a provider-agnostic wrapper around the Gemini CLI that implements
 * the IAgentRunner interface, allowing seamless switching between Claude and Gemini.
 *
 * @example
 * ```typescript
 * import { GeminiRunner } from 'cyrus-gemini-runner';
 *
 * const runner = new GeminiRunner({
 *   cyrusHome: '/home/user/.cyrus',
 *   workingDirectory: '/path/to/repo',
 *   model: 'gemini-2.5-flash',
 *   autoApprove: true
 * });
 *
 * // Start a session
 * const session = await runner.start("Analyze this codebase");
 * console.log(`Session ID: ${session.sessionId}`);
 *
 * // Get messages
 * const messages = runner.getMessages();
 * console.log(`Received ${messages.length} messages`);
 * ```
 */

// Adapter functions
export {
	createUserMessage,
	extractSessionId,
	geminiEventToSDKMessage,
} from "./adapters.js";
// Main runner class
export { GeminiRunner } from "./GeminiRunner.js";
// Simple agent runner
export { SimpleGeminiRunner } from "./SimpleGeminiRunner.js";
// Types
export type {
	GeminiErrorEvent,
	GeminiInitEvent,
	GeminiMessageEvent,
	GeminiResultEvent,
	GeminiRunnerConfig,
	GeminiRunnerEvents,
	GeminiSessionInfo,
	GeminiStreamEvent,
	GeminiToolResultEvent,
	GeminiToolUseEvent,
} from "./types.js";
