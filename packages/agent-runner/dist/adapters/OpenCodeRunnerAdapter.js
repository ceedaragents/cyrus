import { toError } from "../utils/errors.js";
export class OpenCodeRunnerAdapter {
	config;
	sessionId;
	abortController;
	streamTask;
	stopped = false;
	completed = false;
	constructor(config) {
		this.config = config;
	}
	async start(onEvent) {
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
	async stop() {
		this.stopped = true;
		this.abortController?.abort();
		try {
			await this.streamTask;
		} catch (_error) {
			// Swallow errors on stop
		}
	}
	normalizeServerUrl(url) {
		return url.endsWith("/") ? url.replace(/\/+$/, "") : url;
	}
	async ensureAuth(baseUrl) {
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
	async createSession(baseUrl) {
		const url = new URL(`${baseUrl}/session`);
		url.searchParams.set("directory", this.config.cwd);
		const response = await fetch(url, { method: "POST" });
		if (!response.ok) {
			throw new Error(
				`OpenCode session creation failed with status ${response.status} ${response.statusText}`,
			);
		}
		const data = await response.json();
		if (!data?.id) {
			throw new Error("OpenCode session response missing id");
		}
		return data.id;
	}
	async sendCommand(baseUrl) {
		if (!this.sessionId) {
			throw new Error("OpenCode session id not available");
		}
		const url = new URL(`${baseUrl}/session/${this.sessionId}/command`);
		url.searchParams.set("directory", this.config.cwd);
		const model = {
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
	async consumeEvents(baseUrl, onEvent, retry) {
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
	async streamOnce(baseUrl, onEvent) {
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
	processSseBuffer(buffer, onEvent, flush = false) {
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
	handleSseEvent(rawEvent, onEvent) {
		const parsed = this.parseSseEvent(rawEvent);
		if (!parsed?.data) {
			return;
		}
		let payload;
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
			const normalized = text.trim();
			if (normalized.length > 0) {
				onEvent({ kind: "thought", text: normalized });
			}
		}
		for (const toolEvent of this.extractToolEvents(payload)) {
			const detail = this.stringifyToolDetail(toolEvent.input);
			onEvent({ kind: "action", name: toolEvent.name, detail });
		}
	}
	parseSseEvent(rawEvent) {
		const lines = rawEvent.split("\n");
		const dataLines = [];
		let eventName;
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
	extractTextParts(payload) {
		const texts = [];
		const visited = new WeakSet();
		const walk = (value) => {
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
			if (visited.has(value)) {
				return;
			}
			visited.add(value);
			const node = value;
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
	extractToolEvents(payload) {
		const tools = [];
		const visited = new WeakSet();
		const walk = (value) => {
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
			if (visited.has(value)) {
				return;
			}
			visited.add(value);
			const node = value;
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
	emitCompletion(onEvent) {
		if (this.completed) {
			return;
		}
		this.completed = true;
		onEvent({ kind: "final", text: "OpenCode run completed" });
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
//# sourceMappingURL=OpenCodeRunnerAdapter.js.map
