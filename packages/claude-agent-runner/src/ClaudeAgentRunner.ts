import { EventEmitter } from "node:events";
import type {
	IAgentMessage,
	IAgentRunner,
	IAgentRunnerEvents,
	IAgentSession,
} from "@cyrus/abstractions";
import type { SDKMessage } from "cyrus-claude-runner";
import { ClaudeRunner } from "cyrus-claude-runner";

/**
 * Configuration for ClaudeAgentRunner
 * Extends the base IAgentRunnerConfig with Claude-specific options
 */
export interface ClaudeAgentRunnerConfig {
	model?: string;
	fallbackModel?: string;
	workingDirectory?: string;
	systemPrompt?:
		| string
		| { type: string; preset?: string; text?: string; append?: string };
	appendSystemPrompt?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	allowedDirectories?: string[];
	mcpConfig?: Record<string, unknown>;
	mcpConfigPath?: string | string[];
	hooks?: Record<string, unknown>;
	maxTurns?: number;
	resumeSessionId?: string;
	workspaceName?: string;
	cyrusHome: string;
	promptVersions?: {
		userPromptVersion?: string;
		systemPromptVersion?: string;
	};
}

/**
 * ClaudeAgentRunner - Implementation of IAgentRunner for Claude Code
 *
 * This adapter wraps the existing ClaudeRunner to implement the IAgentRunner interface,
 * providing a clean abstraction over Claude Code while maintaining backward compatibility.
 */
export class ClaudeAgentRunner extends EventEmitter implements IAgentRunner {
	private runner: ClaudeRunner;
	private messages: IAgentMessage[] = [];

	constructor(config: ClaudeAgentRunnerConfig) {
		super();
		this.runner = new ClaudeRunner({
			model: config.model,
			fallbackModel: config.fallbackModel,
			workingDirectory: config.workingDirectory,
			systemPrompt: config.systemPrompt as any,
			appendSystemPrompt: config.appendSystemPrompt,
			allowedTools: config.allowedTools,
			disallowedTools: config.disallowedTools,
			allowedDirectories: config.allowedDirectories,
			mcpConfig: config.mcpConfig as any,
			mcpConfigPath: config.mcpConfigPath,
			hooks: config.hooks as any,
			maxTurns: config.maxTurns,
			resumeSessionId: config.resumeSessionId,
			workspaceName: config.workspaceName,
			cyrusHome: config.cyrusHome,
			promptVersions: config.promptVersions,
		});

		// Forward events from ClaudeRunner to IAgentRunner events
		this.runner.on("message", (msg: SDKMessage) => {
			const agentMsg = this.convertToAgentMessage(msg);
			this.messages.push(agentMsg);
			this.emit("message", agentMsg);
		});

		this.runner.on("text", (text: string) => {
			this.emit("text", text);
		});

		this.runner.on("assistant", (text: string) => {
			this.emit("assistant", text);
		});

		this.runner.on("tool-use", (toolName: string, input: unknown) => {
			this.emit("tool-use", toolName, input);
		});

		this.runner.on("error", (error: Error) => {
			this.emit("error", error);
		});

		this.runner.on("complete", (msgs: SDKMessage[]) => {
			const agentMsgs = msgs.map((m) => this.convertToAgentMessage(m));
			this.emit("complete", agentMsgs);
		});
	}

	/**
	 * Convert SDK message to IAgentMessage
	 */
	private convertToAgentMessage(msg: SDKMessage): IAgentMessage {
		let content = "";
		let type: IAgentMessage["type"] = "system";
		const metadata: Record<string, unknown> = {};

		switch (msg.type) {
			case "assistant":
				type = "assistant";
				if (msg.message?.content && Array.isArray(msg.message.content)) {
					const textBlocks = msg.message.content
						.filter((block) => block.type === "text")
						.map((block) => (block as { text: string }).text);
					content = textBlocks.join("\n");

					// Extract tool use information
					const toolBlocks = msg.message.content.filter(
						(block) => block.type === "tool_use",
					);
					if (toolBlocks.length > 0) {
						metadata.toolUses = toolBlocks;
					}
				}
				break;

			case "user":
				type = "user";
				if (msg.message?.content && Array.isArray(msg.message.content)) {
					const textBlocks = msg.message.content
						.filter((block) => block.type === "text")
						.map((block) => (block as { text: string }).text);
					content = textBlocks.join("\n");
				}
				break;

			case "result":
				type = "result";
				content = "Session completed";
				if (msg.subtype) metadata.subtype = msg.subtype;
				if (msg.duration_ms) metadata.durationMs = msg.duration_ms;
				if (msg.total_cost_usd) metadata.costUSD = msg.total_cost_usd;
				break;

			case "system":
				type = "system";
				content = "System message";
				break;

			default:
				type = "system";
				content = `Unknown message type: ${(msg as any).type}`;
		}

		return {
			id: msg.session_id || "unknown",
			type,
			content,
			timestamp: new Date(),
			metadata,
		};
	}

	/**
	 * Start a new agent session
	 */
	async start(
		prompt: string | AsyncIterable<IAgentMessage>,
	): Promise<IAgentSession> {
		this.messages = [];

		if (typeof prompt === "string") {
			// String mode
			const sessionInfo = await this.runner.start(prompt);
			return this.convertToAgentSession(sessionInfo);
		}

		// Streaming mode
		const sessionInfo = await this.runner.startStreaming();

		// Convert AsyncIterable<IAgentMessage> to messages
		(async () => {
			for await (const msg of prompt) {
				if (msg.type === "user") {
					this.runner.addStreamMessage(msg.content);
				}
			}
			this.runner.completeStream();
		})();

		return this.convertToAgentSession(sessionInfo);
	}

	/**
	 * Stop the current session
	 */
	stop(): void {
		this.runner.stop();
	}

	/**
	 * Check if session is running
	 */
	isRunning(): boolean {
		return this.runner.isRunning();
	}

	/**
	 * Add a message to streaming session
	 */
	addMessage(content: string): void {
		this.runner.addStreamMessage(content);
	}

	/**
	 * Complete the streaming input
	 */
	completeStream(): void {
		this.runner.completeStream();
	}

	/**
	 * Check if in streaming mode
	 */
	isStreaming(): boolean {
		return this.runner.isStreaming();
	}

	/**
	 * Get current session info
	 */
	getSessionInfo(): IAgentSession | null {
		const info = this.runner.getSessionInfo();
		if (!info) return null;
		return this.convertToAgentSession(info);
	}

	/**
	 * Get all messages
	 */
	getMessages(): IAgentMessage[] {
		return [...this.messages];
	}

	/**
	 * Convert ClaudeRunner session info to IAgentSession
	 */
	private convertToAgentSession(info: {
		sessionId: string | null;
		startedAt: Date;
		isRunning: boolean;
	}): IAgentSession {
		return {
			sessionId: info.sessionId,
			startedAt: info.startedAt,
			isRunning: info.isRunning,
		};
	}

	/**
	 * Register event handler (EventEmitter compatibility)
	 */
	on<K extends keyof IAgentRunnerEvents>(
		event: K,
		handler: IAgentRunnerEvents[K],
	): this {
		return super.on(event, handler as any);
	}

	/**
	 * Unregister event handler (EventEmitter compatibility)
	 */
	off<K extends keyof IAgentRunnerEvents>(
		event: K,
		handler: IAgentRunnerEvents[K],
	): this {
		return super.off(event, handler as any);
	}
}
