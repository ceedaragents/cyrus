import { EventEmitter } from "node:events";
import type { LinearClient, LinearDocument } from "@linear/sdk";
import type { LinearWebhook } from "cyrus-core";
import type { LinearWebhookClient } from "cyrus-linear-webhook-client";

/**
 * Mock Linear client for testing
 */
export class MockLinearClient {
	private activities: Map<string, any[]> = new Map();
	private issues: Map<string, any> = new Map();
	private agentSessions: Map<string, any> = new Map();

	async createAgentActivity(
		input: LinearDocument.AgentActivityCreateInput,
	): Promise<any> {
		const activity = {
			id: `activity-${Date.now()}`,
			agentSessionId: input.agentSessionId,
			content: input.content,
			createdAt: new Date(),
			updatedAt: new Date(),
			archivedAt: null,
			ephemeral: input.ephemeral || false,
			signal: input.signal,
			signalMetadata: input.signalMetadata,
		};

		// Store activity
		const sessionActivities = this.activities.get(input.agentSessionId) || [];
		sessionActivities.push(activity);
		this.activities.set(input.agentSessionId, sessionActivities);

		return {
			success: true,
			agentActivity: Promise.resolve(activity),
		};
	}

	issue(id: string): any {
		const issueData = this.issues.get(id);
		if (!issueData) {
			return Promise.resolve(null);
		}

		// Return a promise with an update method
		const promise = Promise.resolve(issueData);
		(promise as any).update = async (updates: any) => {
			Object.assign(issueData, updates);
			return issueData;
		};
		return promise;
	}

	async createComment(input: { issueId: string; body: string }): Promise<any> {
		return {
			id: `comment-${Date.now()}`,
			issueId: input.issueId,
			body: input.body,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
	}

	agentSession(id: string): any {
		const sessionData = this.agentSessions.get(id);
		if (!sessionData) {
			return Promise.resolve(null);
		}

		return Promise.resolve({
			...sessionData,
			activities: async () => ({
				nodes: this.activities.get(id) || [],
			}),
		});
	}

	// Test helpers
	addIssue(issue: any): void {
		this.issues.set(issue.id, issue);
	}

	addAgentSession(session: any): void {
		this.agentSessions.set(session.id, session);
	}

	getActivities(sessionId: string): any[] {
		return this.activities.get(sessionId) || [];
	}

	reset(): void {
		this.activities.clear();
		this.issues.clear();
		this.agentSessions.clear();
	}
}

/**
 * Mock webhook client for testing
 */
export class MockWebhookClient extends EventEmitter {
	private connected = false;

	async connect(): Promise<void> {
		this.connected = true;
		this.emit("connect");
	}

	async disconnect(): Promise<void> {
		this.connected = false;
		this.emit("disconnect");
	}

	isConnected(): boolean {
		return this.connected;
	}

	async sendStatus(_status: any): Promise<void> {
		// Mock implementation
	}

	// Test helper to simulate webhook reception
	simulateWebhook(webhook: LinearWebhook): void {
		if (!this.connected) {
			throw new Error("Cannot simulate webhook: client not connected");
		}
		this.emit("webhook", webhook);
	}

	// Test helper to simulate errors
	simulateError(error: Error): void {
		this.emit("error", error);
	}
}

/**
 * Create a mock LinearClient for testing
 */
export function createMockLinearClient(): LinearClient {
	return new MockLinearClient() as unknown as LinearClient;
}

/**
 * Create a mock LinearWebhookClient for testing
 */
export function createMockWebhookClient(): LinearWebhookClient {
	return new MockWebhookClient() as unknown as LinearWebhookClient;
}
