import { LinearClient } from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";

// Mock modules
vi.mock("@linear/sdk");

// Mock global fetch
global.fetch = vi.fn();

describe("SharedApplicationServer OAuth", () => {
	let server: SharedApplicationServer;
	let mockConfigSaveCallback: any;

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock environment variables
		process.env.LINEAR_CLIENT_ID = "test_client_id";
		process.env.LINEAR_CLIENT_SECRET = "test_client_secret";
		process.env.CYRUS_BASE_URL = "http://localhost:3456";

		// Setup config save callback spy
		mockConfigSaveCallback = vi.fn().mockResolvedValue(undefined);

		// Create server instance with positional parameters
		server = new SharedApplicationServer(
			3456,
			"localhost",
			mockConfigSaveCallback,
		);
	});

	describe("OAuth callback route", () => {
		it("should handle successful OAuth flow", async () => {
			// Mock fetch for token exchange
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: "lin_oauth_test_access_token",
					refresh_token: "lin_oauth_test_refresh_token",
					expires_in: 86400,
					token_type: "Bearer",
				}),
			} as any);

			// Mock LinearClient and viewer
			const mockLinearClient = {
				viewer: Promise.resolve({
					organization: Promise.resolve({
						id: "workspace-123",
						name: "Test Workspace",
					}),
				}),
			};
			vi.mocked(LinearClient).mockImplementation(() => mockLinearClient as any);

			// Get Fastify instance and make request
			const app = server.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback?code=test_auth_code",
			});

			expect(response.statusCode).toBe(200);
			expect(response.body).toContain("Authorization successful");
			expect(mockConfigSaveCallback).toHaveBeenCalledWith({
				linearToken: "lin_oauth_test_access_token",
				linearRefreshToken: "lin_oauth_test_refresh_token",
				linearWorkspaceId: "workspace-123",
				linearWorkspaceName: "Test Workspace",
			});
		});

		it("should return 400 when authorization code is missing", async () => {
			const app = server.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback",
			});

			expect(response.statusCode).toBe(400);
			expect(response.body).toContain("Missing authorization code");
		});

		it("should return 500 when environment variables are missing", async () => {
			delete process.env.LINEAR_CLIENT_ID;

			const testServer = new SharedApplicationServer(3457, "localhost");

			const app = testServer.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback?code=test_code",
			});

			expect(response.statusCode).toBe(500);
			expect(response.body).toContain("Configuration error");
		});

		it("should return 500 when token exchange fails", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				text: async () => "Invalid authorization code",
			} as any);

			const app = server.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback?code=invalid_code",
			});

			expect(response.statusCode).toBe(500);
			expect(response.body).toContain("Failed to exchange authorization code");
		});

		it("should return 500 when access token is invalid", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: "invalid_token_format",
					expires_in: 86400,
				}),
			} as any);

			const app = server.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback?code=test_code",
			});

			expect(response.statusCode).toBe(500);
			expect(response.body).toContain("Invalid token received");
		});

		it("should return 500 when workspace fetch fails", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: "lin_oauth_valid_token",
					refresh_token: "lin_oauth_refresh",
					expires_in: 86400,
				}),
			} as any);

			// Mock LinearClient that fails to get workspace
			const mockLinearClient = {
				viewer: Promise.resolve({
					organization: Promise.resolve(null),
				}),
			};
			vi.mocked(LinearClient).mockImplementation(() => mockLinearClient as any);

			const app = server.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback?code=test_code",
			});

			expect(response.statusCode).toBe(500);
			expect(response.body).toContain("Failed to fetch workspace information");
		});

		it("should continue even if config save fails", async () => {
			// Make config save throw an error
			mockConfigSaveCallback.mockRejectedValueOnce(
				new Error("File write error"),
			);

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					access_token: "lin_oauth_test_token",
					refresh_token: "lin_oauth_refresh",
					expires_in: 86400,
				}),
			} as any);

			const mockLinearClient = {
				viewer: Promise.resolve({
					organization: Promise.resolve({
						id: "workspace-123",
						name: "Test Workspace",
					}),
				}),
			};
			vi.mocked(LinearClient).mockImplementation(() => mockLinearClient as any);

			const app = server.getFastifyInstance();
			const response = await app.inject({
				method: "GET",
				url: "/callback?code=test_code",
			});

			// Should still succeed even though save failed
			expect(response.statusCode).toBe(200);
			expect(response.body).toContain("Authorization successful");
		});
	});
});
