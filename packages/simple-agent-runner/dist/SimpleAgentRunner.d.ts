import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentProgressEvent, SimpleAgentQueryOptions, SimpleAgentResult, SimpleAgentRunnerConfig } from "./types.js";
/**
 * Abstract base class for simple agent runners that return enumerated responses.
 *
 * This class provides the core validation and flow control logic, while
 * concrete implementations provide the actual agent execution.
 */
export declare abstract class SimpleAgentRunner<T extends string> {
    protected readonly config: SimpleAgentRunnerConfig<T>;
    protected readonly validResponseSet: Set<T>;
    constructor(config: SimpleAgentRunnerConfig<T>);
    /**
     * Execute the agent with the given prompt and return a validated response.
     *
     * @param prompt - The question or instruction for the agent
     * @param options - Optional query configuration
     * @returns A validated response from the enumerated set
     * @throws {InvalidResponseError} If agent returns invalid response
     * @throws {TimeoutError} If execution times out
     * @throws {NoResponseError} If agent produces no response
     * @throws {SessionError} If underlying session fails
     */
    query(prompt: string, options?: SimpleAgentQueryOptions): Promise<SimpleAgentResult<T>>;
    /**
     * Validate the configuration
     */
    private validateConfig;
    /**
     * Check if a response is valid
     */
    protected isValidResponse(response: string): response is T;
    /**
     * Build the complete system prompt
     */
    protected buildSystemPrompt(): string;
    /**
     * Emit a progress event if callback is configured
     */
    protected emitProgress(event: AgentProgressEvent): void;
    /**
     * Abstract method: Execute the agent and return messages.
     * Concrete implementations must provide this.
     */
    protected abstract executeAgent(prompt: string, options?: SimpleAgentQueryOptions): Promise<SDKMessage[]>;
    /**
     * Abstract method: Extract the final response from messages.
     * Concrete implementations must provide this.
     */
    protected abstract extractResponse(messages: SDKMessage[]): string;
}
//# sourceMappingURL=SimpleAgentRunner.d.ts.map