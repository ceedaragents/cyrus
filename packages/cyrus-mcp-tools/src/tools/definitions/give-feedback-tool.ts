import type { MCPToolDefinition } from "../../types.js";

/**
 * Tool for providing feedback to a child agent session.
 * This tool allows a parent agent session to send feedback messages to its child sessions.
 */
export const giveFeedbackToolDefinition: MCPToolDefinition = {
	name: "linear_agent_give_feedback",
	description:
		"Provide feedback to a child agent session to continue its processing.",
	input_schema: {
		type: "object",
		properties: {
			agentSessionId: {
				type: "string",
				description: "The ID of the child agent session to provide feedback to",
			},
			message: {
				type: "string",
				description: "The feedback message to send to the child agent session",
			},
		},
		required: ["agentSessionId", "message"],
	},
	output_schema: {
		type: "object",
		properties: {
			success: {
				type: "boolean",
				description: "Whether the feedback was successfully queued",
			},
		},
	},
};
