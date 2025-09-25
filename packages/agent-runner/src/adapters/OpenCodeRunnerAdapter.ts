import type {
	OpenCodeRunnerOptions,
	Runner,
	RunnerEvent,
	RunnerStartResult,
} from "../types.js";
import { toError } from "../utils/errors.js";

interface ToolEventPayload {
	name: string;
	input?: unknown;
}

export class OpenCodeRunnerAdapter implements Runner {
	private sessionId?: string;

	private abortController?: AbortController;

	private streamTask?: Promise<void>;

	private stopped = false;

	private completed = false;

	constructor(private readonly config: OpenCodeRunnerOptions) {}

	async start(
		onEvent: (event: RunnerEvent) => void,
	): Promise<RunnerStartResult> {
		const baseUrl = this.normalizeServerUrl(this.config.serverUrl);

		try {
			await this.ensureAuth(baseUrl);
			this.sessionId =
				this.config.sessionId ?? (await this.createSession(baseUrl));
			await this.sendCommand(baseUrl);
		} catch (error) {
			const err = toError(error, "Failed to initialize OpenCode session");
			onEvent({ kind: "error", error: err });
			throw err;
		}

		this.abortController = new AbortController();
		const retry = this.config.retryOnDisconnect !== false;

		this.streamTask = this.consumeEvents(baseUrl, onEvent, retry).catch(
			(error) => {
				if (this.stopped) {
					return;
				}
				onEvent({
					kind: "error",
					error: toError(error, "OpenCode event stream error"),
				});
			},
		);

		return { sessionId: this.sessionId };
	}

	async stop(): Promise<void> {
		this.stopped = true;
		this.abortController?.abort();
		try {
			await this.streamTask;
		} catch (_error) {
			// Swallow errors on stop
		}
	}

	private normalizeServerUrl(url: string): string {
		return url.endsWith("/") ? url.replace(/\/+$/, "") : url;
	}

	private async ensureAuth(baseUrl: string): Promise<void> {
		const apiKey = this.config.openaiApiKey ?? process.env.OPENAI_API_KEY;
		if (!apiKey) {
			return;
		}

		const response = await fetch(`${baseUrl}/auth/openai`, {
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ type: "api", key: apiKey }),
		});

		if (!response.ok) {
			throw new Error(
				`OpenCode auth failed with status ${response.status} ${response.statusText}`,
			);
		}
	}

	private async createSession(baseUrl: string): Promise<string> {
		const url = new URL(`${baseUrl}/session`);
		url.searchParams.set("directory", this.config.cwd);

		const response = await fetch(url, { method: "POST" });
		if (!response.ok) {
			throw new Error(
				`OpenCode session creation failed with status ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as { id?: string };
		if (!data?.id) {
			throw new Error("OpenCode session response missing id");
		}
		return data.id;
	}

	private async sendCommand(baseUrl: string): Promise<void> {
		if (!this.sessionId) {
			throw new Error("OpenCode session id not available");
		}

		const url = new URL(`${baseUrl}/session/${this.sessionId}/command`);
		url.searchParams.set("directory", this.config.cwd);

		const model: Record<string, string> = {
			providerID: this.config.provider ?? "openai",
		};
		if (this.config.model) {
			model.modelID = this.config.model;
		}

		const payload = {
			parts: [
				{
					type: "text",
					text: this.config.prompt,
				},
			],
			model,
		};

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			throw new Error(
				`OpenCode command failed with status ${response.status} ${response.statusText}`,
			);
		}
	}

	private async consumeEvents(
		baseUrl: string,
		onEvent: (event: RunnerEvent) => void,
		retry: boolean,
	): Promise<void> {
		let attempt = 0;
		const maxAttempts = retry ? 2 : 1;

		while (!this.stopped && attempt < maxAttempts) {
			attempt += 1;
			try {
				await this.streamOnce(baseUrl, onEvent);
				this.emitCompletion(onEvent);
				return;
			} catch (error) {
				if (this.stopped) {
					return;
				}
				if (process.env.DEBUG_EDGE?.toLowerCase() === "true") {
					console.debug(
						`[OpenCodeRunnerAdapter] SSE stream error on attempt ${attempt}`,
						error,
					);
				}
				if (attempt >= maxAttempts) {
					throw error;
				}
			}
		}
	}

	private async streamOnce(
		baseUrl: string,
		onEvent: (event: RunnerEvent) => void,
	): Promise<void> {
		if (!this.abortController) {
			throw new Error("OpenCode runner missing abort controller");
		}

		const response = await fetch(`${baseUrl}/event`, {
			signal: this.abortController.signal,
		});

		if (!response.ok || !response.body) {
			throw new Error(
				`OpenCode event stream failed with status ${response.status} ${response.statusText}`,
			);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		while (!this.stopped) {
			const { value, done } = await reader.read();
			if (done) {
				break;
			}
			buffer += decoder.decode(value, { stream: true });
			buffer = this.processSseBuffer(buffer, onEvent);
		}

		if (buffer.length > 0) {
			this.processSseBuffer(buffer, onEvent, true);
		}
	}

	private processSseBuffer(
		buffer: string,
		onEvent: (event: RunnerEvent) => void,
		flush = false,
	): string {
		let working = buffer.replace(/\r\n/g, "\n");
		let boundary = working.indexOf("\n\n");
		while (boundary !== -1) {
			const rawEvent = working.slice(0, boundary);
			working = working.slice(boundary + 2);
			this.handleSseEvent(rawEvent, onEvent);
			boundary = working.indexOf("\n\n");
		}

		if (flush && working.length > 0) {
			this.handleSseEvent(working, onEvent);
			return "";
		}

		return working;
	}

	private handleSseEvent(
		rawEvent: string,
		onEvent: (event: RunnerEvent) => void,
	): void {
		const parsed = this.parseSseEvent(rawEvent);
		if (!parsed?.data) {
			return;
		}

		let payload: any;
		try {
			payload = JSON.parse(parsed.data);
		} catch (_error) {
			return;
		}

		if (
			this.sessionId &&
			payload?.properties?.sessionID &&
			payload.properties.sessionID !== this.sessionId
		) {
			return;
		}

		for (const text of this.extractTextParts(payload)) {
			if (text.trim().length > 0) {
				onEvent({ kind: "text", text });
			}
		}

		for (const toolEvent of this.extractToolEvents(payload)) {
			onEvent({ kind: "tool", name: toolEvent.name, input: toolEvent.input });
		}
	}

	private parseSseEvent(rawEvent: string): { event?: string; data?: string } {
		const lines = rawEvent.split("\n");
		const dataLines: string[] = [];
		let eventName: string | undefined;

		for (const line of lines) {
			if (line.startsWith(":")) {
				continue;
			}
			if (line.startsWith("event:")) {
				eventName = line.slice(6).trim();
				continue;
			}
			if (line.startsWith("data:")) {
				dataLines.push(line.slice(5).trimStart());
			}
		}

		return {
			event: eventName,
			data: dataLines.length > 0 ? dataLines.join("\n") : undefined,
		};
	}

	private extractTextParts(payload: unknown): string[] {
		const texts: string[] = [];
		const visited = new WeakSet<object>();

		const walk = (value: unknown): void => {
			if (!value) {
				return;
			}
			if (typeof value === "string") {
				return;
			}
			if (Array.isArray(value)) {
				for (const item of value) {
					walk(item);
				}
				return;
			}
			if (typeof value !== "object") {
				return;
			}

			if (visited.has(value as object)) {
				return;
			}
			visited.add(value as object);

			const node = value as Record<string, unknown>;
			if (
				typeof node.type === "string" &&
				node.type === "text" &&
				typeof node.text === "string"
			) {
				texts.push(node.text);
			}

			if (Array.isArray(node.parts)) {
				for (const part of node.parts) {
					walk(part);
				}
			}

			for (const value of Object.values(node)) {
				if (value && (typeof value === "object" || Array.isArray(value))) {
					walk(value);
				}
			}
		};

		walk(payload);
		return texts;
	}

	private extractToolEvents(payload: unknown): ToolEventPayload[] {
		const tools: ToolEventPayload[] = [];
		const visited = new WeakSet<object>();

		const walk = (value: unknown): void => {
			if (!value) {
				return;
			}
			if (Array.isArray(value)) {
				for (const item of value) {
					walk(item);
				}
				return;
			}
			if (typeof value !== "object") {
				return;
			}
			if (visited.has(value as object)) {
				return;
			}
			visited.add(value as object);

			const node = value as Record<string, unknown>;
			if (
				typeof node.type === "string" &&
				node.type.includes("tool") &&
				typeof node.name === "string"
			) {
				tools.push({ name: node.name, input: node.input ?? node.arguments });
			}

			if (Array.isArray(node.parts)) {
				for (const part of node.parts) {
					walk(part);
				}
			}

			for (const value of Object.values(node)) {
				if (value && (typeof value === "object" || Array.isArray(value))) {
					walk(value);
				}
			}
		};

		walk(payload);
		return tools;
	}

	private emitCompletion(onEvent: (event: RunnerEvent) => void): void {
		if (this.completed) {
			return;
		}
		this.completed = true;
		onEvent({ kind: "result", summary: "OpenCode run completed" });
	}
}
