import { LinearEventTransport } from "cyrus-linear-event-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	mkdir: vi.fn(),
	rename: vi.fn(),
	readdir: vi.fn(),
}));

// Mock dependencies
vi.mock("cyrus-claude-runner");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});
vi.mock("cyrus-linear-event-transport");
vi.mock("file-type");

describe("EdgeWorker - Status Endpoint", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockFastify: any;
	let registeredRoutes: Map<string, { method: string; handler: any }>;
	let mockAgentSessionManager: any;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read", "Edit"],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		registeredRoutes = new Map();

		// Mock console methods
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});

		// Create mock Fastify instance that captures route registrations
		mockFastify = {
			get: vi.fn((path: string, handler: any) => {
				registeredRoutes.set(path, { method: "GET", handler });
			}),
			post: vi.fn((path: string, handler: any) => {
				registeredRoutes.set(path, { method: "POST", handler });
			}),
			delete: vi.fn((path: string, handler: any) => {
				registeredRoutes.set(`${path}:DELETE`, { method: "DELETE", handler });
			}),
		};

		// Mock SharedApplicationServer
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					getFastifyInstance: vi.fn().mockReturnValue(mockFastify),
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					getWebhookUrl: vi
						.fn()
						.mockReturnValue("http://localhost:3456/webhook"),
				}) as any,
		);

		// Mock AgentSessionManager with empty sessions by default
		mockAgentSessionManager = {
			getActiveSessions: vi.fn().mockReturnValue([]),
			getAllSessions: vi.fn().mockReturnValue([]),
			getAllAgentRunners: vi.fn().mockReturnValue([]),
			serializeState: vi.fn().mockReturnValue({ sessions: {}, entries: {} }),
			restoreState: vi.fn(),
			on: vi.fn(), // EventEmitter method
		};

		vi.mocked(AgentSessionManager).mockImplementation(
			() => mockAgentSessionManager as any,
		);

		// Mock LinearEventTransport
		vi.mocked(LinearEventTransport).mockImplementation(
			() =>
				({
					register: vi.fn(),
					on: vi.fn(),
					removeAllListeners: vi.fn(),
				}) as any,
		);

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			webhookPort: 3456,
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [mockRepository],
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getActiveSessionCount", () => {
		it("should return 0 when there are no running agent runners", () => {
			mockAgentSessionManager.getAllAgentRunners.mockReturnValue([]);

			const count = edgeWorker.getActiveSessionCount();

			expect(count).toBe(0);
		});

		it("should return correct count when there are running agent runners", () => {
			// Mock 2 running agent runners
			mockAgentSessionManager.getAllAgentRunners.mockReturnValue([
				{ id: "runner-1" },
				{ id: "runner-2" },
			]);

			const count = edgeWorker.getActiveSessionCount();

			expect(count).toBe(2);
		});
	});

	describe("/status endpoint registration", () => {
		it("should register /status GET endpoint during initialization", async () => {
			await edgeWorker.start();

			expect(mockFastify.get).toHaveBeenCalledWith(
				"/status",
				expect.any(Function),
			);
		});
	});

	describe("/status endpoint response", () => {
		it('should return status "idle" and active_tasks 0 when no agent runners are running', async () => {
			mockAgentSessionManager.getAllAgentRunners.mockReturnValue([]);
			await edgeWorker.start();

			// Get the registered handler
			const route = registeredRoutes.get("/status");
			expect(route).toBeDefined();
			expect(route?.method).toBe("GET");

			// Create mock request and reply
			const mockRequest = {};
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the handler
			await route?.handler(mockRequest, mockReply);

			expect(mockReply.status).toHaveBeenCalledWith(200);
			expect(mockReply.send).toHaveBeenCalledWith({
				status: "idle",
				active_tasks: 0,
			});
		});

		it('should return status "busy" and correct active_tasks when agent runners are running', async () => {
			// Mock 3 running agent runners
			mockAgentSessionManager.getAllAgentRunners.mockReturnValue([
				{ id: "runner-1" },
				{ id: "runner-2" },
				{ id: "runner-3" },
			]);

			await edgeWorker.start();

			// Get the registered handler
			const route = registeredRoutes.get("/status");
			expect(route).toBeDefined();

			// Create mock request and reply
			const mockRequest = {};
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the handler
			await route?.handler(mockRequest, mockReply);

			expect(mockReply.status).toHaveBeenCalledWith(200);
			expect(mockReply.send).toHaveBeenCalledWith({
				status: "busy",
				active_tasks: 3,
			});
		});

		it('should return status "busy" when even one agent runner is running', async () => {
			// Mock 1 running agent runner
			mockAgentSessionManager.getAllAgentRunners.mockReturnValue([
				{ id: "runner-1" },
			]);

			await edgeWorker.start();

			// Get the registered handler
			const route = registeredRoutes.get("/status");
			expect(route).toBeDefined();

			// Create mock request and reply
			const mockRequest = {};
			const mockReply = {
				status: vi.fn().mockReturnThis(),
				send: vi.fn().mockReturnThis(),
			};

			// Call the handler
			await route?.handler(mockRequest, mockReply);

			expect(mockReply.status).toHaveBeenCalledWith(200);
			expect(mockReply.send).toHaveBeenCalledWith({
				status: "busy",
				active_tasks: 1,
			});
		});
	});
});
