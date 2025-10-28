import type {
	LinearAgentSessionCreatedWebhook,
	LinearWebhook,
} from "cyrus-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type MockProxy, mockDeep } from "vitest-mock-extended";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

describe("EdgeWorker - Unhandled Webhook Logging", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		// Mock configuration with a single repository
		mockConfig = {
			proxyUrl: "https://test-proxy.com",
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [
				{
					id: "test-repo",
					name: "Test Repository",
					repositoryPath: "/repos/test",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "linear-token-1",
					linearWorkspaceId: "workspace-1",
					linearWorkspaceName: "Test Workspace",
					teamKeys: ["TEST"],
					isActive: true,
				},
			],
		};

		// Spy on console.log to verify logging behavior
		consoleWarnSpy = vi.spyOn(console, "warn");

		// Ensure CYRUS_WEBHOOK_DEBUG is not set (default user experience)
		delete process.env.CYRUS_WEBHOOK_DEBUG;

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		consoleWarnSpy.mockRestore();
	});

	it("should log unhandled webhooks even when CYRUS_WEBHOOK_DEBUG is not set", async () => {
		// Create a webhook with invalid type/action combination that won't match any type guard
		// This simulates a webhook from Linear that doesn't match our expected structure
		const invalidWebhook: MockProxy<LinearWebhook> = mockDeep<LinearWebhook>();
		(invalidWebhook as any).type = "AgentSessionEvent"; // Type is correct
		(invalidWebhook as any).action = "unknown_action"; // But action is not recognized
		(invalidWebhook as any).organizationId = "workspace-1";
		(invalidWebhook as any).agentSession = {
			id: "session-123",
			issue: {
				id: "issue-123",
				identifier: "TEST-42",
				title: "Test Issue",
				team: {
					key: "TEST",
					id: "team-123",
					name: "Test Team",
				},
			},
		};

		// Access the private handleWebhook method through reflection
		// @ts-expect-error - accessing private method for testing
		await edgeWorker.handleWebhook(invalidWebhook, mockConfig.repositories);

		// Verify that a warning was logged about the unhandled webhook
		// This should happen even without CYRUS_WEBHOOK_DEBUG=true
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unhandled webhook"),
		);
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("unknown_action"),
		);
	});

	it("should log unhandled webhooks with type mismatch", async () => {
		// Create a webhook that looks like AgentSessionCreated but with wrong type field
		const mismatchedWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
			mockDeep<LinearAgentSessionCreatedWebhook>();
		(mismatchedWebhook as any).type = "AgentSession"; // Wrong: should be "AgentSessionEvent"
		(mismatchedWebhook as any).action = "created";
		(mismatchedWebhook as any).organizationId = "workspace-1";
		(mismatchedWebhook as any).agentSession = {
			id: "session-456",
			issue: {
				id: "issue-456",
				identifier: "TEST-99",
				title: "Another Test",
				team: {
					key: "TEST",
					id: "team-123",
					name: "Test Team",
				},
			},
		};

		// Access the private handleWebhook method through reflection
		// @ts-expect-error - accessing private method for testing
		await edgeWorker.handleWebhook(
			mismatchedWebhook as LinearWebhook,
			mockConfig.repositories,
		);

		// Verify that a warning was logged
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unhandled webhook"),
		);
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("created"),
		);
	});

	it("should provide actionable debug information in unhandled webhook logs", async () => {
		// Create an unhandled webhook
		const unhandledWebhook: MockProxy<LinearWebhook> =
			mockDeep<LinearWebhook>();
		(unhandledWebhook as any).type = "SomeNewType";
		(unhandledWebhook as any).action = "someNewAction";
		(unhandledWebhook as any).organizationId = "workspace-1";
		(unhandledWebhook as any).agentSession = {
			issue: {
				identifier: "TEST-123",
				team: { key: "TEST" },
			},
		};

		// Access the private handleWebhook method through reflection
		// @ts-expect-error - accessing private method for testing
		await edgeWorker.handleWebhook(unhandledWebhook, mockConfig.repositories);

		// Verify that the log includes helpful debug information
		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Unhandled webhook"),
		);

		// Should include the webhook type and action for debugging
		const logCalls = consoleWarnSpy.mock.calls;
		const relevantLog = logCalls.find((call) =>
			call.some((arg) => String(arg).includes("Unhandled webhook")),
		);

		expect(relevantLog).toBeTruthy();
		// Log should contain type and action information
		const logString = relevantLog?.join(" ");
		expect(logString).toContain("type");
		expect(logString).toContain("action");
	});
});
