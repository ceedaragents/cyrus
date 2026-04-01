/**
 * Module augmentation for @anthropic-ai/claude-agent-sdk.
 *
 * `startup()` is exported from sdk.mjs but is not yet declared in sdk.d.ts.
 * Its signature is derived from the SDK source (v0.2.89):
 *
 *   async function startup({ options } = {}) {
 *     // pre-warms a Claude subprocess; returns a warm session object
 *     return { query(prompt): Query, close(): void, [Symbol.asyncDispose](): Promise<void> }
 *   }
 */
import type {
	Options,
	Query,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";

declare module "@anthropic-ai/claude-agent-sdk" {
	/** A pre-warmed Claude session returned by {@link startup}. */
	export interface WarmSession {
		/**
		 * Start the first (and only) query against this warm session.
		 * Can only be called once — calling a second time throws.
		 */
		query(prompt: string | AsyncIterable<SDKUserMessage>): Query;
		/** Close the warm session without running a query. */
		close(): void;
		[Symbol.asyncDispose](): Promise<void>;
	}

	/**
	 * Pre-warm a Claude subprocess so the first query has near-zero cold-start latency.
	 *
	 * Uses `MCP_CONNECTION_NONBLOCKING=true` to return in ~500 ms while MCP servers
	 * connect in the background.
	 *
	 * @example
	 * ```ts
	 * const warm = await startup({ options: { resume: sessionId, cwd, env } });
	 * const query = warm.query(promptStream);
	 * for await (const msg of query) { ... }
	 * ```
	 */
	export function startup(params?: { options?: Options }): Promise<WarmSession>;
}
