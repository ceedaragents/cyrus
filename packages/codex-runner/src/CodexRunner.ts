import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";
import type { Thread, ThreadOptions, Usage } from "@openai/codex-sdk";
import { Codex } from "@openai/codex-sdk";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
} from "cyrus-core";
import { CodexMessageFormatter } from "./formatter.js";
import type {
	CodexConfigOverrides,
	CodexJsonEvent,
	CodexRunnerConfig,
	CodexRunnerEvents,
	CodexSessionInfo,
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

function toFiniteNumber(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
		model: "gpt-5-codex",
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
		},
		container: null,
		context_management: null,
	};
}

function parseUsage(usage: Usage | null | undefined): ParsedUsage {
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
	};
}

function getDefaultReasoningEffortForModel(
	model?: string,
): CodexRunnerConfig["modelReasoningEffort"] | undefined {
	// gpt-5-codex rejects xhigh in some environments; pin a compatible default.
	return model?.toLowerCase() === "gpt-5-codex" ? "high" : undefined;
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

/**
 * Runner that adapts Codex SDK streaming output to Cyrus SDK message types.
 */
export class CodexRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;

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
	private abortController: AbortController | null = null;

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

	addStreamMessage(_content: string): void {
		throw new Error("CodexRunner does not support streaming input messages");
	}

	completeStream(): void {
		// No-op: CodexRunner does not support streaming input.
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

		const prompt = (stringPrompt ?? streamingInitialPrompt ?? "").trim();
		const threadOptions = this.buildThreadOptions();
		const codex = this.createCodexClient();
		const thread = this.config.resumeSessionId
			? codex.resumeThread(this.config.resumeSessionId, threadOptions)
			: codex.startThread(threadOptions);
		const abortController = new AbortController();
		this.abortController = abortController;

		let caughtError: unknown;
		try {
			await this.runTurn(thread, prompt, abortController.signal);
		} catch (error) {
			caughtError = error;
		} finally {
			this.finalizeSession(caughtError);
		}

		return this.sessionInfo;
	}

	private createCodexClient(): Codex {
		const codexHome = this.resolveCodexHome();
		const envOverride = this.buildEnvOverride(codexHome);
		const configOverrides = this.buildConfigOverrides();

		return new Codex({
			...(this.config.codexPath
				? { codexPathOverride: this.config.codexPath }
				: {}),
			...(envOverride ? { env: envOverride } : {}),
			...(configOverrides ? { config: configOverrides } : {}),
		});
	}

	private buildThreadOptions(): ThreadOptions {
		const additionalDirectories = this.getAdditionalDirectories();
		const reasoningEffort =
			this.config.modelReasoningEffort ??
			getDefaultReasoningEffortForModel(this.config.model);
		const webSearchMode =
			this.config.webSearchMode ??
			(this.config.includeWebSearch ? "live" : undefined);

		const threadOptions: ThreadOptions = {
			model: this.config.model,
			sandboxMode: this.config.sandbox || "workspace-write",
			workingDirectory: this.config.workingDirectory,
			skipGitRepoCheck: this.config.skipGitRepoCheck ?? true,
			approvalPolicy: this.config.askForApproval || "never",
			...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
			...(webSearchMode ? { webSearchMode } : {}),
			...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
		};

		return threadOptions;
	}

	private getAdditionalDirectories(): string[] {
		const workingDirectory = this.config.workingDirectory;
		const uniqueDirectories = new Set<string>();

		for (const directory of this.config.allowedDirectories || []) {
			if (!directory || directory === workingDirectory) {
				continue;
			}
			uniqueDirectories.add(directory);
		}

		return [...uniqueDirectories];
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

	private buildConfigOverrides(): CodexConfigOverrides | undefined {
		const appendSystemPrompt = (this.config.appendSystemPrompt ?? "").trim();
		const configOverrides = this.config.configOverrides
			? { ...this.config.configOverrides }
			: undefined;

		if (!appendSystemPrompt) {
			return configOverrides;
		}

		return {
			...(configOverrides ?? {}),
			developer_instructions: appendSystemPrompt,
		};
	}

	private async runTurn(
		thread: Thread,
		prompt: string,
		signal: AbortSignal,
	): Promise<void> {
		const streamedTurn = await thread.runStreamed(prompt, { signal });
		for await (const event of streamedTurn.events) {
			this.handleEvent(event);
		}
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
				}
				break;
			}
			case "turn.completed": {
				this.lastUsage = parseUsage(event.usage);
				this.pendingResultMessage = this.createSuccessResultMessage(
					this.lastAssistantText || "Codex session completed successfully",
				);
				break;
			}
			case "turn.failed": {
				const message = event.error.message || "Codex execution failed";
				this.errorMessages.push(message);
				this.pendingResultMessage = this.createErrorResultMessage(message);
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

	private finalizeSession(caughtError?: unknown): void {
		if (!this.sessionInfo) {
			this.cleanupRuntimeState();
			return;
		}

		this.sessionInfo.isRunning = false;

		// Ensure init is emitted even if stream fails before thread.started.
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
			claude_code_version: "codex-cli",
			cwd: this.config.workingDirectory || cwd(),
			tools: [],
			mcp_servers: [],
			model: this.config.model || "gpt-5-codex",
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
			num_turns: 1,
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
			num_turns: 1,
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
		this.abortController = null;
	}

	stop(): void {
		if (!this.sessionInfo?.isRunning) {
			return;
		}
		this.wasStopped = true;
		this.abortController?.abort();
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
