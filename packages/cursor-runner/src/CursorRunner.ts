import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import {
	chmodSync,
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	renameSync,
	unlinkSync,
	type WriteStream,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { cwd } from "node:process";
import { fileURLToPath } from "node:url";
import type {
	McpServerConfig as CursorMcpServerConfig,
	SDKAssistantMessage as CursorSDKAssistantMessage,
	SDKMessage as CursorSDKMessage,
	SDKStatusMessage as CursorSDKStatusMessage,
	SDKThinkingMessage as CursorSDKThinkingMessage,
	SDKToolUseMessage as CursorSDKToolUseMessage,
	SDKUserMessageEvent as CursorSDKUserMessageEvent,
	Run,
	SDKAgent,
} from "@cursor/sdk";
import { Agent } from "@cursor/sdk";
import type {
	IAgentRunner,
	IMessageFormatter,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKUserMessage,
} from "cyrus-core";
import { CursorMessageFormatter } from "./formatter.js";
import {
	buildCyrusPermissionsConfig,
	type CyrusPermissionsConfig,
} from "./permissions.js";
import type {
	CursorRunnerConfig,
	CursorRunnerEvents,
	CursorSessionInfo,
} from "./types.js";

type ToolInput = Record<string, unknown>;

type SDKSystemInitMessage = Extract<
	SDKMessage,
	{ type: "system"; subtype: "init" }
>;

interface CursorHooksRestoreState {
	hooksPath: string;
	backupPath: string | null;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function normalizeError(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (typeof error === "string") return error;
	return "Cursor execution failed";
}

function normalizeCursorModel(model?: string): string | undefined {
	if (!model) return model;
	// Preserve backward compatibility for legacy aliases that the SDK rejects.
	if (model.toLowerCase() === "gpt-5") return "auto";
	return model;
}

function createAssistantToolUseMessage(
	toolUseId: string,
	toolName: string,
	toolInput: ToolInput,
	messageId: string = crypto.randomUUID(),
): SDKAssistantMessage["message"] {
	const contentBlocks = [
		{ type: "tool_use", id: toolUseId, name: toolName, input: toolInput },
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

function createAssistantTextMessage(
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

	return { role: "user", content: contentBlocks };
}

function createResultUsage(): SDKResultMessage["usage"] {
	return {
		input_tokens: 0,
		output_tokens: 0,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
		cache_creation: {
			ephemeral_1h_input_tokens: 0,
			ephemeral_5m_input_tokens: 0,
		},
	} as SDKResultMessage["usage"];
}

/**
 * Convert the Cyrus inline MCP config (potentially containing in-process
 * SDK servers) into the SDK's serializable McpServerConfig format. Skips
 * entries that aren't transportable.
 */
function mapCyrusMcpToSdk(
	mcpConfig: CursorRunnerConfig["mcpConfig"] | undefined,
): Record<string, CursorMcpServerConfig> {
	const servers: Record<string, CursorMcpServerConfig> = {};
	if (!mcpConfig) return servers;

	for (const [name, raw] of Object.entries(mcpConfig)) {
		const cfg = raw as Record<string, unknown>;
		if (
			typeof cfg.listTools === "function" ||
			typeof cfg.callTool === "function"
		) {
			console.warn(
				`[CursorRunner] Skipping MCP server '${name}' because in-process SDK server instances cannot be serialized for @cursor/sdk`,
			);
			continue;
		}

		if (typeof cfg.url === "string" && cfg.url.length > 0) {
			const headers =
				cfg.headers &&
				typeof cfg.headers === "object" &&
				!Array.isArray(cfg.headers)
					? (cfg.headers as Record<string, string>)
					: undefined;
			const type = (cfg.type === "sse" ? "sse" : "http") as "http" | "sse";
			servers[name] = {
				type,
				url: cfg.url,
				...(headers ? { headers } : {}),
			};
			continue;
		}

		if (typeof cfg.command === "string" && cfg.command.length > 0) {
			const args = Array.isArray(cfg.args) ? (cfg.args as string[]) : undefined;
			const env =
				cfg.env && typeof cfg.env === "object" && !Array.isArray(cfg.env)
					? (cfg.env as Record<string, string>)
					: undefined;
			servers[name] = {
				type: "stdio",
				command: cfg.command,
				...(args ? { args } : {}),
				...(env ? { env } : {}),
				...(typeof cfg.cwd === "string" ? { cwd: cfg.cwd } : {}),
			};
			continue;
		}

		console.warn(
			`[CursorRunner] Skipping MCP server '${name}' because it has no serializable command/url transport`,
		);
	}

	return servers;
}

interface ToolProjection {
	toolUseId: string;
	toolName: string;
	toolInput: ToolInput;
	result: string;
	isError: boolean;
}

/**
 * Project an SDK `tool_call` event into the Claude-shaped tool_use /
 * tool_result pair that the Cyrus formatter and timeline expect.
 *
 * MCP tool calls surface as the generic `name: "mcp"` in the SDK stream;
 * this inspects `args` to extract the actual `<server>:<tool>` and
 * re-projects them as `mcp__<server>__<tool>` to match the Claude
 * runner's convention.
 */
function projectToolCall(
	event: CursorSDKToolUseMessage,
	workingDirectory?: string,
): ToolProjection {
	const args = (event.args ?? {}) as Record<string, unknown>;
	const rawName = (event.name ?? "").toLowerCase();

	let toolName = event.name ?? "Tool";
	let toolInput: ToolInput = args as ToolInput;

	if (rawName === "shell") {
		toolName = "Bash";
		const command = typeof args.command === "string" ? args.command : "";
		toolInput = { command, description: command };
	} else if (rawName === "read") {
		toolName = "Read";
		toolInput = {
			file_path: typeof args.path === "string" ? args.path : args.file_path,
			offset: args.offset,
			limit: args.limit,
		};
	} else if (rawName === "grep") {
		toolName = "Grep";
		toolInput = {
			pattern: typeof args.pattern === "string" ? args.pattern : "",
			path: typeof args.path === "string" ? args.path : undefined,
		};
	} else if (rawName === "glob") {
		toolName = "Glob";
		toolInput = {
			pattern:
				typeof args.globPattern === "string" ? args.globPattern : args.pattern,
			path:
				typeof args.targetDirectory === "string"
					? args.targetDirectory
					: undefined,
		};
	} else if (
		rawName === "edit" ||
		rawName === "write" ||
		rawName === "delete"
	) {
		toolName =
			rawName === "delete" ? "Edit" : rawName === "write" ? "Write" : "Edit";
		toolInput = { file_path: typeof args.path === "string" ? args.path : "" };
	} else if (rawName === "mcp") {
		const provider =
			typeof args.providerIdentifier === "string"
				? args.providerIdentifier
				: typeof (args as Record<string, unknown>).server === "string"
					? ((args as Record<string, unknown>).server as string)
					: "mcp";
		const innerTool =
			typeof args.toolName === "string"
				? args.toolName
				: typeof (args as Record<string, unknown>).name === "string"
					? ((args as Record<string, unknown>).name as string)
					: "tool";
		toolName = `mcp__${provider}__${innerTool}`;
		toolInput =
			args.args && typeof args.args === "object"
				? (args.args as ToolInput)
				: ({} as ToolInput);
	} else if (rawName === "update_todos" || rawName === "updatetodos") {
		toolName = "TodoWrite";
		toolInput = { todos: args.todos };
	} else if (rawName === "web_fetch" || rawName === "webfetch") {
		toolName = "WebFetch";
		toolInput = { url: typeof args.url === "string" ? args.url : "" };
	}

	let resultText = "Tool completed";
	const isError = event.status === "error";
	if (event.result !== undefined && event.result !== null) {
		if (typeof event.result === "string") {
			resultText = event.result;
		} else {
			resultText = safeStringify(event.result);
		}
	} else if (isError) {
		resultText = "Tool failed";
	}

	// Light path normalization: trim workingDirectory prefix on read targets.
	if (
		workingDirectory &&
		toolName === "Read" &&
		typeof toolInput.file_path === "string" &&
		toolInput.file_path.startsWith(workingDirectory)
	) {
		const rel = toolInput.file_path
			.slice(workingDirectory.length)
			.replace(/^\//, "");
		if (rel) toolInput = { ...toolInput, file_path: rel };
	}

	return {
		toolUseId: event.call_id,
		toolName,
		toolInput,
		result: resultText,
		isError,
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
	private agent: SDKAgent | null = null;
	private currentRun: Run | null = null;
	private pendingResultMessage: SDKResultMessage | null = null;
	private hasInitMessage = false;
	private lastAssistantText: string | null = null;
	private wasStopped = false;
	private startTimestampMs = 0;
	private errorMessages: string[] = [];
	private emittedToolUseIds = new Set<string>();
	private logStream: WriteStream | null = null;
	private hooksRestoreState: CursorHooksRestoreState | null = null;
	private permissionsArtifactsInstalled = false;

	constructor(config: CursorRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new CursorMessageFormatter();

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<CursorSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Cursor session already running");
		}

		const initialSessionId = this.config.resumeSessionId || crypto.randomUUID();
		this.sessionInfo = {
			sessionId: initialSessionId,
			startedAt: new Date(),
			isRunning: true,
		};

		this.messages = [];
		this.pendingResultMessage = null;
		this.hasInitMessage = false;
		this.lastAssistantText = null;
		this.wasStopped = false;
		this.startTimestampMs = Date.now();
		this.errorMessages = [];
		this.emittedToolUseIds.clear();
		this.setupLogging(initialSessionId);

		const workspace = resolve(this.config.workingDirectory || cwd());

		try {
			this.installPermissionsArtifacts(workspace);

			// Test/CI fallback for environments where the SDK can't run.
			if (process.env.CYRUS_CURSOR_MOCK === "1") {
				this.emitInitMessage();
				this.pushAssistantText("Cursor mock session completed");
				this.pendingResultMessage = this.createSuccessResultMessage(
					"Cursor mock session completed",
				);
				this.finalizeSession();
				return this.sessionInfo;
			}

			const apiKey = this.config.cursorApiKey ?? process.env.CURSOR_API_KEY;
			const normalizedModel = normalizeCursorModel(this.config.model);
			const mcpServers = mapCyrusMcpToSdk(this.config.mcpConfig);

			const baseAgentOptions = {
				apiKey,
				...(normalizedModel ? { model: { id: normalizedModel } } : {}),
				local: {
					// `cwd` is passed as a string[] per Cyrus convention; the SDK
					// types accept `string | string[]`.
					cwd: [workspace],
					settingSources: ["project" as const],
					// TODO(CYPACK-1149): re-enable sandbox once @cursor/sdk exports
					// configureSandboxPrereqs — bug filed with the Cursor team.
					// sandboxOptions: { enabled: this.config.sandbox === "enabled" },
				},
				...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
			};

			let agent: SDKAgent;
			if (this.config.resumeSessionId) {
				console.log(
					`[CursorRunner] Resuming agent ${this.config.resumeSessionId}`,
				);
				agent = await Agent.resume(
					this.config.resumeSessionId,
					baseAgentOptions,
				);
			} else {
				agent = await Agent.create(baseAgentOptions);
			}
			this.agent = agent;

			if (this.sessionInfo) {
				this.sessionInfo.sessionId = agent.agentId;
			}
			this.emitInitMessage();

			console.log(
				`[CursorRunner] Sending prompt to agent ${agent.agentId} (resume=${Boolean(this.config.resumeSessionId)})`,
			);

			let caughtError: unknown;
			try {
				const run = await agent.send(prompt);
				this.currentRun = run;
				for await (const event of run.stream()) {
					if (this.wasStopped) break;
					this.handleSdkEvent(event);
				}
			} catch (error) {
				caughtError = error;
			}

			this.finalizeSession(caughtError);
		} catch (error) {
			this.finalizeSession(error);
		}

		return this.sessionInfo;
	}

	async startStreaming(_initialPrompt?: string): Promise<CursorSessionInfo> {
		throw new Error("CursorRunner does not support streaming input");
	}

	addStreamMessage(_content: string): void {
		throw new Error("CursorRunner does not support streaming input messages");
	}

	completeStream(): void {
		// No-op: CursorRunner does not support streaming input.
	}

	stop(): void {
		this.wasStopped = true;
		const run = this.currentRun;
		if (run && typeof run.cancel === "function") {
			void run.cancel().catch(() => {});
		}
		const agent = this.agent;
		if (agent && typeof agent.close === "function") {
			try {
				agent.close();
			} catch {}
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

	// ---------- SDK event handling ----------

	private handleSdkEvent(event: CursorSDKMessage): void {
		switch (event.type) {
			case "system":
				if (event.subtype === "init" && this.sessionInfo) {
					this.sessionInfo.sessionId = event.agent_id;
				}
				this.emitInitMessage();
				return;
			case "assistant":
				this.handleAssistantEvent(event);
				return;
			case "user":
				this.handleUserEvent(event);
				return;
			case "tool_call":
				this.handleToolCallEvent(event);
				return;
			case "thinking":
				this.handleThinkingEvent(event);
				return;
			case "status":
				this.handleStatusEvent(event);
				return;
			default:
				return;
		}
	}

	private handleAssistantEvent(event: CursorSDKAssistantMessage): void {
		this.emitInitMessage();
		const content = event.message?.content ?? [];
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			if (block.type === "text" && typeof block.text === "string") {
				if (block.text.trim().length === 0) continue;
				this.lastAssistantText = block.text;
				this.pushAssistantText(block.text);
			} else if (block.type === "tool_use") {
				const rawName = String(block.name || "Tool");
				const lowered = rawName.toLowerCase();
				let toolName = rawName;
				let toolInput = (block.input ?? {}) as ToolInput;
				// MCP tool_use blocks surface as name="mcp" — extract real id.
				if (lowered === "mcp") {
					const args = toolInput as Record<string, unknown>;
					const provider =
						typeof args.providerIdentifier === "string"
							? args.providerIdentifier
							: typeof args.server === "string"
								? args.server
								: "mcp";
					const innerTool =
						typeof args.toolName === "string"
							? args.toolName
							: typeof args.name === "string"
								? args.name
								: "tool";
					toolName = `mcp__${provider}__${innerTool}`;
					toolInput =
						args.args && typeof args.args === "object"
							? (args.args as ToolInput)
							: ({} as ToolInput);
				}
				this.emitToolUse({
					toolUseId: block.id,
					toolName,
					toolInput,
					result: "",
					isError: false,
				});
			}
		}
	}

	private handleUserEvent(event: CursorSDKUserMessageEvent): void {
		this.emitInitMessage();
		const content = event.message?.content ?? [];
		const text = content
			.filter(
				(b): b is { type: "text"; text: string } =>
					Boolean(b) &&
					typeof b === "object" &&
					(b as { type?: string }).type === "text",
			)
			.map((b) => b.text)
			.join("")
			.trim();
		if (!text) return;

		const message: SDKUserMessage = {
			type: "user",
			message: {
				role: "user",
				content: [{ type: "text", text }],
			},
			parent_tool_use_id: null,
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private handleToolCallEvent(event: CursorSDKToolUseMessage): void {
		this.emitInitMessage();
		const projection = projectToolCall(event, this.config.workingDirectory);
		if (event.status === "running") {
			this.emitToolUse(projection);
			return;
		}
		this.emitToolUse(projection);
		this.emitToolResult(projection);
	}

	private handleThinkingEvent(_event: CursorSDKThinkingMessage): void {
		// cyrus-core's SDKAssistantMessage content blocks don't yet include
		// "thinking"; intentionally drop these to avoid invalid shapes.
	}

	private handleStatusEvent(event: CursorSDKStatusMessage): void {
		if (event.status === "ERROR") {
			const message = event.message || "Cursor session errored";
			this.errorMessages.push(message);
			this.pendingResultMessage = this.createErrorResultMessage(message);
		} else if (event.status === "CANCELLED") {
			this.pendingResultMessage = this.createErrorResultMessage(
				"Cursor session cancelled",
			);
		} else if (event.status === "EXPIRED") {
			this.pendingResultMessage = this.createErrorResultMessage(
				"Cursor session expired",
			);
		}
	}

	// ---------- Permission artifacts ----------

	private installPermissionsArtifacts(workspace: string): void {
		const cursorDir = join(workspace, ".cursor");
		mkdirSync(cursorDir, { recursive: true });

		// 1. Permissions config (auto-deny is merged in by the helper)
		const cfg: CyrusPermissionsConfig = buildCyrusPermissionsConfig({
			workspace,
			allowedTools: this.config.allowedTools,
			disallowedTools: this.config.disallowedTools,
		});
		writeFileSync(
			join(cursorDir, "cyrus-permissions.json"),
			`${JSON.stringify(cfg, null, "\t")}\n`,
			"utf8",
		);

		// 2. Permission helper script (copied from package's bundled .mjs)
		const helperDst = join(cursorDir, "cyrus-permission-check.mjs");
		const helperSrc = this.locatePermissionCheckSource();
		copyFileSync(helperSrc, helperDst);
		try {
			chmodSync(helperDst, 0o755);
		} catch {}

		// 3. Hooks config (back up any existing one)
		const hooksPath = join(cursorDir, "hooks.json");
		const existed = existsSync(hooksPath);
		const backupPath = existed
			? `${hooksPath}.cyrus-backup-${Date.now()}-${process.pid}`
			: null;
		if (existed && backupPath) {
			renameSync(hooksPath, backupPath);
		}
		const hooksConfig = {
			version: 1,
			hooks: {
				preToolUse: [
					{ command: "./.cursor/cyrus-permission-check.mjs", failClosed: true },
				],
				beforeShellExecution: [
					{ command: "./.cursor/cyrus-permission-check.mjs", failClosed: true },
				],
				beforeReadFile: [
					{ command: "./.cursor/cyrus-permission-check.mjs", failClosed: true },
				],
				beforeMCPExecution: [
					{ command: "./.cursor/cyrus-permission-check.mjs", failClosed: true },
				],
			},
		};
		writeFileSync(
			hooksPath,
			`${JSON.stringify(hooksConfig, null, "\t")}\n`,
			"utf8",
		);
		this.hooksRestoreState = { hooksPath, backupPath };
		this.permissionsArtifactsInstalled = true;

		console.log(
			`[CursorRunner] Installed Cyrus permission hooks at ${hooksPath} (allow=${cfg.allow.length}, deny=${cfg.deny.length}, backup=${backupPath ? "yes" : "no"})`,
		);
	}

	private locatePermissionCheckSource(): string {
		const here = dirname(fileURLToPath(import.meta.url));
		// When built, the .mjs sits next to the compiled JS in dist/.
		const built = join(here, "permission-check.mjs");
		if (existsSync(built)) return built;
		// During tests against src/, fall back to the source file.
		const fromSrc = join(here, "permission-check.mjs");
		if (existsSync(fromSrc)) return fromSrc;
		// Last-ditch: package root.
		const pkgRoot = join(here, "..", "src", "permission-check.mjs");
		if (existsSync(pkgRoot)) return pkgRoot;
		throw new Error(
			"[CursorRunner] could not locate cyrus permission-check.mjs helper",
		);
	}

	private uninstallPermissionsArtifacts(): void {
		if (!this.permissionsArtifactsInstalled) return;
		const workspace = resolve(this.config.workingDirectory || cwd());
		const cursorDir = join(workspace, ".cursor");
		const cfgPath = join(cursorDir, "cyrus-permissions.json");
		const helperPath = join(cursorDir, "cyrus-permission-check.mjs");

		try {
			if (existsSync(cfgPath)) unlinkSync(cfgPath);
		} catch {}
		try {
			if (existsSync(helperPath)) unlinkSync(helperPath);
		} catch {}

		const hooks = this.hooksRestoreState;
		if (hooks) {
			try {
				if (existsSync(hooks.hooksPath)) unlinkSync(hooks.hooksPath);
				if (hooks.backupPath && existsSync(hooks.backupPath)) {
					renameSync(hooks.backupPath, hooks.hooksPath);
				}
			} catch (error) {
				const detail = error instanceof Error ? error.message : String(error);
				console.warn(
					`[CursorRunner] Failed to restore hooks at ${hooks.hooksPath}: ${detail}`,
				);
			}
		}

		this.hooksRestoreState = null;
		this.permissionsArtifactsInstalled = false;
	}

	// ---------- Internal helpers ----------

	private emitToolUse(projection: ToolProjection): void {
		if (this.emittedToolUseIds.has(projection.toolUseId)) return;
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
				projection.result || "Tool completed",
				projection.isError,
			),
			parent_tool_use_id: projection.toolUseId,
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private pushAssistantText(text: string): void {
		const message: SDKAssistantMessage = {
			type: "assistant",
			message: createAssistantTextMessage(text),
			parent_tool_use_id: null,
			uuid: crypto.randomUUID(),
			session_id: this.sessionInfo?.sessionId || "pending",
		};
		this.pushMessage(message);
	}

	private emitInitMessage(): void {
		if (this.hasInitMessage) return;
		this.hasInitMessage = true;
		const sessionId = this.sessionInfo?.sessionId || crypto.randomUUID();
		const initMessage: SDKSystemInitMessage = {
			type: "system",
			subtype: "init",
			cwd: this.config.workingDirectory || cwd(),
			session_id: sessionId,
			tools: this.config.allowedTools || [],
			mcp_servers: [],
			model: this.config.model || "gpt-5",
			permissionMode: "default",
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
			stop_reason: null,
			total_cost_usd: 0,
			usage: createResultUsage(),
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
			stop_reason: null,
			total_cost_usd: 0,
			usage: createResultUsage(),
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
			const stream = createWriteStream(
				join(logsDir, `cursor-${sessionId}.jsonl`),
				{ flags: "a" },
			);
			stream.on("error", () => {
				// Swallow — logging is best-effort and must not crash the runner.
			});
			this.logStream = stream;
		} catch {
			this.logStream = null;
		}
	}

	private finalizeSession(error?: unknown): void {
		if (!this.sessionInfo) return;

		this.emitInitMessage();
		this.sessionInfo.isRunning = false;
		this.uninstallPermissionsArtifacts();

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
			resultMessage = this.createSuccessResultMessage(
				this.lastAssistantText || "Cursor session completed successfully",
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
		if (this.logStream) {
			try {
				this.logStream.end();
			} catch {}
			this.logStream = null;
		}
		this.currentRun = null;
		this.agent = null;
		this.pendingResultMessage = null;
	}
}
