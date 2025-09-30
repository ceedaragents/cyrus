import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type {
	CodexRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
import { toError } from "../utils/errors.js";
import { pipeStreamLines } from "../utils/stream.js";

type CodexJsonMessage = Record<string, unknown>;

const LAST_MESSAGE_MARKER_REGEX = /___LAST_MESSAGE_MARKER___/g;

export class CodexRunnerAdapter implements Runner {
	private child?: ChildProcessWithoutNullStreams;

	private finalDelivered = false;

	constructor(private readonly config: CodexRunnerOptions) {}

	async start(
		onEvent: (event: RunnerEvent) => void,
	): Promise<RunnerStartResult> {
		const args = ["exec", "--experimental-json", "--cd", this.config.cwd];
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

		this.finalDelivered = false;

		this.child.on("error", (error) => {
			if (this.finalDelivered) {
				this.emitLog(
					onEvent,
					`Codex process error after final: ${toError(error).message}`,
				);
				return;
			}
			onEvent({ kind: "error", error: toError(error, "Codex process error") });
		});

		if (this.child.stdout) {
			pipeStreamLines(this.child.stdout, (line) => {
				this.handleStdoutLine(line, onEvent);
			});
		}

		if (this.child.stderr) {
			pipeStreamLines(this.child.stderr, (line) => {
				const text = line.trim();
				if (text.length > 0) {
					this.emitLog(onEvent, `[codex:stderr] ${text}`);
				}
			});
		}

		this.child.on("close", (code, signal) => {
			this.child = undefined;
			if (signal || (typeof code === "number" && code !== 0)) {
				const reason = signal
					? `signal ${signal}`
					: `exit code ${code ?? "unknown"}`;
				if (this.finalDelivered) {
					this.emitLog(onEvent, `Codex exited with ${reason}`);
				} else {
					onEvent({
						kind: "error",
						error: new Error(
							`Codex exited before delivering a final response (${reason})`,
						),
					});
				}
				return;
			}

			if (!this.finalDelivered) {
				onEvent({
					kind: "error",
					error: new Error("Codex exited without delivering a final response"),
				});
			}
		});

		return { capabilities: { jsonStream: true } };
	}

	async stop(): Promise<void> {
		if (this.child && !this.child.killed) {
			this.child.kill("SIGTERM");
			this.child = undefined;
		}
	}

	private handleStdoutLine(
		rawLine: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		const line = rawLine.trim();
		if (line.length === 0) {
			return;
		}

		let payload: CodexJsonMessage;
		try {
			payload = JSON.parse(line) as CodexJsonMessage;
		} catch (_error) {
			this.emitLog(onEvent, `[codex] ${line}`);
			return;
		}

		const type = typeof payload.type === "string" ? payload.type : undefined;
		if (this.isErrorPayload(type, payload)) {
			this.emitError(payload, line, onEvent);
			return;
		}

		const item = this.extractItem(payload);
		const itemType = item ? this.extractItemType(item) : undefined;
		if (item && itemType) {
			const normalizedItemType = itemType.toLowerCase();
			if (this.isItemFailure(item)) {
				this.emitError(payload, line, onEvent);
				return;
			}
			if (normalizedItemType.includes("reasoning")) {
				this.emitThought(item, onEvent);
				return;
			}
			if (
				normalizedItemType.includes("command") ||
				normalizedItemType.includes("tool")
			) {
				this.emitCommandAction(item, line, onEvent);
				return;
			}
			if (normalizedItemType === "assistant_response") {
				this.emitResponse(item, onEvent);
				return;
			}
			if (normalizedItemType === "assistant_message") {
				this.emitFinal(item, line, onEvent);
				return;
			}
			if (this.isTelemetryItemType(normalizedItemType)) {
				this.emitLog(
					onEvent,
					this.extractText(item) ?? this.extractText(payload) ?? line,
				);
				return;
			}
		}

		if (type === "session.created" && typeof payload.session_id === "string") {
			this.emitLog(onEvent, `[codex:session] ${payload.session_id}`);
			return;
		}

		if (this.isTelemetryType(type)) {
			this.emitLog(onEvent, this.extractText(payload) ?? line);
			return;
		}

		// Default to log to avoid losing visibility into unexpected messages.
		this.emitLog(onEvent, this.extractText(payload) ?? line);
	}

	private emitThought(
		payload: CodexJsonMessage,
		onEvent: (event: RunnerEvent) => void,
	): void {
		if (this.finalDelivered) {
			return;
		}
		const text = this.extractText(payload);
		if (text) {
			onEvent({ kind: "thought", text });
		}
	}

	private emitResponse(
		payload: CodexJsonMessage,
		onEvent: (event: RunnerEvent) => void,
	): void {
		const text = this.extractText(payload);
		const cleaned = this.sanitizeAssistantText(text);
		if (cleaned) {
			onEvent({ kind: "response", text: cleaned });
		}
	}

	private emitFinal(
		payload: CodexJsonMessage,
		raw: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		if (this.finalDelivered) {
			return;
		}
		this.finalDelivered = true;
		const text = this.sanitizeAssistantText(this.extractText(payload));
		onEvent({ kind: "final", text: text ?? "Codex run completed" });
		this.emitLog(onEvent, `[codex:final] ${raw}`);
	}

	private emitCommandAction(
		item: CodexJsonMessage,
		raw: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		if (this.finalDelivered) {
			return;
		}
		const name = this.extractCommandName(item) ?? "command_execution";
		const detail = this.extractCommandDetail(item) ?? raw;
		onEvent({ kind: "action", name, detail });
	}

	private emitError(
		payload: CodexJsonMessage,
		raw: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		const message =
			this.extractText(payload) ??
			(typeof payload.message === "string" ? payload.message : undefined) ??
			"Codex reported an error";
		this.emitLog(onEvent, `[codex:error] ${raw}`);
		const error = new Error(message);
		(error as Error & { cause?: unknown }).cause = payload;
		onEvent({ kind: "error", error });
	}

	private emitLog(onEvent: (event: RunnerEvent) => void, text: string): void {
		if (text.trim().length === 0) {
			return;
		}
		onEvent({ kind: "log", text });
	}

	private isTelemetryType(type: string | undefined): boolean {
		if (!type) {
			return false;
		}
		const normalized = type.toLowerCase();
		return (
			normalized.includes("token") ||
			normalized.includes("status") ||
			normalized.includes("progress") ||
			normalized.includes("telemetry") ||
			normalized.includes("metrics")
		);
	}

	private isTelemetryItemType(itemType: string): boolean {
		return (
			itemType.includes("token") ||
			itemType.includes("status") ||
			itemType.includes("progress") ||
			itemType.includes("telemetry") ||
			itemType.includes("metrics")
		);
	}

	private isErrorPayload(
		type: string | undefined,
		payload: CodexJsonMessage,
	): boolean {
		if (type) {
			const normalized = type.toLowerCase();
			if (
				normalized.includes("error") ||
				normalized.endsWith(".failed") ||
				normalized === "session.failed" ||
				normalized === "item.failed"
			) {
				return true;
			}
		}
		if (typeof payload.error === "string" && payload.error.trim().length > 0) {
			return true;
		}
		if (payload.error && typeof payload.error === "object") {
			return true;
		}
		const level = payload.level;
		if (typeof level === "string" && level.toLowerCase() === "error") {
			return true;
		}
		return false;
	}

	private extractItem(payload: CodexJsonMessage): CodexJsonMessage | undefined {
		const item = payload.item;
		if (item && typeof item === "object" && !Array.isArray(item)) {
			return item as CodexJsonMessage;
		}
		return undefined;
	}

	private extractItemType(item: CodexJsonMessage): string | undefined {
		const type = item.item_type;
		if (typeof type === "string" && type.trim().length > 0) {
			return type.trim();
		}
		return undefined;
	}

	private isItemFailure(item: CodexJsonMessage): boolean {
		const statusValue = item.status;
		const status =
			typeof statusValue === "string" ? statusValue.toLowerCase() : undefined;
		if (status === "failed" || status === "error") {
			return true;
		}
		const outcomeValue = item.outcome;
		const outcome =
			typeof outcomeValue === "string" ? outcomeValue.toLowerCase() : undefined;
		if (outcome === "failure" || outcome === "failed") {
			return true;
		}
		const errorValue = item.error;
		if (typeof errorValue === "string" && errorValue.trim().length > 0) {
			return true;
		}
		if (errorValue && typeof errorValue === "object") {
			return true;
		}
		return false;
	}

	private extractCommandName(item: CodexJsonMessage): string | undefined {
		const candidates = [item.command, item.tool_name, item.name];
		for (const candidate of candidates) {
			if (typeof candidate === "string") {
				const trimmed = candidate.trim();
				if (trimmed.length > 0) {
					return trimmed;
				}
			}
		}
		return undefined;
	}

	private extractCommandDetail(item: CodexJsonMessage): string | undefined {
		const parts: string[] = [];
		const commandValue = item.command;
		const command =
			typeof commandValue === "string" ? commandValue.trim() : undefined;
		if (command) {
			parts.push(`command: ${command}`);
		}
		const argsValue = item.args;
		const args = Array.isArray(argsValue) ? argsValue : undefined;
		if (args && args.length > 0) {
			parts.push(`args: ${args.map(String).join(" ")}`);
		}
		const statusValue = item.status;
		const status =
			typeof statusValue === "string" ? statusValue.trim() : undefined;
		if (status) {
			parts.push(`status: ${status}`);
		}
		const exitCode = item.exit_code;
		if (typeof exitCode === "number") {
			parts.push(`exit_code: ${exitCode}`);
		} else if (typeof exitCode === "string" && exitCode.trim().length > 0) {
			parts.push(`exit_code: ${exitCode.trim()}`);
		}
		const aggregatedRaw = item.aggregated_output;
		const aggregatedOutput =
			typeof aggregatedRaw === "string" ? aggregatedRaw.trim() : undefined;
		if (aggregatedOutput) {
			parts.push(`output:\n${aggregatedOutput}`);
		}
		if (parts.length > 0) {
			return parts.join("\n\n");
		}
		return this.safeJsonStringify(item);
	}

	private safeJsonStringify(value: unknown): string | undefined {
		try {
			return JSON.stringify(value, undefined, 2);
		} catch (_error) {
			return undefined;
		}
	}

	private sanitizeAssistantText(text: string | undefined): string | undefined {
		if (!text) {
			return undefined;
		}
		const cleaned = text.replace(LAST_MESSAGE_MARKER_REGEX, "").trim();
		return cleaned.length > 0 ? cleaned : undefined;
	}

	private extractText(payload: CodexJsonMessage): string | undefined {
		const pieces: string[] = [];
		const visited = new WeakSet<object>();

		const walk = (value: unknown): void => {
			if (!value) {
				return;
			}
			if (typeof value === "string") {
				const trimmed = value.trim();
				if (trimmed.length > 0) {
					pieces.push(trimmed);
				}
				return;
			}
			if (Array.isArray(value)) {
				for (const item of value) {
					walk(item);
				}
				return;
			}
			if (typeof value !== "object") {
				return;
			}
			if (visited.has(value as object)) {
				return;
			}
			visited.add(value as object);

			const record = value as Record<string, unknown>;
			for (const key of ["text", "content", "message", "delta", "reasoning"]) {
				const nested = record[key];
				if (nested) {
					walk(nested);
				}
			}
			for (const [key, nested] of Object.entries(record)) {
				if (nested && (Array.isArray(nested) || typeof nested === "object")) {
					walk(nested);
				} else if (typeof nested === "string") {
					if (
						key === "type" ||
						key === "role" ||
						key === "name" ||
						key === "item_type" ||
						key === "status"
					) {
						continue;
					}
					const trimmed = nested.trim();
					if (trimmed.length > 0) {
						pieces.push(trimmed);
					}
				}
			}
		};

		walk(payload);
		if (pieces.length === 0) {
			return undefined;
		}
		const uniquePieces = Array.from(new Set(pieces));
		return uniquePieces.join("\n");
	}
}
