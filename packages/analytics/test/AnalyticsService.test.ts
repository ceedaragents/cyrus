import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AgentAssignedProperties,
	AnalyticsEvents,
	AnalyticsService,
	type PRMergedProperties,
	type TrackClient,
} from "../src/index.js";

function createMockClient(): TrackClient & { track: ReturnType<typeof vi.fn> } {
	return { track: vi.fn() };
}

describe("AnalyticsService", () => {
	afterEach(() => {
		delete process.env.MIXPANEL_TOKEN;
	});

	describe("constructor", () => {
		it("is enabled when a client is injected", () => {
			const service = new AnalyticsService({
				client: createMockClient(),
			});
			expect(service.enabled).toBe(true);
		});

		it("is disabled when no token or client is provided", () => {
			delete process.env.MIXPANEL_TOKEN;
			const service = new AnalyticsService();
			expect(service.enabled).toBe(false);
		});
	});

	describe("trackAgentAssigned", () => {
		const properties: AgentAssignedProperties = {
			organizationId: "org-123",
			issueId: "issue-456",
			issueIdentifier: "PROJ-42",
			issueTitle: "Fix the bug",
			teamId: "team-789",
			userId: "user-abc",
			userName: "Alice",
			userEmail: "alice@example.com",
			repositoryId: "repo-def",
			repositoryName: "my-repo",
		};

		it("tracks event with correct properties", () => {
			const mockClient = createMockClient();
			const service = new AnalyticsService({ client: mockClient });
			service.trackAgentAssigned(properties);

			expect(mockClient.track).toHaveBeenCalledWith(
				AnalyticsEvents.AGENT_ASSIGNED,
				{
					distinct_id: "org-123",
					issue_id: "issue-456",
					issue_identifier: "PROJ-42",
					issue_title: "Fix the bug",
					team_id: "team-789",
					user_id: "user-abc",
					user_name: "Alice",
					user_email: "alice@example.com",
					repository_id: "repo-def",
					repository_name: "my-repo",
				},
			);
		});

		it("is a no-op when disabled", () => {
			const service = new AnalyticsService();
			// Should not throw
			service.trackAgentAssigned(properties);
		});
	});

	describe("trackPRMerged", () => {
		const properties: PRMergedProperties = {
			repositoryFullName: "owner/repo",
			prNumber: 42,
			prTitle: "Fix something",
			branchName: "fix/something",
			mergedBy: "bob",
			organizationId: "org-123",
			repositoryId: "repo-def",
		};

		it("tracks event with correct properties", () => {
			const mockClient = createMockClient();
			const service = new AnalyticsService({ client: mockClient });
			service.trackPRMerged(properties);

			expect(mockClient.track).toHaveBeenCalledWith(AnalyticsEvents.PR_MERGED, {
				distinct_id: "org-123",
				repository_full_name: "owner/repo",
				pr_number: 42,
				pr_title: "Fix something",
				branch_name: "fix/something",
				merged_by: "bob",
				organization_id: "org-123",
				repository_id: "repo-def",
			});
		});

		it("falls back to repository name for distinct_id when no org", () => {
			const mockClient = createMockClient();
			const service = new AnalyticsService({ client: mockClient });
			service.trackPRMerged({
				repositoryFullName: "owner/repo",
				prNumber: 42,
				prTitle: "Fix something",
				branchName: "fix/something",
			});

			expect(mockClient.track).toHaveBeenCalledWith(
				AnalyticsEvents.PR_MERGED,
				expect.objectContaining({
					distinct_id: "owner/repo",
				}),
			);
		});

		it("is a no-op when disabled", () => {
			const service = new AnalyticsService();
			// Should not throw
			service.trackPRMerged(properties);
		});
	});
});
