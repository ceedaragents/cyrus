/**
 * Structured operational events forwarded to dashboards and alerting.
 *
 * Events are a distinct record kind from free-form log lines: every event
 * is high-value and expected to flow to the full sink chain regardless of
 * the current log level. Adding a new event type means extending the
 * `CyrusEvent` union below — the compiler enforces the schema across every
 * emitter and sink.
 */

export type ErrorClass =
	| "rate_limit"
	| "auth"
	| "network"
	| "timeout"
	| "abort"
	| "unknown";

export interface SessionStartedEvent {
	name: "session.started";
	sessionId: string;
	runner: string;
	model: string;
	repository?: string;
}

export interface SessionResumedEvent {
	name: "session.resumed";
	sessionId: string;
	runner: string;
	model: string;
	repository?: string;
	resumedFromSessionId: string;
}

export interface SessionCompletedEvent {
	name: "session.completed";
	sessionId: string;
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalCostUsd?: number;
	stopReason: string;
}

export interface SessionStoppedEvent {
	name: "session.stopped";
	sessionId: string;
	reason: string;
	durationMs?: number;
}

export interface SessionFailedEvent {
	name: "session.failed";
	sessionId?: string;
	errorClass: ErrorClass;
	errorMessage: string;
}

export type CyrusEvent =
	| SessionStartedEvent
	| SessionResumedEvent
	| SessionCompletedEvent
	| SessionStoppedEvent
	| SessionFailedEvent;

/**
 * Bucket an unknown error into a small set of operational classes suitable
 * for dashboard grouping and alert routing. Intentionally coarse: dashboards
 * aggregate by class, not by raw message text.
 */
export function classifyError(error: unknown): ErrorClass {
	if (!(error instanceof Error)) {
		return "unknown";
	}
	if (error.name === "AbortError") {
		return "abort";
	}
	const msg = error.message.toLowerCase();
	if (msg.includes("aborted")) {
		return "abort";
	}
	if (msg.includes("timeout") || msg.includes("etimedout")) {
		return "timeout";
	}
	if (msg.includes("rate limit") || msg.includes("429")) {
		return "rate_limit";
	}
	if (
		msg.includes("401") ||
		msg.includes("403") ||
		msg.includes("unauthorized") ||
		msg.includes("forbidden")
	) {
		return "auth";
	}
	if (
		msg.includes("econnreset") ||
		msg.includes("enotfound") ||
		msg.includes("econnrefused") ||
		msg.includes("network")
	) {
		return "network";
	}
	return "unknown";
}
