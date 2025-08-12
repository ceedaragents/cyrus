import { describe, expect, it, vi } from "vitest";

// Mock the Claude SDK
vi.mock("@anthropic-ai/claude-code", () => ({
	query: vi.fn(),
	AbortError: class AbortError extends Error {
		name = "AbortError";
	},
}));

// Mock file system operations
vi.mock("node:fs", () => ({
	mkdirSync: vi.fn(),
	createWriteStream: vi.fn(() => ({
		write: vi.fn(),
		end: vi.fn(),
		on: vi.fn(),
	})),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

// Mock os module
vi.mock("node:os", () => ({
	homedir: vi.fn(() => "/mock/home"),
}));

import { query } from "@anthropic-ai/claude-code";
import { ClaudeRunner } from "../src/ClaudeRunner";
import type { ClaudeRunnerConfig } from "../src/types";

describe("ClaudeRunner Resume Functionality", () => {
	let mockQuery: any;

	beforeEach(() => {
		vi.clearAllMocks();
		mockQuery = vi.mocked(query);

		// Mock a simple successful query
		mockQuery.mockImplementation(async function* () {
			yield {
				type: "assistant",
				message: { content: [{ type: "text", text: "Hello!" }] },
				parent_tool_use_id: null,
				session_id: "test-session",
			};
		});
	});

	it("should pass both resume and continue options when resumeSessionId is provided", async () => {
		const resumeSessionId = "existing-session-abc123";
		const config: ClaudeRunnerConfig = {
			workingDirectory: "/tmp/test",
			workspaceName: "test-resume",
			resumeSessionId,
		};

		const runner = new ClaudeRunner(config);
		await runner.start("Test with resume");

		expect(mockQuery).toHaveBeenCalledWith({
			prompt: "Test with resume",
			options: {
				abortController: expect.any(AbortController),
				cwd: "/tmp/test",
				resume: resumeSessionId,
				continue: true,
			},
		});
	});

	it("should not pass resume or continue options when resumeSessionId is not provided", async () => {
		const config: ClaudeRunnerConfig = {
			workingDirectory: "/tmp/test",
			workspaceName: "test-no-resume",
		};

		const runner = new ClaudeRunner(config);
		await runner.start("Test without resume");

		expect(mockQuery).toHaveBeenCalledWith({
			prompt: "Test without resume",
			options: {
				abortController: expect.any(AbortController),
				cwd: "/tmp/test",
				// No resume or continue options
			},
		});

		// Verify resume and continue are not present
		const callArgs = mockQuery.mock.calls[0][0];
		expect(callArgs.options).not.toHaveProperty("resume");
		expect(callArgs.options).not.toHaveProperty("continue");
	});

	it("should log the resume session ID during initialization", () => {
		const logSpy = vi.spyOn(console, "log");
		const resumeSessionId = "test-session-456";

		new ClaudeRunner({
			workingDirectory: "/tmp/test",
			resumeSessionId,
		});

		expect(logSpy).toHaveBeenCalledWith(
			`[ClaudeRunner] Constructor called with resumeSessionId: ${resumeSessionId}`,
		);
	});

	it("should log the resume session ID when starting a session", async () => {
		const logSpy = vi.spyOn(console, "log");
		const resumeSessionId = "test-session-789";
		const config: ClaudeRunnerConfig = {
			workingDirectory: "/tmp/test",
			resumeSessionId,
		};

		const runner = new ClaudeRunner(config);
		await runner.start("Test");

		expect(logSpy).toHaveBeenCalledWith(
			"[ClaudeRunner] Resume session ID:",
			resumeSessionId,
		);
	});

	it("should handle empty string resumeSessionId as no resume", async () => {
		const config: ClaudeRunnerConfig = {
			workingDirectory: "/tmp/test",
			resumeSessionId: "", // Empty string should be treated as no resume
		};

		const runner = new ClaudeRunner(config);
		await runner.start("Test");

		const callArgs = mockQuery.mock.calls[0][0];
		expect(callArgs.options).not.toHaveProperty("resume");
		expect(callArgs.options).not.toHaveProperty("continue");
	});
});
