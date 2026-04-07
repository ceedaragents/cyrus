import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import type { OpencodeClient } from "@opencode-ai/sdk";
import {
	type AgentConfig,
	type Config,
	createOpencodeClient,
	createOpencodeServer,
	type GlobalEvent,
	type McpLocalConfig,
	type McpRemoteConfig,
	type Event as OpenCodeEvent,
} from "@opencode-ai/sdk";
import type { IAgentRunner, IMessageFormatter, SDKMessage } from "cyrus-core";
import {
	buildAssistantTextMessage,
	buildErrorResultMessage,
	buildResultMessage,
	convertToolPartToMessages,
	extractSessionErrorMessage,
	extractTextDelta,
	isMessagePartUpdatedEvent,
	isMessageUpdatedEvent,
	isPermissionUpdatedEvent,
	isSessionErrorEvent,
	isSessionIdleEvent,
} from "./adapters.js";
import { OpenCodeMessageFormatter } from "./formatter.js";
import type {
	OpenCodeRunnerConfig,
	OpenCodeRunnerEvents,
	OpenCodeSessionInfo,
} from "./types.js";

export declare interface OpenCodeRunner {
	on<K extends keyof OpenCodeRunnerEvents>(
		event: K,
		listener: OpenCodeRunnerEvents[K],
	): this;
	emit<K extends keyof OpenCodeRunnerEvents>(
		event: K,
		...args: Parameters<OpenCodeRunnerEvents[K]>
	): boolean;
}

/**
 * Runner that integrates with OpenCode via its HTTP SDK.
 *
 * Flow:
 * 1. Spawn an `opencode serve` process via createOpencodeServer()
 * 2. Create an HTTP client pointed at the server
 * 3. Create a new OpenCode session
 * 4. Subscribe to global SSE events
 * 5. Send the prompt via session.prompt()
 * 6. Convert EventMessagePartUpdated → SDKAssistantMessage/SDKUserMessage
 * 7. Auto-approve EventPermissionUpdated
 * 8. Emit SDKResultMessage on EventSessionIdle
 * 9. Shut down the server process when done
 */
export class OpenCodeRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;

	private config: OpenCodeRunnerConfig;
	private sessionInfo: OpenCodeSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;
	private lastAssistantText: string | null = null;
	private totalInputTokens = 0;
	private totalOutputTokens = 0;
	private wasStopped = false;
	private abortController: AbortController | null = null;
	private serverClose: (() => void) | null = null;
	/**
	 * Tracks message IDs that belong to the user (prompt) turn so that
	 * message.part.updated events for those messages are not mistakenly
	 * accumulated as assistant response text.
	 */
	private userMessageIds: Set<string> = new Set();
	/**
	 * Tracks the ID of the most recent assistant message seen via message.updated.
	 * When a new assistant message starts, lastAssistantText is reset so that
	 * any user-prompt content accumulated before the assistant responds is cleared.
	 */
	private currentAssistantMessageId: string | null = null;
	/**
	 * Per-message token usage keyed by message ID. Updated on each
	 * message.updated event; summed when building the final result.
	 */
	private messageTokens: Map<string, { input: number; output: number }> =
		new Map();

	constructor(config: OpenCodeRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new OpenCodeMessageFormatter();

		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	// -------------------------------------------------------------------------
	// IAgentRunner public API
	// -------------------------------------------------------------------------

	async start(prompt: string): Promise<OpenCodeSessionInfo> {
		return this.runSession(prompt);
	}

	/**
	 * OpenCode does not support true streaming input; this method is provided
	 * for interface compatibility and behaves the same as start().
	 */
	async startStreaming(initialPrompt?: string): Promise<OpenCodeSessionInfo> {
		return this.runSession(initialPrompt ?? "");
	}

	addStreamMessage(_content: string): void {
		throw new Error("OpenCodeRunner does not support streaming input messages");
	}

	completeStream(): void {
		// No-op: OpenCodeRunner does not support streaming input.
	}

	stop(): void {
		if (this.abortController) {
			this.wasStopped = true;
			this.abortController.abort();
		}
	}

	isRunning(): boolean {
		return this.sessionInfo?.isRunning === true;
	}

	getMessages(): SDKMessage[] {
		return [...this.messages];
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	// -------------------------------------------------------------------------
	// Core session management
	// -------------------------------------------------------------------------

	private async runSession(prompt: string): Promise<OpenCodeSessionInfo> {
		if (this.isRunning()) {
			throw new Error("OpenCode session already running");
		}

		const sessionId = crypto.randomUUID();
		this.sessionInfo = {
			sessionId,
			opencodeSessionId: null,
			startedAt: new Date(),
			isRunning: true,
		};

		this.messages = [];
		this.lastAssistantText = null;
		this.totalInputTokens = 0;
		this.totalOutputTokens = 0;
		this.wasStopped = false;
		this.userMessageIds = new Set();
		this.currentAssistantMessageId = null;
		this.messageTokens = new Map();
		this.abortController = new AbortController();

		let caughtError: unknown;
		try {
			await this.executeSession(prompt, this.abortController.signal);
		} catch (error) {
			caughtError = error;
		} finally {
			this.finalizeSession(caughtError);
		}

		return this.sessionInfo;
	}

	private async executeSession(
		prompt: string,
		signal: AbortSignal,
	): Promise<void> {
		// 1. Start the OpenCode server process
		const workingDirectory = this.config.workingDirectory;
		const serverConfig = this.buildServerConfig();

		console.log("[OpenCodeRunner] Starting opencode server...");
		const port = await findFreePort();
		console.log(`[OpenCodeRunner] Using port ${port}`);
		const server = await createOpencodeServer({
			config: serverConfig,
			signal,
			port,
		});
		this.serverClose = server.close;
		console.log(`[OpenCodeRunner] Server started at ${server.url}`);

		// 2. Create HTTP client
		const client = createOpencodeClient({
			baseUrl: server.url,
			directory: workingDirectory,
		});

		// 3. Create a new session (passing directory via query param)
		const sessionCreateResult = await client.session.create({
			query: workingDirectory ? { directory: workingDirectory } : undefined,
		});

		if (!sessionCreateResult.data) {
			throw new Error("Failed to create OpenCode session: no data returned");
		}
		const opencodeSessionId = sessionCreateResult.data.id;
		console.log(`[OpenCodeRunner] Session created: ${opencodeSessionId}`);

		if (this.sessionInfo) {
			this.sessionInfo.opencodeSessionId = opencodeSessionId;
		}

		// 4. Subscribe to global SSE events and wait for completion
		await this.subscribeAndPrompt(client, opencodeSessionId, prompt, signal);
	}

	private async subscribeAndPrompt(
		client: OpencodeClient,
		opencodeSessionId: string,
		prompt: string,
		signal: AbortSignal,
	): Promise<void> {
		// Subscribe to global events stream
		const sseResult = await client.global.event();

		if (!sseResult || !sseResult.stream) {
			throw new Error("Failed to open global SSE event stream");
		}

		return new Promise<void>((resolve, reject) => {
			let settled = false;
			const settle = (outcome: "resolve" | "reject", err?: unknown) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				if (outcome === "resolve") resolve();
				else reject(err);
			};

			// Abort handler
			const onAbort = () => {
				settle("reject", new Error("OpenCode session aborted"));
			};
			signal.addEventListener("abort", onAbort, { once: true });

			// Send the prompt asynchronously after subscribing
			this.sendPrompt(client, opencodeSessionId, prompt).catch((err) => {
				settle("reject", err);
			});

			// Process events
			(async () => {
				try {
					for await (const sseItem of sseResult.stream) {
						if (signal.aborted || settled) {
							break;
						}

						// Each item from the SSE stream is a GlobalEvent: { directory, payload }
						const globalEvent = sseItem as GlobalEvent;
						const event = globalEvent.payload as OpenCodeEvent;
						if (!event) {
							continue;
						}

						this.emit("streamEvent", event);

						const done = await this.handleEvent(
							event,
							opencodeSessionId,
							client,
						);
						if (done) {
							break;
						}
					}
					settle("resolve");
				} catch (err) {
					settle("reject", err);
				}
			})();
		});
	}

	private async sendPrompt(
		client: OpencodeClient,
		opencodeSessionId: string,
		prompt: string,
	): Promise<void> {
		// Build model spec if a model is configured
		let modelSpec: { providerID: string; modelID: string } | undefined;
		if (this.config.model) {
			const parsed = this.parseModelSpec(this.config.model);
			if (parsed) {
				modelSpec = parsed;
			}
		}

		console.log(
			`[OpenCodeRunner] Sending prompt to session ${opencodeSessionId}`,
		);
		const result = await client.session.prompt({
			path: { id: opencodeSessionId },
			query: this.config.workingDirectory
				? { directory: this.config.workingDirectory }
				: undefined,
			body: {
				model: modelSpec,
				system: this.config.systemPrompt || this.config.appendSystemPrompt,
				parts: [{ type: "text", text: prompt }],
			},
		});

		if (!result.data) {
			console.warn("[OpenCodeRunner] session.prompt() returned no data");
		}
	}

	/**
	 * Handle a single SSE event.
	 * Returns true if the session should be considered complete.
	 */
	private async handleEvent(
		event: OpenCodeEvent,
		opencodeSessionId: string,
		client: OpencodeClient,
	): Promise<boolean> {
		// --- Track user/assistant message boundaries ---
		if (isMessageUpdatedEvent(event)) {
			const info = event.properties.info;
			if (info.sessionID !== opencodeSessionId) return false;

			if (info.role === "user") {
				// Track user message IDs so that message.part.updated events for the
				// user prompt are skipped and not accumulated as assistant text.
				this.userMessageIds.add(info.id);
			} else if (info.role === "assistant") {
				if (info.id !== this.currentAssistantMessageId) {
					// A new assistant message is starting.
					// Reset lastAssistantText so any user-prompt content that may have
					// been accumulated before this point (due to event-ordering races or
					// OpenCode sending user-part deltas) is discarded.
					this.currentAssistantMessageId = info.id;
					this.lastAssistantText = null;
				}
				// Accumulate token usage from assistant messages.
				// Each assistant message carries its own token counts. OpenCode fires
				// message.updated multiple times per message; we track the latest
				// per-message values and sum across messages in finalizeSession.
				const tokens = (info as Record<string, unknown>).tokens as
					| { input?: number; output?: number }
					| undefined;
				if (tokens) {
					this.messageTokens.set(info.id, {
						input: typeof tokens.input === "number" ? tokens.input : 0,
						output: typeof tokens.output === "number" ? tokens.output : 0,
					});
				}
			}
			return false;
		}

		// --- Text / tool parts ---
		if (isMessagePartUpdatedEvent(event)) {
			// Filter to our session
			if (event.properties.part.sessionID !== opencodeSessionId) {
				return false;
			}

			// Skip parts that belong to user (prompt) messages
			if (this.userMessageIds.has(event.properties.part.messageID)) {
				return false;
			}

			const textDelta = extractTextDelta(event);
			if (textDelta) {
				// Accumulate text for result coercion
				if (this.lastAssistantText === null) {
					this.lastAssistantText = textDelta;
				} else {
					this.lastAssistantText += textDelta;
				}
				const msg = buildAssistantTextMessage(
					this.lastAssistantText,
					event.properties.part.messageID,
					this.config.model ?? "opencode",
				);
				this.emitMessage(msg);
				return false;
			}

			// Tool part completed/errored
			const toolMsgs = convertToolPartToMessages(
				event,
				this.config.model ?? "opencode",
			);
			if (toolMsgs) {
				const [assistantMsg, userMsg] = toolMsgs;
				this.emitMessage(assistantMsg);
				this.emitMessage(userMsg);
			}
			return false;
		}

		// --- Permission request: auto-approve ---
		// OpenCode may still prompt for permissions beyond the server config's
		// edit/bash/webfetch allow-list (e.g., MCP tools, new tool categories).
		// In headless Cyrus mode we auto-approve to avoid hanging, similar to
		// Gemini's --yolo and Cursor's pre-set project permissions.
		if (isPermissionUpdatedEvent(event)) {
			if (event.properties.sessionID !== opencodeSessionId) {
				return false;
			}
			const permissionId = event.properties.id;
			console.log(`[OpenCodeRunner] Auto-approving permission ${permissionId}`);
			try {
				await client.postSessionIdPermissionsPermissionId({
					path: {
						id: opencodeSessionId,
						permissionID: permissionId,
					},
					body: { response: "always" },
					query: this.config.workingDirectory
						? { directory: this.config.workingDirectory }
						: undefined,
				});
			} catch (err) {
				console.warn(
					`[OpenCodeRunner] Failed to approve permission ${permissionId}: ${err}`,
				);
			}
			return false;
		}

		// --- Session idle: session completed ---
		if (isSessionIdleEvent(event)) {
			if (event.properties.sessionID !== opencodeSessionId) {
				return false;
			}
			console.log("[OpenCodeRunner] Session idle — completing");
			// Sum per-message token counts
			for (const t of this.messageTokens.values()) {
				this.totalInputTokens += t.input;
				this.totalOutputTokens += t.output;
			}
			const resultMsg = buildResultMessage(
				this.lastAssistantText,
				this.totalInputTokens,
				this.totalOutputTokens,
			);
			this.emitMessage(resultMsg);
			return true; // done
		}

		// --- Session error ---
		if (isSessionErrorEvent(event)) {
			if (
				event.properties.sessionID &&
				event.properties.sessionID !== opencodeSessionId
			) {
				return false;
			}
			const errorMsg = extractSessionErrorMessage(event);
			console.error(`[OpenCodeRunner] Session error: ${errorMsg}`);
			const resultMsg = buildErrorResultMessage(errorMsg);
			this.emitMessage(resultMsg);
			return true; // done
		}

		return false;
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	private emitMessage(message: SDKMessage): void {
		this.messages.push(message);
		this.emit("message", message);
	}

	private finalizeSession(caughtError?: unknown): void {
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}

		// Shut down the server process
		if (this.serverClose) {
			try {
				this.serverClose();
			} catch {
				// ignore
			}
			this.serverClose = null;
		}

		if (caughtError) {
			const err =
				caughtError instanceof Error
					? caughtError
					: new Error(String(caughtError));

			if (!this.wasStopped) {
				// Emit an error result message so callers can detect failure
				const errorResult = buildErrorResultMessage(err.message);
				this.messages.push(errorResult);
				this.emit("message", errorResult);
				this.emit("error", err);
			}
		}

		this.emit("complete", [...this.messages]);
		this.abortController = null;
	}

	/**
	 * Build the OpenCode server Config object from runner config.
	 * Maps MCP servers and model settings.
	 */
	private buildServerConfig(): Config {
		const cfg: Config = {};

		// Map model to provider config
		if (this.config.model) {
			cfg.model = this.config.model;
		}

		// Map MCP servers
		const mcpServers = this.config.mcpConfig;
		if (mcpServers && Object.keys(mcpServers).length > 0) {
			cfg.mcp = {};
			for (const [name, serverConfig] of Object.entries(mcpServers)) {
				if ("type" in serverConfig && serverConfig.type === "sse") {
					// SSE-type servers are not supported by OpenCode — skip
					continue;
				}

				if ("type" in serverConfig && serverConfig.type === "http") {
					// Map Cyrus http-type servers to OpenCode's remote config
					const url =
						"url" in serverConfig && typeof serverConfig.url === "string"
							? serverConfig.url
							: null;
					if (!url) continue;

					const headers =
						"headers" in serverConfig &&
						serverConfig.headers != null &&
						typeof serverConfig.headers === "object"
							? (serverConfig.headers as Record<string, string>)
							: undefined;

					const mcpEntry: McpRemoteConfig = {
						type: "remote",
						url,
						...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
					};
					cfg.mcp[name] = mcpEntry;
					continue;
				}

				if (!("command" in serverConfig) || !serverConfig.command) {
					continue;
				}
				const command = serverConfig.command as string;
				const args =
					"args" in serverConfig && Array.isArray(serverConfig.args)
						? (serverConfig.args as string[])
						: [];
				const env =
					"env" in serverConfig && serverConfig.env != null
						? (serverConfig.env as Record<string, string>)
						: {};
				const cmd = [command, ...args];

				const mcpEntry: McpLocalConfig = {
					type: "local",
					command: cmd,
					...(Object.keys(env).length > 0 ? { environment: env } : {}),
				};
				cfg.mcp[name] = mcpEntry;
			}
		}

		// Agent config: disable permission prompts & set maxSteps
		const agentCfg: AgentConfig = {
			permission: {
				edit: "allow",
				bash: "allow",
				webfetch: "allow",
			},
		};
		if (this.config.maxSteps !== undefined) {
			agentCfg.maxSteps = this.config.maxSteps;
		}
		cfg.agent = { build: agentCfg };

		return cfg;
	}

	/**
	 * Parse a model string of the form "providerID/modelID" or just "modelID".
	 * Returns null if the string is empty.
	 */
	private parseModelSpec(
		model: string,
	): { providerID: string; modelID: string } | null {
		if (!model) return null;
		const slashIndex = model.indexOf("/");
		if (slashIndex > 0) {
			return {
				providerID: model.slice(0, slashIndex),
				modelID: model.slice(slashIndex + 1),
			};
		}
		// No slash: treat as anthropic model alias or pass as-is
		return { providerID: "anthropic", modelID: model };
	}
}

/**
 * Find a free TCP port by binding to port 0 (OS assigns an available port).
 */
function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((err) => {
				if (err) reject(err);
				else resolve(port);
			});
		});
		server.on("error", reject);
	});
}
