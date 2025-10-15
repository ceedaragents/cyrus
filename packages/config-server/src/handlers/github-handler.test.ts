import * as childProcess from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleGitHubCredentials } from "./github-handler";

// Mock child_process
vi.mock("child_process");

describe("handleGitHubCredentials", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should throw error if token is empty", async () => {
		await expect(handleGitHubCredentials({ token: "" })).rejects.toThrow(
			"Token is required",
		);
	});

	it("should throw error if token is whitespace only", async () => {
		await expect(handleGitHubCredentials({ token: "   " })).rejects.toThrow(
			"Token is required",
		);
	});

	it("should successfully authenticate with valid token", async () => {
		const mockStdout = {
			on: vi.fn((event, _callback) => {
				if (event === "data") {
					// No output needed for successful auth
				}
			}),
		};

		const mockStderr = {
			on: vi.fn(),
		};

		const mockStdin = {
			write: vi.fn(),
			end: vi.fn(),
		};

		const mockProcess = {
			stdout: mockStdout,
			stderr: mockStderr,
			stdin: mockStdin,
			on: vi.fn((event, callback) => {
				if (event === "close") {
					callback(0); // Success exit code
				}
			}),
		};

		vi.spyOn(childProcess, "spawn").mockImplementation(
			() => mockProcess as any,
		);

		await handleGitHubCredentials({ token: "ghp_test_token_123" });

		expect(childProcess.spawn).toHaveBeenCalledWith("gh", [
			"auth",
			"login",
			"--with-token",
		]);
		expect(mockStdin.write).toHaveBeenCalledWith("ghp_test_token_123");
		expect(mockStdin.end).toHaveBeenCalled();
	});

	it("should handle gh auth login failure", async () => {
		const mockStdout = {
			on: vi.fn(),
		};

		const mockStderr = {
			on: vi.fn((event, callback) => {
				if (event === "data") {
					callback(Buffer.from("Authentication failed"));
				}
			}),
		};

		const mockStdin = {
			write: vi.fn(),
			end: vi.fn(),
		};

		const mockProcess = {
			stdout: mockStdout,
			stderr: mockStderr,
			stdin: mockStdin,
			on: vi.fn((event, callback) => {
				if (event === "close") {
					callback(1); // Error exit code
				}
			}),
		};

		vi.spyOn(childProcess, "spawn").mockImplementation(
			() => mockProcess as any,
		);

		await expect(
			handleGitHubCredentials({ token: "invalid_token" }),
		).rejects.toThrow("Failed to update GitHub authentication");
	});

	it("should not fail if gh auth setup-git fails", async () => {
		let callCount = 0;

		const mockStdout = {
			on: vi.fn(),
		};

		const mockStderr = {
			on: vi.fn(),
		};

		const mockStdin = {
			write: vi.fn(),
			end: vi.fn(),
		};

		const mockProcess = {
			stdout: mockStdout,
			stderr: mockStderr,
			stdin: mockStdin,
			on: vi.fn((event, callback) => {
				if (event === "close") {
					callCount++;
					// First call (gh auth login) succeeds, second call (gh auth setup-git) fails
					callback(callCount === 1 ? 0 : 1);
				}
			}),
		};

		vi.spyOn(childProcess, "spawn").mockImplementation(
			() => mockProcess as any,
		);
		const consoleWarnSpy = vi
			.spyOn(console, "warn")
			.mockImplementation(() => {});

		// Should not throw even though setup-git fails
		await expect(
			handleGitHubCredentials({ token: "ghp_test_token_123" }),
		).resolves.toBeUndefined();

		expect(consoleWarnSpy).toHaveBeenCalledWith(
			expect.stringContaining("Warning: gh auth setup-git failed"),
		);

		consoleWarnSpy.mockRestore();
	});
});
