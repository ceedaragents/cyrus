import { type ExecFileException, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { RepositoryConfig, RunnerType } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";

const DEFAULT_KEEPALIVE_SHELL = "sh";
const DEFAULT_KEEPALIVE_COMMAND =
	"trap 'exit 0' TERM INT; while :; do sleep 5; done";

const CONTAINER_BINARIES: Partial<Record<RunnerType, string>> = {
	codex: "codex",
	cursor: "cursor-agent",
	gemini: "gemini",
};

type ExecFileLike = typeof execFile;

export interface EnsureIssueContainerInput {
	sessionId: string;
	issueId?: string;
	issueIdentifier: string;
	repository: RepositoryConfig;
	runnerType: RunnerType;
	workingDirectory: string;
	allowedDirectories: string[];
}

export interface IssueContainerRuntime {
	containerName: string;
	wrapperPath: string;
}

export class PersistentIssueContainerManager {
	private readonly logger: ILogger;
	private readonly execFileAsync: (
		file: string,
		args: readonly string[],
	) => Promise<{ stdout: string; stderr: string }>;
	private readonly cyrusHome: string;
	private readonly cyrusRepoRoot: string;

	constructor(
		cyrusHome: string,
		logger?: ILogger,
		execFileImpl: ExecFileLike = execFile,
		cyrusRepoRoot: string = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"../../../../..",
		),
	) {
		this.cyrusHome = cyrusHome;
		this.logger =
			logger ?? createLogger({ component: "PersistentIssueContainerManager" });
		this.execFileAsync = promisify(execFileImpl);
		this.cyrusRepoRoot = cyrusRepoRoot;
	}

	async ensureRuntime(
		input: EnsureIssueContainerInput,
	): Promise<IssueContainerRuntime | undefined> {
		const config = input.repository.agentExecution;
		if (!config || config.mode !== "persistent_issue_container") {
			return undefined;
		}

		if (!this.supportsRunner(input.runnerType, config.supportedRunners)) {
			return undefined;
		}

		const containerName = this.buildContainerName(
			input.repository.id,
			input.issueIdentifier,
		);
		await this.ensureContainerRunning(containerName, input);

		const wrapperPath = await this.writeRunnerWrapper(containerName, input);
		return {
			containerName,
			wrapperPath,
		};
	}

	async destroyRuntime(
		sessionId: string,
		repository: RepositoryConfig,
		issueIdentifier: string,
	): Promise<void> {
		const config = repository.agentExecution;
		if (!config || config.mode !== "persistent_issue_container") {
			return;
		}

		const containerName = this.buildContainerName(
			repository.id,
			issueIdentifier,
		);
		try {
			await this.execFileAsync("docker", ["rm", "-f", containerName]);
			this.logger.info(
				`Stopped issue container ${containerName} for ${issueIdentifier}`,
			);
		} catch (error) {
			if (!isDockerMissingObjectError(error)) {
				throw error;
			}
		}

		await rm(this.getRuntimeDir(sessionId), { recursive: true, force: true });
	}

	private async ensureContainerRunning(
		containerName: string,
		input: EnsureIssueContainerInput,
	): Promise<void> {
		if (await this.isContainerRunning(containerName)) {
			return;
		}

		const config = input.repository.agentExecution;
		if (!config || config.mode !== "persistent_issue_container") {
			throw new Error(
				`Repository ${input.repository.id} is not configured for persistent issue container execution`,
			);
		}

		const shell = config.shell ?? DEFAULT_KEEPALIVE_SHELL;
		const startupCommand = config.startupCommand ?? DEFAULT_KEEPALIVE_COMMAND;
		const mounts = this.collectMountPaths(input.workingDirectory, [
			...input.allowedDirectories,
			input.repository.repositoryPath,
			this.cyrusHome,
			...(config.mountPaths ?? []),
			...(input.runnerType === "claude" ? [this.cyrusRepoRoot] : []),
		]);
		const args = [
			"run",
			"-d",
			"--rm",
			"--name",
			containerName,
			"--label",
			`cyrus.issue=${input.issueIdentifier}`,
			"--label",
			`cyrus.repository=${input.repository.id}`,
			"--env",
			`LINEAR_ISSUE_IDENTIFIER=${input.issueIdentifier}`,
		];

		if (input.issueId) {
			args.push("--env", `LINEAR_ISSUE_ID=${input.issueId}`);
		}

		for (const [key, value] of Object.entries(config.env ?? {})) {
			args.push("--env", `${key}=${value}`);
		}

		for (const envName of config.inheritEnv ?? []) {
			const value = process.env[envName];
			if (value) {
				args.push("--env", `${envName}=${value}`);
			}
		}

		for (const mountPath of mounts) {
			args.push("-v", `${mountPath}:${mountPath}`);
		}

		args.push(config.image, shell, "-lc", startupCommand);

		this.logger.info(
			`Starting issue container ${containerName} for ${input.issueIdentifier} with image ${config.image}`,
		);
		await this.execFileAsync("docker", args);
	}

	private async isContainerRunning(containerName: string): Promise<boolean> {
		try {
			const { stdout } = await this.execFileAsync("docker", [
				"inspect",
				"--format",
				"{{.State.Running}}",
				containerName,
			]);
			return stdout.trim() === "true";
		} catch (error) {
			if (isDockerMissingObjectError(error)) {
				return false;
			}
			throw error;
		}
	}

	private async writeRunnerWrapper(
		containerName: string,
		input: EnsureIssueContainerInput,
	): Promise<string> {
		const runtimeDir = this.getRuntimeDir(input.sessionId);
		await mkdir(runtimeDir, { recursive: true });

		const wrapperPath = join(runtimeDir, `${input.runnerType}-in-container`);
		let script = `#!/usr/bin/env bash
set -euo pipefail
`;

		if (input.runnerType === "claude") {
			const bridgeScriptPath = join(
				this.cyrusRepoRoot,
				"packages/claude-runner/dist/container-bridge.js",
			);
			script += `exec docker exec -i -w ${shellEscape(input.workingDirectory)} ${shellEscape(containerName)} node ${shellEscape(bridgeScriptPath)}
`;
		} else {
			const binaryName = CONTAINER_BINARIES[input.runnerType];
			if (!binaryName) {
				throw new Error(
					`Runner ${input.runnerType} does not support persistent issue container execution`,
				);
			}
			script += `exec docker exec -i -w ${shellEscape(input.workingDirectory)} ${shellEscape(containerName)} ${shellEscape(binaryName)} "$@"
`;
		}
		await writeFile(wrapperPath, script);
		await chmod(wrapperPath, 0o755);
		return wrapperPath;
	}

	private collectMountPaths(
		workingDirectory: string,
		allowedDirectories: string[],
	): string[] {
		const uniquePaths = new Set<string>();
		for (const directory of [workingDirectory, ...allowedDirectories]) {
			if (!directory || !existsSync(directory)) {
				continue;
			}
			uniquePaths.add(directory);
		}

		return [...uniquePaths].sort((left, right) => left.localeCompare(right));
	}

	private getRuntimeDir(sessionId: string): string {
		return join(this.cyrusHome, "agent-execution", sessionId);
	}

	private buildContainerName(
		repositoryId: string,
		issueIdentifier: string,
	): string {
		const sanitized = `${repositoryId}-${issueIdentifier}`
			.toLowerCase()
			.replace(/[^a-z0-9_.-]+/g, "-")
			.replace(/^-+|-+$/g, "");
		return `cyrus-issue-${sanitized}`.slice(0, 120);
	}

	private supportsRunner(
		runnerType: RunnerType,
		supportedRunners?: RunnerType[],
	): boolean {
		if (!supportedRunners || supportedRunners.length === 0) {
			return true;
		}
		return supportedRunners.includes(runnerType);
	}
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isDockerMissingObjectError(error: unknown): boolean {
	const execError = error as ExecFileException & {
		stderr?: string | Buffer;
	};
	const stderrValue = execError?.stderr;
	const stderr =
		typeof stderrValue === "string"
			? stderrValue
			: stderrValue
				? String(stderrValue)
				: "";
	return (
		execError?.code === 1 && /no such object|no such container/i.test(stderr)
	);
}
