import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { SimpleAgentRunner } from "./SimpleAgentRunner.js";
import type { SimpleAgentQueryOptions } from "./types.js";
/**
 * Concrete implementation using ClaudeRunner from cyrus-claude-runner package.
 *
 * This implementation uses the Claude Agent SDK to execute queries and
 * constrains the responses to an enumerated set.
 */
export declare class SimpleClaudeRunner<T extends string> extends SimpleAgentRunner<T> {
    /**
     * Execute the agent using ClaudeRunner
     */
    protected executeAgent(prompt: string, options?: SimpleAgentQueryOptions): Promise<SDKMessage[]>;
    /**
     * Extract the final response from the last assistant message
     */
    protected extractResponse(messages: SDKMessage[]): string;
    /**
     * Clean the response text to extract the actual value
     */
    private cleanResponse;
    /**
     * Handle incoming messages for progress events
     */
    private handleMessage;
}
//# sourceMappingURL=SimpleClaudeRunner.d.ts.map