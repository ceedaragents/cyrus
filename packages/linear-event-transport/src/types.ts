/**
 * Types for Linear event transport
 */

import type { AgentEvent, InternalMessage } from "cyrus-core";
import type { FastifyInstance } from "fastify";

/**
 * Verification mode for Linear webhooks
 * - 'direct': Use LINEAR_WEBHOOK_SECRET for Linear signature verification
 * - 'proxy': Use CYRUS_API_KEY Bearer token for proxy authentication
 */
export type VerificationMode = "direct" | "proxy";

/**
 * Configuration for LinearEventTransport
 */
export interface LinearEventTransportConfig {
	/** Fastify server instance to mount routes on */
	fastifyServer: FastifyInstance;
	/** Verification mode: 'direct' or 'proxy' */
	verificationMode: VerificationMode;
	/** Secret for verification (LINEAR_WEBHOOK_SECRET or CYRUS_API_KEY) */
	secret: string;
}

/**
 * Callback context extracted from CYHOST webhook headers.
 * Used to POST error telemetry back to CYHOST for Mixpanel tracking.
 * Only present when webhooks are forwarded from CYHOST (cloud droplets).
 */
export interface TelemetryCallbackContext {
	/** Bearer token for authenticating callback POSTs to CYHOST */
	callbackToken: string;
	/** URL to POST telemetry events to (e.g., https://host/api/telemetry/callback) */
	callbackUrl: string;
	/** Team ID for CYHOST to resolve user identity */
	teamId: string;
}

/**
 * Events emitted by LinearEventTransport
 */
export interface LinearEventTransportEvents {
	/** Emitted when a webhook is received and verified (legacy) */
	event: (event: AgentEvent) => void;
	/** Emitted when a unified internal message is received */
	message: (message: InternalMessage) => void;
	/** Emitted when an error occurs */
	error: (error: Error) => void;
}
