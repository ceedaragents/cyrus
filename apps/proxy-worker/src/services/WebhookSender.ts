// Using Web Crypto API for Cloudflare Workers compatibility
import type { EdgeEvent, Env, LinearWebhook } from "../types";
import {
	EdgeWorkerRegistry,
	type StoredEdgeWorker,
} from "./EdgeWorkerRegistry.js";

/**
 * Sends webhook events to registered edge workers
 */
export class WebhookSender {
	private eventCounter = 0;
	private registry: EdgeWorkerRegistry;

	constructor(env: Env) {
		this.registry = new EdgeWorkerRegistry(env);
	}

	/**
	 * Transform Linear webhook to EdgeEvent
	 */
	transformWebhookToEvent(webhook: LinearWebhook): EdgeEvent {
		this.eventCounter++;

		return {
			id: `evt_${this.eventCounter}_${Date.now()}`,
			type: "webhook",
			timestamp: new Date().toISOString(),
			data: webhook,
		};
	}

	/**
	 * Send webhook event to all edge workers for a workspace
	 */
	async sendWebhookToWorkspace(
		event: EdgeEvent,
		workspaceId: string,
	): Promise<number> {
		const edgeWorkers =
			await this.registry.getEdgeWorkersForWorkspace(workspaceId);

		if (edgeWorkers.length === 0) {
			console.log(`No edge workers registered for workspace ${workspaceId}`);
			return 0;
		}

		let successCount = 0;
		const deliveryPromises = edgeWorkers.map(async (worker) => {
			try {
				await this.deliverWebhookToEdgeWorker(worker, event);
				successCount++;
			} catch (error) {
				console.error(`Failed to deliver webhook to ${worker.name}:`, error);
			}
		});

		await Promise.all(deliveryPromises);

		console.log(
			`Delivered webhook to ${successCount}/${edgeWorkers.length} edge workers for workspace ${workspaceId}`,
		);
		return successCount;
	}

	/**
	 * Deliver webhook to a specific edge worker with retry logic
	 */
	private async deliverWebhookToEdgeWorker(
		worker: StoredEdgeWorker,
		event: EdgeEvent,
	): Promise<void> {
		const maxRetries = 3;
		let attempt = 0;

		while (attempt < maxRetries) {
			try {
				await this.makeWebhookRequest(worker, event);
				return; // Success, exit retry loop
			} catch (error) {
				attempt++;

				if (attempt >= maxRetries) {
					throw error; // Final attempt failed
				}

				// Exponential backoff: 1s, 2s, 4s
				const delay = 2 ** (attempt - 1) * 1000;
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}
	}

	/**
	 * Make the actual HTTP request to edge worker webhook
	 */
	private async makeWebhookRequest(
		worker: StoredEdgeWorker,
		event: EdgeEvent,
	): Promise<void> {
		const body = JSON.stringify(event);
		const timestamp = Date.now().toString();
		const signature = await this.generateWebhookSignature(
			body,
			timestamp,
			worker.webhookSecret,
		);

		const response = await fetch(worker.webhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Webhook-Signature": `sha256=${signature}`,
				"X-Webhook-Timestamp": timestamp,
				"User-Agent": "Cyrus-Proxy-Worker/1.0",
			},
			body,
			signal: AbortSignal.timeout(10000), // 10 second timeout
		});

		if (!response.ok) {
			throw new Error(
				`Webhook delivery failed: ${response.status} ${response.statusText}`,
			);
		}

		// Log successful delivery
		console.log(`Successfully delivered webhook ${event.id} to ${worker.name}`);
	}

	/**
	 * Generate HMAC-SHA256 signature for webhook verification
	 */
	private async generateWebhookSignature(
		body: string,
		timestamp: string,
		secret: string,
	): Promise<string> {
		const payload = `${timestamp}.${body}`;
		const encoder = new TextEncoder();
		const keyData = encoder.encode(secret);
		const payloadData = encoder.encode(payload);

		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			keyData,
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);

		const signature = await crypto.subtle.sign("HMAC", cryptoKey, payloadData);
		const hashArray = Array.from(new Uint8Array(signature));
		return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	}

	/**
	 * Handle status update from edge worker
	 */
	async handleStatusUpdate(request: Request): Promise<Response> {
		try {
			const { eventId, status } = (await request.json()) as any;

			// Extract edge authentication
			const authHeader = request.headers.get("authorization");
			if (!authHeader || !authHeader.startsWith("Bearer ")) {
				return new Response("Missing or invalid authorization header", {
					status: 401,
				});
			}

			const linearToken = authHeader.substring(7);

			// Obscure token for logging
			const obscuredId = `${linearToken.substring(0, 10)}...${linearToken.substring(linearToken.length - 4)}`;
			console.log(
				`Edge ${obscuredId} reported status for event ${eventId}: ${status}`,
			);

			// TODO: Handle status update (update Linear, metrics, etc.)

			return new Response(JSON.stringify({ received: true }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		} catch (error) {
			console.error("Error handling status update:", error);
			return new Response("Invalid request", { status: 400 });
		}
	}

	/**
	 * Get registry instance for external use
	 */
	getRegistry(): EdgeWorkerRegistry {
		return this.registry;
	}
}
