import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepositoryConfig, RunnerType } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";

export interface EnsureExternalLauncherRuntimeInput {
	sessionId: string;
	repository: RepositoryConfig;
	runnerType: RunnerType;
	workingDirectory: string;
}

export interface ExternalLauncherRuntime {
	wrapperPath: string;
	command: string;
}

export class ExternalAgentLauncherManager {
	private readonly logger: ILogger;

	constructor(
		private readonly cyrusHome: string,
		logger?: ILogger,
	) {
		this.logger =
			logger ?? createLogger({ component: "ExternalAgentLauncherManager" });
	}

	async ensureRuntime(
		input: EnsureExternalLauncherRuntimeInput,
	): Promise<ExternalLauncherRuntime | undefined> {
		const config = input.repository.agentExecution;
		if (!config || config.mode !== "external_launcher") {
			return undefined;
		}

		if (config.runner !== "codex") {
			throw new Error(
				`Unsupported external launcher runner "${config.runner}" for repository ${input.repository.id}`,
			);
		}

		if (input.runnerType !== config.runner) {
			throw new Error(
				`Repository ${input.repository.id} requires runner "${config.runner}" for external launcher execution, but resolved runner was "${input.runnerType}"`,
			);
		}

		const runtimeDir = this.getRuntimeDir(input.sessionId);
		await mkdir(runtimeDir, { recursive: true });
		const envFilePath = join(runtimeDir, "launcher.env");
		await writeFile(
			envFilePath,
			this.buildEnvFileContents(config.env ?? {}, config.inheritEnv ?? []),
		);

		const wrapperPath = join(runtimeDir, `${config.runner}-external-launcher`);
		const script = this.buildWrapperScript(
			input.workingDirectory,
			config.command,
			config.args ?? [],
			config.env ?? {},
			config.inheritEnv ?? [],
			envFilePath,
		);
		await writeFile(wrapperPath, script);
		await chmod(wrapperPath, 0o755);

		this.logger.info(
			`Prepared external launcher wrapper for session ${input.sessionId} using ${config.command}`,
		);

		return {
			wrapperPath,
			command: config.command,
		};
	}

	async destroyRuntime(sessionId: string): Promise<void> {
		await rm(this.getRuntimeDir(sessionId), { recursive: true, force: true });
	}

	private getRuntimeDir(sessionId: string): string {
		return join(this.cyrusHome, "agent-execution", sessionId);
	}

	private buildWrapperScript(
		workingDirectory: string,
		command: string,
		args: string[],
		env: Record<string, string>,
		inheritEnv: string[],
		envFilePath: string,
	): string {
		const lines = [
			"#!/usr/bin/env bash",
			"set -euo pipefail",
			`cd ${shellEscape(workingDirectory)}`,
			'export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"',
		];

		for (const [key, value] of Object.entries(env)) {
			lines.push(`export ${key}=${shellEscape(value)}`);
		}

		for (const envName of inheritEnv) {
			lines.push(
				`if [[ -n "\${${envName}:-}" ]]; then export ${envName}="\${${envName}}"; fi`,
			);
		}

		const escapedArgs = args.map((arg) => shellEscape(arg)).join(" ");
		const envFileArg = ` --env-file ${shellEscape(envFilePath)}`;
		const execArgs = escapedArgs.length > 0 ? ` ${escapedArgs}` : "";
		const commandInvocation = `${shellEscape(command)}${envFileArg}${execArgs} "$@"`;
		const launcherArrayEntries = [
			shellEscape(command),
			"'--env-file'",
			shellEscape(envFilePath),
			...args.map((arg) => shellEscape(arg)),
			'"$@"',
		].join(" ");
		lines.push("if [[ -t 1 ]]; then");
		lines.push(`  exec ${commandInvocation}`);
		lines.push("fi");
		lines.push(`launcher_command=(${launcherArrayEntries})`);
		lines.push("set +e");
		lines.push(
			"python3 - \"${launcher_command[@]}\" <<'PY' | perl -pe 's/\\e\\][^\\a]*(?:\\a|\\e\\\\)//g; s/\\e\\[[0-9;?]*[ -\\/]*[@-~]//g; s/\\r//g; s/[\\x00-\\x08\\x0B-\\x1A\\x1C-\\x1F\\x7F]//g'",
		);
		lines.push("import os");
		lines.push("import pty");
		lines.push("import subprocess");
		lines.push("import sys");
		lines.push("");
		lines.push("command = sys.argv[1:]");
		lines.push("master_fd, slave_fd = pty.openpty()");
		lines.push(
			"process = subprocess.Popen(command, stdin=slave_fd, stdout=slave_fd, stderr=slave_fd, close_fds=True)",
		);
		lines.push("os.close(slave_fd)");
		lines.push("try:");
		lines.push("    while True:");
		lines.push("        try:");
		lines.push("            chunk = os.read(master_fd, 4096)");
		lines.push("        except OSError:");
		lines.push("            break");
		lines.push("        if not chunk:");
		lines.push("            break");
		lines.push("        os.write(sys.stdout.fileno(), chunk)");
		lines.push("finally:");
		lines.push("    os.close(master_fd)");
		lines.push("");
		lines.push("return_code = process.wait()");
		lines.push("if return_code < 0:");
		lines.push("    sys.exit(128 + (-return_code))");
		lines.push("sys.exit(return_code)");
		lines.push("PY");
		lines.push("status=${PIPESTATUS[0]}");
		lines.push("set -e");
		lines.push('exit "$status"');
		return `${lines.join("\n")}\n`;
	}

	private buildEnvFileContents(
		env: Record<string, string>,
		inheritEnv: string[],
	): string {
		const mergedEnv = new Map<string, string>();
		mergedEnv.set("npm_config_yes", "true");

		for (const [key, value] of Object.entries(env)) {
			mergedEnv.set(key, value);
		}

		for (const envName of inheritEnv) {
			const value = process.env[envName];
			if (value) {
				mergedEnv.set(envName, value);
			}
		}

		return `${Array.from(mergedEnv.entries())
			.map(([key, value]) => `${key}=${sanitizeEnvFileValue(value)}`)
			.join("\n")}\n`;
	}
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sanitizeEnvFileValue(value: string): string {
	return value.replace(/\r?\n/g, " ");
}
