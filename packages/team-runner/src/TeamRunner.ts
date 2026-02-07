import { EventEmitter } from "node:events";
import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeMessageFormatter } from "cyrus-claude-runner";
import type {
	AgentMessage,
	AgentRunnerConfig,
	AgentSessionInfo,
	IAgentRunner,
	IMessageFormatter,
} from "cyrus-core";
import type { LinearActivityBridge } from "./LinearActivityBridge.js";
import type { TeamTask } from "./types.js";

export interface TeamRunnerConfig extends AgentRunnerConfig {
	/** Pre-built task list for the team */
	tasks: TeamTask[];
	/** Number of teammates to spawn */
	teamSize: number;
	/** Bridge for streaming team events back to Linear */
	activityBridge?: LinearActivityBridge;
	/** Classification that triggered this team */
	classification: string;
}

export class TeamRunner extends EventEmitter implements IAgentRunner {
	readonly supportsStreamingInput = false;

	private config: TeamRunnerConfig;
	private abortController: AbortController | null = null;
	private sessionInfo: AgentSessionInfo | null = null;
	private messages: SDKMessage[] = [];
	private formatter: IMessageFormatter;

	constructor(config: TeamRunnerConfig) {
		super();
		this.config = config;
		this.formatter = new ClaudeMessageFormatter();

		// Forward config callbacks to events
		if (config.onMessage) this.on("message", config.onMessage);
		if (config.onError) this.on("error", config.onError);
		if (config.onComplete) this.on("complete", config.onComplete);
	}

	async start(prompt: string): Promise<AgentSessionInfo> {
		if (this.isRunning()) {
			throw new Error("Team session already running");
		}

		this.sessionInfo = {
			sessionId: null,
			startedAt: new Date(),
			isRunning: true,
		};

		this.abortController = new AbortController();
		this.messages = [];

		console.log(
			`[TeamRunner] Starting team session with ${this.config.teamSize} teammates`,
		);
		console.log(
			`[TeamRunner] Classification: ${this.config.classification}, Tasks: ${this.config.tasks.length}`,
		);

		const teamLeadPrompt = this.buildTeamLeadPrompt(prompt);

		try {
			const queryOptions = {
				prompt: teamLeadPrompt,
				options: {
					model: this.config.model || "opus",
					fallbackModel: this.config.fallbackModel || "sonnet",
					abortController: this.abortController,
					env: {
						...process.env,
						CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
					},
					systemPrompt: {
						type: "preset" as const,
						preset: "claude_code" as const,
						...(this.config.appendSystemPrompt && {
							append: this.config.appendSystemPrompt,
						}),
					},
					settingSources: [
						"user" as const,
						"project" as const,
						"local" as const,
					],
					...(this.config.workingDirectory && {
						cwd: this.config.workingDirectory,
					}),
					...(this.config.allowedTools && {
						allowedTools: this.config.allowedTools,
					}),
					...(this.config.disallowedTools && {
						disallowedTools: this.config.disallowedTools,
					}),
					...(this.config.hooks && { hooks: this.config.hooks }),
				},
			};

			let pendingResultMessage: SDKMessage | null = null;

			for await (const message of query(queryOptions)) {
				if (!this.sessionInfo?.isRunning) {
					console.log(
						"[TeamRunner] Session was stopped, breaking from query loop",
					);
					break;
				}

				// Extract session ID and check version from init message
				if (
					message.type === "system" &&
					"subtype" in message &&
					message.subtype === "init"
				) {
					const initMsg = message as {
						claude_code_version?: string;
						[key: string]: unknown;
					};
					if (initMsg.claude_code_version) {
						const version = initMsg.claude_code_version;
						const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
						if (match) {
							const parts = match.slice(1).map(Number);
							const major = parts[0] ?? 0;
							const minor = parts[1] ?? 0;
							const patch = parts[2] ?? 0;
							// Agent teams require Claude Code >= 2.1.32
							if (
								major < 2 ||
								(major === 2 && minor < 1) ||
								(major === 2 && minor === 1 && patch < 32)
							) {
								console.warn(
									`[TeamRunner] Claude Code version ${version} detected. ` +
										"Agent teams require >= 2.1.32. Team coordination may not work correctly.",
								);
							} else {
								console.log(
									`[TeamRunner] Claude Code version ${version} (agent teams supported)`,
								);
							}
						}
					}
				}

				if (!this.sessionInfo.sessionId && message.session_id) {
					this.sessionInfo.sessionId = message.session_id;
					console.log(
						`[TeamRunner] Session ID assigned: ${message.session_id}`,
					);
				}

				this.messages.push(message);

				// Forward to activity bridge if configured
				if (this.config.activityBridge) {
					this.config.activityBridge.onMessage(message);
				}

				// Defer result message emission until after loop completes to avoid race conditions
				if (message.type === "result") {
					pendingResultMessage = message;
				} else {
					this.emit("message", message);
				}
			}

			console.log(
				`[TeamRunner] Session completed with ${this.messages.length} messages`,
			);
			this.sessionInfo.isRunning = false;

			// Emit deferred result message after marking isRunning = false
			if (pendingResultMessage) {
				this.emit("message", pendingResultMessage);
			}

			this.emit("complete", this.messages);
		} catch (error) {
			if (this.sessionInfo) {
				this.sessionInfo.isRunning = false;
			}

			// Check for user-initiated abort
			const isAbortError =
				error instanceof Error &&
				(error.name === "AbortError" ||
					error.message.includes("aborted by user"));

			// Check for SIGTERM (exit code 143 = 128 + 15)
			const isSigterm =
				error instanceof Error &&
				error.message.includes("exited with code 143");

			if (isAbortError) {
				console.log("[TeamRunner] Session stopped by user");
			} else if (isSigterm) {
				console.log("[TeamRunner] Session terminated gracefully (SIGTERM)");
			} else {
				console.error("[TeamRunner] Session error:", error);
				this.emit(
					"error",
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		} finally {
			this.abortController = null;
		}

		return this.sessionInfo;
	}

	stop(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		if (this.sessionInfo) {
			this.sessionInfo.isRunning = false;
		}
	}

	isRunning(): boolean {
		return this.sessionInfo?.isRunning ?? false;
	}

	getMessages(): AgentMessage[] {
		return [...this.messages];
	}

	getFormatter(): IMessageFormatter {
		return this.formatter;
	}

	/**
	 * Build the team lead prompt that instructs it to create a team,
	 * set up the task list with dependencies, spawn teammates, and coordinate.
	 */
	buildTeamLeadPrompt(originalPrompt: string): string {
		const taskListStr = this.config.tasks
			.map((t) => {
				const deps =
					t.blockedBy.length > 0
						? `(blocked by: ${t.blockedBy.join(", ")})`
						: "(no dependencies)";
				return `- Task ${t.id}: ${t.subject} ${deps}\n  Description: ${t.description}\n  Assign to: ${t.assignTo || "any"}`;
			})
			.join("\n\n");

		const teamName = `cyrus-${Date.now()}`;

		return `You are a team lead for a software development task. You MUST create an agent team to execute this work in parallel.

## Your Task

${originalPrompt}

## Team Setup Instructions

1. Create a team named "${teamName}"
2. Create the following tasks (set blockedBy dependencies exactly as specified):

${taskListStr}

3. Spawn ${this.config.teamSize} teammates:
   - Use "sonnet" model for all teammates
   - Give each teammate a descriptive name matching their role
   - Include the full task context in their spawn prompts

4. Coordinate:
   - Assign tasks to appropriate teammates
   - Monitor progress via the task list
   - When teammates report findings, share relevant results with dependent teammates
   - If verification fails, create a fix task and reassign

5. When all tasks are complete:
   - Shut down all teammates
   - Clean up the team
   - Report the final result

## Critical Rules

- Do NOT implement tasks yourself -- delegate everything to teammates
- Wait for teammates to finish before proceeding to dependent tasks
- If a teammate fails, spawn a replacement
- Share research findings between teammates via messages`;
	}
}
