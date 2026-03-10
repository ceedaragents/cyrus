/**
 * Tests for edge config migration (per-repo tokens → workspace-keyed tokens)
 */

import { describe, expect, it } from "vitest";
import { migrateEdgeConfig } from "../src/config-schemas.js";

describe("migrateEdgeConfig", () => {
	it("migrates per-repo tokens to workspace-keyed format", () => {
		const oldConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					linearWorkspaceName: "My Workspace",
					linearToken: "lin_api_token_123",
					linearRefreshToken: "lin_refresh_token_123",
					workspaceBaseDir: "/workspaces",
				},
			],
		};

		const result = migrateEdgeConfig(oldConfig);

		// Should have workspace-level tokens
		expect(result.linearWorkspaces).toEqual({
			"ws-123": {
				linearToken: "lin_api_token_123",
				linearRefreshToken: "lin_refresh_token_123",
			},
		});

		// Repositories should no longer have tokens
		const repos = result.repositories as Record<string, unknown>[];
		expect(repos[0]).not.toHaveProperty("linearToken");
		expect(repos[0]).not.toHaveProperty("linearRefreshToken");

		// Other repo fields should be preserved
		expect(repos[0]).toHaveProperty("id", "repo-1");
		expect(repos[0]).toHaveProperty("linearWorkspaceId", "ws-123");
		expect(repos[0]).toHaveProperty("linearWorkspaceName", "My Workspace");
	});

	it("deduplicates tokens across repos sharing same workspace", () => {
		const oldConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "Repo 1",
					repositoryPath: "/path/1",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					linearToken: "shared_token",
					linearRefreshToken: "shared_refresh",
					workspaceBaseDir: "/ws",
				},
				{
					id: "repo-2",
					name: "Repo 2",
					repositoryPath: "/path/2",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					linearToken: "shared_token",
					linearRefreshToken: "shared_refresh",
					workspaceBaseDir: "/ws",
				},
				{
					id: "repo-3",
					name: "Repo 3",
					repositoryPath: "/path/3",
					baseBranch: "main",
					linearWorkspaceId: "ws-456",
					linearToken: "other_token",
					workspaceBaseDir: "/ws",
				},
			],
		};

		const result = migrateEdgeConfig(oldConfig);

		// Should have two workspace entries
		expect(Object.keys(result.linearWorkspaces as object)).toHaveLength(2);
		expect((result.linearWorkspaces as Record<string, any>)["ws-123"]).toEqual({
			linearToken: "shared_token",
			linearRefreshToken: "shared_refresh",
		});
		expect((result.linearWorkspaces as Record<string, any>)["ws-456"]).toEqual({
			linearToken: "other_token",
		});

		// All repos should have tokens stripped
		const repos = result.repositories as Record<string, unknown>[];
		for (const repo of repos) {
			expect(repo).not.toHaveProperty("linearToken");
			expect(repo).not.toHaveProperty("linearRefreshToken");
		}
	});

	it("is idempotent - returns unchanged config if already migrated", () => {
		const alreadyMigrated = {
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					workspaceBaseDir: "/ws",
				},
			],
			linearWorkspaces: {
				"ws-123": {
					linearToken: "token_123",
					linearRefreshToken: "refresh_123",
				},
			},
		};

		const result = migrateEdgeConfig(alreadyMigrated);

		// Should be returned unchanged
		expect(result).toBe(alreadyMigrated);
	});

	it("handles missing repositories array", () => {
		const noRepos = { linearWorkspaces: {} };
		const result = migrateEdgeConfig(noRepos);
		expect(result).toBe(noRepos);
	});

	it("handles repos without tokens (no migration needed)", () => {
		const noTokens = {
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					workspaceBaseDir: "/ws",
				},
			],
		};

		const result = migrateEdgeConfig(noTokens);
		expect(result).toBe(noTokens);
		expect(result.linearWorkspaces).toBeUndefined();
	});

	it("handles repos without refresh tokens", () => {
		const noRefresh = {
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					linearToken: "token_only",
					workspaceBaseDir: "/ws",
				},
			],
		};

		const result = migrateEdgeConfig(noRefresh);
		expect((result.linearWorkspaces as Record<string, any>)["ws-123"]).toEqual({
			linearToken: "token_only",
		});
	});

	it("preserves all non-token config fields", () => {
		const fullConfig = {
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					linearToken: "token",
					teamKeys: ["TEAM"],
					routingLabels: ["bug"],
					workspaceBaseDir: "/ws",
					isActive: true,
					model: "opus",
				},
			],
			ngrokAuthToken: "ngrok_123",
			claudeDefaultModel: "sonnet",
		};

		const result = migrateEdgeConfig(fullConfig);

		// Non-token fields on repo preserved
		const repo = (result.repositories as Record<string, unknown>[])[0]!;
		expect(repo).toHaveProperty("teamKeys", ["TEAM"]);
		expect(repo).toHaveProperty("routingLabels", ["bug"]);
		expect(repo).toHaveProperty("isActive", true);
		expect(repo).toHaveProperty("model", "opus");

		// Top-level fields preserved
		expect(result).toHaveProperty("ngrokAuthToken", "ngrok_123");
		expect(result).toHaveProperty("claudeDefaultModel", "sonnet");
	});
});
