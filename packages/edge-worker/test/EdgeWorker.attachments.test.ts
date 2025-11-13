import type {
	Attachment,
	AttachmentConnection,
	LinearIssue,
} from "@linear/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker";
import type { EdgeWorkerConfig } from "../src/types";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn(),
}));

// Mock file-type
vi.mock("file-type", () => ({
	fileTypeFromBuffer: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("EdgeWorker - Native Attachments", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		mockConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [
				{
					id: "test-repo",
					name: "test-repo",
					repositoryPath: "/test/repo",
					workspaceBaseDir: "/test/workspaces",
					linearToken: "test-token",
					linearWorkspaceId: "test-workspace",
					baseBranch: "main",
				},
			],
		};

		edgeWorker = new EdgeWorker(mockConfig);
		mockFetch.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("downloadIssueAttachments", () => {
		it("should fetch native Linear attachments alongside extracted URLs", async () => {
			// Mock Linear issue with attachments method
			const mockAttachments: Attachment[] = [
				{
					id: "attach1",
					title: "Error: Rendered more hooks than during the previous render.",
					url: "https://sentry.io/organizations/ceedar/issues/6785301401/",
				} as Attachment,
				{
					id: "attach2",
					title: "Performance Report",
					url: "https://datadog.com/reports/123",
				} as Attachment,
			];

			const mockIssue = {
				id: "issue-123",
				identifier: "PACK-203",
				title: "Test Issue",
				description:
					"Issue with attachment URL https://uploads.linear.app/test.png",
				attachments: vi.fn().mockResolvedValue({
					nodes: mockAttachments,
				} as AttachmentConnection),
			} as unknown as LinearIssue;

			// Mock IssueTrackerService
			const mockLinearClient = {
				fetchIssue: vi.fn().mockResolvedValue(mockIssue),
				fetchComments: vi.fn().mockResolvedValue({ nodes: [] }),
				fetchIssueAttachments: vi
					.fn()
					.mockResolvedValue(
						mockAttachments.map((a) => ({ title: a.title, url: a.url })),
					),
			};
			(edgeWorker as any).issueTrackers.set("test-repo", mockLinearClient);

			// Call the method
			const result = await (edgeWorker as any).downloadIssueAttachments(
				mockIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			// Verify attachments were fetched via IssueTrackerService
			expect(mockLinearClient.fetchIssueAttachments).toHaveBeenCalledWith(
				"issue-123",
			);

			// Verify manifest includes native attachments
			expect(result.manifest).toContain("### Linear Issue Links");
			expect(result.manifest).toContain(
				"Error: Rendered more hooks than during the previous render.",
			);
			expect(result.manifest).toContain(
				"https://sentry.io/organizations/ceedar/issues/6785301401/",
			);
			expect(result.manifest).toContain("Performance Report");
			expect(result.manifest).toContain("https://datadog.com/reports/123");
		});

		it("should handle when no native attachments are present", async () => {
			const mockIssue = {
				id: "issue-456",
				identifier: "PACK-204",
				title: "Test Issue Without Attachments",
				description: "No attachments here",
				attachments: vi.fn().mockResolvedValue({
					nodes: [],
				} as AttachmentConnection),
			} as unknown as LinearIssue;

			const mockLinearClient = {
				fetchIssue: vi.fn().mockResolvedValue(mockIssue),
				fetchComments: vi.fn().mockResolvedValue({ nodes: [] }),
				fetchIssueAttachments: vi.fn().mockResolvedValue([]),
			};
			(edgeWorker as any).issueTrackers.set("test-repo", mockLinearClient);

			const result = await (edgeWorker as any).downloadIssueAttachments(
				mockIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			expect(mockLinearClient.fetchIssueAttachments).toHaveBeenCalledWith(
				"issue-456",
			);
			expect(result.manifest).not.toContain("### Linear Issue Links");
			expect(result.manifest).toContain(
				"No attachments were found in this issue.",
			);
		});

		it("should handle errors when fetching native attachments", async () => {
			const mockIssue = {
				id: "issue-789",
				identifier: "PACK-205",
				title: "Test Issue with Error",
				description: "Testing error handling",
				attachments: vi.fn().mockRejectedValue(new Error("API Error")),
			} as unknown as LinearIssue;

			const mockLinearClient = {
				fetchIssue: vi.fn().mockResolvedValue(mockIssue),
				fetchComments: vi.fn().mockResolvedValue({ nodes: [] }),
				fetchIssueAttachments: vi.fn().mockResolvedValue([]),
			};
			(edgeWorker as any).issueTrackers.set("test-repo", mockLinearClient);

			// Should not throw, but handle gracefully
			const result = await (edgeWorker as any).downloadIssueAttachments(
				mockIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			expect(mockLinearClient.fetchIssueAttachments).toHaveBeenCalledWith(
				"issue-789",
			);
			expect(result.manifest).toContain(
				"No attachments were found in this issue.",
			);
		});

		it("should handle platform-agnostic Issue objects without attachments() method (CLI mode)", async () => {
			// CYPACK-330 fix: CLI mode uses platform-agnostic Issue objects
			// which don't have an attachments() method - should handle gracefully
			const platformAgnosticIssue = {
				id: "issue-999",
				identifier: "PACK-999",
				title: "CLI Platform Test Issue",
				description: "Testing with platform-agnostic Issue object",
				url: "https://linear.app/test/issue/PACK-999",
				teamId: "team-1",
				team: { id: "team-1", name: "Test Team", key: "TEST" },
				state: { id: "state-1", name: "Todo", type: "unstarted" },
				assigneeId: "user-1",
				assignee: {
					id: "user-1",
					name: "Test User",
					email: "test@example.com",
				},
				labels: [], // Platform-agnostic labels array
				priority: 0,
				parentId: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				archivedAt: null,
				// NOTE: No attachments() method - this is a plain object, not a Linear SDK Issue
				// Include attachments property (would be populated by CLIIssueTrackerService)
				attachments: [],
			} as unknown as LinearIssue;

			const mockLinearClient = {
				fetchIssue: vi.fn().mockResolvedValue(platformAgnosticIssue),
				fetchComments: vi.fn().mockResolvedValue({ nodes: [] }),
				fetchIssueAttachments: vi.fn().mockResolvedValue([]),
			};
			(edgeWorker as any).issueTrackers.set("test-repo", mockLinearClient);

			// Spy on console.error to verify NO error is logged (fix working)
			const consoleErrorSpy = vi.spyOn(console, "error");

			// With the fix, this should work without errors
			const result = await (edgeWorker as any).downloadIssueAttachments(
				platformAgnosticIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			// No error should be logged (fix is working)
			expect(consoleErrorSpy).not.toHaveBeenCalledWith(
				expect.stringContaining("Failed to fetch attachments"),
				expect.any(Error),
			);

			// Clean up
			consoleErrorSpy.mockRestore();

			// The result should be returned successfully
			expect(result).toBeDefined();
			expect(result.manifest).toContain(
				"No attachments were found in this issue.",
			);
		});

		it("should handle platform-agnostic Issue objects with attachments property", async () => {
			// Test that platform-agnostic Issue objects with attachments work correctly
			const platformAgnosticIssueWithAttachments = {
				id: "issue-1000",
				identifier: "PACK-1000",
				title: "CLI Platform Test Issue with Attachments",
				description:
					"Testing with platform-agnostic Issue object with attachments",
				url: "https://linear.app/test/issue/PACK-1000",
				teamId: "team-1",
				team: { id: "team-1", name: "Test Team", key: "TEST" },
				state: { id: "state-1", name: "Todo", type: "unstarted" },
				assigneeId: "user-1",
				assignee: {
					id: "user-1",
					name: "Test User",
					email: "test@example.com",
				},
				labels: [], // Platform-agnostic labels array
				priority: 0,
				parentId: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				archivedAt: null,
				// Platform-agnostic Issue has attachments as a property, not a method
				attachments: [
					{
						id: "attach-1",
						title: "Test Attachment",
						url: "https://example.com/attachment1",
					},
					{
						id: "attach-2",
						title: "Another Attachment",
						url: "https://example.com/attachment2",
					},
				],
			} as unknown as LinearIssue;

			const mockLinearClient = {
				fetchIssue: vi
					.fn()
					.mockResolvedValue(platformAgnosticIssueWithAttachments),
				fetchComments: vi.fn().mockResolvedValue({ nodes: [] }),
				fetchIssueAttachments: vi.fn().mockResolvedValue([
					{
						id: "attach-1",
						title: "Test Attachment",
						url: "https://example.com/attachment1",
					},
					{
						id: "attach-2",
						title: "Another Attachment",
						url: "https://example.com/attachment2",
					},
				]),
			};
			(edgeWorker as any).issueTrackers.set("test-repo", mockLinearClient);

			const result = await (edgeWorker as any).downloadIssueAttachments(
				platformAgnosticIssueWithAttachments,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			// Should include native attachments in manifest
			expect(result.manifest).toContain("### Linear Issue Links");
			expect(result.manifest).toContain("Test Attachment");
			expect(result.manifest).toContain("https://example.com/attachment1");
			expect(result.manifest).toContain("Another Attachment");
			expect(result.manifest).toContain("https://example.com/attachment2");
		});
	});

	describe("downloadCommentAttachments", () => {
		it("should download attachments from comment body", async () => {
			const commentBody =
				"Check this out: https://uploads.linear.app/image1.png and https://uploads.linear.app/doc.pdf";
			const attachmentsDir = "/tmp/test-attachments";

			// Mock downloadAttachment method
			(edgeWorker as any).downloadAttachment = vi
				.fn()
				.mockResolvedValueOnce({
					success: true,
					fileType: ".png",
					isImage: true,
				})
				.mockResolvedValueOnce({
					success: true,
					fileType: ".pdf",
					isImage: false,
				});

			// Mock countExistingImages
			(edgeWorker as any).countExistingImages = vi.fn().mockResolvedValue(0);

			const result = await (edgeWorker as any).downloadCommentAttachments(
				commentBody,
				attachmentsDir,
				"test-token",
				0, // No existing attachments
			);

			expect(result.totalNewAttachments).toBe(2);
			expect(Object.keys(result.newImageMap)).toHaveLength(1);
			expect(Object.keys(result.newAttachmentMap)).toHaveLength(1);
			expect(result.failedCount).toBe(0);
		});

		it("should respect attachment limit when downloading from comments", async () => {
			const commentBody =
				"Multiple files: https://uploads.linear.app/1.png https://uploads.linear.app/2.png https://uploads.linear.app/3.png";
			const attachmentsDir = "/tmp/test-attachments";

			// Mock successful downloads
			(edgeWorker as any).downloadAttachment = vi
				.fn()
				.mockResolvedValue({ success: true, fileType: ".png", isImage: true });

			const result = await (edgeWorker as any).downloadCommentAttachments(
				commentBody,
				attachmentsDir,
				"test-token",
				19, // Already have 19 attachments, so only 1 more allowed with limit of 20
			);

			expect(result.totalNewAttachments).toBe(1);
			expect((edgeWorker as any).downloadAttachment).toHaveBeenCalledTimes(1);
		});

		it("should handle no attachments in comment", async () => {
			const commentBody = "This is just a regular comment with no attachments";
			const attachmentsDir = "/tmp/test-attachments";

			const result = await (edgeWorker as any).downloadCommentAttachments(
				commentBody,
				attachmentsDir,
				"test-token",
				0,
			);

			expect(result.totalNewAttachments).toBe(0);
			expect(Object.keys(result.newImageMap)).toHaveLength(0);
			expect(Object.keys(result.newAttachmentMap)).toHaveLength(0);
		});

		it("should handle download failures gracefully", async () => {
			const commentBody = "File: https://uploads.linear.app/fail.pdf";
			const attachmentsDir = "/tmp/test-attachments";

			// Mock download failure
			(edgeWorker as any).downloadAttachment = vi
				.fn()
				.mockResolvedValue({ success: false });

			const result = await (edgeWorker as any).downloadCommentAttachments(
				commentBody,
				attachmentsDir,
				"test-token",
				0,
			);

			expect(result.totalNewAttachments).toBe(0);
			expect(result.failedCount).toBe(1);
		});

		it("should handle malformed markdown links correctly", async () => {
			// Test malformed markdown that caused the original bug
			const commentBody =
				"Check this: [file.png](https://uploads.linear.app/ee2a1136-fe42-47ac-897f-f4ee8e824eb8/f43efb28-7db5-485b-aba1-bd5998bd46bc/a2e99ac8-337e-4b69-887e-e4cf0ddc42ab](https://uploads.linear.app/ee2a1136-fe42-47ac-897f-f4ee8e824eb8/f43efb28-7db5-485b-aba1-bd5998bd46bc/duplicate-url";

			// Mock successful download for the correctly extracted URLs
			(edgeWorker as any).downloadAttachment = vi
				.fn()
				.mockResolvedValue({ success: true, fileType: ".png", isImage: true });

			// Mock countExistingImages
			(edgeWorker as any).countExistingImages = vi.fn().mockResolvedValue(0);

			const result = await (edgeWorker as any).downloadCommentAttachments(
				commentBody,
				"/tmp/test-attachments",
				"test-token",
				0,
			);

			// Should extract exactly 2 valid URLs (not the malformed concatenated one)
			expect(result.totalNewAttachments).toBe(2);
			expect((edgeWorker as any).downloadAttachment).toHaveBeenCalledTimes(2);

			// Verify the URLs passed to downloadAttachment don't contain brackets or malformed parts
			const downloadCalls = (edgeWorker as any).downloadAttachment.mock.calls;
			downloadCalls.forEach((call: any[]) => {
				const url = call[0];
				expect(url).toMatch(
					/^https:\/\/uploads\.linear\.app\/[a-zA-Z0-9/_.-]+$/,
				);
				expect(url).not.toContain("]");
				expect(url).not.toContain("(");
			});
		});
	});

	describe("generateNewAttachmentManifest", () => {
		it("should generate manifest for new comment attachments", () => {
			const result = {
				newAttachmentMap: {
					"https://uploads.linear.app/doc.pdf":
						"/tmp/attachments/attachment_1.pdf",
				},
				newImageMap: {
					"https://uploads.linear.app/screenshot.png":
						"/tmp/attachments/image_1.png",
				},
				totalNewAttachments: 2,
				failedCount: 0,
			};

			const manifest = (edgeWorker as any).generateNewAttachmentManifest(
				result,
			);

			expect(manifest).toContain("## New Attachments from Comment");
			expect(manifest).toContain("Downloaded 2 new attachments");
			expect(manifest).toContain("### New Images");
			expect(manifest).toContain("image_1.png");
			expect(manifest).toContain("### New Attachments");
			expect(manifest).toContain("attachment_1.pdf");
		});

		it("should return empty string when no new attachments", () => {
			const result = {
				newAttachmentMap: {},
				newImageMap: {},
				totalNewAttachments: 0,
				failedCount: 0,
			};

			const manifest = (edgeWorker as any).generateNewAttachmentManifest(
				result,
			);
			expect(manifest).toBe("");
		});

		it("should include failed count in manifest", () => {
			const result = {
				newAttachmentMap: {},
				newImageMap: {
					"https://uploads.linear.app/success.png":
						"/tmp/attachments/image_1.png",
				},
				totalNewAttachments: 1,
				failedCount: 2,
			};

			const manifest = (edgeWorker as any).generateNewAttachmentManifest(
				result,
			);
			expect(manifest).toContain("Downloaded 1 new attachment (2 failed)");
		});
	});

	describe("generateAttachmentManifest", () => {
		it("should include native attachments section when provided", () => {
			const downloadResult = {
				attachmentMap: {},
				imageMap: {},
				totalFound: 0,
				downloaded: 0,
				imagesDownloaded: 0,
				skipped: 0,
				failed: 0,
				nativeAttachments: [
					{ title: "Sentry Error", url: "https://sentry.io/error/123" },
					{
						title: "GitHub Issue",
						url: "https://github.com/org/repo/issues/456",
					},
				],
			};

			const manifest = (edgeWorker as any).generateAttachmentManifest(
				downloadResult,
			);

			expect(manifest).toContain("### Linear Issue Links");
			expect(manifest).toContain("1. Sentry Error");
			expect(manifest).toContain("   URL: https://sentry.io/error/123");
			expect(manifest).toContain("2. GitHub Issue");
			expect(manifest).toContain(
				"   URL: https://github.com/org/repo/issues/456",
			);
		});

		it("should handle mixed native and downloaded attachments", () => {
			const downloadResult = {
				attachmentMap: {
					"https://uploads.linear.app/doc.pdf":
						"/tmp/attachments/attachment_1.pdf",
				},
				imageMap: {
					"https://uploads.linear.app/screenshot.png":
						"/tmp/attachments/image_1.png",
				},
				totalFound: 2,
				downloaded: 2,
				imagesDownloaded: 1,
				skipped: 0,
				failed: 0,
				nativeAttachments: [
					{ title: "Related Sentry Issue", url: "https://sentry.io/issue/789" },
				],
			};

			const manifest = (edgeWorker as any).generateAttachmentManifest(
				downloadResult,
			);

			// Should include all sections
			expect(manifest).toContain("### Linear Issue Links");
			expect(manifest).toContain("Related Sentry Issue");
			expect(manifest).toContain("### Images");
			expect(manifest).toContain("image_1.png");
			expect(manifest).toContain("### Other Attachments");
			expect(manifest).toContain("attachment_1.pdf");
		});
	});
});
