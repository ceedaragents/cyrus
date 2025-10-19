/**
 * Platform-agnostic agent session information
 *
 * Represents the state of an ongoing or completed agent session
 */
export interface IAgentSession {
	/**
	 * Unique identifier for this session
	 * May be null if not yet assigned by the underlying system
	 */
	sessionId: string | null;

	/**
	 * When the session started
	 */
	startedAt: Date;

	/**
	 * Whether the session is currently running
	 */
	isRunning: boolean;

	/**
	 * When the session ended (if completed)
	 */
	endedAt?: Date;

	/**
	 * Optional metadata for platform-specific information
	 * Can include:
	 * - model: the model being used
	 * - workingDirectory: where the agent is operating
	 * - totalCost: total cost in USD
	 * - totalTokens: total tokens used
	 * - exitCode: exit code if completed
	 * - error: error information if failed
	 */
	metadata?: Record<string, unknown>;
}

/**
 * Type guard to check if an object is an IAgentSession
 */
export function isAgentSession(obj: unknown): obj is IAgentSession {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"startedAt" in obj &&
		"isRunning" in obj
	);
}
