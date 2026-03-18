import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PersistentIssueContainerManager } from "../src/agent-execution/index.js";
import type { RepositoryConfig } from "../src/types.js";

type ExecFileCallback = (
	error: NodeJS.ErrnoException | null,
	stdout?: string,
	stderr?: string,
) => void;

describe("PersistentIssueContainerManager", () => {
	let tempDir: string;
	let previousOpenAiApiKey: string | undefined;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cyrus-issue-container-"));
		previousOpenAiApiKey = process.env.OPENAI_API_KEY;
		process.env.OPENAI_API_KEY = "test-openai-key";
	});

	afterEach(() => {
		if (previousOpenAiApiKey === undefined) {
			delete process.env.OPENAI_API_KEY;
		} else {
			process.env.OPENAI_API_KEY = previousOpenAiApiKey;
		}
		rmSync(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it("starts a persistent issue container and writes a runner wrapper", async () => {
		const workspacePath = join(tempDir, "worktree");
		const attachmentsPath = join(tempDir, "attachments");
		const repoPath = join(tempDir, "repo");
		mkdirSync(workspacePath, { recursive: true });
		mkdirSync(attachmentsPath, { recursive: true });
		mkdirSync(repoPath, { recursive: true });

		const execFileMock = vi
			.fn()
			.mockImplementationOnce(
				(
					_file: string,
					_args: readonly string[],
					callback: ExecFileCallback,
				) => {
					const error = Object.assign(new Error("No such object"), {
						code: 1,
						stderr: "Error: No such object: cyrus-issue-test-repo-def-123",
					});
					callback(error);
				},
			)
			.mockImplementationOnce(
				(_file: string, _args: readonly string[], callback: ExecFileCallback) =>
					callback(null, "container-id\n", ""),
			);

		const repository: RepositoryConfig = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: repoPath,
			workspaceBaseDir: join(tempDir, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			agentExecution: {
				mode: "persistent_issue_container",
				image: "ghcr.io/test/codex-debug:latest",
				env: {
					FOO: "bar",
				},
				inheritEnv: ["OPENAI_API_KEY"],
				mountPaths: [join(tempDir, "shared-auth")],
			},
		};
		mkdirSync(repository.agentExecution!.mountPaths![0]!, { recursive: true });

		const manager = new PersistentIssueContainerManager(
			tempDir,
			undefined,
			execFileMock as any,
		);

		const runtime = await manager.ensureRuntime({
			sessionId: "session-123",
			issueId: "issue-123",
			issueIdentifier: "DEF-123",
			repository,
			runnerType: "codex",
			workingDirectory: workspacePath,
			allowedDirectories: [attachmentsPath],
		});

		expect(runtime).toBeDefined();
		expect(runtime?.containerName).toBe("cyrus-issue-test-repo-def-123");
		expect(runtime?.wrapperPath).toBeTruthy();
		expect(existsSync(runtime!.wrapperPath)).toBe(true);

		const wrapperScript = readFileSync(runtime!.wrapperPath, "utf8");
		expect(wrapperScript).toContain("docker exec -i -w");
		expect(wrapperScript).toContain("cyrus-issue-test-repo-def-123");
		expect(wrapperScript).toContain("'codex' \"$@\"");

		expect(execFileMock).toHaveBeenCalledTimes(2);
		expect(execFileMock.mock.calls[0]?.[0]).toBe("docker");
		expect(execFileMock.mock.calls[0]?.[1]).toEqual([
			"inspect",
			"--format",
			"{{.State.Running}}",
			"cyrus-issue-test-repo-def-123",
		]);

		const dockerRunArgs = execFileMock.mock.calls[1]?.[1] as string[];
		expect(dockerRunArgs).toContain("-d");
		expect(dockerRunArgs).toContain("--name");
		expect(dockerRunArgs).toContain("cyrus-issue-test-repo-def-123");
		expect(dockerRunArgs).toContain("--env");
		expect(dockerRunArgs).toContain("LINEAR_ISSUE_ID=issue-123");
		expect(dockerRunArgs).toContain("LINEAR_ISSUE_IDENTIFIER=DEF-123");
		expect(dockerRunArgs).toContain("FOO=bar");
		expect(dockerRunArgs).toContain("OPENAI_API_KEY=test-openai-key");
		expect(dockerRunArgs).toContain(`${workspacePath}:${workspacePath}`);
		expect(dockerRunArgs).toContain(`${attachmentsPath}:${attachmentsPath}`);
		expect(dockerRunArgs).toContain(`${repoPath}:${repoPath}`);
		expect(dockerRunArgs).toContain(
			`${repository.agentExecution!.mountPaths![0]}:${repository.agentExecution!.mountPaths![0]}`,
		);
		expect(dockerRunArgs).toContain(`${tempDir}:${tempDir}`);
	});

	it("writes a claude bridge wrapper for containerized claude execution", async () => {
		const workspacePath = join(tempDir, "worktree");
		const repoPath = join(tempDir, "repo");
		const cyrusRepoRoot = join(tempDir, "cyrus-repo");
		mkdirSync(workspacePath, { recursive: true });
		mkdirSync(repoPath, { recursive: true });
		mkdirSync(join(cyrusRepoRoot, "packages", "claude-runner", "dist"), {
			recursive: true,
		});

		const execFileMock = vi
			.fn()
			.mockImplementationOnce(
				(
					_file: string,
					_args: readonly string[],
					callback: ExecFileCallback,
				) => {
					const error = Object.assign(new Error("No such object"), {
						code: 1,
						stderr: "Error: No such object: cyrus-issue-test-repo-def-123",
					});
					callback(error);
				},
			)
			.mockImplementationOnce(
				(_file: string, _args: readonly string[], callback: ExecFileCallback) =>
					callback(null, "container-id\n", ""),
			);

		const repository: RepositoryConfig = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: repoPath,
			workspaceBaseDir: join(tempDir, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			agentExecution: {
				mode: "persistent_issue_container",
				image: "ghcr.io/test/claude-debug:latest",
				supportedRunners: ["claude"],
			},
		};

		const manager = new PersistentIssueContainerManager(
			tempDir,
			undefined,
			execFileMock as any,
			cyrusRepoRoot,
		);
		const runtime = await manager.ensureRuntime({
			sessionId: "session-claude",
			issueIdentifier: "DEF-123",
			repository,
			runnerType: "claude",
			workingDirectory: workspacePath,
			allowedDirectories: [],
		});

		expect(runtime).toBeDefined();
		const wrapperScript = readFileSync(runtime!.wrapperPath, "utf8");
		expect(wrapperScript).toContain("docker exec -i -w");
		expect(wrapperScript).toContain("node");
		expect(wrapperScript).toContain(
			`${cyrusRepoRoot}/packages/claude-runner/dist/container-bridge.js`,
		);

		const dockerRunArgs = execFileMock.mock.calls[1]?.[1] as string[];
		expect(dockerRunArgs).toContain(`${cyrusRepoRoot}:${cyrusRepoRoot}`);
	});

	it("removes the issue container runtime directory on destroy", async () => {
		const runtimeDir = join(tempDir, "agent-execution", "session-123");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(
			join(runtimeDir, "codex-in-container"),
			"#!/usr/bin/env bash\n",
		);

		const execFileMock = vi.fn(
			(_file: string, _args: readonly string[], callback: ExecFileCallback) =>
				callback(null, "", ""),
		);
		const repository: RepositoryConfig = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: join(tempDir, "repo"),
			workspaceBaseDir: join(tempDir, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			agentExecution: {
				mode: "persistent_issue_container",
				image: "ghcr.io/test/codex-debug:latest",
			},
		};

		const manager = new PersistentIssueContainerManager(
			tempDir,
			undefined,
			execFileMock as any,
		);
		await manager.destroyRuntime("session-123", repository, "DEF-123");

		expect(execFileMock).toHaveBeenCalledWith(
			"docker",
			["rm", "-f", "cyrus-issue-test-repo-def-123"],
			expect.any(Function),
		);
		expect(existsSync(runtimeDir)).toBe(false);
	});
});
