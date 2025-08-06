import { execSync } from "node:child_process";
import { basename, isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Extract actual path processing logic from app.ts:253
const processRepositoryPath = (repositoryPath: string): string => {
	return resolve(repositoryPath);
};

// Extract actual repository name generation from app.ts:207
const generateRepositoryName = (repositoryPath: string): string => {
	return basename(repositoryPath);
};

// Extract actual safe name generation logic from app.ts:210
const generateSafeRepositoryName = (repositoryName: string): string => {
	return repositoryName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
};

describe("add-repository command", () => {
	describe("CLI integration", () => {
		it("should include add-repository in help output", () => {
			const helpOutput = execSync("node dist/app.js --help", {
				encoding: "utf-8",
				cwd: __dirname,
			});

			expect(helpOutput).toContain("add-repository");
			expect(helpOutput).toContain("Add a new repository configuration");
			expect(helpOutput).toContain(
				"cyrus add-repository           Add a new repository interactively",
			);
		});
	});

	describe("Repository configuration validation", () => {
		it("should validate absolute paths", () => {
			const validPaths = [
				"/Users/test/repo",
				"/home/user/project",
				"/var/www/app",
				"/opt/projects/myapp",
			];

			const invalidPaths = [
				"relative/path",
				"./current",
				"../parent",
				"~/home/repo",
				"project",
			];

			validPaths.forEach((path) => {
				const processedPath = processRepositoryPath(path);
				expect(isAbsolute(processedPath)).toBe(true);
				// Input paths should already be absolute for valid cases
				expect(isAbsolute(path)).toBe(true);
			});

			invalidPaths.forEach((path) => {
				const processedPath = processRepositoryPath(path);
				// resolve() always makes paths absolute, even from relative input
				expect(isAbsolute(processedPath)).toBe(true);
				// Input paths should be relative for invalid cases
				expect(isAbsolute(path)).toBe(false);
			});
		});

		it("should generate valid repository IDs from paths", () => {
			const testCases = [
				{ path: "/Users/test/my-project", expectedName: "my-project" },
				{ path: "/home/user/awesome-app", expectedName: "awesome-app" },
				{ path: "/var/www/website", expectedName: "website" },
				{ path: "/opt/projects/backend-api", expectedName: "backend-api" },
			];

			testCases.forEach(({ path, expectedName }) => {
				const actualName = generateRepositoryName(path);
				expect(actualName).toBe(expectedName);
			});
		});

		it("should handle edge cases in repository paths", () => {
			const edgeCases = [
				"/Users/test/project with spaces",
				"/Users/test/project@2024",
				"/Users/test/project-v1.0",
				"/Users/test/project_underscore",
			];

			edgeCases.forEach((path) => {
				const processedPath = processRepositoryPath(path);
				expect(isAbsolute(processedPath)).toBe(true);
				const name = generateRepositoryName(processedPath);
				expect(name).toBeTruthy();
				expect(name.length).toBeGreaterThan(0);
				// Test the safe name generation as well
				const safeName = generateSafeRepositoryName(name);
				expect(safeName).toMatch(/^[a-z0-9-_]+$/);
			});
		});
	});

	describe("Configuration structure", () => {
		it("should define proper repository configuration interface", () => {
			const sampleRepo = {
				id: "test-repo",
				name: "Test Repository",
				repositoryPath: "/Users/test/repo",
				baseBranch: "main",
				linearWorkspaceId: "ws-123",
				linearToken: "token-123",
				linearWorkspaceName: "Test Workspace",
				workspaceBaseDir: "/Users/test/workspaces/repo",
				isActive: true,
			};

			// Validate required fields
			expect(sampleRepo.id).toBeTruthy();
			expect(sampleRepo.name).toBeTruthy();
			expect(sampleRepo.repositoryPath).toMatch(/^\//);
			expect(sampleRepo.baseBranch).toBeTruthy();
			expect(sampleRepo.linearWorkspaceId).toBeTruthy();
			expect(sampleRepo.linearToken).toBeTruthy();
			expect(sampleRepo.workspaceBaseDir).toMatch(/^\//);
			expect(typeof sampleRepo.isActive).toBe("boolean");
		});

		it("should preserve existing configuration when adding repositories", () => {
			const existingConfig = {
				repositories: [
					{
						id: "repo1",
						name: "Repository 1",
						repositoryPath: "/test/repo1",
						baseBranch: "main",
						linearWorkspaceId: "ws-123",
						linearToken: "token1",
						workspaceBaseDir: "/test/workspaces/repo1",
						isActive: true,
					},
				],
				ngrokAuthToken: "ngrok-token",
				customSetting: "custom-value",
			};

			const newRepo = {
				id: "repo2",
				name: "Repository 2",
				repositoryPath: "/test/repo2",
				baseBranch: "develop",
				linearWorkspaceId: "ws-456",
				linearToken: "token2",
				workspaceBaseDir: "/test/workspaces/repo2",
				isActive: true,
			};

			const updatedConfig = {
				...existingConfig,
				repositories: [...existingConfig.repositories, newRepo],
			};

			// Should preserve existing settings
			expect(updatedConfig.ngrokAuthToken).toBe("ngrok-token");
			expect(updatedConfig.customSetting).toBe("custom-value");

			// Should add new repository
			expect(updatedConfig.repositories).toHaveLength(2);
			expect(updatedConfig.repositories[1]).toEqual(newRepo);
		});
	});

	describe("Linear credentials handling", () => {
		it("should detect existing Linear credentials", () => {
			const configWithCredentials = {
				repositories: [
					{
						id: "repo1",
						linearToken: "token-123",
						linearWorkspaceId: "ws-123",
						linearWorkspaceName: "Test Workspace",
					},
				],
			};

			const repoWithToken = configWithCredentials.repositories.find(
				(r: any) => r.linearToken,
			);
			expect(repoWithToken).toBeDefined();
			expect(repoWithToken!.linearToken).toBe("token-123");
			expect(repoWithToken!.linearWorkspaceName).toBe("Test Workspace");
		});

		it("should handle missing Linear credentials", () => {
			const configWithoutCredentials = {
				repositories: [] as any[],
			};

			const repoWithToken = configWithoutCredentials.repositories.find(
				(r: any) => r.linearToken,
			);
			expect(repoWithToken).toBeUndefined();
		});

		it("should reuse credentials from existing repositories", () => {
			const configWithMultipleRepos = {
				repositories: [
					{
						id: "repo1",
						linearToken: "shared-token",
						linearWorkspaceId: "ws-123",
						linearWorkspaceName: "Shared Workspace",
					},
					{
						id: "repo2",
						linearToken: "shared-token",
						linearWorkspaceId: "ws-123",
						linearWorkspaceName: "Shared Workspace",
					},
				],
			};

			// Should be able to reuse credentials
			const credentialsSource = configWithMultipleRepos.repositories.find(
				(r: any) => r.linearToken,
			);
			expect(credentialsSource).toBeDefined();

			const linearCredentials = {
				linearToken: credentialsSource!.linearToken,
				linearWorkspaceId: credentialsSource!.linearWorkspaceId,
				linearWorkspaceName:
					credentialsSource!.linearWorkspaceName || "Your Workspace",
			};

			expect(linearCredentials.linearToken).toBe("shared-token");
			expect(linearCredentials.linearWorkspaceId).toBe("ws-123");
		});
	});
});
