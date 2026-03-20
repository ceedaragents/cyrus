import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import {
	createInterface,
	type Interface as ReadLineInterface,
} from "node:readline";
import type {
	AppServerInitializeParams,
	AppServerNotification,
	AppServerRequest,
	AppServerThreadResumeParams,
	AppServerThreadStartParams,
	AppServerThreadStartResponse,
	AppServerTurnInterruptParams,
	AppServerTurnStartParams,
	AppServerTurnStartResponse,
	JsonRpcResponse,
} from "./appServerProtocol.js";

interface PendingRequest {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
}

export interface CodexAppServerClientOptions {
	codexPath?: string;
	env?: Record<string, string>;
	configOverrides?: string[];
	onNotification: (notification: AppServerNotification) => void;
	onRequest?: (request: AppServerRequest) => Promise<unknown> | unknown;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	return "Unknown Codex app-server error";
}

function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
	return Boolean(
		value &&
			typeof value === "object" &&
			"id" in value &&
			("result" in value || "error" in value),
	);
}

function isServerRequest(value: unknown): value is AppServerRequest {
	return Boolean(
		value &&
			typeof value === "object" &&
			"id" in value &&
			"method" in value &&
			!("result" in value) &&
			!("error" in value),
	);
}

function isNotification(value: unknown): value is AppServerNotification {
	return Boolean(
		value && typeof value === "object" && "method" in value && !("id" in value),
	);
}

export class CodexAppServerClient {
	private readonly options: CodexAppServerClientOptions;
	private readonly pendingRequests = new Map<number, PendingRequest>();
	private readonly stderrChunks: string[] = [];
	private readonly nextRequestId = { value: 1 };
	private child: ChildProcess | null = null;
	private readline: ReadLineInterface | null = null;
	private closed = false;

	constructor(options: CodexAppServerClientOptions) {
		this.options = options;
	}

	async connect(initialization: AppServerInitializeParams): Promise<void> {
		if (this.child) {
			throw new Error("Codex app-server client already connected");
		}

		const args = ["app-server"];
		for (const override of this.options.configOverrides || []) {
			args.push("--config", override);
		}

		const child = spawn(this.options.codexPath || "codex", args, {
			env: this.options.env,
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.child = child;
		this.closed = false;
		this.stderrChunks.length = 0;

		if (!child.stdin || !child.stdout) {
			child.kill();
			throw new Error("Codex app-server did not expose stdio pipes");
		}

		this.readline = createInterface({ input: child.stdout });
		this.readline.on("line", (line) => void this.handleStdoutLine(line));

		child.stderr?.on("data", (chunk) => {
			this.stderrChunks.push(String(chunk));
		});

		child.once("error", (error) => {
			this.rejectAllPending(
				error instanceof Error ? error : new Error(String(error)),
			);
		});

		child.once("exit", (code, signal) => {
			const stderr = this.stderrChunks.join("").trim();
			const reason =
				stderr ||
				`Codex app-server exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`;
			this.rejectAllPending(new Error(reason));
			this.cleanupHandles();
		});

		await this.request("initialize", initialization);
		this.notify("initialized");
	}

	async startThread(
		params: AppServerThreadStartParams,
	): Promise<AppServerThreadStartResponse> {
		return this.request<AppServerThreadStartResponse>("thread/start", params);
	}

	async resumeThread(
		params: AppServerThreadResumeParams,
	): Promise<AppServerThreadStartResponse> {
		return this.request<AppServerThreadStartResponse>("thread/resume", params);
	}

	async startTurn(
		params: AppServerTurnStartParams,
	): Promise<AppServerTurnStartResponse> {
		return this.request<AppServerTurnStartResponse>("turn/start", params);
	}

	async interruptTurn(params: AppServerTurnInterruptParams): Promise<void> {
		await this.request("turn/interrupt", params);
	}

	close(): void {
		if (this.closed) {
			return;
		}

		this.closed = true;
		this.cleanupHandles();
		this.child?.kill();
		this.child = null;
	}

	private cleanupHandles(): void {
		if (this.readline) {
			this.readline.close();
			this.readline.removeAllListeners();
			this.readline = null;
		}
	}

	private async handleStdoutLine(line: string): Promise<void> {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}

		let payload: unknown;
		try {
			payload = JSON.parse(trimmed);
		} catch (error) {
			const message = toErrorMessage(error);
			this.rejectAllPending(
				new Error(`Failed to parse Codex app-server JSON: ${message}`),
			);
			return;
		}

		if (isJsonRpcResponse(payload)) {
			this.handleResponse(payload);
			return;
		}

		if (isServerRequest(payload)) {
			await this.handleServerRequest(payload);
			return;
		}

		if (isNotification(payload)) {
			this.options.onNotification(payload);
			return;
		}
	}

	private handleResponse(response: JsonRpcResponse): void {
		const pending = this.pendingRequests.get(response.id);
		if (!pending) {
			return;
		}

		this.pendingRequests.delete(response.id);
		if ("error" in response) {
			pending.reject(new Error(response.error.message));
			return;
		}

		pending.resolve(response.result);
	}

	private async handleServerRequest(request: AppServerRequest): Promise<void> {
		try {
			const result = this.options.onRequest
				? await this.options.onRequest(request)
				: this.defaultRequestResult(request);
			this.writeMessage({ id: request.id, result });
		} catch (error) {
			this.writeMessage({
				id: request.id,
				error: {
					code: -32603,
					message: toErrorMessage(error),
				},
			});
		}
	}

	private defaultRequestResult(request: AppServerRequest): unknown {
		switch (request.method) {
			case "item/commandExecution/requestApproval":
				return { decision: "decline" };
			case "item/fileChange/requestApproval":
				return { decision: "decline" };
			case "applyPatchApproval":
				return { decision: "denied" };
			case "execCommandApproval":
				return { decision: "denied" };
			default:
				throw new Error(
					`Unsupported Codex app-server request: ${request.method}`,
				);
		}
	}

	private request<Result = unknown>(
		method: string,
		params?: unknown,
	): Promise<Result> {
		const id = this.nextRequestId.value++;
		return new Promise<Result>((resolve, reject) => {
			this.pendingRequests.set(id, { resolve, reject });
			try {
				this.writeMessage(
					params === undefined ? { method, id } : { method, id, params },
				);
			} catch (error) {
				this.pendingRequests.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private notify(method: string, params?: unknown): void {
		this.writeMessage(params === undefined ? { method } : { method, params });
	}

	private writeMessage(message: unknown): void {
		if (!this.child?.stdin) {
			throw new Error("Codex app-server stdin is unavailable");
		}

		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private rejectAllPending(error: Error): void {
		if (this.pendingRequests.size === 0) {
			return;
		}

		for (const pending of this.pendingRequests.values()) {
			pending.reject(error);
		}
		this.pendingRequests.clear();
	}
}
