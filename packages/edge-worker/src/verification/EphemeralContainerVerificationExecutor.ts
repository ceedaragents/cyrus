import { type ChildProcessByStdio, spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Readable } from "node:stream";
import type { RepositoryConfig } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";

type SpawnLike = typeof spawn;
type SpawnedVerificationProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface VerificationExecutionInput {
	issueId?: string;
	issueIdentifier: string;
	repository: RepositoryConfig;
	workspacePath: string;
	workspaceHostPath?: string;
}

export interface VerificationExecutionResult {
	mode: "ephemeral_container";
	image: string;
	command: string;
	shell: string;
	workdir: string;
	workspaceHostPath: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	timedOut: boolean;
	artifacts: string[];
}

export class EphemeralContainerVerificationExecutor {
	private logger: ILogger;
	private spawnImpl: SpawnLike;

	constructor(logger?: ILogger, spawnImpl: SpawnLike = spawn) {
		this.logger =
			logger ??
			createLogger({ component: "EphemeralContainerVerificationExecutor" });
		this.spawnImpl = spawnImpl;
	}

	async execute(
		input: VerificationExecutionInput,
	): Promise<VerificationExecutionResult> {
		const config = input.repository.verification;
		if (!config || config.mode !== "ephemeral_container") {
			throw new Error(
				`Repository ${input.repository.id} is not configured for ephemeral container verification`,
			);
		}

		const workspaceHostPath = input.workspaceHostPath ?? input.workspacePath;
		const shell = config.shell ?? "sh";
		const workdir = config.workdir ?? "/workspace";
		const args = this.buildDockerArgs(input, workspaceHostPath, shell, workdir);
		const startTime = Date.now();
		const timeoutMs = (config.timeoutSec ?? 30 * 60) * 1000;

		this.logger.info(
			`Running external verification for ${input.issueIdentifier} with image ${config.image}`,
		);

		const child = this.spawnImpl("docker", args, {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const result = await this.waitForProcess(
			child,
			timeoutMs,
			input.issueIdentifier,
		);
		const artifacts =
			config.artifactGlobs && config.artifactGlobs.length > 0
				? await collectArtifacts(input.workspacePath, config.artifactGlobs)
				: [];

		return {
			mode: "ephemeral_container",
			image: config.image,
			command: config.command,
			shell,
			workdir,
			workspaceHostPath,
			durationMs: Date.now() - startTime,
			artifacts,
			...result,
		};
	}

	buildDockerArgs(
		input: VerificationExecutionInput,
		workspaceHostPath: string,
		shell: string,
		workdir: string,
	): string[] {
		const config = input.repository.verification;
		if (!config || config.mode !== "ephemeral_container") {
			throw new Error(
				`Repository ${input.repository.id} is not configured for ephemeral container verification`,
			);
		}

		const args = [
			"run",
			"--rm",
			"--label",
			`cyrus.issue=${input.issueIdentifier}`,
			"--label",
			`cyrus.repository=${input.repository.id}`,
			"--env",
			"CI=1",
			"--env",
			`LINEAR_ISSUE_IDENTIFIER=${input.issueIdentifier}`,
			"-v",
			`${workspaceHostPath}:${workdir}`,
			"-w",
			workdir,
		];

		if (input.issueId) {
			args.push("--env", `LINEAR_ISSUE_ID=${input.issueId}`);
		}

		args.push(config.image, shell, "-lc", config.command);
		return args;
	}

	private async waitForProcess(
		child: SpawnedVerificationProcess,
		timeoutMs: number,
		issueIdentifier: string,
	): Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
		timedOut: boolean;
	}> {
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});

		return await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				timedOut = true;
				this.logger.warn(
					`External verification timed out for ${issueIdentifier} after ${timeoutMs}ms`,
				);
				child.kill("SIGKILL");
			}, timeoutMs);

			child.once("error", (error) => {
				clearTimeout(timeout);
				reject(error);
			});

			child.once("close", (exitCode) => {
				clearTimeout(timeout);
				resolve({
					exitCode,
					stdout,
					stderr,
					timedOut,
				});
			});
		});
	}
}

function globPatternToRegExp(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	const source = escaped
		.replace(/\*\*/g, "__CYRUS_DOUBLE_STAR__")
		.replace(/\*/g, "[^/]*")
		.replace(/__CYRUS_DOUBLE_STAR__/g, ".*");
	return new RegExp(`^${source}$`);
}

async function collectArtifacts(
	rootPath: string,
	patterns: string[],
): Promise<string[]> {
	const files = await walkFiles(rootPath);
	const regexes = patterns.map(globPatternToRegExp);

	return files
		.map((filePath) => relative(rootPath, filePath))
		.filter((relativePath) => regexes.some((regex) => regex.test(relativePath)))
		.sort();
}

async function walkFiles(rootPath: string): Promise<string[]> {
	const files: string[] = [];
	const entries = await readdir(rootPath, { withFileTypes: true });

	for (const entry of entries) {
		const entryPath = join(rootPath, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkFiles(entryPath)));
			continue;
		}
		if (entry.isFile()) {
			files.push(entryPath);
		}
	}

	return files;
}
