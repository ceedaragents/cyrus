import { ClaudeRunner } from "cyrus-claude-runner";
import { toError } from "../utils/errors.js";

const isAssistantMessage = (message) => message.type === "assistant";
function extractLatestAssistantText(messages) {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!message || !isAssistantMessage(message)) {
			continue;
		}
		const content = message.message?.content;
		if (!Array.isArray(content)) {
			continue;
		}
		const textParts = [];
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
export class ClaudeRunnerAdapter {
	config;
	runner;
	listenersRegistered = false;
	constructor(config) {
		this.config = config;
		this.runner = new ClaudeRunner(config.claudeConfig);
	}
	registerListeners(onEvent) {
		if (this.listenersRegistered) {
			return;
		}
		this.runner.on("text", (text) => {
			if (typeof text === "string" && text.trim().length > 0) {
				onEvent({ kind: "thought", text: text.trim() });
			}
		});
		this.runner.on("tool-use", (name, input) => {
			onEvent({
				kind: "action",
				name,
				detail: this.stringifyToolDetail(input),
			});
		});
		this.runner.on("error", (error) => {
			onEvent({ kind: "error", error });
		});
		this.runner.on("complete", (messages) => {
			const summary =
				extractLatestAssistantText(messages) ?? "Claude run completed";
			onEvent({ kind: "final", text: summary });
		});
		this.listenersRegistered = true;
	}
	async start(onEvent) {
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
	async stop() {
		this.runner.stop();
	}
	stringifyToolDetail(input) {
		if (input === undefined) {
			return undefined;
		}
		if (typeof input === "string") {
			return input;
		}
		try {
			return JSON.stringify(input, undefined, 2);
		} catch (_error) {
			return String(input);
		}
	}
}
//# sourceMappingURL=ClaudeRunnerAdapter.js.map
