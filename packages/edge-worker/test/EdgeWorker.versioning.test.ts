import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig } from "../src/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
}));

// Mock other dependencies
vi.mock("cyrus-linear-event-transport");
vi.mock("cyrus-claude-runner");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core");
vi.mock("file-type");

describe("EdgeWorker - Version Tag Extraction", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		// Clear all mocks
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			webhookPort: 3456,
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [
				{
					id: "test-repo",
					name: "Test Repo",
					repositoryPath: "/test/repo",
					workspaceBaseDir: "/test/workspaces",
					baseBranch: "main",
					linearToken: "test-token",
					linearWorkspaceId: "test-workspace",
					isActive: true,
					allowedTools: ["Read", "Edit"],
					promptTemplatePath: "/test/template.md",
				},
			],
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should extract version from prompt template", async () => {
		const templateWithVersion = `<version-tag value="builder-v1.0.0" />

# Issue Summary

Repository: {{repository_name}}
Issue: {{issue_identifier}} - {{issue_title}}

## Description
{{issue_description}}`;

		vi.mocked(readFile).mockResolvedValue(templateWithVersion);

		// Use reflection to test private method
		const extractVersionTag = (edgeWorker as any).extractVersionTag.bind(
			edgeWorker,
		);
		const version = extractVersionTag(templateWithVersion);

		expect(version).toBe("builder-v1.0.0");
	});

	it("should handle templates without version tags", async () => {
		const templateWithoutVersion = `# Issue Summary

Repository: {{repository_name}}
Issue: {{issue_identifier}} - {{issue_title}}

## Description
{{issue_description}}`;

		vi.mocked(readFile).mockResolvedValue(templateWithoutVersion);

		// Use reflection to test private method
		const extractVersionTag = (edgeWorker as any).extractVersionTag.bind(
			edgeWorker,
		);
		const version = extractVersionTag(templateWithoutVersion);

		expect(version).toBeUndefined();
	});

	it("should log version when present in prompt template", async () => {
		const templateWithVersion = `<version-tag value="debugger-v2.1.0" />

# Debug Issue

Repository: {{repository_name}}`;

		vi.mocked(readFile).mockResolvedValue(templateWithVersion);

		// Spy on console.log to check for version logging
		const logSpy = vi.spyOn(console, "log");

		// Use reflection to test the buildPromptV2 method
		const buildPromptV2 = (edgeWorker as any).buildPromptV2.bind(edgeWorker);

		const mockIssue = {
			id: "issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "Test description",
			state: { name: "Todo" },
			priority: 1,
			url: "http://test.com",
			branchName: "test-branch",
		};

		await buildPromptV2(mockIssue, mockConfig.repositories[0]);

		// Check that version was logged
		expect(logSpy).toHaveBeenCalledWith(
			"[EdgeWorker] Prompt template version: debugger-v2.1.0",
		);
	});

	it("should not log version when template has no version tag", async () => {
		const templateWithoutVersion = `# Issue Summary

Repository: {{repository_name}}`;

		vi.mocked(readFile).mockResolvedValue(templateWithoutVersion);

		const logSpy = vi.spyOn(console, "log");

		// Use reflection to test the buildPromptV2 method
		const buildPromptV2 = (edgeWorker as any).buildPromptV2.bind(edgeWorker);

		const mockIssue = {
			id: "issue-123",
			identifier: "TEST-123",
			title: "Test Issue",
			description: "Test description",
			state: { name: "Todo" },
			priority: 1,
			url: "http://test.com",
			branchName: "test-branch",
		};

		await buildPromptV2(mockIssue, mockConfig.repositories[0]);

		// Check that version was NOT logged
		const versionLogs = logSpy.mock.calls.filter((call) =>
			call[0]?.includes("Prompt template version:"),
		);
		expect(versionLogs).toHaveLength(0);
	});
});
