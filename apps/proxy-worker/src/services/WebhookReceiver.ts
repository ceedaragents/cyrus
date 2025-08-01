import type { Env, LinearWebhook } from "../types";

export class WebhookReceiver {
	constructor(
		private env: Env,
		private onWebhook: (webhook: LinearWebhook) => Promise<void>,
	) {}

	/**
	 * Handle incoming webhook
	 */
	async handleWebhook(request: Request): Promise<Response> {
		// Verify webhook signature
		const signature = request.headers.get("linear-signature");
		if (!signature) {
			return new Response("Missing signature", { status: 401 });
		}

		// Get raw body for signature verification
		const rawBody = await request.text();

		// Verify signature
		const isValid = await this.verifyWebhookSignature(rawBody, signature);
		if (!isValid) {
			return new Response("Invalid signature", { status: 401 });
		}

		try {
			// Parse webhook payload
			const webhook: LinearWebhook = JSON.parse(rawBody);

			// Log webhook type
			console.log(
				`Received webhook: ${webhook.type}/${webhook.action || webhook.notification?.type}`,
			);

			// Process webhook
			await this.onWebhook(webhook);

			return new Response("OK", { status: 200 });
		} catch (error) {
			console.error("Webhook processing error:", error);
			return new Response("Processing error", { status: 500 });
		}
	}

	/**
	 * Verify webhook signature using HMAC-SHA256
	 */
	private async verifyWebhookSignature(
		payload: string,
		signature: string,
	): Promise<boolean> {
		try {
			// Create HMAC key
			const encoder = new TextEncoder();
			const key = await crypto.subtle.importKey(
				"raw",
				encoder.encode(this.env.LINEAR_WEBHOOK_SECRET),
				{ name: "HMAC", hash: "SHA-256" },
				false,
				["sign", "verify"],
			);

			// Sign the payload
			const signatureBuffer = await crypto.subtle.sign(
				"HMAC",
				key,
				encoder.encode(payload),
			);

			// Convert to hex string
			const computedSignature = Array.from(new Uint8Array(signatureBuffer))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			// Compare signatures
			return computedSignature === signature;
		} catch (error) {
			console.error("Signature verification error:", error);
			return false;
		}
	}
}
