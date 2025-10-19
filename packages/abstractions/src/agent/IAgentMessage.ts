/**
 * Platform-agnostic agent message structure
 *
 * This interface represents a single message in an agent conversation,
 * abstracting away the specifics of any particular agent SDK (Claude, OpenAI, etc.)
 */
export interface IAgentMessage {
	/**
	 * Unique identifier for this message
	 */
	id: string;

	/**
	 * Type of message
	 * - user: Input from the user
	 * - assistant: Response from the agent
	 * - system: System-level message
	 * - result: Final result/completion message
	 * - tool-use: Agent is using a tool
	 * - tool-result: Result from a tool execution
	 */
	type: "user" | "assistant" | "system" | "result" | "tool-use" | "tool-result";

	/**
	 * Message content (text)
	 */
	content: string;

	/**
	 * When this message was created
	 */
	timestamp: Date;

	/**
	 * Optional metadata for platform-specific information
	 * Can include:
	 * - toolName: name of tool being used (for tool-use type)
	 * - toolInput: input to tool (for tool-use type)
	 * - toolOutput: output from tool (for tool-result type)
	 * - error: error information (for result type with errors)
	 * - cost: usage cost information
	 * - tokens: token usage information
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Type guard to check if an object is an IAgentMessage
 */
export function isAgentMessage(obj: unknown): obj is IAgentMessage {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"id" in obj &&
		"type" in obj &&
		"content" in obj &&
		"timestamp" in obj
	);
}
