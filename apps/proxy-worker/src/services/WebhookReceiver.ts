import {
	LinearWebhookClient,
	type LinearWebhookPayload,
} from "@linear/sdk/webhooks";
import type { Env } from "../types";

export class WebhookReceiver {
	private webhookClient: LinearWebhookClient;

	constructor(
		private env: Env,
		private onWebhook: (webhook: LinearWebhookPayload) => Promise<void>,
	) {
		// Initialize Linear SDK webhook client with the webhook secret
		this.webhookClient = new LinearWebhookClient(
			this.env.LINEAR_WEBHOOK_SECRET,
		);
	}

	/**
	 * Handle incoming webhook using Linear SDK
	 */
	async handleWebhook(request: Request): Promise<Response> {
		try {
			// Create a webhook handler
			const handler = this.webhookClient.createHandler();

			// Register a wildcard handler to process all webhook types
			handler.on("*", async (payload: LinearWebhookPayload) => {
				// Log webhook type
				console.log(`Received webhook: ${payload.type}/${payload.action}`);

				// Process webhook with the Linear SDK payload
				await this.onWebhook(payload);
			});

			// Use the Linear SDK handler to process the request
			// The SDK handles signature verification automatically
			return await handler(request);
		} catch (error) {
			console.error("Webhook processing error:", error);
			return new Response("Processing error", { status: 500 });
		}
	}
}
