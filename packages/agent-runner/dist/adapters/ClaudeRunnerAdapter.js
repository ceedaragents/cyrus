import { ClaudeRunner } from "cyrus-claude-runner";
import { toError } from "../utils/errors.js";

function extractLatestAssistantText(messages) {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.type !== "assistant") {
			continue;
		}
		const content = message.message?.content;
		if (!Array.isArray(content)) {
			continue;
		}
		const textParts = content
			.filter((part) => part.type === "text" && typeof part.text === "string")
			.map((part) => part.text);
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
				onEvent({ kind: "text", text });
			}
		});
		this.runner.on("tool-use", (name, input) => {
			onEvent({ kind: "tool", name, input });
		});
		this.runner.on("error", (error) => {
			onEvent({ kind: "error", error });
		});
		this.runner.on("complete", (messages) => {
			const summary =
				extractLatestAssistantText(messages) ?? "Claude run completed";
			onEvent({ kind: "result", summary });
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
}
//# sourceMappingURL=ClaudeRunnerAdapter.js.map
