import type { SDKMessage } from "cyrus-core";

export interface ActivityInput {
	type: "thought" | "action" | "response";
	body: string;
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
							await this.config.postActivity({
								type: "action",
								body: this.formatTeamAction(toolName, (block as any).input),
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

	private formatTeamAction(toolName: string, input: any): string {
		switch (toolName) {
			case "TaskCreate":
				return `Created task: ${input?.subject || "unknown"}`;
			case "TaskUpdate":
				return `Task ${input?.taskId} -> ${input?.status || "updated"}`;
			case "SendMessage":
				return `Message to ${input?.recipient || "teammate"}: ${(input?.summary || "").substring(0, 100)}`;
			case "Task":
				return `Spawned teammate: ${input?.name || input?.description || "agent"}`;
			default:
				return toolName;
		}
	}
}
