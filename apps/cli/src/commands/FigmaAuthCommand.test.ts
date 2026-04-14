import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Use vi.hoisted to create mock functions that can be used in vi.mock
const mocks = vi.hoisted(() => ({
	mockReadFileSync: vi.fn(),
	mockWriteFileSync: vi.fn(),
	mockOpen: vi.fn(),
	mockFetch: vi.fn(),
	mockFastifyInstance: {
		get: vi.fn(),
		listen: vi.fn(),
		close: vi.fn(),
	},
	mockFastify: vi.fn(),
}));

// Mock modules
vi.mock("node:fs", () => ({
	readFileSync: mocks.mockReadFileSync,
	writeFileSync: mocks.mockWriteFileSync,
}));

vi.mock("fastify", () => ({
	default: mocks.mockFastify,
}));

vi.mock("open", () => ({
	default: mocks.mockOpen,
}));

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
	throw new Error("process.exit called");
});

// Mock console methods
const mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
const _mockConsoleError = vi
	.spyOn(console, "error")
	.mockImplementation(() => {});

// Import after mocks
import { FigmaAuthCommand } from "./FigmaAuthCommand.js";

type RouteHandler = (...args: unknown[]) => unknown;

// Mock Application
const createMockApp = () => ({
	cyrusHome: "/home/user/.cyrus",
	config: {
		exists: vi.fn().mockReturnValue(true),
		load: vi.fn(),
		update: vi.fn(),
	},
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		success: vi.fn(),
		divider: vi.fn(),
	},
});

describe("FigmaAuthCommand", () => {
	let mockApp: ReturnType<typeof createMockApp>;
	let command: FigmaAuthCommand;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = createMockApp();
		command = new FigmaAuthCommand(mockApp as any);
		originalEnv = { ...process.env };

		delete process.env.CLOUDFLARE_TOKEN;

		mocks.mockFastifyInstance.get.mockReset();
		mocks.mockFastifyInstance.listen.mockReset();
		mocks.mockFastifyInstance.close.mockReset();

		mocks.mockFastify.mockReturnValue(mocks.mockFastifyInstance);
		mocks.mockFastifyInstance.listen.mockResolvedValue(undefined);
		mocks.mockFastifyInstance.close.mockResolvedValue(undefined);
		mocks.mockOpen.mockResolvedValue(undefined);

		global.fetch = mocks.mockFetch;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe("Environment Variable Validation", () => {
		it("should error when FIGMA_CLIENT_ID is missing", async () => {
			delete process.env.FIGMA_CLIENT_ID;
			process.env.FIGMA_CLIENT_SECRET = "test-secret";
			process.env.CYRUS_BASE_URL = "https://example.com";

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockConsoleLog).toHaveBeenCalledWith(
				expect.stringContaining("FIGMA_CLIENT_ID"),
			);
		});

		it("should error when FIGMA_CLIENT_SECRET is missing", async () => {
			process.env.FIGMA_CLIENT_ID = "test-client-id";
			delete process.env.FIGMA_CLIENT_SECRET;
			process.env.CYRUS_BASE_URL = "https://example.com";

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockConsoleLog).toHaveBeenCalledWith(
				expect.stringContaining("FIGMA_CLIENT_SECRET"),
			);
		});

		it("should error when CYRUS_BASE_URL is missing", async () => {
			process.env.FIGMA_CLIENT_ID = "test-client-id";
			process.env.FIGMA_CLIENT_SECRET = "test-secret";
			delete process.env.CYRUS_BASE_URL;

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
			expect(mockConsoleLog).toHaveBeenCalledWith(
				expect.stringContaining("CYRUS_BASE_URL"),
			);
		});
	});

	describe("Config File Validation", () => {
		it("should error when config file does not exist", async () => {
			process.env.FIGMA_CLIENT_ID = "test-client-id";
			process.env.FIGMA_CLIENT_SECRET = "test-secret";
			process.env.CYRUS_BASE_URL = "https://example.com";

			mocks.mockReadFileSync.mockImplementation(() => {
				throw new Error("ENOENT: no such file or directory");
			});

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
		});
	});

	describe("OAuth Flow", () => {
		beforeEach(() => {
			process.env.FIGMA_CLIENT_ID = "test-figma-client-id";
			process.env.FIGMA_CLIENT_SECRET = "test-figma-secret";
			process.env.CYRUS_BASE_URL = "https://example.com";

			mocks.mockReadFileSync.mockReturnValue(
				JSON.stringify({
					repositories: [
						{
							id: "repo-1",
							name: "test-repo",
						},
					],
				}),
			);
		});

		it("should open browser with Figma OAuth URL", async () => {
			let routeHandler: RouteHandler;

			mocks.mockFastifyInstance.get.mockImplementation(
				(_path: string, handler: RouteHandler) => {
					routeHandler = handler;
				},
			);

			mocks.mockFastifyInstance.listen.mockImplementation(async () => {
				setTimeout(async () => {
					const mockRequest = {
						query: { code: "test-figma-code", state: "figma" },
					};
					const mockReply = {
						type: vi.fn().mockReturnThis(),
						code: vi.fn().mockReturnThis(),
						send: vi.fn().mockReturnThis(),
					};
					await routeHandler(mockRequest, mockReply);
				}, 10);
			});

			mocks.mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						access_token: "figma-access-token-123",
						refresh_token: "figma-refresh-token-456",
						expires_in: 7776000,
					}),
			});

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(0); // Success exit

			expect(mocks.mockOpen).toHaveBeenCalledWith(
				expect.stringContaining("https://www.figma.com/oauth"),
			);
			expect(mocks.mockOpen).toHaveBeenCalledWith(
				expect.stringContaining("client_id=test-figma-client-id"),
			);
		});

		it("should save figmaToken to config.json on success", async () => {
			let routeHandler: RouteHandler;

			mocks.mockFastifyInstance.get.mockImplementation(
				(_path: string, handler: RouteHandler) => {
					routeHandler = handler;
				},
			);

			mocks.mockFastifyInstance.listen.mockImplementation(async () => {
				setTimeout(async () => {
					const mockRequest = {
						query: { code: "test-figma-code", state: "figma" },
					};
					const mockReply = {
						type: vi.fn().mockReturnThis(),
						code: vi.fn().mockReturnThis(),
						send: vi.fn().mockReturnThis(),
					};
					await routeHandler(mockRequest, mockReply);
				}, 10);
			});

			mocks.mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						access_token: "figma-access-token-123",
					}),
			});

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(0);

			// Verify the config was written with the figmaToken
			expect(mocks.mockWriteFileSync).toHaveBeenCalled();
			const writtenConfig = JSON.parse(
				mocks.mockWriteFileSync.mock.calls[0][1],
			);
			expect(writtenConfig.figmaToken).toBe("figma-access-token-123");
		});

		it("should exchange code at Figma token endpoint", async () => {
			let routeHandler: RouteHandler;

			mocks.mockFastifyInstance.get.mockImplementation(
				(_path: string, handler: RouteHandler) => {
					routeHandler = handler;
				},
			);

			mocks.mockFastifyInstance.listen.mockImplementation(async () => {
				setTimeout(async () => {
					const mockRequest = {
						query: { code: "test-figma-code", state: "figma" },
					};
					const mockReply = {
						type: vi.fn().mockReturnThis(),
						code: vi.fn().mockReturnThis(),
						send: vi.fn().mockReturnThis(),
					};
					await routeHandler(mockRequest, mockReply);
				}, 10);
			});

			mocks.mockFetch.mockResolvedValueOnce({
				ok: true,
				json: () =>
					Promise.resolve({
						access_token: "figma-access-token-123",
					}),
			});

			await expect(command.execute([])).rejects.toThrow("process.exit called");

			// Verify the token exchange request
			expect(mocks.mockFetch).toHaveBeenCalledWith(
				"https://api.figma.com/v1/oauth/token",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
				}),
			);

			const fetchBody = mocks.mockFetch.mock.calls[0][1].body;
			expect(fetchBody).toContain("client_id=test-figma-client-id");
			expect(fetchBody).toContain("client_secret=test-figma-secret");
			expect(fetchBody).toContain("code=test-figma-code");
			expect(fetchBody).toContain("grant_type=authorization_code");
		});

		it("should handle token exchange failure", async () => {
			let routeHandler: RouteHandler;

			mocks.mockFastifyInstance.get.mockImplementation(
				(_path: string, handler: RouteHandler) => {
					routeHandler = handler;
				},
			);

			mocks.mockFastifyInstance.listen.mockImplementation(async () => {
				setTimeout(async () => {
					const mockRequest = {
						query: { code: "test-figma-code", state: "figma" },
					};
					const mockReply = {
						type: vi.fn().mockReturnThis(),
						code: vi.fn().mockReturnThis(),
						send: vi.fn().mockReturnThis(),
					};
					await routeHandler(mockRequest, mockReply);
				}, 10);
			});

			mocks.mockFetch.mockResolvedValueOnce({
				ok: false,
				text: () => Promise.resolve("invalid_grant"),
			});

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it("should handle OAuth error callback", async () => {
			let routeHandler: RouteHandler;

			mocks.mockFastifyInstance.get.mockImplementation(
				(_path: string, handler: RouteHandler) => {
					routeHandler = handler;
				},
			);

			mocks.mockFastifyInstance.listen.mockImplementation(async () => {
				setTimeout(async () => {
					const mockRequest = {
						query: { error: "access_denied" },
					};
					const mockReply = {
						type: vi.fn().mockReturnThis(),
						code: vi.fn().mockReturnThis(),
						send: vi.fn().mockReturnThis(),
					};
					await routeHandler(mockRequest, mockReply);
				}, 10);
			});

			await expect(command.execute([])).rejects.toThrow("process.exit called");
			expect(mockExit).toHaveBeenCalledWith(1);
		});
	});
});
