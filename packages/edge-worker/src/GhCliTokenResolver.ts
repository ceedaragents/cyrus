import { spawn } from "node:child_process";

export interface GhCliExecResult {
	code: number;
	stdout: string;
}

export type GhCliExecutor = (
	command: string,
	args: string[],
) => Promise<GhCliExecResult>;

export interface GhCliTokenResolverConfig {
	/** Cache TTL in milliseconds. Defaults to 60s. */
	ttlMs?: number;
	/** Path to the `gh` binary. Defaults to "gh" (resolved via PATH). */
	ghPath?: string;
	/** Override for the underlying spawn — used by tests. */
	exec?: GhCliExecutor;
}

const DEFAULT_TTL_MS = 60_000;

/**
 * Resolves a GitHub token by shelling out to `gh auth token`.
 *
 * Used as a middle tier in EdgeWorker's GitHub credential brokering chain
 * for self-hosted users who have authed with `gh auth login` but haven't
 * configured a GitHub App. Tokens are cached for `ttlMs` so a burst of
 * brokered requests doesn't fork+exec on every call.
 *
 * Returns `null` when `gh` is missing, unauthed, or returns an empty token.
 * Callers should treat `null` as "fall through to the next resolver tier".
 */
export class GhCliTokenResolver {
	private readonly ttlMs: number;
	private readonly ghPath: string;
	private readonly exec: GhCliExecutor;
	private cachedToken: string | null = null;
	private cachedAt = 0;
	private inflight: Promise<string | null> | null = null;

	constructor(config: GhCliTokenResolverConfig = {}) {
		this.ttlMs = config.ttlMs ?? DEFAULT_TTL_MS;
		this.ghPath = config.ghPath ?? "gh";
		this.exec = config.exec ?? defaultExec;
	}

	async getToken(): Promise<string | null> {
		const now = Date.now();
		if (this.cachedToken && now - this.cachedAt < this.ttlMs) {
			return this.cachedToken;
		}
		if (this.inflight) return this.inflight;

		this.inflight = this.fetchToken().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	/** Drop the cache so the next `getToken()` re-shells. */
	invalidate(): void {
		this.cachedToken = null;
		this.cachedAt = 0;
	}

	private async fetchToken(): Promise<string | null> {
		try {
			const { code, stdout } = await this.exec(this.ghPath, ["auth", "token"]);
			if (code !== 0) return null;
			const token = stdout.trim();
			if (!token) return null;

			this.cachedToken = token;
			this.cachedAt = Date.now();
			return token;
		} catch {
			return null;
		}
	}
}

const defaultExec: GhCliExecutor = (command, args) =>
	new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.on("error", () => resolve({ code: -1, stdout: "" }));
		child.on("close", (code) => {
			resolve({ code: code ?? -1, stdout });
		});
	});
