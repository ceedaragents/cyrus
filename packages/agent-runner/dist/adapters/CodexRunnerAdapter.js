import { spawn } from "node:child_process";
import { toError } from "../utils/errors.js";
import { pipeStreamLines } from "../utils/stream.js";
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
		if (type === "error" || this.hasErrorField(payload)) {
			this.emitError(payload, line, onEvent);
			return;
		}
		if (this.isFinalMessage(type, payload)) {
			this.emitFinal(payload, line, onEvent);
			return;
		}
		if (type === "agent_response") {
			this.emitResponse(payload, onEvent);
			return;
		}
		if (type === "agent_reasoning" || this.resemblesThought(payload)) {
			this.emitThought(payload, onEvent);
			return;
		}
		if (this.isToolEvent(type, payload)) {
			this.emitAction(payload, line, onEvent);
			return;
		}
		if (this.isLogEvent(type)) {
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
		const text = this.extractText(payload);
		if (text) {
			onEvent({ kind: "thought", text });
		}
	}
	emitResponse(payload, onEvent) {
		const text = this.extractText(payload);
		if (text) {
			onEvent({ kind: "response", text });
		}
	}
	emitFinal(payload, raw, onEvent) {
		if (this.finalDelivered) {
			return;
		}
		this.finalDelivered = true;
		const text = this.extractText(payload) ?? "Codex run completed";
		onEvent({ kind: "final", text });
		this.emitLog(onEvent, `[codex:final] ${raw}`);
	}
	emitAction(payload, raw, onEvent) {
		if (this.finalDelivered) {
			return;
		}
		const name = this.extractToolName(payload) ?? "codex-tool";
		const detail = this.extractToolDetail(payload) ?? raw;
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
	isFinalMessage(type, payload) {
		if (this.finalDelivered) {
			return false;
		}
		if (!type && typeof payload.final === "boolean") {
			return Boolean(payload.final);
		}
		return (
			type === "agent_message" ||
			type === "final" ||
			type === "agent_final" ||
			Boolean(payload.message?.final)
		);
	}
	isToolEvent(type, payload) {
		if (typeof type === "string" && type.toLowerCase().includes("tool")) {
			return true;
		}
		if (typeof payload.tool === "object" && payload.tool !== null) {
			return true;
		}
		const message = payload.message;
		return Boolean(message?.tool);
	}
	isLogEvent(type) {
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
	hasErrorField(payload) {
		if (payload.error && typeof payload.error === "object") {
			return true;
		}
		if (typeof payload.level === "string" && payload.level === "error") {
			return true;
		}
		return false;
	}
	resemblesThought(payload) {
		if (this.finalDelivered) {
			return false;
		}
		if (typeof payload.reasoning === "string") {
			return true;
		}
		const message = payload.message;
		return typeof message?.role === "string" && message.role === "assistant";
	}
	extractToolName(payload) {
		const tool = this.findToolPayload(payload);
		if (!tool) {
			return undefined;
		}
		if (typeof tool.name === "string") {
			return tool.name;
		}
		if (typeof tool.tool === "string") {
			return tool.tool;
		}
		return undefined;
	}
	extractToolDetail(payload) {
		const tool = this.findToolPayload(payload);
		const detailSource =
			tool?.input ??
			tool?.arguments ??
			tool?.params ??
			payload.arguments ??
			payload.input ??
			tool;
		const detail = detailSource;
		try {
			return typeof detail === "string"
				? detail
				: JSON.stringify(detail, undefined, 2);
		} catch (_error) {
			return undefined;
		}
	}
	findToolPayload(payload) {
		if (payload.tool && typeof payload.tool === "object") {
			return payload.tool;
		}
		const message = payload.message;
		if (message && typeof message === "object") {
			const tool = message.tool;
			if (tool && typeof tool === "object") {
				return tool;
			}
		}
		return undefined;
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
					if (key === "type" || key === "role" || key === "name") {
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
//# sourceMappingURL=CodexRunnerAdapter.js.map
