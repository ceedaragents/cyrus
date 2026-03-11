import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	containsAuthError,
	handleTestMcp,
} from "../../src/handlers/testMcp.js";
import type { TestMcpPayload } from "../../src/types.js";

// Mock the MCP SDK modules
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn(),
	getDefaultEnvironment: vi.fn(() => ({ PATH: "/usr/bin", HOME: "/home" })),
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: vi.fn(),
}));

describe("containsAuthError", () => {
	it("should detect 'unauthorized' (case insensitive)", () => {
		expect(containsAuthError("Error: Unauthorized")).toBe(true);
		expect(containsAuthError("UNAUTHORIZED")).toBe(true);
		expect(containsAuthError("unauthorised")).toBe(true);
	});

	it("should detect 'invalid key' variants", () => {
		expect(containsAuthError("invalid key")).toBe(true);
		expect(containsAuthError("invalid_key")).toBe(true);
		expect(containsAuthError("invalid-key")).toBe(true);
		expect(containsAuthError("Invalid API key")).toBe(true);
		expect(containsAuthError("invalid_api_key")).toBe(true);
		expect(containsAuthError("invalid-api-key")).toBe(true);
	});

	it("should detect 'authentication failed'", () => {
		expect(containsAuthError("authentication failed")).toBe(true);
		expect(containsAuthError("Authentication Failed")).toBe(true);
	});

	it("should detect auth error variations", () => {
		expect(containsAuthError("auth error")).toBe(true);
		expect(containsAuthError("authentication error")).toBe(true);
		expect(containsAuthError("authorization error")).toBe(true);
	});

	it("should detect HTTP status codes", () => {
		expect(containsAuthError("HTTP 401")).toBe(true);
		expect(containsAuthError("status: 403")).toBe(true);
	});

	it("should detect 'forbidden'", () => {
		expect(containsAuthError("Forbidden")).toBe(true);
	});

	it("should detect 'invalid token'", () => {
		expect(containsAuthError("invalid token")).toBe(true);
		expect(containsAuthError("invalid_token")).toBe(true);
	});

	it("should detect 'access denied'", () => {
		expect(containsAuthError("access denied")).toBe(true);
		expect(containsAuthError("Access_Denied")).toBe(true);
	});

	it("should detect 'permission denied'", () => {
		expect(containsAuthError("permission denied")).toBe(true);
	});

	it("should detect 'credentials invalid'", () => {
		expect(containsAuthError("credentials are invalid")).toBe(true);
		expect(containsAuthError("credential invalid")).toBe(true);
	});

	it("should detect 'api key is invalid'", () => {
		expect(containsAuthError("api key is invalid")).toBe(true);
		expect(containsAuthError("api_key invalid")).toBe(true);
	});

	it("should detect 'not authorized'", () => {
		expect(containsAuthError("not authorized")).toBe(true);
		expect(containsAuthError("not authorised")).toBe(true);
	});

	it("should NOT match normal output", () => {
		expect(containsAuthError("Server started successfully")).toBe(false);
		expect(containsAuthError("Listening on port 3000")).toBe(false);
		expect(containsAuthError("Connected to database")).toBe(false);
	});
});

describe("handleTestMcp", () => {
	let mockClient: {
		connect: ReturnType<typeof vi.fn>;
		listTools: ReturnType<typeof vi.fn>;
		close: ReturnType<typeof vi.fn>;
		getServerVersion: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockClient = {
			connect: vi.fn(),
			listTools: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
			getServerVersion: vi.fn().mockReturnValue({
				name: "test-server",
				version: "1.0.0",
			}),
		};

		vi.mocked(Client).mockImplementation(() => mockClient as any);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("validation", () => {
		it("should reject missing transport type", async () => {
			const result = await handleTestMcp({} as TestMcpPayload);
			expect(result).toEqual({
				success: false,
				error: "MCP test requires transport type",
			});
		});

		it("should reject stdio without command", async () => {
			const result = await handleTestMcp({
				transportType: "stdio",
			});
			expect(result).toEqual({
				success: false,
				error: "MCP stdio transport requires a command",
			});
		});

		it("should reject http without server URL", async () => {
			const result = await handleTestMcp({
				transportType: "http",
			});
			expect(result).toEqual({
				success: false,
				error: "MCP HTTP/SSE transport requires a server URL",
			});
		});

		it("should reject unsupported transport type", async () => {
			const result = await handleTestMcp({
				transportType: "grpc" as any,
			});
			expect(result).toEqual({
				success: false,
				error: "Unsupported transport type: grpc",
			});
		});
	});

	describe("stdio transport — successful connection", () => {
		it("should return discovered tools on success", async () => {
			const stderrStream = new PassThrough();

			vi.mocked(StdioClientTransport).mockImplementation(
				() =>
					({
						stderr: stderrStream,
						onclose: null,
						start: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			mockClient.connect.mockResolvedValue(undefined);
			mockClient.listTools.mockResolvedValue({
				tools: [
					{ name: "tool1", description: "First tool" },
					{ name: "tool2", description: "Second tool" },
				],
			});

			const result = await handleTestMcp({
				transportType: "stdio",
				command: "node",
				commandArgs: [{ value: "server.js", order: 0 }],
			});

			expect(result.success).toBe(true);
			expect(result.data.tools).toHaveLength(2);
			expect(result.message).toContain("discovered 2 tool(s)");
		});
	});

	describe("stdio transport — stderr auth error detection", () => {
		it("should fail immediately when stderr contains auth error", async () => {
			const stderrStream = new PassThrough();

			vi.mocked(StdioClientTransport).mockImplementation(
				() =>
					({
						stderr: stderrStream,
						onclose: null,
						start: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			// Make connect hang forever so we can test that stderr wins the race
			mockClient.connect.mockImplementation(
				() => new Promise(() => {}), // never resolves
			);

			const resultPromise = handleTestMcp({
				transportType: "stdio",
				command: "stripe-mcp",
			});

			// Simulate auth error on stderr after a small delay
			await new Promise((r) => setTimeout(r, 10));
			stderrStream.write(
				"Error: Invalid API key provided: sk_test_****invalid\n",
			);

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain("authentication error");
			expect(result.error).toContain("Invalid API key");
		});

		it("should fail immediately when stderr contains 401", async () => {
			const stderrStream = new PassThrough();

			vi.mocked(StdioClientTransport).mockImplementation(
				() =>
					({
						stderr: stderrStream,
						onclose: null,
						start: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			mockClient.connect.mockImplementation(() => new Promise(() => {}));

			const resultPromise = handleTestMcp({
				transportType: "stdio",
				command: "some-mcp",
			});

			await new Promise((r) => setTimeout(r, 10));
			stderrStream.write("HTTP 401 Unauthorized\n");

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain("authentication error");
		});
	});

	describe("stdio transport — process exit detection", () => {
		it("should fail immediately when process exits with stderr output", async () => {
			const stderrStream = new PassThrough();
			let capturedOnClose: (() => void) | null = null;

			vi.mocked(StdioClientTransport).mockImplementation(() => {
				const transport = {
					stderr: stderrStream,
					_onclose: null as (() => void) | null,
					get onclose() {
						return this._onclose;
					},
					set onclose(fn: (() => void) | null) {
						this._onclose = fn;
						capturedOnClose = fn;
					},
					start: vi.fn().mockResolvedValue(undefined),
				};
				return transport as any;
			});

			mockClient.connect.mockImplementation(() => new Promise(() => {}));

			const resultPromise = handleTestMcp({
				transportType: "stdio",
				command: "bad-mcp",
			});

			// Simulate stderr output followed by process exit
			await new Promise((r) => setTimeout(r, 10));
			stderrStream.write("Error: missing required configuration\n");

			// Trigger process close
			await new Promise((r) => setTimeout(r, 10));
			capturedOnClose?.();

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain("MCP process exited unexpectedly");
			expect(result.error).toContain("missing required configuration");
		});

		it("should fail with generic message when process exits without stderr", async () => {
			const stderrStream = new PassThrough();
			let capturedOnClose: (() => void) | null = null;

			vi.mocked(StdioClientTransport).mockImplementation(() => {
				const transport = {
					stderr: stderrStream,
					_onclose: null as (() => void) | null,
					get onclose() {
						return this._onclose;
					},
					set onclose(fn: (() => void) | null) {
						this._onclose = fn;
						capturedOnClose = fn;
					},
					start: vi.fn().mockResolvedValue(undefined),
				};
				return transport as any;
			});

			mockClient.connect.mockImplementation(() => new Promise(() => {}));

			const resultPromise = handleTestMcp({
				transportType: "stdio",
				command: "bad-mcp",
			});

			await new Promise((r) => setTimeout(r, 10));
			capturedOnClose?.();

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain(
				"MCP process exited unexpectedly before completing the test",
			);
		});
	});

	describe("stdio transport — timeout with stderr context", () => {
		it("should include stderr in timeout error message", async () => {
			const stderrStream = new PassThrough();

			vi.mocked(StdioClientTransport).mockImplementation(
				() =>
					({
						stderr: stderrStream,
						onclose: null,
						start: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			// Connect succeeds but listTools hangs
			mockClient.connect.mockResolvedValue(undefined);
			mockClient.listTools.mockImplementation(() => new Promise(() => {}));

			const resultPromise = handleTestMcp({
				transportType: "stdio",
				command: "slow-mcp",
			});

			// Write non-auth stderr (won't trigger early failure but should be captured)
			await new Promise((r) => setTimeout(r, 10));
			stderrStream.write("Warning: slow startup detected\n");

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.error).toContain("Tool listing timed out");
			expect(result.error).toContain("slow startup detected");
		}, 15_000);
	});

	describe("http transport", () => {
		it("should connect and discover tools for HTTP transport", async () => {
			vi.mocked(StreamableHTTPClientTransport).mockImplementation(
				() =>
					({
						start: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			mockClient.connect.mockResolvedValue(undefined);
			mockClient.listTools.mockResolvedValue({
				tools: [{ name: "http-tool", description: "An HTTP tool" }],
			});

			const result = await handleTestMcp({
				transportType: "http",
				serverUrl: "https://example.com/mcp",
			});

			expect(result.success).toBe(true);
			expect(result.data.tools).toHaveLength(1);
		});

		it("should substitute env vars in URL and headers", async () => {
			let capturedUrl: URL | undefined;

			vi.mocked(StreamableHTTPClientTransport).mockImplementation(
				(url: URL) => {
					capturedUrl = url;
					return {
						start: vi.fn().mockResolvedValue(undefined),
					} as any;
				},
			);

			mockClient.connect.mockResolvedValue(undefined);
			mockClient.listTools.mockResolvedValue({ tools: [] });

			const serverUrl = "https://example.com/" + "${API_KEY}" + "/mcp";
			await handleTestMcp({
				transportType: "http",
				serverUrl,
				envVars: [{ key: "API_KEY", value: "my-secret-key" }],
			});

			expect(capturedUrl?.toString()).toBe(
				"https://example.com/my-secret-key/mcp",
			);
		});
	});
});
