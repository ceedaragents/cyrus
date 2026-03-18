import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EphemeralContainerVerificationExecutor } from "../src/verification/index.js";

function createMockChild() {
	const child = new EventEmitter() as any;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.kill = vi.fn();
	return child;
}

describe("EphemeralContainerVerificationExecutor", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("builds the expected docker run arguments", () => {
		const executor = new EphemeralContainerVerificationExecutor();
		const args = executor.buildDockerArgs(
			{
				issueId: "issue-123",
				issueIdentifier: "TEST-123",
				workspacePath: "/workspace/worktrees/TEST-123",
				workspaceHostPath: "/host/worktrees/TEST-123",
				repository: {
					id: "repo-1",
					name: "Repo",
					repositoryPath: "/workspace/repos/repo",
					workspaceBaseDir: "/workspace/worktrees",
					baseBranch: "main",
					verification: {
						mode: "ephemeral_container",
						image: "ghcr.io/test/debug:latest",
						command: "pnpm test",
						workdir: "/workspace",
						shell: "bash",
					},
				},
			},
			"/host/worktrees/TEST-123",
			"bash",
			"/workspace",
		);

		expect(args).toEqual([
			"run",
			"--rm",
			"--label",
			"cyrus.issue=TEST-123",
			"--label",
			"cyrus.repository=repo-1",
			"--env",
			"CI=1",
			"--env",
			"LINEAR_ISSUE_IDENTIFIER=TEST-123",
			"-v",
			"/host/worktrees/TEST-123:/workspace",
			"-w",
			"/workspace",
			"--env",
			"LINEAR_ISSUE_ID=issue-123",
			"ghcr.io/test/debug:latest",
			"bash",
			"-lc",
			"pnpm test",
		]);
	});

	it("captures command output and collects configured artifacts", async () => {
		const workspacePath = mkdtempSync(join(tmpdir(), "cyrus-verification-"));
		mkdirSync(join(workspacePath, "test-results"), { recursive: true });
		mkdirSync(join(workspacePath, "playwright-report"), { recursive: true });
		writeFileSync(join(workspacePath, "test-results", "junit.xml"), "<xml />");
		writeFileSync(
			join(workspacePath, "playwright-report", "video.mp4"),
			"binary",
		);

		const child = createMockChild();
		const spawnImpl = vi.fn(() => child);
		const executor = new EphemeralContainerVerificationExecutor(
			undefined,
			spawnImpl as any,
		);

		const promise = executor.execute({
			issueId: "issue-123",
			issueIdentifier: "TEST-123",
			workspacePath,
			workspaceHostPath: "/host/worktrees/TEST-123",
			repository: {
				id: "repo-1",
				name: "Repo",
				repositoryPath: "/workspace/repos/repo",
				workspaceBaseDir: "/workspace/worktrees",
				baseBranch: "main",
				verification: {
					mode: "ephemeral_container",
					image: "ghcr.io/test/debug:latest",
					command: "pnpm test",
					workdir: "/workspace",
					artifactGlobs: ["test-results/**", "playwright-report/**"],
				},
			},
		});

		child.stdout.emit("data", "test output");
		child.stderr.emit("data", "warning output");
		child.emit("close", 0);

		const result = await promise;

		expect(spawnImpl).toHaveBeenCalledWith(
			"docker",
			expect.any(Array),
			expect.objectContaining({
				stdio: ["ignore", "pipe", "pipe"],
			}),
		);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("test output");
		expect(result.stderr).toBe("warning output");
		expect(result.workspaceHostPath).toBe("/host/worktrees/TEST-123");
		expect(result.artifacts).toEqual([
			"playwright-report/video.mp4",
			"test-results/junit.xml",
		]);
	});
});
