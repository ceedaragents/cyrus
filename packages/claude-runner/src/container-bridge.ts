import crypto from "node:crypto";
import type {
	PermissionResult,
	SDKMessage,
	SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AskUserQuestionInput, AskUserQuestionResult } from "cyrus-core";
import { StreamingPrompt } from "cyrus-core";
import type {
	ClaudeBridgeChildMessage,
	ClaudeBridgeHostMessage,
	SerializableClaudeBridgeConfig,
	SerializableHooks,
} from "./container-bridge-types.js";

type PendingQuestionResolver = {
	resolve: (result: AskUserQuestionResult) => void;
	reject: (error: Error) => void;
};

const pendingQuestions = new Map<string, PendingQuestionResolver>();
let currentStreamingPrompt: StreamingPrompt | null = null;
let currentSessionId: string | null = null;
let currentAbortController: AbortController | null = null;

function writeMessage(message: ClaudeBridgeChildMessage): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function buildDefaultHooks(
	enabled: boolean | undefined,
): SerializableHooks | undefined {
	if (!enabled) {
		return undefined;
	}

	return {
		PostToolUse: [
			{
				matcher: "playwright_screenshot",
				hooks: [
					async (input) => {
						const response = (input as { tool_response?: { path?: string } })
							.tool_response;
						const filePath = response?.path || "the screenshot file";
						return {
							continue: true,
							additionalContext: `Screenshot taken successfully. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown. You can also use the Read tool to view the screenshot file to analyze the visual content.`,
						};
					},
				],
			},
			{
				matcher: "mcp__claude-in-chrome__computer",
				hooks: [
					async (input) => {
						const response = (
							input as { tool_response?: { action?: string; path?: string } }
						).tool_response;
						if (response?.action !== "screenshot") {
							return { continue: true };
						}
						const filePath = response.path || "the screenshot file";
						return {
							continue: true,
							additionalContext: `Screenshot captured. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
						};
					},
				],
			},
			{
				matcher: "mcp__claude-in-chrome__gif_creator",
				hooks: [
					async (input) => {
						const response = (
							input as { tool_response?: { action?: string; path?: string } }
						).tool_response;
						if (response?.action !== "export") {
							return { continue: true };
						}
						const filePath = response.path || "the exported GIF";
						return {
							continue: true,
							additionalContext: `GIF exported successfully. To share this GIF in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
						};
					},
				],
			},
			{
				matcher: "mcp__chrome-devtools__take_screenshot",
				hooks: [
					async (input) => {
						const toolInput = (input as { tool_input?: { filePath?: string } })
							.tool_input;
						const filePath = toolInput?.filePath || "the screenshot file";
						return {
							continue: true,
							additionalContext: `Screenshot saved. To share this screenshot in Linear comments, use the linear_upload_file tool to upload ${filePath}. This will return an asset URL that can be embedded in markdown.`,
						};
					},
				],
			},
		],
	};
}

function createCanUseToolCallback() {
	return async (
		toolName: string,
		input: Record<string, unknown>,
	): Promise<PermissionResult> => {
		if (toolName !== "AskUserQuestion") {
			return {
				behavior: "allow",
				updatedInput: input,
			};
		}

		const askInput = input as unknown as AskUserQuestionInput;
		if (!askInput.questions || !Array.isArray(askInput.questions)) {
			return {
				behavior: "deny",
				message: "Invalid AskUserQuestion input: 'questions' array is required",
			};
		}

		if (askInput.questions.length !== 1) {
			return {
				behavior: "deny",
				message:
					"Only one question at a time is supported. Please ask each question separately.",
			};
		}

		const requestId = crypto.randomUUID();
		const answerPromise = new Promise<AskUserQuestionResult>(
			(resolve, reject) => {
				pendingQuestions.set(requestId, { resolve, reject });
			},
		);
		writeMessage({
			type: "ask-user-question",
			requestId,
			input: askInput,
			sessionId: currentSessionId,
		});

		const result = await answerPromise;
		if (result.answered && result.answers) {
			return {
				behavior: "allow",
				updatedInput: {
					questions: askInput.questions,
					answers: result.answers,
				},
			};
		}

		return {
			behavior: "deny",
			message: result.message || "User did not respond to the question",
		};
	};
}

async function runQuery(
	config: SerializableClaudeBridgeConfig,
	prompt: string | AsyncIterable<SDKUserMessage>,
): Promise<void> {
	currentAbortController = new AbortController();

	const queryOptions: Parameters<typeof query>[0] = {
		prompt,
		options: {
			model: config.model || "opus",
			fallbackModel: config.fallbackModel || "sonnet",
			abortController: currentAbortController,
			systemPrompt: config.systemPrompt || {
				type: "preset",
				preset: "claude_code",
			},
			settingSources: ["user", "project", "local"],
			env: {
				...process.env,
				...(config.env ?? {}),
				CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
				CLAUDE_CODE_ENABLE_TASKS: "true",
				CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
			},
			...(config.workingDirectory && {
				cwd: config.workingDirectory,
			}),
			...(config.allowedDirectories && {
				allowedDirectories: config.allowedDirectories,
			}),
			...(config.allowedTools && { allowedTools: config.allowedTools }),
			...(config.disallowedTools && {
				disallowedTools: config.disallowedTools,
			}),
			canUseTool: createCanUseToolCallback(),
			...(config.resumeSessionId && {
				resume: config.resumeSessionId,
			}),
			...(config.mcpConfig && { mcpServers: config.mcpConfig }),
			...(buildDefaultHooks(config.enableDefaultPostToolUseHooks)
				? {
						hooks: buildDefaultHooks(config.enableDefaultPostToolUseHooks),
					}
				: {}),
			...(config.tools !== undefined && { tools: config.tools }),
			...(config.maxTurns && { maxTurns: config.maxTurns }),
			...(config.outputFormat && {
				outputFormat: config.outputFormat,
			}),
			...(config.extraArgs && { extraArgs: config.extraArgs }),
		},
	};

	try {
		for await (const message of query(queryOptions)) {
			currentSessionId = message.session_id ?? currentSessionId;
			if (currentStreamingPrompt && currentSessionId) {
				currentStreamingPrompt.updateSessionId(currentSessionId);
			}
			writeMessage({
				type: "sdk-message",
				message: message as SDKMessage,
			});
		}
		writeMessage({ type: "complete" });
	} catch (error) {
		writeMessage({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		});
	} finally {
		currentAbortController = null;
		currentStreamingPrompt = null;
		for (const [requestId, resolver] of pendingQuestions) {
			resolver.reject(new Error("Claude container bridge stopped"));
			pendingQuestions.delete(requestId);
		}
	}
}

function handleHostMessage(message: ClaudeBridgeHostMessage): void {
	switch (message.type) {
		case "start":
			void runQuery(message.config, message.prompt);
			return;
		case "startStreaming":
			currentStreamingPrompt = new StreamingPrompt(
				currentSessionId,
				message.initialPrompt,
			);
			void runQuery(message.config, currentStreamingPrompt);
			return;
		case "stream-message":
			if (!currentStreamingPrompt) {
				throw new Error("Received stream-message before startStreaming");
			}
			currentStreamingPrompt.addMessage(message.content);
			return;
		case "complete-stream":
			currentStreamingPrompt?.complete();
			return;
		case "ask-user-question-result": {
			const resolver = pendingQuestions.get(message.requestId);
			if (!resolver) {
				return;
			}
			pendingQuestions.delete(message.requestId);
			resolver.resolve(message.result);
			return;
		}
		case "stop":
			currentStreamingPrompt?.complete();
			currentAbortController?.abort();
			return;
	}
}

let inputBuffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
	inputBuffer += chunk;
	let newlineIndex = inputBuffer.indexOf("\n");
	while (newlineIndex !== -1) {
		const line = inputBuffer.slice(0, newlineIndex).trim();
		inputBuffer = inputBuffer.slice(newlineIndex + 1);
		if (line.length > 0) {
			try {
				handleHostMessage(JSON.parse(line) as ClaudeBridgeHostMessage);
			} catch (error) {
				writeMessage({
					type: "error",
					message: error instanceof Error ? error.message : String(error),
				});
			}
		}
		newlineIndex = inputBuffer.indexOf("\n");
	}
});

process.stdin.on("end", () => {
	currentAbortController?.abort();
});
