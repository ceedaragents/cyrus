import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cwd } from "node:process";
import { createInterface } from "node:readline";
import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
} from "cyrus-core";
import type {
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

function asNumber(value: unknown): number {
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
			server_tool_use: null,
			service_tier: null,
		},
		container: null,
		context_management: null,
	};
}

function extractTextFromOutput(output: unknown): string | null {
	if (!Array.isArray(output)) {
		return null;
	}

	const chunks: string[] = [];
	for (const item of output) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const outputRecord = item as Record<string, unknown>;
		if (typeof outputRecord.text === "string") {
			chunks.push(outputRecord.text);
			continue;
		}

		const content = outputRecord.content;
		if (typeof content === "string") {
			chunks.push(content);
			continue;
		}
		if (Array.isArray(content)) {
			for (const part of content) {
				if (!part || typeof part !== "object") {
					continue;
				}
				const partRecord = part as Record<string, unknown>;
				if (typeof partRecord.text === "string") {
					chunks.push(partRecord.text);
				}
			}
		}
	}

	if (chunks.length === 0) {
		return null;
	}

	return chunks.join("\n").trim() || null;
}

function parseUsage(usage: unknown): ParsedUsage {
	if (!usage || typeof usage !== "object") {
		return {
			inputTokens: 0,
			outputTokens: 0,
			cachedInputTokens: 0,
		};
	}

	const usageRecord = usage as Record<string, unknown>;
	return {
		inputTokens: asNumber(usageRecord.input_tokens ?? usageRecord.inputTokens),
		outputTokens: asNumber(
			usageRecord.output_tokens ?? usageRecord.outputTokens,
		),
		cachedInputTokens: asNumber(
			usageRecord.cached_input_tokens ?? usageRecord.cachedInputTokens,
		),
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
		server_tool_use: {
			web_fetch_requests: 0,
			web_search_requests: 0,
		},
		service_tier: "standard",
	};
}

function getDefaultReasoningEffortForModel(model?: string): "high" | null {
	// gpt-5-codex rejects xhigh in some environments; pin a compatible default.
	return model?.toLowerCase() === "gpt-5-codex" ? "high" : null;
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
 * Runner that adapts `codex exec --json` output to Cyrus SDK message types.
 */
export class CodexRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;

	private config: CodexRunnerConfig;
	private process: ChildProcess | null = null;
	private sessionInfo: CodexSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;
	private cyrusHome: string;
	private hasInitMessage = false;
	private pendingResultMessage: SDKResultMessage | null = null;
	private lastAssistantText: string | null = null;
	private lastUsage: ParsedUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cachedInputTokens: 0,
	};
	private errorMessages: string[] = [];
	private stderrLines: string[] = [];
	private startTimestampMs = 0;
	private wasStopped = false;
	private outputFilePath: string | null = null;
	private stdoutReadline: ReturnType<typeof createInterface> | null = null;
	private stderrReadline: ReturnType<typeof createInterface> | null = null;

	constructor(config: CodexRunnerConfig) {
		super();
		this.config = config;
		this.cyrusHome = config.cyrusHome;
		this.formatter = new ClaudeMessageFormatter();

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
		this.stderrLines = [];
		this.wasStopped = false;
		this.startTimestampMs = Date.now();
		this.cleanupOutputFile();

		const prompt = this.buildPrompt(stringPrompt, streamingInitialPrompt);
		const { command, args, env } = this.buildCommand(prompt);

		this.emitSystemInitMessage(sessionId);

		await new Promise<void>((resolve) => {
			this.process = spawn(command, args, {
				cwd: this.config.workingDirectory,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});

			this.stdoutReadline = this.process.stdout
				? createInterface({ input: this.process.stdout })
				: null;
			this.stderrReadline = this.process.stderr
				? createInterface({ input: this.process.stderr })
				: null;

			this.stdoutReadline?.on("line", (line) => this.handleStdoutLine(line));
			this.stderrReadline?.on("line", (line) => this.handleStderrLine(line));

			this.process.once("error", (error) => {
				this.errorMessages.push(error.message);
			});

			this.process.once("close", (code, signal) => {
				this.handleClose(code, signal);
				resolve();
			});
		});

		return this.sessionInfo;
	}

	private buildPrompt(
		stringPrompt?: string | null,
		streamingInitialPrompt?: string,
	): string {
		const prompt = (stringPrompt ?? streamingInitialPrompt ?? "").trim();
		const appendSystemPrompt = (this.config.appendSystemPrompt ?? "").trim();

		if (appendSystemPrompt && prompt) {
			return `${appendSystemPrompt}\n\n${prompt}`;
		}
		if (appendSystemPrompt) {
			return appendSystemPrompt;
		}
		return prompt;
	}

	private buildCommand(prompt: string): {
		command: string;
		args: string[];
		env: NodeJS.ProcessEnv;
	} {
		const command = this.config.codexPath || "codex";
		const args: string[] = [];

		args.push("--ask-for-approval", this.config.askForApproval || "never");
		args.push("--sandbox", this.config.sandbox || "workspace-write");

		const reasoningEffort =
			this.config.modelReasoningEffort ??
			getDefaultReasoningEffortForModel(this.config.model);
		if (reasoningEffort) {
			args.push("-c", `model_reasoning_effort="${reasoningEffort}"`);
		}

		if (this.config.workingDirectory) {
			args.push("--cd", this.config.workingDirectory);
		}

		for (const directory of this.config.allowedDirectories || []) {
			if (!directory || directory === this.config.workingDirectory) {
				continue;
			}
			args.push("--add-dir", directory);
		}

		if (this.config.includeWebSearch) {
			args.push("--search");
		}

		args.push("exec");

		if (this.config.resumeSessionId) {
			args.push("resume");
		}

		args.push("--json");
		if (this.config.skipGitRepoCheck !== false) {
			args.push("--skip-git-repo-check");
		}

		// `-o` is not currently available on `codex exec resume`.
		if (!this.config.resumeSessionId) {
			const outputFilePath = join(
				this.cyrusHome,
				"tmp",
				`codex-last-message-${Date.now()}-${crypto.randomUUID()}.txt`,
			);
			this.outputFilePath = outputFilePath;
			args.push("--output-last-message", outputFilePath);
		}

		if (this.config.model) {
			args.push("--model", this.config.model);
		}

		if (this.config.resumeSessionId) {
			args.push(this.config.resumeSessionId);
		}

		if (prompt) {
			args.push(prompt);
		}

		const codexHome =
			this.config.codexHome ||
			process.env.CODEX_HOME ||
			join(homedir(), ".codex");
		mkdirSync(codexHome, { recursive: true });
		mkdirSync(join(this.cyrusHome, "tmp"), { recursive: true });

		const env = {
			...process.env,
			CODEX_HOME: codexHome,
		};

		return { command, args, env };
	}

	private handleStdoutLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		if (!trimmed.startsWith("{")) {
			return;
		}

		let event: CodexJsonEvent;
		try {
			event = JSON.parse(trimmed) as CodexJsonEvent;
		} catch {
			return;
		}

		this.emit("streamEvent", event);

		switch (event.type) {
			case "thread.started": {
				const threadId =
					typeof event.thread_id === "string" ? event.thread_id : null;
				if (threadId && this.sessionInfo) {
					this.sessionInfo.sessionId = threadId;
				}
				break;
			}
			case "item.completed": {
				this.handleItemCompleted(event);
				break;
			}
			case "turn.completed": {
				this.handleTurnCompleted(event);
				break;
			}
			case "turn.failed": {
				this.handleTurnFailed(event);
				break;
			}
			case "error": {
				if (typeof event.message === "string") {
					this.errorMessages.push(event.message);
				}
				break;
			}
			case "response.failed": {
				const message = this.extractEventErrorMessage(event);
				if (message) {
					this.errorMessages.push(message);
				}
				break;
			}
			default:
				break;
		}
	}

	private handleStderrLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		this.stderrLines.push(trimmed);
		if (this.stderrLines.length > 25) {
			this.stderrLines.shift();
		}
	}

	private handleItemCompleted(event: CodexJsonEvent): void {
		if (!event.item || typeof event.item !== "object") {
			return;
		}
		const item = event.item as Record<string, unknown>;
		const itemType = typeof item.type === "string" ? item.type : "";
		if (itemType !== "agent_message") {
			return;
		}

		const text =
			typeof item.text === "string"
				? item.text
				: extractTextFromOutput(item.content ?? item.output);
		if (!text) {
			return;
		}

		this.emitAssistantMessage(text);
	}

	private handleTurnCompleted(event: CodexJsonEvent): void {
		const turn =
			event.turn && typeof event.turn === "object"
				? (event.turn as Record<string, unknown>)
				: null;
		const text = extractTextFromOutput(turn?.output);
		if (text && text !== this.lastAssistantText) {
			this.emitAssistantMessage(text);
		}

		this.lastUsage = parseUsage(turn?.usage);
		this.pendingResultMessage = this.createSuccessResultMessage(
			this.lastAssistantText || "Codex session completed successfully",
		);
	}

	private handleTurnFailed(event: CodexJsonEvent): void {
		const message =
			this.extractEventErrorMessage(event) ||
			this.errorMessages.at(-1) ||
			"Codex execution failed";
		this.pendingResultMessage = this.createErrorResultMessage(message);
	}

	private extractEventErrorMessage(event: CodexJsonEvent): string | null {
		if (typeof event.message === "string") {
			return event.message;
		}
		if (event.error && typeof event.error === "object") {
			const message = (event.error as Record<string, unknown>).message;
			if (typeof message === "string") {
				return message;
			}
		}
		return null;
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

	private readOutputLastMessage(): string | null {
		if (!this.outputFilePath || !existsSync(this.outputFilePath)) {
			return null;
		}
		try {
			const content = readFileSync(this.outputFilePath, "utf-8");
			return content.trim() || null;
		} catch {
			return null;
		}
	}

	private handleClose(
		code: number | null,
		signal: NodeJS.Signals | null,
	): void {
		if (!this.sessionInfo) {
			return;
		}

		this.sessionInfo.isRunning = false;

		const outputLastMessage = this.readOutputLastMessage();
		if (
			outputLastMessage &&
			outputLastMessage !== this.lastAssistantText &&
			!this.wasStopped
		) {
			this.emitAssistantMessage(outputLastMessage);
		}

		if (!this.pendingResultMessage && !this.wasStopped) {
			if ((code ?? 0) === 0) {
				this.pendingResultMessage = this.createSuccessResultMessage(
					this.lastAssistantText || "Codex session completed successfully",
				);
			} else {
				const signalText = signal ? ` (signal: ${signal})` : "";
				const stderrText = this.stderrLines.at(-1);
				const defaultMessage = `Codex process exited with code ${code ?? "unknown"}${signalText}`;
				this.pendingResultMessage = this.createErrorResultMessage(
					this.errorMessages.at(-1) || stderrText || defaultMessage,
				);
			}
		}

		if (this.pendingResultMessage) {
			this.messages.push(this.pendingResultMessage);
			this.emit("message", this.pendingResultMessage);
			this.pendingResultMessage = null;
		}

		this.emit("complete", [...this.messages]);

		this.cleanupProcessState();
	}

	private cleanupProcessState(): void {
		this.stdoutReadline?.close();
		this.stderrReadline?.close();
		this.stdoutReadline = null;
		this.stderrReadline = null;
		this.process = null;
		this.cleanupOutputFile();
	}

	private cleanupOutputFile(): void {
		if (this.outputFilePath && existsSync(this.outputFilePath)) {
			try {
				rmSync(this.outputFilePath, { force: true });
			} catch {
				// Best effort cleanup only.
			}
		}
		this.outputFilePath = null;
	}

	stop(): void {
		if (!this.process || !this.sessionInfo?.isRunning) {
			return;
		}
		this.wasStopped = true;
		this.process.kill("SIGTERM");
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
