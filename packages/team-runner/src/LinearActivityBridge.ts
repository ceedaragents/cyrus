import type { SDKMessage } from "cyrus-core";

export interface ActivityInput {
	type: "thought" | "action" | "response";
	body: string;
	/** For action type: the action name (e.g. tool name) */
	action?: string;
	/** For action type: the parameter/details */
	parameter?: string;
	ephemeral?: boolean;
}

export interface LinearActivityBridgeConfig {
	/** Callback to post an activity to Linear */
	postActivity: (input: ActivityInput) => Promise<void>;
}

const TEAM_PROGRESS_KEYWORDS = [
	"teammate",
	"task",
	"completed",
	"spawning",
	"assigned",
	"blocked",
	"unblocked",
	"all tasks",
	"shutting down",
];

const TEAM_TOOL_NAMES = [
	"TeamCreate",
	"TaskCreate",
	"TaskUpdate",
	"TaskList",
	"SendMessage",
	"Task",
];

export class LinearActivityBridge {
	private config: LinearActivityBridgeConfig;
	private lastPostedAt = 0;
	private readonly MIN_POST_INTERVAL_MS = 2000;

	constructor(config: LinearActivityBridgeConfig) {
		this.config = config;
	}

	async onMessage(message: SDKMessage): Promise<void> {
		const now = Date.now();
		if (now - this.lastPostedAt < this.MIN_POST_INTERVAL_MS) return;

		try {
			if (message.type === "assistant" && message.message?.content) {
				for (const block of message.message.content) {
					if (block.type === "text" && block.text.trim()) {
						if (this.isTeamProgressMessage(block.text)) {
							await this.config.postActivity({
								type: "thought",
								body: this.formatTeamProgress(block.text),
								ephemeral: true,
							});
							this.lastPostedAt = now;
						}
					}

					if (block.type === "tool_use") {
						const toolName = (block as any).name;
						if (this.isTeamTool(toolName)) {
							const teamAction = this.formatTeamAction(
								toolName,
								(block as any).input,
							);
							await this.config.postActivity({
								type: "action",
								body: `${teamAction.action}: ${teamAction.parameter}`,
								action: teamAction.action,
								parameter: teamAction.parameter,
								ephemeral: true,
							});
							this.lastPostedAt = now;
						}
					}
				}
			}

			if (message.type === "result") {
				await this.config.postActivity({
					type: "response",
					body: "Team execution completed.",
					ephemeral: false,
				});
			}
		} catch (error) {
			console.error("[LinearActivityBridge] Failed to post activity:", error);
		}
	}

	private isTeamProgressMessage(text: string): boolean {
		const lowerText = text.toLowerCase();
		return TEAM_PROGRESS_KEYWORDS.some((k) => lowerText.includes(k));
	}

	private isTeamTool(toolName: string): boolean {
		return TEAM_TOOL_NAMES.includes(toolName);
	}

	private formatTeamProgress(text: string): string {
		if (text.length > 500) return `${text.substring(0, 497)}...`;
		return text;
	}

	private formatTeamAction(
		toolName: string,
		input: any,
	): { action: string; parameter: string } {
		switch (toolName) {
			case "TaskCreate":
				return {
					action: "Create task",
					parameter: input?.subject || "unknown",
				};
			case "TaskUpdate":
				return {
					action: "Update task",
					parameter: `${input?.taskId} -> ${input?.status || "updated"}`,
				};
			case "SendMessage":
				return {
					action: "Send message",
					parameter: `to ${input?.recipient || "teammate"}: ${(input?.summary || "").substring(0, 100)}`,
				};
			case "Task":
				return {
					action: "Spawn teammate",
					parameter: input?.name || input?.description || "agent",
				};
			default:
				return { action: toolName, parameter: "" };
		}
	}
}
