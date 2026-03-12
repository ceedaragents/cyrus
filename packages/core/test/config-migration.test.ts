/**
 * Tests for edge config migration (per-repo tokens → workspace-keyed tokens)
 */

import { describe, expect, it } from "vitest";
import {
	EdgeConfigPayloadSchema,
	migrateEdgeConfig,
} from "../src/config-schemas.js";

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

		// Should have workspace-level tokens and workspace name
		expect(result.linearWorkspaces).toEqual({
			"ws-123": {
				linearToken: "lin_api_token_123",
				linearRefreshToken: "lin_refresh_token_123",
				linearWorkspaceName: "My Workspace",
			},
		});

		// Repositories should no longer have tokens or workspace name
		const repos = result.repositories as Record<string, unknown>[];
		expect(repos[0]).not.toHaveProperty("linearToken");
		expect(repos[0]).not.toHaveProperty("linearRefreshToken");
		expect(repos[0]).not.toHaveProperty("linearWorkspaceName");

		// Other repo fields should be preserved
		expect(repos[0]).toHaveProperty("id", "repo-1");
		expect(repos[0]).toHaveProperty("linearWorkspaceId", "ws-123");
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

	it("folds top-level linearWorkspaceSlug into workspace config", () => {
		const oldConfig = {
			linearWorkspaceSlug: "my-workspace",
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path",
					baseBranch: "main",
					linearWorkspaceId: "ws-123",
					linearToken: "token_123",
					workspaceBaseDir: "/ws",
				},
			],
		};

		const result = migrateEdgeConfig(oldConfig);

		expect((result.linearWorkspaces as Record<string, any>)["ws-123"]).toEqual({
			linearToken: "token_123",
			linearWorkspaceSlug: "my-workspace",
		});

		// Top-level slug should be removed
		expect(result).not.toHaveProperty("linearWorkspaceSlug");
	});
});

describe("Zod schema + migration round-trip", () => {
	const makeOldFormatPayload = () => ({
		linearWorkspaceSlug: "acme-corp",
		repositories: [
			{
				id: "repo-1",
				name: "My Repo",
				repositoryPath: "/path/to/repo",
				baseBranch: "main",
				linearWorkspaceId: "ws-abc",
				linearToken: "lin_token_old",
				linearRefreshToken: "lin_refresh_old",
				linearWorkspaceName: "Acme Corp",
				workspaceBaseDir: "/ws",
			},
		],
	});

	it("old-format payload survives Zod validation and migrates correctly", () => {
		const payload = makeOldFormatPayload();

		// Zod should accept deprecated fields (not strip them)
		const parseResult = EdgeConfigPayloadSchema.safeParse(payload);
		expect(parseResult.success).toBe(true);

		const parsed = parseResult.data!;
		// Deprecated fields should be preserved after parse
		expect(parsed.repositories[0]).toHaveProperty(
			"linearToken",
			"lin_token_old",
		);
		expect(parsed.repositories[0]).toHaveProperty(
			"linearRefreshToken",
			"lin_refresh_old",
		);
		expect(parsed.repositories[0]).toHaveProperty(
			"linearWorkspaceName",
			"Acme Corp",
		);
		expect(parsed).toHaveProperty("linearWorkspaceSlug", "acme-corp");

		// Now migrate
		const migrated = migrateEdgeConfig(
			parsed as unknown as Record<string, unknown>,
		);

		expect(migrated.linearWorkspaces).toEqual({
			"ws-abc": {
				linearToken: "lin_token_old",
				linearRefreshToken: "lin_refresh_old",
				linearWorkspaceSlug: "acme-corp",
				linearWorkspaceName: "Acme Corp",
			},
		});

		// Deprecated fields stripped from repos and top-level
		const repos = migrated.repositories as Record<string, unknown>[];
		expect(repos[0]).not.toHaveProperty("linearToken");
		expect(repos[0]).not.toHaveProperty("linearRefreshToken");
		expect(repos[0]).not.toHaveProperty("linearWorkspaceName");
		expect(migrated).not.toHaveProperty("linearWorkspaceSlug");
	});

	it("new-format payload passes Zod and migration unchanged", () => {
		const newPayload = {
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					linearWorkspaceId: "ws-abc",
					workspaceBaseDir: "/ws",
				},
			],
			linearWorkspaces: {
				"ws-abc": {
					linearToken: "lin_token_new",
					linearRefreshToken: "lin_refresh_new",
				},
			},
		};

		const parseResult = EdgeConfigPayloadSchema.safeParse(newPayload);
		expect(parseResult.success).toBe(true);

		const migrated = migrateEdgeConfig(
			parseResult.data as unknown as Record<string, unknown>,
		);

		// Should be returned as-is (idempotent — linearWorkspaces already present)
		expect(migrated).toBe(parseResult.data);
	});

	it("combined format (both old and new fields) is idempotent after migration", () => {
		const combinedPayload = {
			linearWorkspaceSlug: "acme-corp",
			repositories: [
				{
					id: "repo-1",
					name: "My Repo",
					repositoryPath: "/path/to/repo",
					baseBranch: "main",
					linearWorkspaceId: "ws-abc",
					linearToken: "lin_token_old",
					workspaceBaseDir: "/ws",
				},
			],
			linearWorkspaces: {
				"ws-abc": {
					linearToken: "lin_token_new",
					linearRefreshToken: "lin_refresh_new",
				},
			},
		};

		const parseResult = EdgeConfigPayloadSchema.safeParse(combinedPayload);
		expect(parseResult.success).toBe(true);

		const migrated = migrateEdgeConfig(
			parseResult.data as unknown as Record<string, unknown>,
		);

		// linearWorkspaces already existed, so migration returns unchanged
		expect(migrated).toBe(parseResult.data);
		expect(
			(migrated.linearWorkspaces as Record<string, any>)["ws-abc"],
		).toEqual({
			linearToken: "lin_token_new",
			linearRefreshToken: "lin_refresh_new",
		});
	});
});
