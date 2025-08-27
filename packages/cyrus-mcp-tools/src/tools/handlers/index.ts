import type { LinearService } from "../../services/linear-service.js";
import { handleCreateAgentSession } from "./agent-session-handler.js";
import { handleGiveFeedback } from "./give-feedback-handler.js";
import { handleUploadFile } from "./upload-handler.js";

// Define the handler function type
type ToolHandler = (args: unknown) => Promise<unknown>;

/**
 * Registers all tool handlers for the MCP Linear uploads
 * @param linearService The Linear service instance
 * @returns A map of tool name to handler function
 */
export function registerToolHandlers(
	linearService: LinearService,
): Record<string, ToolHandler> {
	return {
		linear_upload_file: handleUploadFile(linearService),
		linear_agent_session_create: handleCreateAgentSession(linearService),
		linear_agent_give_feedback: handleGiveFeedback(linearService),
	};
}

// Export all handlers individually
export { handleUploadFile, handleCreateAgentSession, handleGiveFeedback };
