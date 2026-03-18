import { createLogger, type ILogger } from "cyrus-core";

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

export interface TelemetryReporterConfig {
	/** CYRUS_API_KEY used as Bearer token for authenticating with CYHOST */
	apiKey: string;
	/** Base URL of CYHOST (e.g., "https://api.atcyrus.com") */
	hostUrl: string;
	/** Team ID for identifying the team in telemetry events */
	teamId?: string;
}

/**
 * Reports error telemetry from CYPACK back to CYHOST.
 *
 * Uses CYRUS_API_KEY for authentication — the same shared secret already used
 * for webhook verification. No separate callback tokens needed.
 *
 * Fire-and-forget: errors in reporting are logged but never thrown.
 * If API key or host URL is missing, all calls are silently skipped.
 */
export class TelemetryReporter {
	private logger: ILogger;
	private config: TelemetryReporterConfig;

	constructor(config: TelemetryReporterConfig, logger?: ILogger) {
		this.config = config;
		this.logger = logger ?? createLogger({ component: "TelemetryReporter" });
	}

	/**
	 * Whether the reporter is configured and ready to send telemetry.
	 * Returns false if API key or host URL is missing.
	 */
	get isConfigured(): boolean {
		return Boolean(this.config.apiKey && this.config.hostUrl);
	}

	/**
	 * Update the team ID (may not be known at construction time).
	 */
	setTeamId(teamId: string): void {
		this.config.teamId = teamId;
	}

	/**
	 * Report an error event to CYHOST. Fire-and-forget.
	 */
	async reportError(event: TelemetryErrorEvent): Promise<void> {
		if (!this.isConfigured) {
			return;
		}

		try {
			const payload = {
				team_id: this.config.teamId,
				event_type: "agent_session_error" as const,
				error_type: event.error_type,
				error_message: event.error_message,
				issue_id: event.issue_id,
				issue_identifier: event.issue_identifier,
				session_id: event.session_id,
				duration_seconds: event.duration_seconds,
				timestamp: new Date().toISOString(),
			};

			const url = `${this.config.hostUrl}/api/telemetry/callback`;
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${this.config.apiKey}`,
				},
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(10_000),
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

	/**
	 * Build a TelemetryReporter from environment variables.
	 * Returns a reporter instance — check `isConfigured` to see if it can send telemetry.
	 */
	static fromEnv(logger?: ILogger): TelemetryReporter {
		return new TelemetryReporter(
			{
				apiKey: process.env.CYRUS_API_KEY?.trim() || "",
				hostUrl: process.env.CYRUS_HOST_URL?.trim() || "",
			},
			logger,
		);
	}
}
