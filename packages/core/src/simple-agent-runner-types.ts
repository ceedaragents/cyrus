import type {
	AgentProgressEvent as SimpleAgentProgressEvent,
	SimpleAgentQueryOptions as SimpleAgentQueryOptionsBase,
	SimpleAgentResult as SimpleAgentResultBase,
	SimpleAgentRunnerConfig as SimpleAgentRunnerConfigBase,
} from "cyrus-simple-agent-runner";

/**
 * Simple Agent Runner Interface
 *
 * This interface provides a provider-agnostic abstraction for simple agent runners
 * that return enumerated responses. It follows the same pattern as IAgentRunner,
 * where type aliases point to provider-specific SDK types (currently Claude SDK).
 *
 * Simple agent runners are specialized agents that:
 * - Accept a constrained set of valid responses (enumerated type T)
 * - Run until they produce one of the valid responses
 * - Validate the response before returning
 * - Provide progress events during execution
 *
 * ## Architecture Pattern
 *
 * This abstraction uses type aliasing to external SDK types rather than creating
 * new types. This approach:
 * - Maintains compatibility with existing simple-agent-runner code
 * - Allows gradual migration to provider-agnostic code
 * - Enables adapter pattern implementations for other providers
 * - Preserves type safety and IDE autocomplete
 *
 * ## Usage Example
 *
 * ```typescript
 * type IssueAction = "fix" | "skip" | "clarify";
 *
 * const config: ISimpleAgentRunnerConfig<IssueAction> = {
 *   validResponses: ["fix", "skip", "clarify"] as const,
 *   systemPrompt: "You analyze issues and decide what to do",
 *   cyrusHome: "/home/user/.cyrus",
 *   onProgress: (event) => {
 *     if (event.type === "response-detected") {
 *       console.log(`Agent wants to: ${event.candidateResponse}`);
 *     }
 *   }
 * };
 *
 * const runner = new SimpleAgentRunner(config);
 * const result = await runner.query("What should I do with this bug?");
 * console.log(`Decision: ${result.response}`); // "fix" | "skip" | "clarify"
 * ```
 *
 * @see {@link ISimpleAgentRunnerConfig} for configuration options
 * @see {@link ISimpleAgentResult} for result structure
 * @see {@link IAgentProgressEvent} for progress event types
 */
export interface ISimpleAgentRunner<T extends string> {
	/**
	 * Query the agent and get an enumerated response
	 *
	 * This method runs a complete agent session and returns one of the
	 * predefined valid responses. The agent will continue running until
	 * it produces a valid response or times out.
	 *
	 * @param question - The question or prompt to send to the agent
	 * @param options - Optional configuration for this specific query
	 * @returns A result containing the validated response and session metadata
	 * @throws Error if the agent times out or fails to produce a valid response
	 *
	 * @example
	 * ```typescript
	 * const result = await runner.query(
	 *   "Should we merge this PR?",
	 *   { context: "CI passed, 2 approvals", allowFileReading: true }
	 * );
	 * console.log(`Decision: ${result.response}`); // "approve" | "reject" | "request-changes"
	 * console.log(`Cost: $${result.costUSD}`);
	 * console.log(`Duration: ${result.durationMs}ms`);
	 * ```
	 */
	query(
		question: string,
		options?: ISimpleAgentQueryOptions,
	): Promise<ISimpleAgentResult<T>>;
}

/**
 * Configuration for Simple Agent Runner
 *
 * Defines how the simple agent runner should behave, including valid responses,
 * prompts, timeouts, and progress callbacks.
 *
 * @template T - The enumerated string type for valid responses
 *
 * @example
 * ```typescript
 * type Priority = "low" | "medium" | "high" | "critical";
 *
 * const config: ISimpleAgentRunnerConfig<Priority> = {
 *   validResponses: ["low", "medium", "high", "critical"] as const,
 *   systemPrompt: "Analyze the issue and determine priority level",
 *   maxTurns: 10,
 *   timeoutMs: 60000,
 *   model: "sonnet",
 *   cyrusHome: "/home/user/.cyrus",
 *   onProgress: (event) => {
 *     console.log(`Agent progress: ${event.type}`);
 *   }
 * };
 * ```
 */
export type ISimpleAgentRunnerConfig<T extends string> =
	SimpleAgentRunnerConfigBase<T>;

/**
 * Result from a Simple Agent Runner query
 *
 * Contains the validated response along with session metadata including
 * messages, duration, cost, and session ID.
 *
 * @template T - The enumerated string type for valid responses
 *
 * @example
 * ```typescript
 * const result: ISimpleAgentResult<"approve" | "reject"> = {
 *   response: "approve",
 *   messages: [...],  // All SDK messages from the session
 *   sessionId: "claude-session-123",
 *   durationMs: 5432,
 *   costUSD: 0.0234
 * };
 * ```
 */
export type ISimpleAgentResult<T extends string> = SimpleAgentResultBase<T>;

/**
 * Progress events emitted during agent execution
 *
 * These events allow monitoring the agent's progress as it works toward
 * producing a valid response. Useful for logging, UI updates, or debugging.
 *
 * Event types:
 * - `started`: Session has begun (includes sessionId)
 * - `thinking`: Agent is processing (includes reasoning text)
 * - `tool-use`: Agent is using a tool (includes tool name and input)
 * - `response-detected`: Agent produced a candidate response (may be invalid)
 * - `validating`: Checking if response is valid
 *
 * @example
 * ```typescript
 * const config: ISimpleAgentRunnerConfig<"yes" | "no"> = {
 *   validResponses: ["yes", "no"] as const,
 *   cyrusHome: "/home/user/.cyrus",
 *   onProgress: (event: IAgentProgressEvent) => {
 *     switch (event.type) {
 *       case "started":
 *         console.log(`Session started: ${event.sessionId}`);
 *         break;
 *       case "thinking":
 *         console.log(`Agent thinking: ${event.text}`);
 *         break;
 *       case "tool-use":
 *         console.log(`Using tool: ${event.toolName}`);
 *         break;
 *       case "response-detected":
 *         console.log(`Candidate response: ${event.candidateResponse}`);
 *         break;
 *       case "validating":
 *         console.log(`Validating: ${event.response}`);
 *         break;
 *     }
 *   }
 * };
 * ```
 */
export type IAgentProgressEvent = SimpleAgentProgressEvent;

/**
 * Options for a Simple Agent Runner query
 *
 * Provides additional configuration that can be specified per-query
 * to customize behavior beyond the runner's base configuration.
 *
 * @example
 * ```typescript
 * const options: ISimpleAgentQueryOptions = {
 *   context: "User has premium subscription, last login was 2 days ago",
 *   allowFileReading: true,
 *   allowedDirectories: ["/home/user/project/src"]
 * };
 *
 * const result = await runner.query("Should we send a reminder email?", options);
 * ```
 */
export type ISimpleAgentQueryOptions = SimpleAgentQueryOptionsBase;

/**
 * Re-export simple-agent-runner types for convenience
 *
 * These re-exports allow consumers to import all necessary types
 * from a single location (packages/core) without knowing the
 * underlying provider SDK.
 */
export type {
	AgentProgressEvent,
	SimpleAgentQueryOptions,
	SimpleAgentResult,
	SimpleAgentRunnerConfig,
} from "cyrus-simple-agent-runner";
