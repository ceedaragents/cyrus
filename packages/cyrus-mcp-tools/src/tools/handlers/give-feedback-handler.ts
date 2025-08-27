import type { LinearService } from "../../services/linear-service.js";

/**
 * Handler for the give_feedback tool.
 * Returns success immediately as the actual feedback logic is handled
 * by the Claude Code SDK PostToolUse hook in EdgeWorker.
 */
export function handleGiveFeedback(
	_linearService: LinearService,
): (args: unknown) => Promise<unknown> {
	return async (args: unknown): Promise<unknown> => {
		// Simple validation - the actual work happens in the PostToolUse hook
		const typedArgs = args as {
			agentSessionId?: string;
			message?: string;
		};

		if (!typedArgs.agentSessionId) {
			return {
				success: false,
				error: "agentSessionId is required",
			};
		}

		if (!typedArgs.message) {
			return {
				success: false,
				error: "message is required",
			};
		}

		// Return success - the PostToolUse hook will handle the actual feedback
		return { success: true };
	};
}
