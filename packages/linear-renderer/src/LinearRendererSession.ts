import type {
	IRendererActivity,
	IRendererMessage,
	IRendererSession,
	IRendererStatus,
	ISessionContext,
} from "@cyrus/abstractions";
import type { LinearClient } from "@linear/sdk";

export class LinearRendererSession implements IRendererSession {
	readonly id: string;
	readonly context: ISessionContext;
	private client: LinearClient;
	private issueId: string;
	private metadata: Record<string, unknown> = {};

	constructor(client: LinearClient, context: ISessionContext) {
		this.client = client;
		this.context = context;
		this.id = context.taskId;
		this.issueId = context.taskId;
	}

	async initialize(): Promise<void> {
		// Initialization complete
	}

	async writeMessage(message: IRendererMessage): Promise<void> {
		await this.client.createComment({
			issueId: this.issueId,
			body: `**${message.type}:** ${message.content}`,
		});
	}

	async writeActivity(activity: IRendererActivity): Promise<void> {
		// Write as comment for now - full agent session API integration pending
		await this.client.createComment({
			issueId: this.issueId,
			body: `[Activity] ${activity.description}`,
		});
	}

	async updateStatus(status: IRendererStatus): Promise<void> {
		// Status updates via comments
		await this.client.createComment({
			issueId: this.issueId,
			body:
				"[Status] " +
				status.state +
				(status.message ? `: ${status.message}` : ""),
		});
	}

	getMetadata(): Record<string, unknown> {
		return { ...this.metadata };
	}

	async updateMetadata(metadata: Record<string, unknown>): Promise<void> {
		this.metadata = { ...this.metadata, ...metadata };
	}

	async close(): Promise<void> {
		// Cleanup complete
	}
}
