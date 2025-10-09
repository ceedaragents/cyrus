import {
	type ChildProcessWithoutNullStreams,
	spawn,
	spawnSync,
} from "node:child_process";
import type {
	CodexRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
import { toError } from "../utils/errors.js";
import { pipeStreamLines } from "../utils/stream.js";

type CodexJsonMessage = Record<string, unknown>;

type CodexCliFeatures = {
	supportsJson: boolean;
	supportsApprovalPolicy: boolean;
	supportsSandbox: boolean;
	supportsFullAuto: boolean;
};

let cachedFeatures: CodexCliFeatures | undefined;

function detectCodexFeatures(
	env: NodeJS.ProcessEnv | undefined,
): CodexCliFeatures {
	if (cachedFeatures) {
		return cachedFeatures;
	}

	let helpOutput = "";
	try {
		const detection = spawnSync("codex", ["exec", "--help"], {
			env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		helpOutput = `${detection.stdout ?? ""}${detection.stderr ?? ""}`;
	} catch (_error) {
		helpOutput = "";
	}

	cachedFeatures = {
		supportsJson: helpOutput.includes("--json"),
		supportsApprovalPolicy: helpOutput.includes("--approval-policy"),
		supportsSandbox: helpOutput.includes("--sandbox"),
		supportsFullAuto: helpOutput.toLowerCase().includes("--full-auto"),
	};

	return cachedFeatures;
}

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

export class CodexRunnerAdapter implements Runner {
	private child?: ChildProcessWithoutNullStreams;

	private finalDelivered = false;
	private stopRequested = false;
	private stopWait?: Promise<void>;
	private stopKillTimer?: NodeJS.Timeout;

	constructor(private readonly config: CodexRunnerOptions) {}

	async start(
		onEvent: (event: RunnerEvent) => void,
	): Promise<RunnerStartResult> {
		const env = { ...process.env, ...(this.config.env ?? {}) };
		const features = detectCodexFeatures(env);
		const args = ["exec", "--json", "--cd", this.config.cwd];
		if (!features.supportsJson) {
			this.emitLog(
				onEvent,
				"Codex CLI help did not list --json; attempting to continue regardless",
			);
		}

		const requestedSandbox = this.config.sandbox;
		const requestedFullAuto = this.config.fullAuto ?? false;
		let derivedFullAuto = false;

		if (requestedSandbox && features.supportsSandbox) {
			args.push("--sandbox", requestedSandbox);
		} else if (requestedSandbox && !features.supportsSandbox) {
			if (requestedSandbox === "workspace-write") {
				derivedFullAuto = true;
				this.emitLog(
					onEvent,
					"Codex CLI lacks --sandbox; enabling --full-auto so workspace edits remain allowed",
				);
			} else if (requestedSandbox === "danger-full-access") {
				derivedFullAuto = true;
				this.emitLog(
					onEvent,
					"Codex CLI lacks sandbox controls; proceeding with --full-auto",
				);
			}
		}

		const fullAuto = requestedFullAuto || derivedFullAuto;

		if (fullAuto) {
			if (features.supportsFullAuto) {
				args.push("--full-auto");
			} else {
				this.emitLog(
					onEvent,
					"Codex CLI does not expose --full-auto; continuing without explicit flag",
				);
			}
		}

		if (this.config.model) {
			args.push("-m", this.config.model);
		}

		if (features.supportsApprovalPolicy && this.config.approvalPolicy) {
			args.push("--approval-policy", this.config.approvalPolicy);
		} else if (!features.supportsApprovalPolicy && this.config.approvalPolicy) {
			this.emitLog(
				onEvent,
				"Codex CLI does not support --approval-policy; falling back to CLI defaults",
			);
		}
		if (this.config.resumeSessionId) {
			args.push("resume", this.config.resumeSessionId, this.config.prompt);
		} else {
			args.push(this.config.prompt);
		}

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
				if (this.stopRequested) {
					// Intentionally stopped; suppress error emission
					this.emitLog(onEvent, `Codex stopped intentionally (${reason})`);
				} else if (this.finalDelivered) {
					this.emitLog(onEvent, `Codex exited with ${reason}`);
				} else {
					onEvent({
						kind: "error",
						error: new Error(
							`Codex exited before delivering a final response (${reason})`,
						),
					});
				}
				this.stopRequested = false;
				return;
			}

			if (!this.finalDelivered) {
				if (this.stopRequested) {
					// Intentionally stopped; do not emit error
					this.emitLog(onEvent, "Codex stopped intentionally (no final)");
				} else {
					onEvent({
						kind: "error",
						error: new Error(
							"Codex exited without delivering a final response",
						),
					});
				}
				this.stopRequested = false;
			}
		});

		return { capabilities: { jsonStream: true } };
	}

	async stop(): Promise<void> {
		if (this.stopWait) {
			await this.stopWait;
			return;
		}
		const child = this.child;
		if (!child) {
			return;
		}
		// Mark that a stop was requested so close handler can suppress errors
		this.stopRequested = true;
		this.stopWait = new Promise<void>((resolve) => {
			let completed = false;
			const onClose = (): void => {
				completed = true;
				if (this.stopKillTimer) {
					clearTimeout(this.stopKillTimer);
					this.stopKillTimer = undefined;
				}
				this.stopWait = undefined;
				this.stopRequested = false;
				resolve();
			};
			child.once("close", onClose);
			child.once("exit", onClose);

			this.stopKillTimer = setTimeout(() => {
				if (!completed) {
					try {
						child.kill("SIGKILL");
					} catch (error) {
						console.warn("Failed to SIGKILL codex process", error);
					}
				}
			}, 5000);
		});

		try {
			child.kill("SIGTERM");
		} catch (error) {
			console.warn("Failed to SIGTERM codex process", error);
		}

		await this.stopWait;
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
		const normalizedType = this.normalizeEventType(type);
		if (this.isErrorPayload(type, payload)) {
			this.emitError(payload, line, onEvent);
			return;
		}

		const item = this.extractItem(payload);
		const itemType = item ? this.extractItemType(item) : undefined;
		if (item && itemType) {
			const normalizedItemType = this.normalizeItemType(itemType);
			if (this.isItemFailure(item)) {
				this.emitError(payload, line, onEvent);
				return;
			}
			if (normalizedItemType.includes("reasoning")) {
				this.emitThought(item, onEvent);
				return;
			}
			if (this.isToolActionType(normalizedItemType)) {
				this.emitToolAction(item, normalizedItemType, line, onEvent);
				return;
			}
			if (normalizedItemType === "assistant_response") {
				this.emitResponse(item, onEvent);
				return;
			}
			if (
				normalizedItemType === "assistant_message" ||
				normalizedItemType === "agent_message"
			) {
				const assistantText =
					this.extractText(item) ?? this.extractText(payload);
				const shouldFinalize = normalizedType === "item.completed";
				if (shouldFinalize) {
					this.emitFinal(item, line, onEvent);
				} else if (
					normalizedType === "item.started" ||
					normalizedType === "item.updated"
				) {
					this.emitResponse(item, onEvent);
				} else if (!normalizedType && assistantText) {
					// Legacy Codex builds may omit item events; treat as response until completion is clear.
					this.emitResponse(item, onEvent);
				}
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

		if (
			normalizedType === "thread.started" ||
			normalizedType === "thread.resumed"
		) {
			const threadId = this.extractThreadId(payload);
			if (threadId) {
				onEvent({ kind: "session", id: threadId });
				this.emitLog(onEvent, `[codex:${normalizedType}] ${threadId}`);
			} else {
				this.emitLog(
					onEvent,
					this.extractText(payload) ?? `[codex:${normalizedType}] ${line}`,
				);
			}
			return;
		}

		if (type === "session.created" && typeof payload.session_id === "string") {
			const sessionId = payload.session_id;
			onEvent({ kind: "session", id: sessionId });
			this.emitLog(onEvent, `[codex:session] ${sessionId}`);
			return;
		}

		if (normalizedType === "turn.started") {
			this.emitLog(
				onEvent,
				this.formatTurnLogMessage("started", payload) ?? `[codex:turn] ${line}`,
			);
			return;
		}

		if (normalizedType === "turn.completed") {
			const message =
				this.formatTurnLogMessage("completed", payload) ??
				this.extractText(payload) ??
				`turn completed`;
			this.emitLog(onEvent, message);
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
		const text = this.stripItemTokens(this.extractText(payload));
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

	private emitToolAction(
		item: CodexJsonMessage,
		itemType: string,
		raw: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		if (this.finalDelivered) {
			return;
		}
		const name = this.resolveActionName(item, itemType);
		const detail = this.buildActionDetail(item, itemType) ?? raw;
		const icon = this.iconForItemType(itemType);
		onEvent({ kind: "action", name, detail, itemType, icon });
	}

	private resolveActionName(item: CodexJsonMessage, itemType: string): string {
		switch (itemType) {
			case "file_change":
			case "filechange": {
				const file = this.extractFilePath(item);
				return file ?? "file change";
			}
			case "mcp_tool_call":
			case "mcp_toolcall": {
				const toolName = this.extractStringField(item, [
					"tool_name",
					"tool",
					"name",
				]);
				return toolName ?? "mcp tool call";
			}
			case "web_search":
			case "websearch": {
				const query = this.extractStringField(item, [
					"query",
					"search",
					"name",
				]);
				return query ?? "web search";
			}
			default: {
				const commandName = this.extractCommandName(item);
				if (commandName) {
					return commandName;
				}
				return itemType.replace(/_/g, " ");
			}
		}
	}

	private buildActionDetail(
		item: CodexJsonMessage,
		itemType: string,
	): string | undefined {
		switch (itemType) {
			case "file_change":
			case "filechange":
				return this.buildFileChangeDetail(item);
			case "mcp_tool_call":
			case "mcp_toolcall":
				return this.buildMcpToolDetail(item);
			case "web_search":
			case "websearch":
				return this.buildWebSearchDetail(item);
			default:
				return this.extractCommandDetail(item);
		}
	}

	private iconForItemType(itemType: string): string | undefined {
		switch (itemType) {
			case "command_execution":
			case "commandexecution":
				return "⚙️";
			case "mcp_tool_call":
			case "mcp_toolcall":
				return "🧰";
			case "file_change":
			case "filechange":
				return "📝";
			case "web_search":
			case "websearch":
				return "🔍";
			default:
				return "🛠️";
		}
	}

	private buildFileChangeDetail(item: CodexJsonMessage): string | undefined {
		const parts: string[] = [];
		const file = this.extractFilePath(item);
		if (file) {
			parts.push(`file: ${file}`);
		}
		const changeKind = this.extractStringField(item, [
			"change_type",
			"changeType",
			"status",
			"action",
		]);
		if (changeKind) {
			parts.push(`change: ${changeKind}`);
		}
		const summary = this.extractStringField(item, [
			"summary",
			"description",
			"text",
		]);
		if (summary) {
			parts.push(summary);
		}
		const diff = this.extractStringField(item, ["diff", "patch"]);
		if (diff) {
			parts.push(`diff:\n${diff}`);
		}
		if (parts.length > 0) {
			return parts.join("\n\n");
		}
		return this.safeJsonStringify(item);
	}

	private buildMcpToolDetail(item: CodexJsonMessage): string | undefined {
		const parts: string[] = [];
		const toolName = this.extractStringField(item, [
			"tool_name",
			"tool",
			"name",
		]);
		if (toolName) {
			parts.push(`tool: ${toolName}`);
		}
		const argumentsValue = item.arguments ?? item.args ?? item.parameters;
		if (argumentsValue) {
			const serialized = this.safeJsonStringify(argumentsValue);
			if (serialized) {
				parts.push(`arguments:\n${serialized}`);
			}
		}
		const output = this.extractStringField(item, [
			"result",
			"output",
			"response",
		]);
		if (output) {
			parts.push(`output:\n${output}`);
		}
		if (parts.length > 0) {
			return parts.join("\n\n");
		}
		return this.safeJsonStringify(item);
	}

	private buildWebSearchDetail(item: CodexJsonMessage): string | undefined {
		const parts: string[] = [];
		const query = this.extractStringField(item, ["query", "search", "name"]);
		if (query) {
			parts.push(`query: ${query}`);
		}
		const provider = this.extractStringField(item, ["provider", "engine"]);
		if (provider) {
			parts.push(`provider: ${provider}`);
		}
		const results = item.results ?? item.documents ?? item.links;
		if (results) {
			const serialized = this.safeJsonStringify(results);
			if (serialized) {
				parts.push(`results:\n${serialized}`);
			}
		}
		if (parts.length > 0) {
			return parts.join("\n\n");
		}
		return this.safeJsonStringify(item);
	}

	private extractFilePath(item: CodexJsonMessage): string | undefined {
		const candidates = [
			item.file,
			item.file_path,
			item.filePath,
			item.path,
			item.target,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string") {
				const trimmed = candidate.trim();
				if (trimmed.length > 0) {
					return trimmed;
				}
			}
		}
		if (Array.isArray(item.files) && item.files.length > 0) {
			const first = item.files[0];
			if (typeof first === "string") {
				const trimmed = first.trim();
				if (trimmed.length > 0) {
					return trimmed;
				}
			}
		}
		return undefined;
	}

	private extractStringField(
		source: CodexJsonMessage,
		keys: string[],
	): string | undefined {
		for (const key of keys) {
			const value = source[key];
			if (typeof value === "string") {
				const trimmed = value.trim();
				if (trimmed.length > 0) {
					return trimmed;
				}
			}
		}
		return undefined;
	}

	private formatTurnLogMessage(
		phase: "started" | "completed",
		payload: CodexJsonMessage,
	): string | undefined {
		const turnId = this.extractStringField(payload, ["turn_id", "id"]);
		const prefix = turnId ? `turn ${phase} (${turnId})` : `turn ${phase}`;
		if (phase === "completed") {
			const usageText = this.formatUsage(payload.usage);
			if (usageText) {
				return `${prefix} ${usageText}`;
			}
		}
		return prefix;
	}

	private formatUsage(value: unknown): string | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}
		const record = value as Record<string, unknown>;
		const segments: string[] = [];
		for (const [key, entry] of Object.entries(record)) {
			if (typeof entry === "number") {
				segments.push(`${key}: ${entry}`);
			}
		}
		if (segments.length === 0) {
			return undefined;
		}
		return `{ ${segments.join(", ")} }`;
	}

	private extractThreadId(payload: CodexJsonMessage): string | undefined {
		const candidates = [payload.thread_id, payload.session_id, payload.id];
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

	private emitError(
		payload: CodexJsonMessage,
		raw: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		const message = this.buildErrorMessage(payload);
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

	private normalizeEventType(type: string | undefined): string | undefined {
		if (!type) {
			return undefined;
		}
		const trimmed = type.trim();
		if (trimmed.length === 0) {
			return undefined;
		}
		return trimmed.toLowerCase();
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

	private normalizeItemType(itemType: string): string {
		return itemType
			.trim()
			.toLowerCase()
			.replace(/[\s-]+/g, "_");
	}

	private isToolActionType(itemType: string): boolean {
		if (itemType.includes("command") || itemType.includes("tool")) {
			return true;
		}
		switch (itemType) {
			case "file_change":
			case "filechange":
			case "web_search":
			case "websearch":
				return true;
			default:
				return false;
		}
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
		const candidates = [item.item_type, item.type];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return candidate.trim();
			}
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
		const withoutIds = text.replace(/\bitem_\d+\b/gi, "");
		return this.stripItemTokens(withoutIds);
	}

	private buildErrorMessage(payload: CodexJsonMessage): string {
		const parts: string[] = [];
		const payloadText = this.extractText(payload);
		const explicitMessage =
			typeof payload.message === "string" ? payload.message.trim() : undefined;
		if (payloadText && payloadText.length > 0) {
			parts.push(payloadText);
		} else if (explicitMessage && explicitMessage.length > 0) {
			parts.push(explicitMessage);
		}

		const item = this.extractItem(payload);
		const command = item ? this.extractCommandName(item) : undefined;
		const exitCode = this.extractExitCode(item, payload);
		if (command) {
			const exitSuffix =
				exitCode !== undefined && exitCode !== "" ? ` (exit ${exitCode})` : "";
			parts.push(`Command: ${command}${exitSuffix}`);
		}

		const aggregated = this.extractAggregatedOutput(item, payload);
		if (aggregated) {
			parts.push(`Output:\n${aggregated}`);
		}

		if (parts.length > 0) {
			return parts.join("\n\n");
		}

		if (command) {
			return exitCode !== undefined && exitCode !== ""
				? `Codex command ${command} failed (exit ${exitCode})`
				: `Codex command ${command} failed`;
		}

		const errorObj = payload.error;
		if (
			errorObj &&
			typeof errorObj === "object" &&
			"message" in errorObj &&
			typeof (errorObj as { message?: unknown }).message === "string"
		) {
			return (errorObj as { message: string }).message;
		}

		return "Codex reported an error";
	}

	private extractExitCode(
		item: CodexJsonMessage | undefined,
		payload: CodexJsonMessage,
	): number | string | undefined {
		const candidates = [
			item?.exit_code,
			item?.exitCode,
			payload.exit_code,
			payload.exitCode,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "number" || typeof candidate === "string") {
				return candidate;
			}
		}
		return undefined;
	}

	private extractAggregatedOutput(
		item: CodexJsonMessage | undefined,
		payload: CodexJsonMessage,
	): string | undefined {
		const candidates = [
			item?.aggregated_output,
			item?.aggregatedOutput,
			payload.aggregated_output,
			payload.aggregatedOutput,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return this.truncateOutput(candidate.trim());
			}
			if (
				Array.isArray(candidate) &&
				candidate.length > 0 &&
				candidate.every((value) => typeof value === "string")
			) {
				return this.truncateOutput(
					(candidate as string[])
						.map((value) => value.trim())
						.filter((value) => value.length > 0)
						.join("\n"),
				);
			}
		}
		return undefined;
	}

	private truncateOutput(output: string, limit = 2000): string {
		if (output.length <= limit) {
			return output;
		}
		return `${output.slice(0, limit)}...`;
	}

	private stripItemTokens(text: string | undefined): string | undefined {
		if (!text) {
			return undefined;
		}
		const cleanedLines = text
			.split(/\r?\n/)
			.map((line) => line.replace(/\bitem_\d+\b/gi, "").trim())
			.filter((line) => line.length > 0 && !ITEM_ID_PATTERN.test(line));
		if (cleanedLines.length === 0) {
			return undefined;
		}
		return cleanedLines.join("\n");
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

export function __resetCodexFeatureCacheForTests(): void {
	cachedFeatures = undefined;
}
