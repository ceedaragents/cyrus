import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join, relative as pathRelative } from "node:path";
import { cwd } from "node:process";
import { createInterface } from "node:readline";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import { CursorMessageFormatter } from "./formatter.js";
import type {
	CursorJsonEvent,
	CursorRunnerConfig,
	CursorRunnerEvents,
	CursorSessionInfo,
} from "./types.js";

type ToolInput = Record<string, unknown>;

interface ParsedUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
}

interface ToolProjection {
	toolUseId: string;
	toolName: string;
	toolInput: ToolInput;
	result: string;
	isError: boolean;
}

type SDKSystemInitMessage = Extract<
	SDKMessage,
	{ type: "system"; subtype: "init" }
>;

function toFiniteNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function createAssistantToolUseMessage(
	toolUseId: string,
	toolName: string,
	toolInput: ToolInput,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{
			type: "tool_use",
			id: toolUseId,
			name: toolName,
			input: toolInput,
		},
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		content: contentBlocks,
		model: "cursor-agent",
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		} as SDKAssistantMessage["message"]["usage"],
		container: null,
		context_management: null,
	};
}

function createUserToolResultMessage(
	toolUseId: string,
	result: string,
	isError: boolean,
): SDKUserMessage["message"] {
	const contentBlocks = [
		{
			type: "tool_result",
			tool_use_id: toolUseId,
			content: result,
			is_error: isError,
		},
	] as unknown as SDKUserMessage["message"]["content"];

	return {
		role: "user",
		content: contentBlocks,
	};
}

function createAssistantBetaMessage(
	content: string,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{ type: "text", text: content },
	] as unknown as SDKAssistantMessage["message"]["content"];

	return {
		id: messageId,
		type: "message",
		role: "assistant",
		content: contentBlocks,
		model: "cursor-agent",
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
		} as SDKAssistantMessage["message"]["usage"],
		container: null,
		context_management: null,
	};
}

function createResultUsage(parsed: ParsedUsage): SDKResultMessage["usage"] {
	return {
		input_tokens: parsed.inputTokens,
		output_tokens: parsed.outputTokens,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: parsed.cachedInputTokens,
		cache_creation: {
			ephemeral_1h_input_tokens: 0,
			ephemeral_5m_input_tokens: 0,
		},
	} as SDKResultMessage["usage"];
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Cursor execution failed";
}

function inferCommandToolName(command: string): string {
	const normalized = command.toLowerCase();
	if (/\brg\b|\bgrep\b/.test(normalized)) {
		return "Grep";
	}
	if (/\bglob\.glob\b|\bfind\b.+\s-name\s/.test(normalized)) {
		return "Glob";
	}
	if (/\bcat\b/.test(normalized) && !/>/.test(normalized)) {
		return "Read";
	}
	if (
		/<<\s*['"]?eof['"]?\s*>/i.test(command) ||
		/\becho\b.+>/.test(normalized)
	) {
		return "Write";
	}
	return "Bash";
}

function normalizeFilePath(path: string, workingDirectory?: string): string {
	if (!path) {
		return path;
	}

	if (workingDirectory && path.startsWith(workingDirectory)) {
		const relativePath = pathRelative(workingDirectory, path);
		if (relativePath && relativePath !== ".") {
			return relativePath;
		}
	}

	return path;
}

function summarizeFileChanges(
	item: Record<string, unknown>,
	workingDirectory?: string,
): string {
	const changes = Array.isArray(item.changes) ? item.changes : [];
	if (!changes.length) {
		return item.status === "failed" ? "Patch failed" : "No file changes";
	}

	return changes
		.map((change) => {
			if (!change || typeof change !== "object") {
				return null;
			}
			const mapped = change as Record<string, unknown>;
			const path = typeof mapped.path === "string" ? mapped.path : "";
			const kind = typeof mapped.kind === "string" ? mapped.kind : "update";
			const filePath = normalizeFilePath(path, workingDirectory);
			return `${kind} ${filePath}`;
		})
		.filter((line): line is string => Boolean(line))
		.join("\n");
}

function summarizeTodoList(item: Record<string, unknown>): string {
	const todos = Array.isArray(item.items) ? item.items : [];
	if (!todos.length) {
		return "No todos";
	}

	return todos
		.map((todo) => {
			if (!todo || typeof todo !== "object") {
				return "- [ ] task";
			}
			const mapped = todo as Record<string, unknown>;
			const text =
				typeof mapped.content === "string"
					? mapped.content
					: typeof mapped.description === "string"
						? mapped.description
						: "task";
			const status =
				typeof mapped.status === "string"
					? mapped.status.toLowerCase()
					: "pending";
			const marker = status === "completed" ? "[x]" : "[ ]";
			const suffix = status === "in_progress" ? " (in progress)" : "";
			return `- ${marker} ${text}${suffix}`;
		})
		.join("\n");
}

function getStringValue(
	object: Record<string, unknown>,
	...keys: string[]
): string | undefined {
	for (const key of keys) {
		const value = object[key];
		if (typeof value === "string" && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
}

function getProjectionForItem(
	item: Record<string, unknown>,
	workingDirectory?: string,
): ToolProjection | null {
	const itemId = getStringValue(item, "id", "tool_id", "item_id");
	if (!itemId) {
		return null;
	}

	const itemType = getStringValue(item, "type");
	const status = getStringValue(item, "status") || "completed";
	const isError = status === "failed";

	if (itemType === "command_execution") {
		const command = getStringValue(item, "command") || "";
		const output = getStringValue(item, "aggregated_output", "output") || "";
		const exitCodeValue = item.exit_code;
		const exitCode = toFiniteNumber(exitCodeValue);
		const toolName = inferCommandToolName(command);
		const toolInput: ToolInput = {
			command,
			description: command,
		};
		const result =
			output ||
			(isError
				? `Command failed${exitCode ? ` (exit ${exitCode})` : ""}`
				: "Command completed");
		return {
			toolUseId: itemId,
			toolName,
			toolInput,
			result,
			isError,
		};
	}

	if (itemType === "file_change") {
		const summary = summarizeFileChanges(item, workingDirectory);
		return {
			toolUseId: itemId,
			toolName: "Edit",
			toolInput: { description: summary },
			result: summary,
			isError,
		};
	}

	if (itemType === "web_search") {
		const query = getStringValue(item, "query") || "web search";
		const actionValue = item.action;
		let toolInput: ToolInput = { query };
		let result = query;
		if (actionValue && typeof actionValue === "object") {
			const action = actionValue as Record<string, unknown>;
			const url = getStringValue(action, "url");
			if (url) {
				toolInput = { url };
				result = url;
			}
		}
		return {
			toolUseId: itemId,
			toolName: "WebSearch",
			toolInput,
			result,
			isError,
		};
	}

	if (itemType === "mcp_tool_call") {
		const server = getStringValue(item, "server") || "mcp";
		const tool = getStringValue(item, "tool") || "tool";
		const args =
			item.arguments && typeof item.arguments === "object"
				? item.arguments
				: {};
		const result =
			getStringValue(item, "result") ||
			safeStringify(item.result || "MCP tool completed");
		return {
			toolUseId: itemId,
			toolName: `mcp__${server}__${tool}`,
			toolInput: args as ToolInput,
			result,
			isError,
		};
	}

	if (itemType === "todo_list") {
		const summary = summarizeTodoList(item);
		return {
			toolUseId: itemId,
			toolName: "TodoWrite",
			toolInput: { todos: item.items },
			result: summary,
			isError,
		};
	}

	return null;
}

function extractUsageFromEvent(
	event: Record<string, unknown>,
): ParsedUsage | null {
	const usageRaw =
		event.usage && typeof event.usage === "object"
			? (event.usage as Record<string, unknown>)
			: null;
	if (!usageRaw) {
		return null;
	}
	return {
		inputTokens: toFiniteNumber(usageRaw.input_tokens),
		outputTokens: toFiniteNumber(usageRaw.output_tokens),
		cachedInputTokens: toFiniteNumber(usageRaw.cached_input_tokens),
	};
}

export declare interface CursorRunner {
	on<K extends keyof CursorRunnerEvents>(
		event: K,
		listener: CursorRunnerEvents[K],
	): this;
	emit<K extends keyof CursorRunnerEvents>(
		event: K,
		...args: Parameters<CursorRunnerEvents[K]>
	): boolean;
}

export class CursorRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;

	private config: CursorRunnerConfig;
	private sessionInfo: CursorSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;
	private process: ChildProcess | null = null;
	private readlineInterface: ReturnType<typeof createInterface> | null = null;
	private pendingResultMessage: SDKResultMessage | null = null;
	private hasInitMessage = false;
	private lastAssistantText: string | null = null;
	private wasStopped = false;
	private startTimestampMs = 0;
	private lastUsage: ParsedUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
	};
	private errorMessages: string[] = [];
	private emittedToolUseIds = new Set<string>();
	private fallbackOutputLines: string[] = [];
	private logStream: WriteStream | null = null;

	constructor(config: CursorRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new CursorMessageFormatter();

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<CursorSessionInfo> {
		return this.startWithPrompt(prompt);
	}

	async startStreaming(initialPrompt?: string): Promise<CursorSessionInfo> {
		return this.startWithPrompt(null, initialPrompt);
	}

	addStreamMessage(_content: string): void {
		throw new Error("CursorRunner does not support streaming input messages");
	}

	completeStream(): void {
		// No-op: CursorRunner does not support streaming input.
	}

	private async startWithPrompt(
		stringPrompt?: string | null,
		streamingInitialPrompt?: string,
	): Promise<CursorSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Cursor session already running");
		}

		const sessionId = this.config.resumeSessionId || crypto.randomUUID();
		this.sessionInfo = {
			sessionId,
			startedAt: new Date(),
			isRunning: true,
		};

		this.messages = [];
		this.pendingResultMessage = null;
		this.hasInitMessage = false;
		this.lastAssistantText = null;
		this.wasStopped = false;
		this.startTimestampMs = Date.now();
		this.lastUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
		};
		this.errorMessages = [];
		this.emittedToolUseIds.clear();
		this.fallbackOutputLines = [];
		this.setupLogging(sessionId);

		// Test/CI fallback: allow deterministic mock runs when cursor-agent cannot execute.
		if (process.env.CYRUS_CURSOR_MOCK === "1") {
			this.emitInitMessage();
			this.handleEvent({
				type: "message",
				role: "assistant",
				content: "Cursor mock session completed",
			});
			this.pendingResultMessage = this.createSuccessResultMessage(
				"Cursor mock session completed",
			);
			this.finalizeSession();
			return this.sessionInfo;
		}

		const prompt = (stringPrompt ?? streamingInitialPrompt ?? "").trim();
		const cursorPath = this.config.cursorPath || "cursor-agent";
		const args = this.buildArgs(prompt);
		const child = spawn(cursorPath, args, {
			cwd: this.config.workingDirectory || cwd(),
			env: this.buildEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.process = child;

		this.readlineInterface = createInterface({
			input: child.stdout!,
			crlfDelay: Infinity,
		});

		this.readlineInterface.on("line", (line) => this.handleStdoutLine(line));

		child.stderr?.on("data", (data: Buffer) => {
			const text = data.toString().trim();
			if (!text) return;
			this.errorMessages.push(text);
		});

		let caughtError: unknown;
		try {
			await new Promise<void>((resolve, reject) => {
				child.on("close", (code) => {
					if (code === 0 || this.wasStopped) {
						resolve();
						return;
					}
					reject(new Error(`cursor-agent exited with code ${code}`));
				});
				child.on("error", reject);
			});
		} catch (error) {
			caughtError = error;
		} finally {
			this.finalizeSession(caughtError);
		}

		return this.sessionInfo;
	}

	private buildArgs(prompt: string): string[] {
		const args: string[] = ["--print", "--output-format", "stream-json"];

		if (this.config.model) {
			args.push("--model", this.config.model);
		}

		if (this.config.resumeSessionId) {
			args.push("--resume", this.config.resumeSessionId);
		}

		if (this.config.workingDirectory) {
			args.push("--workspace", this.config.workingDirectory);
		}

		if (this.config.sandbox) {
			args.push("--sandbox", this.config.sandbox);
		}

		if (this.config.askForApproval === "never") {
			args.push("--force");
		}

		if (this.config.approveMcps ?? true) {
			args.push("--approve-mcps");
		}

		if (this.config.cursorApiKey) {
			args.push("--api-key", this.config.cursorApiKey);
		}

		if (prompt) {
			args.push(prompt);
		}

		return args;
	}

	private buildEnv(): NodeJS.ProcessEnv {
		const env: NodeJS.ProcessEnv = { ...process.env };
		if (this.config.cursorApiKey) {
			env.CURSOR_API_KEY = this.config.cursorApiKey;
		}
		return env;
	}

	private handleStdoutLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		if (this.logStream) {
			this.logStream.write(`${trimmed}\n`);
		}

		const parsed = this.parseJsonLine(trimmed);
		if (!parsed) {
			this.fallbackOutputLines.push(trimmed);
			return;
		}

		this.handleEvent(parsed);
	}

	private parseJsonLine(line: string): CursorJsonEvent | null {
		if (!(line.startsWith("{") || line.startsWith("["))) {
			return null;
		}
		try {
			const parsed = JSON.parse(line);
			if (!parsed || typeof parsed !== "object") {
				return null;
			}
			return parsed as CursorJsonEvent;
		} catch {
			return null;
		}
	}

	private handleEvent(event: CursorJsonEvent): void {
		this.emit("streamEvent", event);

		const eventObj = event as Record<string, unknown>;
		const type = getStringValue(eventObj, "type");

		if (!type) {
			return;
		}

		if (type === "init") {
			const sessionId =
				getStringValue(eventObj, "session_id") || this.sessionInfo?.sessionId;
			if (sessionId && this.sessionInfo) {
				this.sessionInfo.sessionId = sessionId;
			}
			this.emitInitMessage();
			return;
		}

		if (type === "message") {
			this.emitInitMessage();
			this.handleMessageEvent(eventObj);
			return;
		}

		if (type === "item.started" || type === "item.completed") {
			this.emitInitMessage();
			const item = eventObj.item;
			if (item && typeof item === "object") {
				this.handleItemEvent(type, item as Record<string, unknown>);
			}
			return;
		}

		if (type === "turn.completed" || type === "result") {
			const usage = extractUsageFromEvent(eventObj);
			if (usage) {
				this.lastUsage = usage;
			}
			const stopReason = getStringValue(eventObj, "stop_reason");
			if (stopReason?.toLowerCase().includes("max")) {
				const result = this.createErrorResultMessage(
					`Cursor turn limit reached: ${stopReason}`,
				);
				this.pendingResultMessage = result;
			}
			return;
		}

		if (type === "error") {
			const message =
				getStringValue(eventObj, "message") || "Cursor execution failed";
			this.errorMessages.push(message);
			this.pendingResultMessage = this.createErrorResultMessage(message);
		}
	}

	private handleMessageEvent(event: Record<string, unknown>): void {
		const role = getStringValue(event, "role");
		const content = getStringValue(event, "content") || "";
		if (!content) {
			return;
		}

		if (role === "assistant") {
			this.lastAssistantText = content;
			const message: SDKAssistantMessage = {
				type: "assistant",
				message: createAssistantBetaMessage(content),
				parent_tool_use_id: null,
				uuid: crypto.randomUUID(),
				session_id: this.sessionInfo?.sessionId || "pending",
			};
			this.pushMessage(message);
			return;
		}

		if (role === "user") {
			const message: SDKUserMessage = {
				type: "user",
				message: {
					role: "user",
					content: [{ type: "text", text: content }],
				},
				parent_tool_use_id: null,
				session_id: this.sessionInfo?.sessionId || "pending",
			};
			this.pushMessage(message);
		}
	}

	private handleItemEvent(type: string, item: Record<string, unknown>): void {
		const projection = getProjectionForItem(item, this.config.workingDirectory);
		if (!projection) {
			return;
		}

		if (type === "item.started") {
			this.emitToolUse(projection);
			return;
		}

		this.emitToolUse(projection);
		this.emitToolResult(projection);
	}

	private emitToolUse(projection: ToolProjection): void {
		if (this.emittedToolUseIds.has(projection.toolUseId)) {
			return;
		}
		this.emittedToolUseIds.add(projection.toolUseId);
		const message: SDKAssistantMessage = {
			type: "assistant",
			message: createAssistantToolUseMessage(
				projection.toolUseId,
				projection.toolName,
				projection.toolInput,
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private emitToolResult(projection: ToolProjection): void {
		const message: SDKUserMessage = {
			type: "user",
			message: createUserToolResultMessage(
				projection.toolUseId,
				projection.result,
				projection.isError,
			),
			parent_tool_use_id: projection.toolUseId,
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private emitInitMessage(): void {
		if (this.hasInitMessage) {
			return;
		}
		this.hasInitMessage = true;
		const sessionId = this.sessionInfo?.sessionId || crypto.randomUUID();
		const permissionModeByCursorConfig: Record<
			NonNullable<CursorRunnerConfig["askForApproval"]>,
			SDKSystemInitMessage["permissionMode"]
		> = {
			never: "dontAsk",
			"on-request": "default",
			"on-failure": "default",
			untrusted: "default",
		};
		const initMessage: SDKSystemInitMessage = {
			type: "system",
			subtype: "init",
			cwd: this.config.workingDirectory || cwd(),
			session_id: sessionId,
			tools: this.config.allowedTools || [],
			mcp_servers: [],
			model: this.config.model || "gpt-5",
			permissionMode: this.config.askForApproval
				? permissionModeByCursorConfig[this.config.askForApproval]
				: "default",
			apiKeySource: this.config.cursorApiKey ? "user" : "project",
			claude_code_version: "cursor-agent",
			slash_commands: [],
			output_style: "default",
			skills: [],
			plugins: [],
			uuid: crypto.randomUUID(),
			agents: undefined,
		};
		this.pushMessage(initMessage);
	}

	private createSuccessResultMessage(result: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "success",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: false,
			num_turns: 1,
			result,
			total_cost_usd: 0,
			usage: createResultUsage(this.lastUsage),
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private createErrorResultMessage(errorMessage: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "error_during_execution",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: true,
			num_turns: 1,
			errors: [errorMessage],
			total_cost_usd: 0,
			usage: createResultUsage(this.lastUsage),
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private pushMessage(message: SDKMessage): void {
		this.messages.push(message);
		this.emit("message", message);
	}

	private setupLogging(sessionId: string): void {
		try {
			const logsDir = join(this.config.cyrusHome, "logs");
			mkdirSync(logsDir, { recursive: true });
			this.logStream = createWriteStream(
				join(logsDir, `cursor-${sessionId}.jsonl`),
				{ flags: "a" },
			);
		} catch {
			this.logStream = null;
		}
	}

	private finalizeSession(error?: unknown): void {
		if (!this.sessionInfo) {
			return;
		}

		this.emitInitMessage();
		this.sessionInfo.isRunning = false;

		let resultMessage: SDKResultMessage;
		if (this.pendingResultMessage) {
			resultMessage = this.pendingResultMessage;
		} else if (error || this.errorMessages.length > 0) {
			const message =
				normalizeError(error) ||
				this.errorMessages.at(-1) ||
				"Cursor execution failed";
			resultMessage = this.createErrorResultMessage(message);
		} else {
			const fallbackOutput = this.fallbackOutputLines.join("\n").trim();
			resultMessage = this.createSuccessResultMessage(
				this.lastAssistantText ||
					fallbackOutput ||
					"Cursor session completed successfully",
			);
		}

		this.pushMessage(resultMessage);
		this.emit("complete", [...this.messages]);

		if (error || this.errorMessages.length > 0) {
			const err =
				error instanceof Error
					? error
					: new Error(this.errorMessages.at(-1) || "Cursor execution failed");
			this.emit("error", err);
		}

		this.cleanupRuntimeState();
	}

	private cleanupRuntimeState(): void {
		if (this.readlineInterface) {
			this.readlineInterface.close();
			this.readlineInterface = null;
		}
		if (this.logStream) {
			this.logStream.end();
			this.logStream = null;
		}
		this.process = null;
		this.pendingResultMessage = null;
	}

	stop(): void {
		this.wasStopped = true;
		if (this.process && !this.process.killed) {
			this.process.kill();
		}
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}
	}

	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	getMessages(): SDKMessage[] {
		return [...this.messages];
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}
}
