import type { LinearClient } from "@linear/sdk";
import type { LinearWebhookClient } from "cyrus-linear-webhook-client";
/**
 * Configuration options for the LinearAdapter
 */
export interface LinearAdapterConfig {
	/**
	 * The Linear API client instance
	 */
	linearClient: LinearClient;
	/**
	 * The Linear webhook client instance
	 */
	webhookClient: LinearWebhookClient;
	/**
	 * Optional callback for logging
	 */
	logger?: Logger;
}
/**
 * Simple logger interface
 */
export interface Logger {
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	debug(message: string, ...args: unknown[]): void;
}
/**
 * Default console-based logger
 */
export declare const defaultLogger: Logger;
//# sourceMappingURL=types.d.ts.map
