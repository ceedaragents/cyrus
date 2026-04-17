/**
 * Structured operational events forwarded to OpenTelemetry for
 * dashboards and alerting.
 *
 * Events are a separate signal from log lines: every event is high-value
 * and always forwarded to OTel (regardless of log level), while routine
 * INFO/DEBUG logs stay on stdout only. Adding a new event requires
 * extending the `CyrusEvent` union below so the schema is enforced at
 * compile time.
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

export interface SessionCompletedEvent {
	name: "session.completed";
	sessionId: string;
	durationMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalCostUsd?: number;
	stopReason: string;
}

export interface SessionFailedEvent {
	name: "session.failed";
	sessionId?: string;
	errorClass: ErrorClass;
	errorMessage: string;
}

export type CyrusEvent =
	| SessionStartedEvent
	| SessionCompletedEvent
	| SessionFailedEvent;

/**
 * Bucket an unknown error value into a small set of operational classes
 * suitable for dashboard grouping and alert routing. The classification
 * is intentionally coarse — dashboards should aggregate by class, not
 * try to regex the original message.
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
