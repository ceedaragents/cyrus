/**
 * Tests for ephemeral activity handling in CLIRPCServer
 *
 * This test suite verifies that the F1 CLI issue tracker correctly respects
 * the ephemeral flag for agent activities. Ephemeral activities should be
 * replaced by subsequent activities in the user-facing renderer.
 */

import type Fastify from "fastify";
import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { CLIIssueTrackerService } from "../src/issue-tracker/adapters/CLIIssueTrackerService.js";
import { CLIRPCServer } from "../src/issue-tracker/adapters/CLIRPCServer.js";
import { AgentActivityType } from "../src/issue-tracker/types.js";

describe("CLIRPCServer - Ephemeral Activity Handling", () => {
	let app: Fastify.FastifyInstance;
	let issueTracker: CLIIssueTrackerService;
	let rpcServer: CLIRPCServer;

	beforeEach(async () => {
		// Create a fresh Fastify instance for each test
		app = fastify();

		// Create issue tracker with default data
		issueTracker = new CLIIssueTrackerService();
		issueTracker.seedDefaultData();

		// Create RPC server
		rpcServer = new CLIRPCServer({
			fastifyServer: app,
			issueTracker,
			version: "test",
		});

		// Register RPC server routes
		rpcServer.register();

		// Wait for Fastify to be ready
		await app.ready();
	});

	afterEach(async () => {
		// Clean up
		await app.close();
	});

	it("should show ephemeral activity when it's the last activity", async () => {
		// Create an issue
		const issue = await issueTracker.createIssue({
			teamId: "team-default",
			title: "Test Issue",
		});

		// Create an agent session
		const sessionPayload = await issueTracker.createAgentSessionOnIssue({
			issueId: issue.id,
		});
		const session = await sessionPayload.agentSession;

		// Post a non-ephemeral activity
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Thought,
				body: "First thought",
			},
			ephemeral: false,
		});

		// Post an ephemeral activity (should be visible)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "Ephemeral action",
			},
			ephemeral: true,
		});

		// Call viewSession via RPC
		const response = await app.inject({
			method: "POST",
			url: "/cli/rpc",
			payload: {
				jsonrpc: "2.0",
				method: "viewSession",
				params: {
					sessionId: session.id,
				},
				id: 1,
			},
		});

		const result = JSON.parse(response.body);

		// Should have 2 activities (both visible)
		expect(result.result.activities).toHaveLength(2);
		expect(result.result.activities[0].content).toBe("First thought");
		expect(result.result.activities[1].content).toBe("Ephemeral action");
	});

	it("should hide ephemeral activity when replaced by subsequent non-ephemeral activity", async () => {
		// Create an issue
		const issue = await issueTracker.createIssue({
			teamId: "team-default",
			title: "Test Issue",
		});

		// Create an agent session
		const sessionPayload = await issueTracker.createAgentSessionOnIssue({
			issueId: issue.id,
		});
		const session = await sessionPayload.agentSession;

		// Post a non-ephemeral activity
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Thought,
				body: "First thought",
			},
			ephemeral: false,
		});

		// Post an ephemeral activity (should be hidden)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "Ephemeral action",
			},
			ephemeral: true,
		});

		// Post another non-ephemeral activity (replaces the ephemeral one)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Thought,
				body: "Second thought",
			},
			ephemeral: false,
		});

		// Call viewSession via RPC
		const response = await app.inject({
			method: "POST",
			url: "/cli/rpc",
			payload: {
				jsonrpc: "2.0",
				method: "viewSession",
				params: {
					sessionId: session.id,
				},
				id: 1,
			},
		});

		const result = JSON.parse(response.body);

		// Should only have 2 activities (ephemeral one is hidden)
		expect(result.result.activities).toHaveLength(2);
		expect(result.result.activities[0].content).toBe("First thought");
		expect(result.result.activities[1].content).toBe("Second thought");
		expect(result.result.totalCount).toBe(2);
	});

	it("should hide ephemeral activity when replaced by subsequent ephemeral activity", async () => {
		// Create an issue
		const issue = await issueTracker.createIssue({
			teamId: "team-default",
			title: "Test Issue",
		});

		// Create an agent session
		const sessionPayload = await issueTracker.createAgentSessionOnIssue({
			issueId: issue.id,
		});
		const session = await sessionPayload.agentSession;

		// Post a non-ephemeral activity
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Thought,
				body: "First thought",
			},
			ephemeral: false,
		});

		// Post first ephemeral activity (should be hidden)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "First ephemeral action",
			},
			ephemeral: true,
		});

		// Post second ephemeral activity (should be visible)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "Second ephemeral action",
			},
			ephemeral: true,
		});

		// Call viewSession via RPC
		const response = await app.inject({
			method: "POST",
			url: "/cli/rpc",
			payload: {
				jsonrpc: "2.0",
				method: "viewSession",
				params: {
					sessionId: session.id,
				},
				id: 1,
			},
		});

		const result = JSON.parse(response.body);

		// Should have 2 activities (first ephemeral is hidden)
		expect(result.result.activities).toHaveLength(2);
		expect(result.result.activities[0].content).toBe("First thought");
		expect(result.result.activities[1].content).toBe("Second ephemeral action");
		expect(result.result.totalCount).toBe(2);
	});

	it("should handle multiple consecutive ephemeral activities correctly", async () => {
		// Create an issue
		const issue = await issueTracker.createIssue({
			teamId: "team-default",
			title: "Test Issue",
		});

		// Create an agent session
		const sessionPayload = await issueTracker.createAgentSessionOnIssue({
			issueId: issue.id,
		});
		const session = await sessionPayload.agentSession;

		// Post a non-ephemeral activity
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Thought,
				body: "First thought",
			},
			ephemeral: false,
		});

		// Post multiple ephemeral activities (only last should be visible)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "Ephemeral 1",
			},
			ephemeral: true,
		});

		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "Ephemeral 2",
			},
			ephemeral: true,
		});

		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Action,
				body: "Ephemeral 3",
			},
			ephemeral: true,
		});

		// Post a final non-ephemeral activity (replaces all ephemeral)
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: {
				type: AgentActivityType.Response,
				body: "Final response",
			},
			ephemeral: false,
		});

		// Call viewSession via RPC
		const response = await app.inject({
			method: "POST",
			url: "/cli/rpc",
			payload: {
				jsonrpc: "2.0",
				method: "viewSession",
				params: {
					sessionId: session.id,
				},
				id: 1,
			},
		});

		const result = JSON.parse(response.body);

		// Should only have 2 activities (all ephemeral ones are hidden)
		expect(result.result.activities).toHaveLength(2);
		expect(result.result.activities[0].content).toBe("First thought");
		expect(result.result.activities[1].content).toBe("Final response");
		expect(result.result.totalCount).toBe(2);
	});

	it("should handle pagination with ephemeral activities correctly", async () => {
		// Create an issue
		const issue = await issueTracker.createIssue({
			teamId: "team-default",
			title: "Test Issue",
		});

		// Create an agent session
		const sessionPayload = await issueTracker.createAgentSessionOnIssue({
			issueId: issue.id,
		});
		const session = await sessionPayload.agentSession;

		// Post multiple activities with some ephemeral ones
		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: { type: AgentActivityType.Thought, body: "Thought 1" },
			ephemeral: false,
		});

		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: { type: AgentActivityType.Action, body: "Ephemeral 1" },
			ephemeral: true,
		});

		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: { type: AgentActivityType.Thought, body: "Thought 2" },
			ephemeral: false,
		});

		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: { type: AgentActivityType.Action, body: "Ephemeral 2" },
			ephemeral: true,
		});

		await issueTracker.createAgentActivity({
			agentSessionId: session.id,
			content: { type: AgentActivityType.Thought, body: "Thought 3" },
			ephemeral: false,
		});

		// Call viewSession with pagination (limit: 2, offset: 0)
		const response = await app.inject({
			method: "POST",
			url: "/cli/rpc",
			payload: {
				jsonrpc: "2.0",
				method: "viewSession",
				params: {
					sessionId: session.id,
					limit: 2,
					offset: 0,
				},
				id: 1,
			},
		});

		const result = JSON.parse(response.body);

		// Should have 2 activities in this page
		expect(result.result.activities).toHaveLength(2);
		expect(result.result.activities[0].content).toBe("Thought 1");
		expect(result.result.activities[1].content).toBe("Thought 2");
		expect(result.result.hasMore).toBe(true);
		expect(result.result.totalCount).toBe(3); // Only non-ephemeral activities
	});
});
