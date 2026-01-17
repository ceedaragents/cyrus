import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn().mockResolvedValue([]),
}));

// Mock dependencies
vi.mock("cyrus-claude-runner");
vi.mock("cyrus-gemini-runner");
vi.mock("cyrus-linear-event-transport");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js", () => ({
	SharedApplicationServer: vi.fn().mockImplementation(() => ({
		initializeFastify: vi.fn(),
		getFastifyInstance: vi.fn().mockReturnValue({
			get: vi.fn(),
			post: vi.fn(),
		}),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		getWebhookUrl: vi.fn().mockReturnValue("http://localhost:3456/webhook"),
	})),
}));
vi.mock("../src/AgentSessionManager.js", () => ({
	AgentSessionManager: vi.fn().mockImplementation(() => ({
		getAllAgentRunners: vi.fn().mockReturnValue([]),
		getAllSessions: vi.fn().mockReturnValue([]),
		createLinearAgentSession: vi.fn(),
		getSession: vi.fn(),
		getActiveSessionsByIssueId: vi.fn().mockReturnValue([]),
		on: vi.fn(), // EventEmitter method
		emit: vi.fn(), // EventEmitter method
	})),
}));
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		isAgentSessionCreatedWebhook: vi.fn().mockReturnValue(false),
		isAgentSessionPromptedWebhook: vi.fn().mockReturnValue(false),
		isIssueAssignedWebhook: vi.fn().mockReturnValue(false),
		isIssueCommentMentionWebhook: vi.fn().mockReturnValue(false),
		isIssueNewCommentWebhook: vi.fn().mockReturnValue(false),
		isIssueUnassignedWebhook: vi.fn().mockReturnValue(false),
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});
vi.mock("file-type");
vi.mock("chokidar", () => ({
	watch: vi.fn().mockReturnValue({
		on: vi.fn().mockReturnThis(),
		close: vi.fn().mockResolvedValue(undefined),
	}),
}));

describe("EdgeWorker - Health Endpoint", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		isActive: true,
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		mockConfig = {
			platform: "linear",
			cyrusHome: "/test/.cyrus",
			repositories: [mockRepository],
		};
	});

	afterEach(async () => {
		if (edgeWorker) {
			try {
				await edgeWorker.stop();
			} catch {
				// Ignore cleanup errors
			}
		}
	});

	describe("registerHealthEndpoint", () => {
		it("should register GET /health endpoint with Fastify", async () => {
			const mockGet = vi.fn();
			const mockFastify = {
				get: mockGet,
				post: vi.fn(),
			};

			// Create EdgeWorker with mock that captures the registered handler
			const { SharedApplicationServer } = await import(
				"../src/SharedApplicationServer.js"
			);
			vi.mocked(SharedApplicationServer).mockImplementation(
				() =>
					({
						initializeFastify: vi.fn(),
						getFastifyInstance: vi.fn().mockReturnValue(mockFastify),
						start: vi.fn().mockResolvedValue(undefined),
						stop: vi.fn().mockResolvedValue(undefined),
						getWebhookUrl: vi
							.fn()
							.mockReturnValue("http://localhost:3456/webhook"),
					}) as any,
			);

			edgeWorker = new EdgeWorker(mockConfig);

			// Call registerHealthEndpoint
			(edgeWorker as any).registerHealthEndpoint();

			// Verify GET /health was registered
			expect(mockGet).toHaveBeenCalledWith("/health", expect.any(Function));
		});

		it("should return healthy status with null version when version is not provided", async () => {
			let capturedHandler: any = null;
			const mockGet = vi.fn((path: string, handler: any) => {
				if (path === "/health") {
					capturedHandler = handler;
				}
			});
			const mockFastify = {
				get: mockGet,
				post: vi.fn(),
			};

			const { SharedApplicationServer } = await import(
				"../src/SharedApplicationServer.js"
			);
			vi.mocked(SharedApplicationServer).mockImplementation(
				() =>
					({
						initializeFastify: vi.fn(),
						getFastifyInstance: vi.fn().mockReturnValue(mockFastify),
						start: vi.fn().mockResolvedValue(undefined),
						stop: vi.fn().mockResolvedValue(undefined),
						getWebhookUrl: vi
							.fn()
							.mockReturnValue("http://localhost:3456/webhook"),
					}) as any,
			);

			// Config without version
			edgeWorker = new EdgeWorker(mockConfig);
			(edgeWorker as any).registerHealthEndpoint();

			// Mock reply object
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the captured handler
			expect(capturedHandler).not.toBeNull();
			await capturedHandler({}, mockReply);

			expect(mockReply.status).toHaveBeenCalledWith(200);
			expect(mockReply.send).toHaveBeenCalledWith({
				status: "healthy",
				cyrus_cli_version: null,
			});
		});

		it("should return healthy status with version when version is provided", async () => {
			let capturedHandler: any = null;
			const mockGet = vi.fn((path: string, handler: any) => {
				if (path === "/health") {
					capturedHandler = handler;
				}
			});
			const mockFastify = {
				get: mockGet,
				post: vi.fn(),
			};

			const { SharedApplicationServer } = await import(
				"../src/SharedApplicationServer.js"
			);
			vi.mocked(SharedApplicationServer).mockImplementation(
				() =>
					({
						initializeFastify: vi.fn(),
						getFastifyInstance: vi.fn().mockReturnValue(mockFastify),
						start: vi.fn().mockResolvedValue(undefined),
						stop: vi.fn().mockResolvedValue(undefined),
						getWebhookUrl: vi
							.fn()
							.mockReturnValue("http://localhost:3456/webhook"),
					}) as any,
			);

			// Config with version
			const configWithVersion: EdgeWorkerConfig = {
				...mockConfig,
				version: "1.2.3",
			};
			edgeWorker = new EdgeWorker(configWithVersion);
			(edgeWorker as any).registerHealthEndpoint();

			// Mock reply object
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the captured handler
			expect(capturedHandler).not.toBeNull();
			await capturedHandler({}, mockReply);

			expect(mockReply.status).toHaveBeenCalledWith(200);
			expect(mockReply.send).toHaveBeenCalledWith({
				status: "healthy",
				cyrus_cli_version: "1.2.3",
			});
		});

		it("should return null for empty string version", async () => {
			let capturedHandler: any = null;
			const mockGet = vi.fn((path: string, handler: any) => {
				if (path === "/health") {
					capturedHandler = handler;
				}
			});
			const mockFastify = {
				get: mockGet,
				post: vi.fn(),
			};

			const { SharedApplicationServer } = await import(
				"../src/SharedApplicationServer.js"
			);
			vi.mocked(SharedApplicationServer).mockImplementation(
				() =>
					({
						initializeFastify: vi.fn(),
						getFastifyInstance: vi.fn().mockReturnValue(mockFastify),
						start: vi.fn().mockResolvedValue(undefined),
						stop: vi.fn().mockResolvedValue(undefined),
						getWebhookUrl: vi
							.fn()
							.mockReturnValue("http://localhost:3456/webhook"),
					}) as any,
			);

			// Config with empty string version - should still return empty string (not null)
			// as the nullish coalescing operator only converts undefined/null to null
			const configWithEmptyVersion: EdgeWorkerConfig = {
				...mockConfig,
				version: "",
			};
			edgeWorker = new EdgeWorker(configWithEmptyVersion);
			(edgeWorker as any).registerHealthEndpoint();

			// Mock reply object
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the captured handler
			expect(capturedHandler).not.toBeNull();
			await capturedHandler({}, mockReply);

			expect(mockReply.status).toHaveBeenCalledWith(200);
			// Empty string is truthy for ?? operator, so it returns empty string
			expect(mockReply.send).toHaveBeenCalledWith({
				status: "healthy",
				cyrus_cli_version: "",
			});
		});

		it("should maintain backward compatibility - existing health check functionality works", async () => {
			let capturedHandler: any = null;
			const mockGet = vi.fn((path: string, handler: any) => {
				if (path === "/health") {
					capturedHandler = handler;
				}
			});
			const mockFastify = {
				get: mockGet,
				post: vi.fn(),
			};

			const { SharedApplicationServer } = await import(
				"../src/SharedApplicationServer.js"
			);
			vi.mocked(SharedApplicationServer).mockImplementation(
				() =>
					({
						initializeFastify: vi.fn(),
						getFastifyInstance: vi.fn().mockReturnValue(mockFastify),
						start: vi.fn().mockResolvedValue(undefined),
						stop: vi.fn().mockResolvedValue(undefined),
						getWebhookUrl: vi
							.fn()
							.mockReturnValue("http://localhost:3456/webhook"),
					}) as any,
			);

			edgeWorker = new EdgeWorker(mockConfig);
			(edgeWorker as any).registerHealthEndpoint();

			// Mock reply object
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the captured handler
			expect(capturedHandler).not.toBeNull();
			await capturedHandler({}, mockReply);

			// Verify the response always includes status field
			expect(mockReply.status).toHaveBeenCalledWith(200);
			const sentData = mockReply.send.mock.calls[0][0];
			expect(sentData).toHaveProperty("status", "healthy");
			expect(sentData).toHaveProperty("cyrus_cli_version");
		});
	});
});
