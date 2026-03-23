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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExternalAgentLauncherManager } from "../src/agent-execution/index.js";
import type { RepositoryConfig } from "../src/types.js";

describe("ExternalAgentLauncherManager", () => {
	let tempDir: string;
	let previousOpenAiApiKey: string | undefined;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cyrus-external-launcher-"));
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
	});

	it("writes a codex external launcher wrapper with env forwarding", async () => {
		const workspacePath = join(tempDir, "worktree");
		const repository: RepositoryConfig = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: join(tempDir, "repo"),
			workspaceBaseDir: join(tempDir, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			agentExecution: {
				mode: "external_launcher",
				runner: "codex",
				command: "/Users/top/bin/codex-api-kk",
				args: ["--profile", "test"],
				env: {
					FOO: "bar",
				},
				inheritEnv: ["OPENAI_API_KEY"],
			},
		};

		const manager = new ExternalAgentLauncherManager(tempDir);
		const runtime = await manager.ensureRuntime({
			sessionId: "session-123",
			repository,
			runnerType: "codex",
			workingDirectory: workspacePath,
		});

		expect(runtime).toEqual({
			wrapperPath: join(
				tempDir,
				"agent-execution",
				"session-123",
				"codex-external-launcher",
			),
			command: "/Users/top/bin/codex-api-kk",
		});
		expect(existsSync(runtime!.wrapperPath)).toBe(true);
		const envFilePath = join(
			tempDir,
			"agent-execution",
			"session-123",
			"launcher.env",
		);
		expect(existsSync(envFilePath)).toBe(true);
		expect(readFileSync(envFilePath, "utf8")).toBe(
			[
				"npm_config_yes=true",
				"FOO=bar",
				"OPENAI_API_KEY=test-openai-key",
				"",
			].join("\n"),
		);

		const wrapperScript = readFileSync(runtime!.wrapperPath, "utf8");
		expect(wrapperScript).toContain(`cd '${workspacePath}'`);
		expect(wrapperScript).toContain(
			'export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"',
		);
		expect(wrapperScript).toContain("export FOO='bar'");
		expect(wrapperScript).toContain(
			'if [[ -n "${OPENAI_API_KEY:-}" ]]; then export OPENAI_API_KEY="${OPENAI_API_KEY}"; fi',
		);
		expect(wrapperScript).toContain("if [[ -t 1 ]]; then");
		expect(wrapperScript).toContain("launcher_command=(");
		expect(wrapperScript).toContain('python3 - "${launcher_command[@]}"');
		expect(wrapperScript).toContain("import pty");
		expect(wrapperScript).toContain("perl -pe");
		expect(wrapperScript).toContain(
			`exec '/Users/top/bin/codex-api-kk' --env-file '${envFilePath}' '--profile' 'test' "$@"`,
		);
	});

	it("rejects non-codex runner resolution for external launcher execution", async () => {
		const manager = new ExternalAgentLauncherManager(tempDir);
		const repository: RepositoryConfig = {
			id: "test-repo",
			name: "Test Repo",
			repositoryPath: join(tempDir, "repo"),
			workspaceBaseDir: join(tempDir, "worktrees"),
			baseBranch: "main",
			linearWorkspaceId: "workspace-1",
			agentExecution: {
				mode: "external_launcher",
				runner: "codex",
				command: "/Users/top/bin/codex-api-kk",
			},
		};

		await expect(
			manager.ensureRuntime({
				sessionId: "session-123",
				repository,
				runnerType: "claude",
				workingDirectory: join(tempDir, "worktree"),
			}),
		).rejects.toThrow(/requires runner "codex"/);
	});

	it("removes the runtime directory on destroy", async () => {
		const runtimeDir = join(tempDir, "agent-execution", "session-123");
		const runtimeFile = join(runtimeDir, "codex-external-launcher");
		mkdirSync(runtimeDir, { recursive: true });
		writeFileSync(runtimeFile, "#!/usr/bin/env bash\n");

		const manager = new ExternalAgentLauncherManager(tempDir);
		await manager.destroyRuntime("session-123");

		expect(existsSync(runtimeDir)).toBe(false);
	});
});
