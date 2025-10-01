import { spawn } from "node:child_process";
import { toError } from "../utils/errors.js";
import { pipeStreamLines } from "../utils/stream.js";

const LAST_MESSAGE_MARKER_REGEX = /___LAST_MESSAGE_MARKER___/g;
const IGNORED_TEXT_KEYS = new Set([
	"type",
	"role",
	"name",
	"item_type",
	"status",
	"id",
	"item_id",
	"session_id",
	"command",
	"args",
	"exit_code",
	"aggregated_output",
]);
const ITEM_ID_PATTERN = /^item_\d+$/i;
export class CodexRunnerAdapter {
	config;
	child;
	finalDelivered = false;
	constructor(config) {
		this.config = config;
	}
	async start(onEvent) {
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
	async stop() {
		if (this.child && !this.child.killed) {
			this.child.kill("SIGTERM");
			this.child = undefined;
		}
	}
	handleStdoutLine(rawLine, onEvent) {
		const line = rawLine.trim();
		if (line.length === 0) {
			return;
		}
		let payload;
		try {
			payload = JSON.parse(line);
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
	emitThought(payload, onEvent) {
		if (this.finalDelivered) {
			return;
		}
		const text = this.stripItemTokens(this.extractText(payload));
		if (text) {
			onEvent({ kind: "thought", text });
		}
	}
	emitResponse(payload, onEvent) {
		const text = this.extractText(payload);
		const cleaned = this.sanitizeAssistantText(text);
		if (cleaned) {
			onEvent({ kind: "response", text: cleaned });
		}
	}
	emitFinal(payload, raw, onEvent) {
		if (this.finalDelivered) {
			return;
		}
		this.finalDelivered = true;
		const text = this.sanitizeAssistantText(this.extractText(payload));
		onEvent({ kind: "final", text: text ?? "Codex run completed" });
		this.emitLog(onEvent, `[codex:final] ${raw}`);
	}
	emitCommandAction(item, raw, onEvent) {
		if (this.finalDelivered) {
			return;
		}
		const name = this.extractCommandName(item) ?? "command_execution";
		const detail = this.extractCommandDetail(item) ?? raw;
		onEvent({ kind: "action", name, detail });
	}
	emitError(payload, raw, onEvent) {
		const message =
			this.extractText(payload) ??
			(typeof payload.message === "string" ? payload.message : undefined) ??
			"Codex reported an error";
		this.emitLog(onEvent, `[codex:error] ${raw}`);
		const error = new Error(message);
		error.cause = payload;
		onEvent({ kind: "error", error });
	}
	emitLog(onEvent, text) {
		if (text.trim().length === 0) {
			return;
		}
		onEvent({ kind: "log", text });
	}
	isTelemetryType(type) {
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
	isTelemetryItemType(itemType) {
		return (
			itemType.includes("token") ||
			itemType.includes("status") ||
			itemType.includes("progress") ||
			itemType.includes("telemetry") ||
			itemType.includes("metrics")
		);
	}
	isErrorPayload(type, payload) {
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
	extractItem(payload) {
		const item = payload.item;
		if (item && typeof item === "object" && !Array.isArray(item)) {
			return item;
		}
		return undefined;
	}
	extractItemType(item) {
		const type = item.item_type;
		if (typeof type === "string" && type.trim().length > 0) {
			return type.trim();
		}
		return undefined;
	}
	isItemFailure(item) {
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
	extractCommandName(item) {
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
	extractCommandDetail(item) {
		const parts = [];
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
	safeJsonStringify(value) {
		try {
			return JSON.stringify(value, undefined, 2);
		} catch (_error) {
			return undefined;
		}
	}
	sanitizeAssistantText(text) {
		if (!text) {
			return undefined;
		}
		const withoutMarker = text.replace(LAST_MESSAGE_MARKER_REGEX, "");
		return this.stripItemTokens(withoutMarker);
	}
	stripItemTokens(text) {
		if (!text) {
			return undefined;
		}
		const cleanedLines = text
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0 && !ITEM_ID_PATTERN.test(line));
		if (cleanedLines.length === 0) {
			return undefined;
		}
		return cleanedLines.join("\n");
	}
	extractText(payload) {
		const pieces = [];
		const visited = new WeakSet();
		const walk = (value) => {
			if (!value) {
				return;
			}
			if (typeof value === "string") {
				const trimmed = value.trim();
				if (trimmed.length > 0 && !ITEM_ID_PATTERN.test(trimmed)) {
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
			if (visited.has(value)) {
				return;
			}
			visited.add(value);
			const record = value;
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
					if (IGNORED_TEXT_KEYS.has(key)) {
						continue;
					}
					const trimmed = nested.trim();
					if (trimmed.length > 0 && !ITEM_ID_PATTERN.test(trimmed)) {
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
//# sourceMappingURL=CodexRunnerAdapter.js.map
