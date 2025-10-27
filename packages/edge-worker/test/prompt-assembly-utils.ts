/**
 * Prompt Assembly Test Utilities
 *
 * Provides a human-readable DSL for testing EdgeWorker.assemblePrompt() method.
 */

import type { RepositoryConfig } from "cyrus-core";
import { expect } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

/**
 * Create an EdgeWorker instance for testing
 */
export function createTestWorker(
	repositories: RepositoryConfig[] = [],
): EdgeWorker {
	const config: EdgeWorkerConfig = {
		cyrusHome: "/tmp/test-cyrus-home",
		defaultModel: "sonnet",
		repositories,
		linearClients: new Map(),
		mcpServers: {},
	};
	return new EdgeWorker(config);
}

/**
 * Scenario builder for test cases - provides human-readable DSL
 */
export class PromptScenario {
	private worker: EdgeWorker;
	private input: any = {};
	private expectedUserPrompt?: string;
	private expectedSystemPrompt?: string;
	private expectedComponents?: string[];
	private expectedPromptType?: string;

	constructor(worker: EdgeWorker) {
		this.worker = worker;
	}

	// ===== Input Builders =====

	streamingSession() {
		this.input.isStreaming = true;
		this.input.isNewSession = false;
		return this;
	}

	continuationSession() {
		this.input.isStreaming = false;
		this.input.isNewSession = false;
		return this;
	}

	newSession() {
		this.input.isStreaming = false;
		this.input.isNewSession = true;
		return this;
	}

	assignmentBased() {
		this.input.isMentionTriggered = false;
		this.input.isLabelBasedPromptRequested = false;
		return this;
	}

	mentionTriggered() {
		this.input.isMentionTriggered = true;
		this.input.isLabelBasedPromptRequested = false;
		return this;
	}

	labelBasedPromptCommand() {
		this.input.isMentionTriggered = true;
		this.input.isLabelBasedPromptRequested = true;
		return this;
	}

	withUserComment(comment: string) {
		this.input.userComment = comment;
		return this;
	}

	withAttachments(manifest: string) {
		this.input.attachmentManifest = manifest;
		return this;
	}

	withLabels(...labels: string[]) {
		this.input.labels = labels;
		return this;
	}

	withSession(session: any) {
		this.input.session = session;
		return this;
	}

	withIssue(issue: any) {
		this.input.fullIssue = issue;
		return this;
	}

	withRepository(repo: any) {
		this.input.repository = repo;
		return this;
	}

	withGuidance(guidance: any[]) {
		this.input.guidance = guidance;
		return this;
	}

	withAgentSession(agentSession: any) {
		this.input.agentSession = agentSession;
		return this;
	}

	// ===== Expectation Builders =====

	expectUserPrompt(prompt: string) {
		this.expectedUserPrompt = prompt;
		return this;
	}

	expectSystemPrompt(prompt: string | undefined) {
		this.expectedSystemPrompt = prompt;
		return this;
	}

	expectComponents(...components: string[]) {
		this.expectedComponents = components;
		return this;
	}

	expectPromptType(type: string) {
		this.expectedPromptType = type;
		return this;
	}

	// ===== Execution =====

	async verify() {
		const result = await (this.worker as any).assemblePrompt(this.input);

		if (this.expectedUserPrompt !== undefined) {
			expect(result.userPrompt).toBe(this.expectedUserPrompt);
		}

		if (this.expectedSystemPrompt !== undefined) {
			expect(result.systemPrompt).toBe(this.expectedSystemPrompt);
		}

		if (this.expectedComponents) {
			expect(result.metadata.components).toEqual(this.expectedComponents);
		}

		if (this.expectedPromptType) {
			expect(result.metadata.promptType).toBe(this.expectedPromptType);
		}

		return result;
	}
}

/**
 * Start building a test scenario
 */
export function scenario(worker: EdgeWorker): PromptScenario {
	return new PromptScenario(worker);
}
