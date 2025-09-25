import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type {
	CodexRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
import { toError } from "../utils/errors.js";
import { pipeStreamLines } from "../utils/stream.js";

export class CodexRunnerAdapter implements Runner {
	private child?: ChildProcessWithoutNullStreams;

	constructor(private readonly config: CodexRunnerOptions) {}

	async start(
		onEvent: (event: RunnerEvent) => void,
	): Promise<RunnerStartResult> {
		const args = ["exec", "--cd", this.config.cwd];
		if (this.config.model) {
			args.push("-m", this.config.model);
		}
		if (this.config.approvalPolicy) {
			args.push("--approval-policy", this.config.approvalPolicy);
		}
		if (this.config.sandbox) {
			args.push("--sandbox", this.config.sandbox);
		}

		args.push(this.config.prompt);

		const env = { ...process.env, ...(this.config.env ?? {}) };

		try {
			this.child = spawn("codex", args, {
				cwd: this.config.cwd,
				env,
			});
		} catch (error) {
			const err = toError(error, "Failed to spawn codex process");
			onEvent({ kind: "error", error: err });
			throw err;
		}

		this.child.on("error", (error) => {
			onEvent({ kind: "error", error: toError(error, "Codex process error") });
		});

		if (this.child.stdout) {
			pipeStreamLines(this.child.stdout, (line) => {
				if (line.trim().length > 0) {
					onEvent({ kind: "text", text: line });
				}
			});
		}

		if (this.child.stderr) {
			pipeStreamLines(this.child.stderr, (line) => {
				if (line.trim().length > 0) {
					onEvent({ kind: "text", text: line });
				}
			});
		}

		this.child.on("close", (code, signal) => {
			this.child = undefined;
			if (code === 0) {
				onEvent({ kind: "result", summary: "Codex run completed" });
			} else {
				const reason = signal
					? `signal ${signal}`
					: typeof code === "number"
						? `exit code ${code}`
						: "unexpected termination";
				onEvent({
					kind: "error",
					error: new Error(`Codex exited with ${reason}`),
				});
			}
		});

		return {};
	}

	async stop(): Promise<void> {
		if (this.child && !this.child.killed) {
			this.child.kill("SIGTERM");
			this.child = undefined;
		}
	}
}
