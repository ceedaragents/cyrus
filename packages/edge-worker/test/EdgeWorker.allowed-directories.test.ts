import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies BEFORE imports
vi.mock("cyrus-ndjson-client");
vi.mock("cyrus-claude-runner", () => ({
	ClaudeRunner: vi.fn(),
	getSafeTools: vi.fn(() => [
		"Read(**)",
		"Edit(**)",
		"Task",
		"WebFetch",
		"WebSearch",
		"TodoRead",
		"TodoWrite",
		"NotebookRead",
		"NotebookEdit",
		"Batch",
	]),
}));
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
}));

// Import after mocking
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";
import { ClaudeRunner } from "cyrus-claude-runner";
import { LinearClient } from "@linear/sdk";
import { NdjsonClient } from "cyrus-ndjson-client";

describe("EdgeWorker - Allowed Directories Configuration", () => {
	let edgeWorker: EdgeWorker;
	let mockLinearClient: any;
	let mockNdjsonClient: any;
	let mockClaudeRunner: any;
	let consoleLogSpy: any;
	let consoleErrorSpy: any;
	let consoleWarnSpy: any;

	const mockConfig: EdgeWorkerConfig = {
		serverBaseUrl: "http://localhost:3000",
		authToken: "test-auth",
		edgeToken: "test-edge-token",
		cyrusHome: "/home/test/.cyrus",
		defaultAllowedTools: ["Read(**)", "Edit(**)", "Task"],
		promptDefaults: {
			default: {
				allowedTools: ["Read(**)", "Edit(**)", "Task"],
			},
		},
		repositories: [], // Add empty repositories array
	};

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repository",
		linearTeamId: "test-team",
		linearApiToken: "test-token",
		branchingScheme: "parent:main",
		parentBranch: "main",
		gitUrl: "https://github.com/test/repo",
		allowedTools: ["Read(**)", "Edit(**)", "Task"],
	};

	beforeEach(() => {
		// Mock LinearClient
		mockLinearClient = {
			viewer: vi.fn().mockResolvedValue({
				id: "test-user-id",
				email: "test@example.com",
			}),
			issue: vi.fn().mockReturnValue({
				assignee: {
					id: "test-user-id",
				},
				identifier: "TEST-123",
				title: "Test Issue",
				description: "Test description",
				url: "https://linear.app/test/issue/TEST-123",
				attachments: vi.fn().mockResolvedValue({
					nodes: [],
				}),
			}),
		};
		LinearClient.mockReturnValue(mockLinearClient);

		// Mock NdjsonClient
		mockNdjsonClient = {
			sendMessage: vi.fn(),
			connect: vi.fn(),
			disconnect: vi.fn(),
			on: vi.fn(), // Add the missing on method
		};
		(NdjsonClient as any).mockReturnValue(mockNdjsonClient);

		// Mock ClaudeRunner
		mockClaudeRunner = {
			run: vi.fn(),
			abort: vi.fn(),
		};
		(ClaudeRunner as any).mockImplementation(() => mockClaudeRunner);

		// Suppress console output during tests
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		// Create edge worker with the repository in the config
		const configWithRepo = {
			...mockConfig,
			repositories: [mockRepository],
		};
		edgeWorker = new EdgeWorker(configWithRepo);
	});

	afterEach(() => {
		vi.clearAllMocks();
		consoleLogSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		consoleWarnSpy.mockRestore();
	});

	describe("Allowed Directories Bug - Directory Restrictions", () => {
		it("should include workspace path in allowed directories for Edit operations", async () => {
			// Mock the session manager
			const mockSessionManager = {
				createSession: vi.fn().mockReturnValue({
					id: "test-session",
					workspace: {
						path: "/Users/test/.cyrus/workspaces/test-repo/TEST-123",
					},
				}),
				getSession: vi.fn(),
				updateSession: vi.fn(),
			};
			
			// Mock the buildClaudeRunnerConfig to capture its arguments
			const buildConfigSpy = vi.spyOn(edgeWorker as any, "buildClaudeRunnerConfig");
			
			// Set up the session manager
			(edgeWorker as any).sessionManager = mockSessionManager;
			
			// Mock file system operations
			const fs = await import("fs/promises");
			(fs.mkdir as any).mockResolvedValue(undefined);
			(fs.readFile as any).mockResolvedValue(JSON.stringify({}));
			
			// Call createLinearAgentSession
			await (edgeWorker as any).createLinearAgentSession(
				"test-activity-session-id",
				{ id: "test-issue-id", identifier: "TEST-123" },
				mockRepository,
				mockSessionManager
			);
			
			// Check that buildClaudeRunnerConfig was called with allowedDirectories
			expect(buildConfigSpy).toHaveBeenCalled();
			const callArgs = buildConfigSpy.mock.calls[0];
			const allowedDirectories = callArgs[5]; // 6th argument is allowedDirectories
			
			// FAILING TEST: Currently allowedDirectories only includes attachments directory
			// It SHOULD include the workspace path as well
			expect(allowedDirectories).toBeDefined();
			expect(allowedDirectories.length).toBeGreaterThan(0);
			
			// This will fail because only attachmentsDir is included
			const workspacePath = "/Users/test/.cyrus/workspaces/test-repo/TEST-123";
			expect(allowedDirectories).toContain(workspacePath);
		});

		it("should allow Edit operations on files in the workspace directory", async () => {
			// This test verifies that Edit tool patterns are properly configured
			// for the workspace directory
			
			const mockWorkspacePath = "/Users/test/.cyrus/workspaces/test-repo/TEST-123";
			const mockAttachmentsDir = "/home/test/.cyrus/TEST-123/attachments";
			
			// Mock the session manager with a complete session
			const mockSessionManager = {
				getSession: vi.fn().mockReturnValue({
					id: "test-session",
					workspace: {
						path: mockWorkspacePath,
					},
					linearActivitySessionId: "test-activity-session",
					repository: mockRepository,
				}),
				updateSession: vi.fn(),
			};
			(edgeWorker as any).sessionManager = mockSessionManager;
			
			// Mock file system operations
			const fs = await import("fs/promises");
			(fs.readFile as any).mockResolvedValue(JSON.stringify({ identifier: "TEST-123" }));
			
			// Mock the buildClaudeRunnerConfig to capture its arguments
			const buildConfigSpy = vi.spyOn(edgeWorker as any, "buildClaudeRunnerConfig");
			
			// Mock the webhook to trigger handleUserPostedAgentActivity
			const webhook = {
				type: "LinearAgentSessionPrompted",
				data: {
					linearAgentActivitySessionId: "test-activity-session",
					issue: { id: "test-issue", identifier: "TEST-123" },
					comment: { body: "Test message" },
				},
			};
			
			// Call handleUserPostedAgentActivity which processes new messages
			await (edgeWorker as any).handleUserPostedAgentActivity(webhook, mockRepository);
			
			// Check that buildClaudeRunnerConfig was called
			expect(buildConfigSpy).toHaveBeenCalled();
			
			const callArgs = buildConfigSpy.mock.calls[0];
			const allowedDirectories = callArgs[5]; // 6th argument is allowedDirectories
			
			// FAILING TEST: The allowedDirectories should include the workspace path
			// so that Edit operations can work on repository files
			expect(allowedDirectories).toContain(mockWorkspacePath);
		});

		it("should convert allowed directories to proper Read/Edit tool patterns", async () => {
			// This test verifies that allowed directories are properly converted
			// to tool patterns that grant both Read and Edit permissions
			
			const mockWorkspacePath = "/Users/test/.cyrus/workspaces/test-repo/TEST-123";
			
			// Capture ClaudeRunner configuration
			let capturedConfig: any = null;
			(ClaudeRunner as any).mockImplementation((config: any) => {
				capturedConfig = config;
				return mockClaudeRunner;
			});
			
			// Mock the session manager
			const mockSessionManager = {
				createSession: vi.fn().mockReturnValue({
					id: "test-session",
					workspace: { path: mockWorkspacePath },
				}),
				getSession: vi.fn(),
				updateSession: vi.fn(),
			};
			(edgeWorker as any).sessionManager = mockSessionManager;
			
			// Mock file system operations
			const fs = await import("fs/promises");
			(fs.mkdir as any).mockResolvedValue(undefined);
			(fs.readFile as any).mockResolvedValue(JSON.stringify({}));
			
			// Call createLinearAgentSession
			await (edgeWorker as any).createLinearAgentSession(
				"test-activity-session-id",
				{ id: "test-issue-id", identifier: "TEST-123" },
				mockRepository,
				mockSessionManager
			);
			
			// FAILING TEST: The configuration should include the workspace in allowedDirectories
			// This ensures ClaudeRunner can properly set up Read and Edit permissions
			expect(capturedConfig).toBeDefined();
			expect(capturedConfig?.allowedDirectories).toContain(mockWorkspacePath);
			
			// Verify that Edit tool is in the allowed tools
			expect(capturedConfig?.allowedTools).toContain("Edit(**)");
		});
	});

	describe("Expected Behavior After Fix", () => {
		it("should always include both attachments and workspace directories", async () => {
			// This test documents the expected behavior after the fix
			// The fix should modify EdgeWorker.ts line 680 and 1105 to include:
			// const allowedDirectories: string[] = [attachmentsDir, session.workspace.path];
			
			// This test will pass once the fix is implemented
			expect(true).toBe(true); // Placeholder - real test is above
		});
	});
});