import type {
	SessionKey,
	SessionStore,
	SessionStoreEntry,
} from "@anthropic-ai/claude-agent-sdk";
import type { ILogger } from "cyrus-core";

/**
 * HTTP-backed Claude Agent SDK SessionStore.
 *
 * Mirrors session transcripts from an edge-worker / ClaudeRunner to the
 * Cyrus hosted control plane, which persists them in a per-team Supabase
 * table. Authenticates every request with a Cyrus team API key
 * (`CYRUS_API_KEY`) passed as `Authorization: Bearer <key>`.
 *
 * Wire protocol (all POST, JSON body):
 *
 *   POST {baseUrl}/api/sessions/append        { projectKey, sessionId, subpath?, entries }
 *   POST {baseUrl}/api/sessions/load          { projectKey, sessionId, subpath? }          -> { entries: SessionStoreEntry[] | null }
 *   POST {baseUrl}/api/sessions/list-sessions { projectKey }                                -> { sessions: [{ sessionId, mtime }] }
 *   POST {baseUrl}/api/sessions/delete        { projectKey, sessionId, subpath? }
 *   POST {baseUrl}/api/sessions/list-subkeys  { projectKey, sessionId }                     -> { subpaths: string[] }
 *
 * The adapter passes the 13-contract conformance suite from
 * anthropics/claude-agent-sdk-typescript/examples/session-stores/shared/conformance.ts
 * when pointed at a conforming backend. The cyrus-hosted implementation of
 * these routes is the canonical conforming backend.
 */
export interface HttpSessionStoreOptions {
	/** Base URL of the control-plane, e.g. "https://app.atcyrus.com". */
	baseUrl: string;
	/** Team-scoped API key. Sent as `Authorization: Bearer <apiKey>`. */
	apiKey: string;
	/**
	 * Optional fetch override — primarily for tests. Defaults to the global
	 * `fetch`. Signature intentionally matches `globalThis.fetch`.
	 */
	fetch?: typeof fetch;
	/** Optional logger; defaults to a silent no-op. */
	logger?: ILogger;
	/** Request timeout in ms. Defaults to 15_000. */
	timeoutMs?: number;
}

type JsonBody = Record<string, unknown>;

export class HttpSessionStore implements SessionStore {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly fetchImpl: typeof fetch;
	private readonly logger: ILogger | undefined;
	private readonly timeoutMs: number;

	constructor(opts: HttpSessionStoreOptions) {
		if (!opts.baseUrl) throw new Error("HttpSessionStore: baseUrl required");
		if (!opts.apiKey) throw new Error("HttpSessionStore: apiKey required");
		// Strip trailing slash so path concat is predictable.
		this.baseUrl = opts.baseUrl.replace(/\/$/, "");
		this.apiKey = opts.apiKey;
		this.fetchImpl = opts.fetch ?? fetch;
		this.logger = opts.logger;
		this.timeoutMs = opts.timeoutMs ?? 15_000;
	}

	async append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void> {
		if (entries.length === 0) return;
		await this.post("/api/sessions/append", {
			projectKey: key.projectKey,
			sessionId: key.sessionId,
			...(key.subpath !== undefined && { subpath: key.subpath }),
			entries,
		});
	}

	async load(key: SessionKey): Promise<SessionStoreEntry[] | null> {
		const res = await this.post<{ entries: SessionStoreEntry[] | null }>(
			"/api/sessions/load",
			{
				projectKey: key.projectKey,
				sessionId: key.sessionId,
				...(key.subpath !== undefined && { subpath: key.subpath }),
			},
		);
		// Server returns `entries: null` when no transcript exists. Preserve that
		// distinction — returning `[]` would look like an empty-but-present
		// session, which the SDK treats differently from "no session found".
		return res.entries ?? null;
	}

	async listSessions(
		projectKey: string,
	): Promise<Array<{ sessionId: string; mtime: number }>> {
		const res = await this.post<{
			sessions: Array<{ sessionId: string; mtime: number }>;
		}>("/api/sessions/list-sessions", { projectKey });
		return res.sessions ?? [];
	}

	async delete(key: SessionKey): Promise<void> {
		await this.post("/api/sessions/delete", {
			projectKey: key.projectKey,
			sessionId: key.sessionId,
			...(key.subpath !== undefined && { subpath: key.subpath }),
		});
	}

	async listSubkeys(key: {
		projectKey: string;
		sessionId: string;
	}): Promise<string[]> {
		const res = await this.post<{ subpaths: string[] }>(
			"/api/sessions/list-subkeys",
			{
				projectKey: key.projectKey,
				sessionId: key.sessionId,
			},
		);
		return res.subpaths ?? [];
	}

	private async post<T = unknown>(path: string, body: JsonBody): Promise<T> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
		try {
			const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (!response.ok) {
				const text = await response.text().catch(() => "");
				const err = new Error(
					`HttpSessionStore ${path} ${response.status}: ${text.slice(0, 500)}`,
				);
				this.logger?.error?.(err.message);
				throw err;
			}
			// Empty bodies (append / delete) are fine — don't blow up on JSON
			// parse if the server omits the body.
			const text = await response.text();
			if (!text) return {} as T;
			return JSON.parse(text) as T;
		} finally {
			clearTimeout(timeout);
		}
	}
}
