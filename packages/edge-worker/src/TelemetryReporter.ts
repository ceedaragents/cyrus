import { createLogger, type ILogger } from "cyrus-core";
import type { TelemetryCallbackContext } from "cyrus-linear-event-transport";

/**
 * Error types reported back to CYHOST for Mixpanel tracking.
 */
export type TelemetryErrorType =
	| "crash"
	| "stall"
	| "rate_limit"
	| "billing"
	| "max_turns";

/**
 * Payload POSTed to CYHOST's /api/telemetry/callback endpoint.
 */
export interface TelemetryErrorEvent {
	team_id: string;
	event_type: "agent_session_error";
	error_type: TelemetryErrorType;
	error_message: string;
	issue_id?: string;
	issue_identifier?: string;
	session_id: string;
	duration_seconds?: number;
	timestamp: string;
}

/**
 * TelemetryReporter — Fire-and-forget error telemetry to CYHOST.
 *
 * When CYHOST forwards a webhook to CYPACK, it includes callback headers
 * (token, URL, team ID). This reporter uses those to POST error events
 * back so CYHOST can resolve team/user identity and forward to Mixpanel.
 *
 * Graceful degradation: if no callback context is provided, all calls are no-ops.
 */
export class TelemetryReporter {
	private callbackContext: TelemetryCallbackContext | null;
	private logger: ILogger;

	constructor(
		callbackContext: TelemetryCallbackContext | null,
		logger?: ILogger,
	) {
		this.callbackContext = callbackContext;
		this.logger = logger ?? createLogger({ component: "TelemetryReporter" });
	}

	/**
	 * Update the callback context (e.g., when it becomes available after first webhook).
	 */
	setCallbackContext(context: TelemetryCallbackContext): void {
		this.callbackContext = context;
	}

	/**
	 * Report an error event to CYHOST. Fire-and-forget: logs failures but never throws.
	 */
	async reportError(
		event: Omit<TelemetryErrorEvent, "team_id" | "event_type" | "timestamp">,
	): Promise<void> {
		if (!this.callbackContext) {
			this.logger.debug(
				"Telemetry skipped: no callback context (self-hosted or older CYHOST)",
			);
			return;
		}

		const { callbackUrl, callbackToken, teamId } = this.callbackContext;

		const payload: TelemetryErrorEvent = {
			...event,
			team_id: teamId,
			event_type: "agent_session_error",
			timestamp: new Date().toISOString(),
		};

		try {
			const response = await fetch(callbackUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${callbackToken}`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(10_000),
			});

			if (!response.ok) {
				this.logger.warn(
					`Telemetry callback returned ${response.status}: ${response.statusText}`,
				);
			} else {
				this.logger.debug(
					`Telemetry reported: ${event.error_type} for session ${event.session_id}`,
				);
			}
		} catch (error) {
			this.logger.warn("Telemetry callback failed", error);
		}
	}
}
