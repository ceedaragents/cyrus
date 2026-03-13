import { createLogger, type ILogger } from "cyrus-core";
import type { TelemetryCallbackConfig } from "cyrus-linear-event-transport";

/**
 * Error event payload sent to CYHOST telemetry callback endpoint.
 */
export interface TelemetryErrorEvent {
	error_type: "crash" | "stall" | "rate_limit" | "billing" | "max_turns";
	error_message: string;
	issue_id: string;
	issue_identifier: string;
	session_id: string;
	duration_seconds: number;
}

/**
 * Reports error telemetry from CYPACK back to CYHOST.
 *
 * Fire-and-forget: errors in reporting are logged but never thrown,
 * so they don't affect session completion.
 *
 * If no callback config is available (older CYHOST, self-hosted without
 * callback headers), all calls are silently skipped.
 */
export class TelemetryReporter {
	private logger: ILogger;
	private getCallbackConfig: () => TelemetryCallbackConfig | null;

	constructor(
		getCallbackConfig: () => TelemetryCallbackConfig | null,
		logger?: ILogger,
	) {
		this.getCallbackConfig = getCallbackConfig;
		this.logger = logger ?? createLogger({ component: "TelemetryReporter" });
	}

	/**
	 * Report an error event to CYHOST. Fire-and-forget.
	 */
	async reportError(event: TelemetryErrorEvent): Promise<void> {
		const config = this.getCallbackConfig();
		if (!config) {
			// No callback config available — silently skip
			return;
		}

		try {
			const payload = {
				team_id: config.teamId,
				event_type: "agent_session_error" as const,
				error_type: event.error_type,
				error_message: event.error_message,
				issue_id: event.issue_id,
				issue_identifier: event.issue_identifier,
				session_id: event.session_id,
				duration_seconds: event.duration_seconds,
				timestamp: new Date().toISOString(),
			};

			const response = await fetch(config.callbackUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${config.callbackToken}`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(10000), // 10 second timeout
			});

			if (!response.ok) {
				this.logger.warn(
					`Telemetry callback returned ${response.status}: ${response.statusText}`,
				);
			}
		} catch (error) {
			this.logger.warn("Failed to send telemetry callback", error);
		}
	}
}
