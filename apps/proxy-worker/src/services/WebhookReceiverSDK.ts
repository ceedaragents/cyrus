import { LinearWebhookClient } from "@linear/sdk/webhooks";
import type { LinearWebhookPayload } from "@linear/sdk/webhooks";
import type { Env, LinearWebhook } from "../types";

/**
 * WebhookReceiver using the Linear SDK's webhook handling capabilities
 * This implementation leverages the official Linear SDK for signature verification
 * and event handling, providing better type safety and automatic updates.
 */
export class WebhookReceiverSDK {
	private webhookClient: LinearWebhookClient;
	private handler: ReturnType<LinearWebhookClient["createHandler"]>;

	constructor(
		private env: Env,
		private onWebhook: (webhook: LinearWebhook) => Promise<void>,
	) {
		// Initialize Linear webhook client with signing secret
		this.webhookClient = new LinearWebhookClient(this.env.LINEAR_WEBHOOK_SECRET);
		this.handler = this.webhookClient.createHandler();

		// Register event handlers for all webhook types
		this.registerEventHandlers();
	}

	/**
	 * Register handlers for different webhook event types
	 */
	private registerEventHandlers(): void {
		// Use wildcard handler to process all events
		this.handler.on("*", async (payload: LinearWebhookPayload) => {
			try {
				// Transform SDK webhook payload to our internal format
				const webhook = this.transformWebhookPayload(payload);
				
				// Log webhook type
				console.log(
					`Received webhook: ${webhook.type}/${webhook.action || webhook.notification?.type}`,
				);

				// Process webhook using the provided handler
				await this.onWebhook(webhook);
			} catch (error) {
				console.error("Webhook processing error:", error);
				// The SDK will handle response codes, so we just log errors
				throw error;
			}
		});
	}

	/**
	 * Handle incoming webhook request using Linear SDK
	 * The SDK automatically handles signature verification and response codes
	 */
	async handleWebhook(request: Request): Promise<Response> {
		try {
			// The Linear SDK's handler works with Fetch API Request/Response
			// It will automatically verify the signature and parse the payload
			return await this.handler(request);
		} catch (error) {
			console.error("SDK webhook handling error:", error);
			return new Response("Processing error", { status: 500 });
		}
	}

	/**
	 * Transform SDK webhook payload to our internal LinearWebhook format
	 * This maintains backward compatibility with existing code
	 */
	private transformWebhookPayload(payload: LinearWebhookPayload): LinearWebhook {
		// The SDK payload is a union type with varying structures
		// We cast it to any and then to our LinearWebhook type
		const webhook: LinearWebhook = payload as any;

		return webhook;
	}

	/**
	 * Get statistics about registered event handlers (for debugging)
	 */
	getHandlerStats(): { eventCount: number; hasWildcard: boolean } {
		// The SDK doesn't expose handler count directly, but we know we have one wildcard
		return {
			eventCount: 1,
			hasWildcard: true,
		};
	}
}