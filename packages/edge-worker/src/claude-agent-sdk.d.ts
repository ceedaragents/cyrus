/**
 * Module augmentation for @anthropic-ai/claude-agent-sdk.
 *
 * `startup()` is exported from sdk.mjs but not yet declared in sdk.d.ts (v0.2.89).
 * Signature derived from SDK source:
 *
 *   async function startup({ options } = {}) {
 *     // pre-warms a Claude subprocess
 *     return { query(prompt): Query, close(): void, [Symbol.asyncDispose](): Promise<void> }
 *   }
 */

import type {
	Options,
	Query,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

declare module "@anthropic-ai/claude-agent-sdk" {
	/**
	 * Pre-warm a Claude subprocess so the first query has near-zero cold-start latency.
	 * Returns a warm session that can be passed to ClaudeRunnerConfig.warmSession.
	 */
	export function startup(params?: { options?: Options }): Promise<WarmSession>;

	/** A pre-warmed Claude session returned by {@link startup}. */
	export interface WarmSession {
		/**
		 * Start the first (and only) query against this warm session.
		 * Can only be called once — calling a second time throws.
		 */
		query(prompt: string | AsyncIterable<SDKUserMessage>): Query;
		/** Release resources without running a query. */
		close(): void;
		[Symbol.asyncDispose](): Promise<void>;
	}
}
