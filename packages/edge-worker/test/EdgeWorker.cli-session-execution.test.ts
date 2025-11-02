/**
 * Test for CLI platform session execution bug (CYPACK-316)
 *
 * Bug description: Sessions are created but never executed.
 * Root cause: Repository routing fails for CLI events, causing sessions to never execute.
 *
 * This test verifies that the repository routing logic correctly handles CLI platform events.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { type MockProxy, mockDeep } from "vitest-mock-extended";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type {
	EdgeWorkerConfig,
	LinearAgentSessionCreatedWebhook,
} from "../src/types.js";

describe("EdgeWorker - CLI Platform Repository Routing", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		// Mock configuration with CLI platform
		mockConfig = {
			proxyUrl: "https://test-proxy.com",
			cyrusHome: "/tmp/test-cyrus-home-cli",
			serverPort: 3456,
			repositories: [
				{
					id: "test-cli-repo",
					name: "Test CLI Repository",
					repositoryPath: "/tmp/test-repo",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					platform: "cli" as const, // Use CLI platform
					isActive: true,
				},
			],
			agentHandle: "@cyrus",
			agentUserId: "cli-agent-user",
		};

		// Create EdgeWorker
		edgeWorker = new EdgeWorker(mockConfig);
	});

	it("should route CLI AgentSessionCreated events to CLI platform repository", async () => {
		// Create a mock CLI agent session created event
		const cliWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
			mockDeep<LinearAgentSessionCreatedWebhook>();

		// Set up CLI event structure
		cliWebhook.type = "AgentSessionEvent";
		cliWebhook.action = "created";
		cliWebhook.organizationId = "cli-org"; // CLI events use "cli-org" as organizationId
		cliWebhook.agentSession.id = "session-123";
		cliWebhook.agentSession.issue.id = "issue-123";
		cliWebhook.agentSession.issue.identifier = "CLI-1";
		cliWebhook.agentSession.issue.title = "Test CLI Issue";

		// Test the routing logic directly
		const result = await edgeWorker.findRepositoryForEvent(
			cliWebhook,
			mockConfig.repositories,
		);

		// Verify the correct repository was returned
		expect(result).toBeTruthy();
		expect(result?.id).toBe("test-cli-repo");
		expect(result?.platform).toBe("cli");
	});

	it("should route CLI events when multiple repositories exist", async () => {
		// Add a Linear repository to the configuration
		const multiRepoConfig: EdgeWorkerConfig = {
			...mockConfig,
			repositories: [
				{
					id: "linear-repo",
					name: "Linear Repository",
					repositoryPath: "/tmp/linear-repo",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "test-token",
					linearWorkspaceId: "workspace-1",
					teamKeys: ["TEST"],
					isActive: true,
				},
				{
					id: "test-cli-repo",
					name: "Test CLI Repository",
					repositoryPath: "/tmp/test-repo",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					platform: "cli" as const,
					isActive: true,
				},
			],
		};

		const multiRepoWorker = new EdgeWorker(multiRepoConfig);

		// Create a CLI event
		const cliWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
			mockDeep<LinearAgentSessionCreatedWebhook>();
		cliWebhook.type = "AgentSessionEvent";
		cliWebhook.action = "created";
		cliWebhook.organizationId = "cli-org";
		cliWebhook.agentSession.id = "session-456";
		cliWebhook.agentSession.issue.id = "issue-456";
		cliWebhook.agentSession.issue.identifier = "CLI-2";
		cliWebhook.agentSession.issue.title = "Another CLI Issue";

		// Test routing
		const result = await multiRepoWorker.findRepositoryForEvent(
			cliWebhook,
			multiRepoConfig.repositories,
		);

		// Verify it selected the CLI repository, not the Linear one
		expect(result).toBeTruthy();
		expect(result?.id).toBe("test-cli-repo");
		expect(result?.platform).toBe("cli");
	});

	it("should fallback to first repo if no CLI repo exists but CLI event received", async () => {
		// Configuration with only Linear repos (no CLI)
		const linearOnlyConfig: EdgeWorkerConfig = {
			...mockConfig,
			repositories: [
				{
					id: "linear-repo",
					name: "Linear Repository",
					repositoryPath: "/tmp/linear-repo",
					baseBranch: "main",
					workspaceBaseDir: "/tmp/workspaces",
					linearToken: "test-token",
					linearWorkspaceId: "workspace-1",
					teamKeys: ["TEST"],
					isActive: true,
				},
			],
		};

		const linearOnlyWorker = new EdgeWorker(linearOnlyConfig);

		// Create a CLI event
		const cliWebhook: MockProxy<LinearAgentSessionCreatedWebhook> =
			mockDeep<LinearAgentSessionCreatedWebhook>();
		cliWebhook.type = "AgentSessionEvent";
		cliWebhook.action = "created";
		cliWebhook.organizationId = "cli-org";
		cliWebhook.agentSession.id = "session-789";
		cliWebhook.agentSession.issue.id = "issue-789";
		cliWebhook.agentSession.issue.identifier = "CLI-3";
		cliWebhook.agentSession.issue.title = "Orphaned CLI Issue";

		// Test routing
		const result = await linearOnlyWorker.findRepositoryForEvent(
			cliWebhook,
			linearOnlyConfig.repositories,
		);

		// Should fallback to first repository
		expect(result).toBeTruthy();
		expect(result?.id).toBe("linear-repo");
	});
});
