import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative as pathRelative } from "node:path";
import { cwd } from "node:process";
import type {
	IAgentRunner,
	IMessageFormatter,
	McpServerConfig,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import type {
	AppServerApprovalPolicy,
	AppServerNotification,
	AppServerReadOnlyAccess,
	AppServerRequest,
	AppServerSandboxPolicy,
	AppServerThreadItem,
	AppServerTokenUsage,
	AppServerTurnStartParams,
	JsonValue,
} from "./appServerProtocol.js";
import { CodexAppServerClient } from "./CodexAppServerClient.js";
import { CodexMessageFormatter } from "./formatter.js";
import type {
	CodexConfigOverrides,
	CodexConfigValue,
	CodexJsonEvent,
	CodexMcpToolCallItem,
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
	CodexThreadItem,
	CodexTodoListItem,
	CodexUsage,
} from "./types.js";

type SDKSystemInitMessage = Extract<
	SDKMessage,
	{ type: "system"; subtype: "init" }
>;

interface ParsedUsage {
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
}

type ToolInput = Record<string, unknown>;

interface ToolProjection {
	toolUseId: string;
	toolName: string;
	toolInput: ToolInput;
	result: string;
	isError: boolean;
}

const DEFAULT_CODEX_MODEL = "gpt-5.3-codex";
const CODEX_MCP_DOCS_URL = "https://platform.openai.com/docs/docs-mcp";

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
		model: DEFAULT_CODEX_MODEL,
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			inference_geo: null,
			iterations: null,
			server_tool_use: null,
			service_tier: null,
			speed: null,
		},
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
		model: DEFAULT_CODEX_MODEL,
		stop_reason: null,
		stop_sequence: null,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			inference_geo: null,
			iterations: null,
			server_tool_use: null,
			service_tier: null,
			speed: null,
		},
		container: null,
		context_management: null,
	};
}

function parseUsage(usage: CodexUsage | null | undefined): ParsedUsage {
	if (!usage) {
		return {
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
		};
	}

	return {
		inputTokens: toFiniteNumber(usage.input_tokens),
		outputTokens: toFiniteNumber(usage.output_tokens),
		cachedInputTokens: toFiniteNumber(usage.cached_input_tokens),
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
		inference_geo: "unknown",
		iterations: [],
		server_tool_use: {
			web_fetch_requests: 0,
			web_search_requests: 0,
		},
		service_tier: "standard",
		speed: "standard",
	};
}

function getDefaultReasoningEffortForModel(
	model?: string,
): CodexRunnerConfig["modelReasoningEffort"] | undefined {
	return /^gpt-5/i.test(model || "") ? "high" : undefined;
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Codex execution failed";
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
	item: Extract<CodexThreadItem, { type: "file_change" }>,
	workingDirectory?: string,
): string {
	if (!item.changes.length) {
		return item.status === "failed" ? "Patch failed" : "No file changes";
	}

	return item.changes
		.map((change) => {
			const filePath = normalizeFilePath(change.path, workingDirectory);
			return `${change.kind} ${filePath}`;
		})
		.join("\n");
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (value && typeof value === "object") {
		return value as Record<string, unknown>;
	}
	return null;
}

function toMcpResultString(item: CodexMcpToolCallItem): string {
	if (item.error?.message) {
		return item.error.message;
	}

	const textBlocks: string[] = [];
	for (const block of item.result?.content || []) {
		const text = asRecord(block)?.text;
		if (typeof text === "string" && text.trim().length > 0) {
			textBlocks.push(text);
		}
	}

	if (textBlocks.length > 0) {
		return textBlocks.join("\n");
	}

	if (item.result?.structured_content !== undefined) {
		return safeStringify(item.result.structured_content);
	}

	return item.status === "failed"
		? "MCP tool call failed"
		: "MCP tool call completed";
}

function normalizeMcpIdentifier(value: string): string {
	const normalized = value
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return normalized || "unknown";
}

function autoDetectMcpConfigPath(
	workingDirectory?: string,
): string | undefined {
	if (!workingDirectory) {
		return undefined;
	}

	const mcpPath = join(workingDirectory, ".mcp.json");
	if (!existsSync(mcpPath)) {
		return undefined;
	}

	try {
		JSON.parse(readFileSync(mcpPath, "utf8"));
		return mcpPath;
	} catch {
		console.warn(
			`[CodexRunner] Found .mcp.json at ${mcpPath} but it is invalid JSON, skipping`,
		);
		return undefined;
	}
}

function loadMcpConfigFromPaths(
	configPaths: string | string[] | undefined,
): Record<string, McpServerConfig> {
	if (!configPaths) {
		return {};
	}

	const paths = Array.isArray(configPaths) ? configPaths : [configPaths];
	let mcpServers: Record<string, McpServerConfig> = {};

	for (const configPath of paths) {
		try {
			const mcpConfigContent = readFileSync(configPath, "utf8");
			const mcpConfig = JSON.parse(mcpConfigContent);
			const servers =
				mcpConfig &&
				typeof mcpConfig === "object" &&
				!Array.isArray(mcpConfig) &&
				mcpConfig.mcpServers &&
				typeof mcpConfig.mcpServers === "object" &&
				!Array.isArray(mcpConfig.mcpServers)
					? (mcpConfig.mcpServers as Record<string, McpServerConfig>)
					: {};
			mcpServers = { ...mcpServers, ...servers };
			console.log(
				`[CodexRunner] Loaded MCP config from ${configPath}: ${Object.keys(servers).join(", ")}`,
			);
		} catch (error) {
			console.warn(
				`[CodexRunner] Failed to load MCP config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	return mcpServers;
}

function isJsonValue(value: unknown): value is JsonValue {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return true;
	}

	if (Array.isArray(value)) {
		return value.every((entry) => isJsonValue(entry));
	}

	if (value && typeof value === "object") {
		return Object.values(value as Record<string, unknown>).every((entry) =>
			entry === undefined ? true : isJsonValue(entry),
		);
	}

	return false;
}

function serializeConfigOverrides(
	configOverrides: CodexConfigOverrides | undefined,
): string[] {
	if (!configOverrides) {
		return [];
	}

	const overrides: string[] = [];
	flattenConfigOverrides(configOverrides, "", overrides);
	return overrides;
}

function flattenConfigOverrides(
	value: CodexConfigValue | CodexConfigOverrides,
	prefix: string,
	overrides: string[],
): void {
	if (!isPlainObject(value)) {
		if (!prefix) {
			throw new Error("Codex config overrides must be a plain object");
		}
		overrides.push(`${prefix}=${toTomlValue(value, prefix)}`);
		return;
	}

	const entries = Object.entries(value);
	if (!prefix && entries.length === 0) {
		return;
	}
	if (prefix && entries.length === 0) {
		overrides.push(`${prefix}={}`);
		return;
	}

	for (const [key, child] of entries) {
		if (!key) {
			throw new Error("Codex config override keys must be non-empty strings");
		}
		if (child === undefined) {
			continue;
		}
		const path = prefix ? `${prefix}.${key}` : key;
		if (isPlainObject(child)) {
			flattenConfigOverrides(child as CodexConfigOverrides, path, overrides);
		} else {
			overrides.push(`${path}=${toTomlValue(child, path)}`);
		}
	}
}

function toTomlValue(value: CodexConfigValue, path: string): string {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error(
				`Codex config override at ${path} must be a finite number`,
			);
		}
		return `${value}`;
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (Array.isArray(value)) {
		return `[${value
			.map((entry, index) => toTomlValue(entry, `${path}[${index}]`))
			.join(", ")}]`;
	}
	if (isPlainObject(value)) {
		return `{${Object.entries(value)
			.filter(([, child]) => child !== undefined)
			.map(
				([key, child]) =>
					`${formatTomlKey(key)} = ${toTomlValue(child as CodexConfigValue, `${path}.${key}`)}`,
			)
			.join(", ")}}`;
	}
	throw new Error(`Unsupported Codex config override value at ${path}`);
}

function formatTomlKey(key: string): string {
	return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeThreadItem(
	item: AppServerThreadItem,
): CodexThreadItem | null {
	switch (item.type) {
		case "agentMessage":
			return {
				id: item.id,
				type: "agent_message",
				text: item.text,
			};
		case "commandExecution":
			return {
				id: item.id,
				type: "command_execution",
				command: item.command,
				aggregated_output: item.aggregatedOutput || "",
				...(typeof item.exitCode === "number"
					? { exit_code: item.exitCode }
					: {}),
				status: item.status === "inProgress" ? "in_progress" : item.status,
			};
		case "fileChange":
			return {
				id: item.id,
				type: "file_change",
				status: item.status,
				changes: item.changes.map((change) => ({
					path: change.path,
					kind: change.kind,
				})),
			};
		case "mcpToolCall":
			return {
				id: item.id,
				type: "mcp_tool_call",
				server: item.server,
				tool: item.tool,
				arguments: item.arguments,
				result: item.result
					? {
							content: item.result.content,
							structured_content:
								item.result.structured_content ?? item.result.structuredContent,
						}
					: undefined,
				error: item.error ?? undefined,
				status: item.status === "inProgress" ? "in_progress" : item.status,
			};
		case "webSearch":
			return {
				id: item.id,
				type: "web_search",
				query: item.query,
				action: item.action,
			};
		default:
			return null;
	}
}

function buildTodoEvent(
	turnId: string,
	plan: Array<{ step: string; status: "pending" | "inProgress" | "completed" }>,
): CodexJsonEvent {
	const todoItem: CodexTodoListItem = {
		id: `plan_${turnId}`,
		type: "todo_list",
		items: plan.map((entry) => ({
			text: entry.step,
			completed: entry.status === "completed",
			in_progress: entry.status === "inProgress",
		})),
	};

	return {
		type: "item.completed",
		item: todoItem,
	};
}

export declare interface CodexRunner {
	on<K extends keyof CodexRunnerEvents>(
		event: K,
		listener: CodexRunnerEvents[K],
	): this;
	emit<K extends keyof CodexRunnerEvents>(
		event: K,
		...args: Parameters<CodexRunnerEvents[K]>
	): boolean;
}

export class CodexRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = true;

	private config: CodexRunnerConfig;
	private sessionInfo: CodexSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;
	private hasInitMessage = false;
	private pendingResultMessage: SDKResultMessage | null = null;
	private lastAssistantText: string | null = null;
	private lastUsage: ParsedUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
	};
	private errorMessages: string[] = [];
	private startTimestampMs = 0;
	private wasStopped = false;
	private emittedToolUseIds: Set<string> = new Set();
	private tokenUsageByTurn = new Map<string, AppServerTokenUsage>();
	private appServerClient: CodexAppServerClient | null = null;
	private terminalTurnResolver: (() => void) | null = null;
	private terminalTurnRejecter: ((error: Error) => void) | null = null;
	private completedTurnCount = 0;
	private pendingPrompts: string[] = [];
	private sessionTask: Promise<void> | null = null;
	private streamingMode = false;
	private streamingCompleted = false;
	private activeTurnId: string | null = null;
	private turnStartedPromise: Promise<void> | null = null;
	private turnStartedResolver: (() => void) | null = null;
	private turnStartedRejecter: ((error: Error) => void) | null = null;

	constructor(config: CodexRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new CodexMessageFormatter();

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<CodexSessionInfo> {
		return this.startWithPrompt(prompt);
	}

	async startStreaming(initialPrompt?: string): Promise<CodexSessionInfo> {
		return this.startWithPrompt(null, initialPrompt);
	}

	addStreamMessage(content: string): void {
		if (!this.streamingMode) {
			throw new Error("Cannot add stream message when not in streaming mode");
		}
		if (this.streamingCompleted) {
			throw new Error("Cannot add stream message after stream completion");
		}
		if (!this.sessionInfo?.isRunning) {
			throw new Error(
				"Cannot add stream message when Codex session is not running",
			);
		}

		const prompt = content.trim();
		if (!prompt) {
			return;
		}

		if (
			this.activeTurnId &&
			this.appServerClient &&
			this.sessionInfo?.sessionId
		) {
			void this.appServerClient
				.steerTurn({
					threadId: this.sessionInfo.sessionId,
					expectedTurnId: this.activeTurnId,
					input: [
						{
							type: "text",
							text: prompt,
							text_elements: [],
						},
					],
				})
				.catch((error) => {
					const message = normalizeError(error);
					this.errorMessages.push(message);
					this.emit("error", new Error(message));
				});
			return;
		}

		this.pendingPrompts.push(prompt);
		this.ensureSessionTaskRunning();
	}

	completeStream(): void {
		this.streamingCompleted = true;
		if (
			this.sessionInfo?.isRunning &&
			!this.sessionTask &&
			this.pendingPrompts.length === 0
		) {
			this.finalizeSession();
		}
	}

	isStreaming(): boolean {
		return (
			this.streamingMode &&
			!this.streamingCompleted &&
			(this.sessionInfo?.isRunning ?? false)
		);
	}

	private async startWithPrompt(
		stringPrompt?: string | null,
		streamingInitialPrompt?: string,
	): Promise<CodexSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Codex session already running");
		}

		const sessionId = this.config.resumeSessionId || crypto.randomUUID();
		this.sessionInfo = {
			sessionId,
			startedAt: new Date(),
			isRunning: true,
		};

		this.messages = [];
		this.hasInitMessage = false;
		this.pendingResultMessage = null;
		this.lastAssistantText = null;
		this.lastUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
		};
		this.errorMessages = [];
		this.wasStopped = false;
		this.startTimestampMs = Date.now();
		this.emittedToolUseIds.clear();
		this.tokenUsageByTurn.clear();
		this.completedTurnCount = 0;
		this.pendingPrompts = [];
		this.sessionTask = null;
		this.streamingMode = stringPrompt === null || stringPrompt === undefined;
		this.streamingCompleted = false;
		this.activeTurnId = null;
		this.turnStartedPromise = null;
		this.turnStartedResolver = null;
		this.turnStartedRejecter = null;

		await this.resolveModelWithFallback();

		const prompt = (stringPrompt ?? streamingInitialPrompt ?? "").trim();
		let caughtError: unknown;

		try {
			const client = this.createAppServerClient();
			this.appServerClient = client;
			await client.connect({
				clientInfo: {
					name: "cyrus_codex_runner",
					title: "Cyrus Codex Runner",
					version: "0.1.0",
				},
				capabilities: {
					experimentalApi: false,
				},
			});

			await this.initializeThread(client);
			if (prompt) {
				this.pendingPrompts.push(prompt);
			}

			if (this.streamingMode) {
				this.ensureSessionTaskRunning();
				if (prompt) {
					await this.waitForTurnToStart();
				}
				return this.sessionInfo!;
			}

			await this.drainPendingPrompts(client);
		} catch (error) {
			caughtError = error;
		}

		this.finalizeSession(caughtError);

		return this.sessionInfo!;
	}

	private async resolveModelWithFallback(): Promise<void> {
		const model = this.config.model;
		const fallback = this.config.fallbackModel;
		if (!model || !fallback || fallback === model) return;

		const apiKey = process.env.OPENAI_API_KEY;
		if (!apiKey) return;

		if (await this.hasCodexSubscription()) return;

		const baseUrl = (
			process.env.OPENAI_BASE_URL ||
			process.env.OPENAI_API_BASE ||
			"https://api.openai.com/v1"
		).replace(/\/+$/, "");

		try {
			const response = await fetch(
				`${baseUrl}/models/${encodeURIComponent(model)}`,
				{
					method: "GET",
					headers: { Authorization: `Bearer ${apiKey}` },
					signal: AbortSignal.timeout(10_000),
				},
			);
			if (response.status === 404) {
				console.log(
					`[CodexRunner] Model "${model}" not found (404), falling back to "${fallback}"`,
				);
				this.config.model = fallback;
			}
		} catch {
			// Keep the original model and let Codex surface any downstream issue.
		}
	}

	private async hasCodexSubscription(): Promise<boolean> {
		const codexBin = this.config.codexPath || "codex";
		try {
			const { execFile } = await import("node:child_process");
			const { promisify } = await import("node:util");
			const execFileAsync = promisify(execFile);
			const { stdout, stderr } = await execFileAsync(
				codexBin,
				["login", "status"],
				{ timeout: 5_000 },
			);
			const result = /logged in using chatgpt/i.test(stdout + stderr);
			console.log(
				`[CodexRunner] hasCodexSubscription: ${result} (stdout: "${stdout.trim()}"${stderr.trim() ? `, stderr: "${stderr.trim()}"` : ""})`,
			);
			return result;
		} catch (error) {
			console.warn(
				`[CodexRunner] hasCodexSubscription error (returning false): ${error instanceof Error ? error.message : String(error)}`,
			);
			return false;
		}
	}

	private createAppServerClient(): CodexAppServerClient {
		const codexHome = this.resolveCodexHome();
		const envOverride = this.buildEnvOverride(codexHome);
		// Cyrus intentionally runs one codex app-server per runner/session.
		// In theory, a shared app-server could still segment cwd/worktree, model,
		// developer instructions, approval policy, and sandbox policy per
		// thread/turn. The remaining hard boundary is MCP config, which we load as
		// startup config overrides (`mcp_servers`) before the app-server starts.
		// Until Codex supports dynamic per-session MCP registration, a shared
		// app-server would need an extra broker/proxy layer or a pool keyed by MCP
		// config shape. Per-runner app-servers keep that state isolated.
		return new CodexAppServerClient({
			...(this.config.codexPath ? { codexPath: this.config.codexPath } : {}),
			...(envOverride ? { env: envOverride } : {}),
			configOverrides: serializeConfigOverrides(
				this.buildAppServerConfigOverrides(),
			),
			onNotification: (notification) => {
				const event = this.translateNotification(notification);
				if (event) {
					this.handleEvent(event);
				}
			},
			onRequest: async (request) => this.handleAppServerRequest(request),
		});
	}

	private async handleAppServerRequest(
		request: AppServerRequest,
	): Promise<unknown> {
		if (
			request.method === "item/tool/requestUserInput" &&
			this.config.onAskUserQuestion
		) {
			const params = request.params as {
				questions: Array<{
					id: string;
					header: string;
					question: string;
					options: Array<{ label: string; description: string }> | null;
				}>;
			};
			const result = await this.config.onAskUserQuestion(
				{
					questions: params.questions.map((question) => ({
						header: question.header,
						question: question.question,
						options: question.options || [],
						multiSelect: false,
					})),
				} as any,
				this.sessionInfo?.sessionId || "pending",
				new AbortController().signal,
			);

			if (!result.answered || !result.answers) {
				throw new Error(result.message || "User input request was declined");
			}

			return {
				answers: Object.fromEntries(
					params.questions.map((question) => {
						const answer = result.answers?.[question.question];
						return [
							question.id,
							{
								answers: answer ? [answer] : [],
							},
						];
					}),
				),
			};
		}

		switch (request.method) {
			case "item/commandExecution/requestApproval":
				return { decision: "decline" };
			case "item/fileChange/requestApproval":
				return { decision: "decline" };
			case "applyPatchApproval":
				return { decision: "denied" };
			case "execCommandApproval":
				return { decision: "denied" };
			default:
				throw new Error(
					`Unsupported Codex app-server request in Cyrus: ${request.method}`,
				);
		}
	}

	private translateNotification(
		notification: AppServerNotification,
	): CodexJsonEvent | null {
		switch (notification.method) {
			case "thread/started": {
				const params = notification.params as { thread: { id: string } };
				return {
					type: "thread.started",
					thread_id: params.thread.id,
				};
			}
			case "item/started": {
				const params = notification.params as {
					item: AppServerThreadItem;
				};
				const item = normalizeThreadItem(params.item);
				return item ? { type: "item.started", item } : null;
			}
			case "item/completed": {
				const params = notification.params as {
					item: AppServerThreadItem;
				};
				const item = normalizeThreadItem(params.item);
				return item ? { type: "item.completed", item } : null;
			}
			case "turn/plan/updated": {
				const params = notification.params as {
					turnId: string;
					plan: Array<{
						step: string;
						status: "pending" | "inProgress" | "completed";
					}>;
				};
				return buildTodoEvent(params.turnId, params.plan);
			}
			case "thread/tokenUsage/updated": {
				const params = notification.params as {
					turnId: string;
					tokenUsage: AppServerTokenUsage;
				};
				this.tokenUsageByTurn.set(params.turnId, params.tokenUsage);
				return null;
			}
			case "turn/completed": {
				const params = notification.params as {
					turn: {
						id: string;
						status: "completed" | "failed" | "interrupted" | "inProgress";
						error: { message: string } | null;
					};
				};
				const turn = params.turn;
				if (turn.status === "failed") {
					return {
						type: "turn.failed",
						error: {
							message: turn.error?.message || "Codex execution failed",
						},
					};
				}
				if (turn.status === "interrupted") {
					return {
						type: "turn.interrupted",
						message:
							turn.error?.message ||
							(this.wasStopped
								? "Codex session interrupted"
								: "Codex turn interrupted"),
					};
				}
				const usage = this.tokenUsageByTurn.get(turn.id);
				return {
					type: "turn.completed",
					...(usage
						? {
								usage: {
									input_tokens: usage.last.inputTokens,
									output_tokens: usage.last.outputTokens,
									cached_input_tokens: usage.last.cachedInputTokens,
								},
							}
						: {}),
				};
			}
			case "error": {
				const params = notification.params as { message: string };
				return {
					type: "error",
					message: params.message,
				};
			}
			default:
				return null;
		}
	}

	private async runTurn(
		client: CodexAppServerClient,
		prompt: string,
	): Promise<void> {
		const threadId = this.sessionInfo?.sessionId;
		if (!threadId) {
			throw new Error("Codex app-server thread is not initialized");
		}

		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			return;
		}

		this.pendingResultMessage = null;
		const turnParams: AppServerTurnStartParams = {
			threadId,
			input: [
				{
					type: "text",
					text: trimmedPrompt,
					text_elements: [],
				},
			],
			cwd: this.config.workingDirectory,
			approvalPolicy: this.buildApprovalPolicy(),
			sandboxPolicy: this.buildSandboxPolicy(),
			model: this.config.model,
			effort:
				this.config.modelReasoningEffort ??
				getDefaultReasoningEffortForModel(this.config.model),
			...(isJsonValue(this.config.outputSchema)
				? { outputSchema: this.config.outputSchema }
				: {}),
		};

		const completionPromise = new Promise<void>((resolve, reject) => {
			this.terminalTurnResolver = resolve;
			this.terminalTurnRejecter = reject;
		});

		try {
			const startedTurn = await client.startTurn(turnParams);
			this.activeTurnId = startedTurn.turn.id;
			this.turnStartedResolver?.();
			this.turnStartedPromise = null;
			this.turnStartedResolver = null;
			this.turnStartedRejecter = null;
		} catch (error) {
			this.turnStartedRejecter?.(
				error instanceof Error ? error : new Error(normalizeError(error)),
			);
			this.turnStartedPromise = null;
			this.turnStartedResolver = null;
			this.turnStartedRejecter = null;
			throw error;
		}
		await completionPromise;
	}

	private async waitForTurnToStart(): Promise<void> {
		if (this.activeTurnId) {
			return;
		}
		if (!this.turnStartedPromise) {
			this.turnStartedPromise = new Promise<void>((resolve, reject) => {
				this.turnStartedResolver = resolve;
				this.turnStartedRejecter = reject;
			});
		}
		await this.turnStartedPromise;
	}

	private async initializeThread(client: CodexAppServerClient): Promise<void> {
		const threadConfig = this.buildThreadConfig();
		const threadResponse = this.config.resumeSessionId
			? await client.resumeThread({
					threadId: this.config.resumeSessionId,
				})
			: await client.startThread({
					model: this.config.model,
					cwd: this.config.workingDirectory,
					approvalPolicy: this.buildApprovalPolicy(),
					sandbox: this.config.sandbox || "workspace-write",
					developerInstructions: threadConfig.developerInstructions,
					ephemeral: false,
				});

		if (this.sessionInfo) {
			this.sessionInfo.sessionId = threadResponse.thread.id;
		}
		this.emitSystemInitMessage(threadResponse.thread.id);
	}

	private ensureSessionTaskRunning(): void {
		if (
			!this.appServerClient ||
			!this.sessionInfo?.isRunning ||
			this.sessionTask
		) {
			return;
		}
		if (this.pendingPrompts.length === 0) {
			if (this.streamingCompleted) {
				this.finalizeSession();
			}
			return;
		}

		this.sessionTask = this.drainPendingPrompts(this.appServerClient).finally(
			() => {
				this.sessionTask = null;
			},
		);
	}

	private async drainPendingPrompts(
		client: CodexAppServerClient,
	): Promise<void> {
		let caughtError: unknown;

		try {
			while (this.sessionInfo?.isRunning) {
				const nextPrompt = this.pendingPrompts.shift();
				if (!nextPrompt) {
					break;
				}
				await this.runTurn(client, nextPrompt);
			}
		} catch (error) {
			caughtError = error;
		}

		if (this.streamingMode) {
			this.finalizeSession(caughtError);
			return;
		}

		if (caughtError) {
			throw caughtError;
		}
	}

	private buildApprovalPolicy(): AppServerApprovalPolicy {
		return this.config.askForApproval || "never";
	}

	private buildSandboxPolicy(): AppServerSandboxPolicy {
		const readableRoots = [
			this.config.workingDirectory,
			...(this.config.allowedDirectories || []),
		].filter((value): value is string => Boolean(value));
		// Codex app-server docs recommend restricted read access with
		// includePlatformDefaults enabled so macOS gets the curated platform
		// Seatbelt allowances without reopening broad filesystem reads.
		const readOnlyAccess: AppServerReadOnlyAccess = {
			type: "restricted",
			includePlatformDefaults: true,
			readableRoots: [...new Set(readableRoots)],
		};
		switch (this.config.sandbox) {
			case "read-only":
				return {
					type: "readOnly",
					access: readOnlyAccess,
				};
			case "danger-full-access":
				return { type: "dangerFullAccess" };
			default: {
				const networkAccess = this.extractWorkspaceNetworkAccess(
					this.buildConfigOverrides(),
				);
				return {
					type: "workspaceWrite",
					writableRoots: [...new Set(readableRoots)],
					readOnlyAccess,
					networkAccess,
					excludeTmpdirEnvVar: false,
					excludeSlashTmp: false,
				};
			}
		}
	}

	private extractWorkspaceNetworkAccess(
		configOverrides: CodexConfigOverrides | undefined,
	): boolean {
		const sandboxWorkspaceWrite = configOverrides?.sandbox_workspace_write;
		if (
			sandboxWorkspaceWrite &&
			typeof sandboxWorkspaceWrite === "object" &&
			!Array.isArray(sandboxWorkspaceWrite) &&
			typeof sandboxWorkspaceWrite.network_access === "boolean"
		) {
			return sandboxWorkspaceWrite.network_access;
		}
		return true;
	}

	private buildThreadConfig(): {
		developerInstructions?: string;
		outputSchema?: JsonValue;
	} {
		const rawConfig = this.buildConfigOverrides();
		if (!rawConfig) {
			return {};
		}

		const { developer_instructions } = rawConfig as CodexConfigOverrides & {
			developer_instructions?: CodexConfigValue;
		};

		return {
			...(typeof developer_instructions === "string"
				? { developerInstructions: developer_instructions }
				: {}),
			...(isJsonValue(this.config.outputSchema)
				? { outputSchema: this.config.outputSchema }
				: {}),
		};
	}

	private buildAppServerConfigOverrides(): CodexConfigOverrides | undefined {
		const rawConfig = this.buildConfigOverrides();
		if (!rawConfig) {
			return undefined;
		}

		const { developer_instructions, ...rest } =
			rawConfig as CodexConfigOverrides & {
				developer_instructions?: CodexConfigValue;
			};
		return Object.keys(rest).length > 0 ? rest : undefined;
	}

	private resolveCodexHome(): string {
		const codexHome =
			this.config.codexHome ||
			process.env.CODEX_HOME ||
			join(homedir(), ".codex");
		mkdirSync(codexHome, { recursive: true });
		return codexHome;
	}

	private buildEnvOverride(
		codexHome: string,
	): Record<string, string> | undefined {
		if (!this.config.codexHome) {
			return undefined;
		}

		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (typeof value === "string") {
				env[key] = value;
			}
		}
		env.CODEX_HOME = codexHome;
		return env;
	}

	private buildCodexMcpServersConfig():
		| Record<string, CodexConfigOverrides>
		| undefined {
		const autoDetectedPath = autoDetectMcpConfigPath(
			this.config.workingDirectory,
		);
		const configPaths = autoDetectedPath ? [autoDetectedPath] : [];
		if (this.config.mcpConfigPath) {
			const explicitPaths = Array.isArray(this.config.mcpConfigPath)
				? this.config.mcpConfigPath
				: [this.config.mcpConfigPath];
			configPaths.push(...explicitPaths);
		}

		const fileBasedServers = loadMcpConfigFromPaths(configPaths);
		const mergedServers = this.config.mcpConfig
			? { ...fileBasedServers, ...this.config.mcpConfig }
			: fileBasedServers;
		if (Object.keys(mergedServers).length === 0) {
			return undefined;
		}

		const codexServers: Record<string, CodexConfigOverrides> = {};
		for (const [serverName, rawConfig] of Object.entries(mergedServers)) {
			const configAny = rawConfig as Record<string, unknown>;
			if (
				typeof configAny.listTools === "function" ||
				typeof configAny.callTool === "function"
			) {
				console.warn(
					`[CodexRunner] Skipping MCP server '${serverName}' because in-process SDK server instances cannot be mapped to codex config`,
				);
				continue;
			}

			const mapped: CodexConfigOverrides = {};
			if (typeof configAny.command === "string") {
				mapped.command = configAny.command;
			}
			if (Array.isArray(configAny.args)) {
				mapped.args =
					configAny.args as unknown as CodexConfigOverrides[keyof CodexConfigOverrides];
			}
			if (
				configAny.env &&
				typeof configAny.env === "object" &&
				!Array.isArray(configAny.env)
			) {
				mapped.env =
					configAny.env as unknown as CodexConfigOverrides[keyof CodexConfigOverrides];
			}
			if (typeof configAny.cwd === "string") {
				mapped.cwd = configAny.cwd;
			}
			if (typeof configAny.url === "string") {
				mapped.url = configAny.url;
			}
			if (
				configAny.http_headers &&
				typeof configAny.http_headers === "object" &&
				!Array.isArray(configAny.http_headers)
			) {
				mapped.http_headers =
					configAny.http_headers as unknown as CodexConfigOverrides[keyof CodexConfigOverrides];
			}
			if (
				configAny.headers &&
				typeof configAny.headers === "object" &&
				!Array.isArray(configAny.headers)
			) {
				mapped.http_headers =
					configAny.headers as unknown as CodexConfigOverrides[keyof CodexConfigOverrides];
			}
			if (
				configAny.env_http_headers &&
				typeof configAny.env_http_headers === "object" &&
				!Array.isArray(configAny.env_http_headers)
			) {
				mapped.env_http_headers =
					configAny.env_http_headers as unknown as CodexConfigOverrides[keyof CodexConfigOverrides];
			}
			if (typeof configAny.bearer_token_env_var === "string") {
				mapped.bearer_token_env_var = configAny.bearer_token_env_var;
			}
			if (typeof configAny.timeout === "number") {
				mapped.timeout = configAny.timeout;
			}

			if (!mapped.command && !mapped.url) {
				console.warn(
					`[CodexRunner] Skipping MCP server '${serverName}' because it has no command/url transport`,
				);
				continue;
			}

			codexServers[serverName] = mapped;
		}

		if (Object.keys(codexServers).length === 0) {
			return undefined;
		}

		console.log(
			`[CodexRunner] Configured ${Object.keys(codexServers).length} MCP server(s) for codex config (docs: ${CODEX_MCP_DOCS_URL})`,
		);
		return codexServers;
	}

	private buildConfigOverrides(): CodexConfigOverrides | undefined {
		const appendSystemPrompt = (this.config.appendSystemPrompt ?? "").trim();
		const configOverrides = this.config.configOverrides
			? { ...this.config.configOverrides }
			: {};
		const mcpServers = this.buildCodexMcpServersConfig();
		if (mcpServers) {
			const existingMcpServers = configOverrides.mcp_servers;
			if (
				existingMcpServers &&
				typeof existingMcpServers === "object" &&
				!Array.isArray(existingMcpServers)
			) {
				configOverrides.mcp_servers = {
					...(existingMcpServers as Record<string, CodexConfigValue>),
					...mcpServers,
				};
			} else {
				configOverrides.mcp_servers = mcpServers;
			}
		}

		const sandboxWorkspaceWrite = configOverrides.sandbox_workspace_write;
		if (
			sandboxWorkspaceWrite &&
			typeof sandboxWorkspaceWrite === "object" &&
			!Array.isArray(sandboxWorkspaceWrite)
		) {
			configOverrides.sandbox_workspace_write = {
				...sandboxWorkspaceWrite,
				network_access:
					(sandboxWorkspaceWrite as { network_access?: boolean })
						.network_access ?? true,
			};
		} else if (!sandboxWorkspaceWrite) {
			configOverrides.sandbox_workspace_write = { network_access: true };
		}

		if (!appendSystemPrompt) {
			return Object.keys(configOverrides).length > 0
				? configOverrides
				: undefined;
		}

		return {
			...configOverrides,
			developer_instructions: appendSystemPrompt,
		};
	}

	private handleEvent(event: CodexJsonEvent): void {
		this.emit("streamEvent", event);

		switch (event.type) {
			case "thread.started": {
				if (this.sessionInfo) {
					this.sessionInfo.sessionId = event.thread_id;
				}
				this.emitSystemInitMessage(event.thread_id);
				break;
			}
			case "item.completed": {
				if (event.item.type === "agent_message") {
					this.emitAssistantMessage(event.item.text);
				} else {
					this.emitToolMessagesForItem(event.item, true);
				}
				break;
			}
			case "item.started": {
				this.emitToolMessagesForItem(event.item, false);
				break;
			}
			case "turn.completed": {
				this.lastUsage = parseUsage(event.usage);
				this.completedTurnCount += 1;
				this.activeTurnId = null;
				this.terminalTurnResolver?.();
				this.terminalTurnResolver = null;
				this.terminalTurnRejecter = null;
				break;
			}
			case "turn.interrupted": {
				this.activeTurnId = null;
				this.terminalTurnRejecter?.(new Error(event.message));
				this.terminalTurnResolver = null;
				this.terminalTurnRejecter = null;
				break;
			}
			case "turn.failed": {
				const message =
					event.error?.message ||
					this.errorMessages.at(-1) ||
					"Codex execution failed";
				this.errorMessages.push(message);
				this.activeTurnId = null;
				this.pendingResultMessage = this.createErrorResultMessage(message);
				this.terminalTurnRejecter?.(new Error(message));
				this.terminalTurnResolver = null;
				this.terminalTurnRejecter = null;
				break;
			}
			case "error": {
				this.errorMessages.push(event.message);
				break;
			}
			default:
				break;
		}
	}

	private projectItemToTool(item: CodexThreadItem): ToolProjection | null {
		switch (item.type) {
			case "command_execution": {
				const isError =
					item.status === "failed" ||
					(typeof item.exit_code === "number" && item.exit_code !== 0);
				const result =
					item.aggregated_output.trim() ||
					(isError
						? `Command failed (exit code ${item.exit_code ?? "unknown"})`
						: "Command completed with no output");

				return {
					toolUseId: item.id,
					toolName: inferCommandToolName(item.command),
					toolInput: { command: item.command },
					result,
					isError,
				};
			}
			case "file_change": {
				const primaryPath =
					item.changes[0]?.path &&
					normalizeFilePath(item.changes[0].path, this.config.workingDirectory);
				return {
					toolUseId: item.id,
					toolName: "Edit",
					toolInput: {
						...(primaryPath ? { file_path: primaryPath } : {}),
						changes: item.changes.map((change) => ({
							kind: change.kind,
							path: normalizeFilePath(
								change.path,
								this.config.workingDirectory,
							),
						})),
					},
					result: summarizeFileChanges(item, this.config.workingDirectory),
					isError: item.status === "failed",
				};
			}
			case "web_search": {
				const action = asRecord(item.action);
				const actionType =
					typeof action?.type === "string" ? action.type : undefined;
				const isFetch = actionType === "open_page";
				const url = typeof action?.url === "string" ? action.url : undefined;
				const pattern =
					typeof action?.pattern === "string" ? action.pattern : undefined;

				return {
					toolUseId: item.id,
					toolName: isFetch ? "WebFetch" : "WebSearch",
					toolInput: isFetch
						? {
								url: url || item.query,
								...(pattern ? { pattern } : {}),
							}
						: { query: item.query },
					result:
						action && Object.keys(action).length > 0
							? safeStringify(action)
							: `Search completed for query: ${item.query}`,
					isError: false,
				};
			}
			case "mcp_tool_call": {
				return {
					toolUseId: item.id,
					toolName: `mcp__${normalizeMcpIdentifier(item.server)}__${normalizeMcpIdentifier(item.tool)}`,
					toolInput: asRecord(item.arguments) || {
						arguments: item.arguments,
					},
					result: toMcpResultString(item),
					isError: item.status === "failed" || Boolean(item.error),
				};
			}
			case "todo_list": {
				return {
					toolUseId: item.id,
					toolName: "TodoWrite",
					toolInput: {
						todos: item.items.map((todo) => ({
							content: todo.text,
							status: todo.completed
								? "completed"
								: todo.in_progress
									? "in_progress"
									: "pending",
						})),
					},
					result: `Updated todo list (${item.items.length} items)`,
					isError: false,
				};
			}
			default:
				return null;
		}
	}

	private emitToolMessagesForItem(
		item: CodexThreadItem,
		includeResult: boolean,
	): void {
		const projection = this.projectItemToTool(item);
		if (!projection) {
			return;
		}

		if (!this.emittedToolUseIds.has(projection.toolUseId)) {
			const assistantMessage: SDKAssistantMessage = {
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
			this.messages.push(assistantMessage);
			this.emit("message", assistantMessage);
			this.emittedToolUseIds.add(projection.toolUseId);
		}

		if (!includeResult) {
			return;
		}

		const userMessage: SDKUserMessage = {
			type: "user",
			message: createUserToolResultMessage(
				projection.toolUseId,
				projection.result,
				projection.isError,
			),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};

		this.messages.push(userMessage);
		this.emit("message", userMessage);
		this.emittedToolUseIds.delete(projection.toolUseId);
	}

	private finalizeSession(caughtError?: unknown): void {
		if (!this.sessionInfo) {
			this.cleanupRuntimeState();
			return;
		}
		if (!this.sessionInfo.isRunning) {
			this.cleanupRuntimeState();
			return;
		}

		this.sessionInfo.isRunning = false;

		if (!this.hasInitMessage) {
			this.emitSystemInitMessage(
				this.sessionInfo.sessionId || this.config.resumeSessionId || "pending",
			);
		}

		if (caughtError && !this.wasStopped) {
			const errorMessage = normalizeError(caughtError);
			this.errorMessages.push(errorMessage);
		}

		if (!this.pendingResultMessage && !this.wasStopped) {
			if (caughtError) {
				this.pendingResultMessage = this.createErrorResultMessage(
					this.errorMessages.at(-1) || "Codex execution failed",
				);
			} else {
				this.pendingResultMessage = this.createSuccessResultMessage(
					this.lastAssistantText || "Codex session completed successfully",
				);
			}
		}

		if (this.pendingResultMessage) {
			this.messages.push(this.pendingResultMessage);
			this.emit("message", this.pendingResultMessage);
			this.pendingResultMessage = null;
		}

		this.emit("complete", [...this.messages]);
		this.cleanupRuntimeState();
	}

	private emitAssistantMessage(text: string): void {
		const normalized = text.trim();
		if (!normalized) {
			return;
		}

		this.lastAssistantText = normalized;
		const assistantMessage: SDKAssistantMessage = {
			type: "assistant",
			message: createAssistantBetaMessage(normalized),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.messages.push(assistantMessage);
		this.emit("message", assistantMessage);
	}

	private emitSystemInitMessage(sessionId: string): void {
		if (this.hasInitMessage) {
			return;
		}
		this.hasInitMessage = true;

		const initMessage: SDKSystemInitMessage = {
			type: "system",
			subtype: "init",
			agents: undefined,
			apiKeySource: "user",
			claude_code_version: "codex-app-server",
			cwd: this.config.workingDirectory || cwd(),
			tools: [],
			mcp_servers: [],
			model: this.config.model || DEFAULT_CODEX_MODEL,
			permissionMode: "default",
			slash_commands: [],
			output_style: "default",
			skills: [],
			plugins: [],
			uuid: crypto.randomUUID(),
			session_id: sessionId,
		};

		this.messages.push(initMessage);
		this.emit("message", initMessage);
	}

	private createSuccessResultMessage(result: string): SDKResultMessage {
		const durationMs = Math.max(Date.now() - this.startTimestampMs, 0);
		return {
			type: "result",
			subtype: "success",
			duration_ms: durationMs,
			duration_api_ms: 0,
			is_error: false,
			num_turns: Math.max(this.completedTurnCount, 1),
			result,
			stop_reason: null,
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
			num_turns: Math.max(this.completedTurnCount, 1),
			stop_reason: null,
			errors: [errorMessage],
			total_cost_usd: 0,
			usage: createResultUsage(this.lastUsage),
			modelUsage: {},
			permission_denials: [],
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
	}

	private cleanupRuntimeState(): void {
		this.terminalTurnResolver = null;
		this.terminalTurnRejecter = null;
		this.pendingPrompts = [];
		this.sessionTask = null;
		this.streamingMode = false;
		this.streamingCompleted = false;
		this.activeTurnId = null;
		this.turnStartedResolver = null;
		this.turnStartedRejecter = null;
		this.turnStartedPromise = null;
		this.appServerClient?.close();
		this.appServerClient = null;
	}

	stop(): void {
		if (!this.sessionInfo?.isRunning) {
			return;
		}

		this.wasStopped = true;
		this.streamingCompleted = true;
		this.pendingPrompts = [];
		if (this.appServerClient && this.sessionInfo.sessionId) {
			void this.appServerClient
				.interruptTurn({ threadId: this.sessionInfo.sessionId })
				.catch((error) => {
					console.warn(
						`[CodexRunner] Failed to interrupt app-server turn: ${normalizeError(error)}`,
					);
					this.appServerClient?.close();
				});
			return;
		}

		this.appServerClient?.close();
		this.finalizeSession();
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
