import type { SDKAssistantMessage, SDKMessage } from "cyrus-claude-runner";
import { ClaudeRunner } from "cyrus-claude-runner";
import type {
	ClaudeRunnerAdapterConfig,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
import { toError } from "../utils/errors.js";

const isAssistantMessage = (
	message: SDKMessage,
): message is SDKAssistantMessage => message.type === "assistant";

function extractLatestAssistantText(
	messages: SDKMessage[],
): string | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message || !isAssistantMessage(message)) {
			continue;
		}

		const content = message.message?.content;
		if (!Array.isArray(content)) {
			continue;
		}

		const textParts: string[] = [];
		for (const block of content) {
			if (block?.type === "text" && typeof block.text === "string") {
				textParts.push(block.text);
			}
		}

		if (textParts.length > 0) {
			return textParts.join("\n");
		}
	}

	return undefined;
}

export class ClaudeRunnerAdapter implements Runner {
	private runner: ClaudeRunner;

	private listenersRegistered = false;

	constructor(private readonly config: ClaudeRunnerAdapterConfig) {
		this.runner = new ClaudeRunner(config.claudeConfig);
	}

	private registerListeners(onEvent: (event: RunnerEvent) => void): void {
		if (this.listenersRegistered) {
			return;
		}

		this.runner.on("text", (text: string) => {
			if (typeof text === "string" && text.trim().length > 0) {
				onEvent({ kind: "text", text });
			}
		});

		this.runner.on("tool-use", (name: string, input: unknown) => {
			onEvent({ kind: "tool", name, input });
		});

		this.runner.on("error", (error: Error) => {
			onEvent({ kind: "error", error });
		});

		this.runner.on("complete", (messages: SDKMessage[]) => {
			const summary =
				extractLatestAssistantText(messages) ?? "Claude run completed";
			onEvent({ kind: "result", summary });
		});

		this.listenersRegistered = true;
	}

	async start(
		onEvent: (event: RunnerEvent) => void,
	): Promise<RunnerStartResult> {
		this.registerListeners(onEvent);

		try {
			const sessionInfo = await this.runner.startStreaming(this.config.prompt);
			return { sessionId: sessionInfo.sessionId ?? undefined };
		} catch (error) {
			const err = toError(error, "Failed to start Claude runner");
			onEvent({ kind: "error", error: err });
			throw err;
		}
	}

	async stop(): Promise<void> {
		this.runner.stop();
	}
}
