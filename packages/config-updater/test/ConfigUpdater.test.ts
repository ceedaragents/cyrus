import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigUpdater } from "../src/ConfigUpdater.js";
import type { CheckGhPayload } from "../src/types.js";

// Mock child_process for gh check handler
vi.mock("node:child_process", () => ({
	exec: vi.fn(),
}));

vi.mock("node:util", () => ({
	promisify: (fn: any) => fn,
}));

describe("ConfigUpdater - Version in Responses", () => {
	const apiKey = "test-api-key";
	const cyrusHome = "/test/cyrus/home";
	const testVersion = "0.2.13";

	let fastify: any;
	let configUpdater: ConfigUpdater;

	beforeEach(async () => {
		// Create a fresh Fastify instance
		fastify = Fastify();

		// Create ConfigUpdater with version
		configUpdater = new ConfigUpdater(fastify, cyrusHome, apiKey, testVersion);
		configUpdater.register();

		// Start the server
		await fastify.listen({ port: 0 });
	});

	afterEach(async () => {
		// Close the server
		await fastify.close();
		vi.clearAllMocks();
	});

	describe("POST /api/check-gh", () => {
		it("should include cyrus_cli_version in success response", async () => {
			const { exec } = await import("node:child_process");
			const mockExec = vi.mocked(exec);

			// Mock successful gh check
			mockExec.mockImplementation((cmd: string, _callback?: any) => {
				if (cmd === "gh --version") {
					return Promise.resolve({ stdout: "gh version 2.0.0", stderr: "" });
				}
				if (cmd === "gh auth status") {
					return Promise.resolve({
						stdout: "Logged in to github.com",
						stderr: "",
					});
				}
				return Promise.reject(new Error("Unknown command"));
			});

			const payload: CheckGhPayload = {};

			const response = await fastify.inject({
				method: "POST",
				url: "/api/check-gh",
				headers: {
					authorization: `Bearer ${apiKey}`,
				},
				payload,
			});

			expect(response.statusCode).toBe(200);
			const body = JSON.parse(response.body);
			expect(body.success).toBe(true);
			expect(body.cyrus_cli_version).toBe(testVersion);
			expect(body.data).toEqual({
				isInstalled: true,
				isAuthenticated: true,
			});
		});
	});

	describe("ConfigUpdater without version", () => {
		it("should include null for cyrus_cli_version when version is not provided", async () => {
			// Create a new Fastify instance for this test
			const fastify2 = Fastify();
			const configUpdater2 = new ConfigUpdater(
				fastify2,
				cyrusHome,
				apiKey,
				undefined,
			);
			configUpdater2.register();

			await fastify2.listen({ port: 0 });

			const { exec } = await import("node:child_process");
			const mockExec = vi.mocked(exec);

			mockExec.mockImplementation((cmd: string, _callback?: any) => {
				if (cmd === "gh --version") {
					return Promise.resolve({ stdout: "gh version 2.0.0", stderr: "" });
				}
				if (cmd === "gh auth status") {
					return Promise.resolve({
						stdout: "Logged in to github.com",
						stderr: "",
					});
				}
				return Promise.reject(new Error("Unknown command"));
			});

			const payload: CheckGhPayload = {};

			const response = await fastify2.inject({
				method: "POST",
				url: "/api/check-gh",
				headers: {
					authorization: `Bearer ${apiKey}`,
				},
				payload,
			});

			expect(response.statusCode).toBe(200);
			const body = JSON.parse(response.body);
			expect(body.success).toBe(true);
			expect(body.cyrus_cli_version).toBe(null);

			await fastify2.close();
		});
	});

	describe("Authentication failures", () => {
		it("should not include version in error responses", async () => {
			const payload: CheckGhPayload = {};

			const response = await fastify.inject({
				method: "POST",
				url: "/api/check-gh",
				headers: {
					authorization: "Bearer wrong-key",
				},
				payload,
			});

			expect(response.statusCode).toBe(401);
			const body = JSON.parse(response.body);
			expect(body.success).toBe(false);
			expect(body.cyrus_cli_version).toBeUndefined();
		});
	});
});
