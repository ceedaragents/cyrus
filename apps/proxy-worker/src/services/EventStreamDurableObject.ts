import type { EdgeEvent } from "../types";

export class EventStreamDurableObject {
	private env: any;
	private connections: Map<
		string,
		{ response: Response; writer: WritableStreamDefaultWriter }
	> = new Map();
	private workspaceIds: string[] = [];
	private linearToken?: string;
	private heartbeatInterval?: number;

	constructor(_state: DurableObjectState, env: any) {
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		// Handle internal event sending
		if (url.pathname === "/send-event" && request.method === "POST") {
			return this.handleSendEvent(request);
		}

		// Handle NDJSON streaming
		if (url.pathname === "/events/stream") {
			return this.handleEventStream(request);
		}

		return new Response("Not found", { status: 404 });
	}

	/**
	 * Handle NDJSON event stream connection
	 */
	private async handleEventStream(request: Request): Promise<Response> {
		// Extract workspace IDs from query params
		const url = new URL(request.url);
		const workspaceIdsParam = url.searchParams.get("workspaceIds");
		if (workspaceIdsParam) {
			this.workspaceIds = workspaceIdsParam.split(",");
		}

		// Check for disconnect simulation from environment variables
		const simulateDisconnect = this.env.SIMULATE_DISCONNECT === "true";
		const disconnectAfterMs = parseInt(
			this.env.DISCONNECT_AFTER_MS || "5000",
			10,
		);

		// Extract Linear token from authorization header
		const authHeader = request.headers.get("authorization");
		if (authHeader?.startsWith("Bearer ")) {
			this.linearToken = authHeader.substring(7);
		}

		// Create NDJSON stream with text encoder/decoder
		const encoder = new TextEncoder();
		const { readable, writable } = new TransformStream({
			start(controller) {
				// Send initial connection event immediately
				const event: EdgeEvent = {
					id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
					type: "connection",
					status: "connected",
					timestamp: new Date().toISOString(),
				};
				const line = `${JSON.stringify(event)}\n`;
				console.log("Sending initial event:", event.type, "id:", event.id);
				controller.enqueue(encoder.encode(line));
			},
		});

		const writer = writable.getWriter();

		// Generate connection ID
		const connectionId = crypto.randomUUID();

		// Store connection before creating response
		this.connections.set(connectionId, { response: null as any, writer });

		// Set up heartbeat if not already running
		if (!this.heartbeatInterval) {
			this.heartbeatInterval = setInterval(() => {
				this.sendHeartbeat();
			}, 30000) as any; // 30 seconds
		}

		// Handle connection close
		request.signal.addEventListener("abort", () => {
			this.connections.delete(connectionId);
			writer.close().catch(() => {});

			// Clear heartbeat if no more connections
			if (this.connections.size === 0 && this.heartbeatInterval) {
				clearInterval(this.heartbeatInterval);
				this.heartbeatInterval = undefined;
			}
		});

		// Set up disconnection simulation if requested
		if (simulateDisconnect) {
			setTimeout(() => {
				console.log(
					`Simulating abrupt disconnection after ${disconnectAfterMs}ms for connection ${connectionId}`,
				);

				// Abruptly close the connection without any warning
				writer.close().catch(() => {});
				this.connections.delete(connectionId);

				// Clear heartbeat if no more connections
				if (this.connections.size === 0 && this.heartbeatInterval) {
					clearInterval(this.heartbeatInterval);
					this.heartbeatInterval = undefined;
				}
			}, disconnectAfterMs);
		}

		// Create and return response immediately
		return new Response(readable, {
			headers: {
				"Content-Type": "application/x-ndjson",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			},
		});
	}

	/**
	 * Handle sending event to all connections
	 */
	private async handleSendEvent(request: Request): Promise<Response> {
		try {
			const event: EdgeEvent = await request.json();

			// Send to all active connections
			const promises: Promise<void>[] = [];
			const deadConnections: string[] = [];

			for (const [id, connection] of this.connections) {
				promises.push(
					this.sendEvent(connection.writer, event).catch(() => {
						deadConnections.push(id);
					}),
				);
			}

			await Promise.all(promises);

			// Clean up dead connections
			for (const id of deadConnections) {
				this.connections.delete(id);
			}

			return new Response(JSON.stringify({ sent: this.connections.size }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		} catch (_error) {
			return new Response("Failed to send event", { status: 500 });
		}
	}

	/**
	 * Send event to a writer
	 */
	private async sendEvent(
		writer: WritableStreamDefaultWriter,
		event: Omit<EdgeEvent, "id">,
	): Promise<void> {
		const fullEvent: EdgeEvent = {
			...event,
			id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		};

		const line = `${JSON.stringify(fullEvent)}\n`;
		const encoder = new TextEncoder();

		console.log("Sending event:", fullEvent.type, "id:", fullEvent.id);

		await writer.write(encoder.encode(line));
	}

	/**
	 * Send heartbeat to all connections
	 */
	private async sendHeartbeat(): Promise<void> {
		const heartbeat: Omit<EdgeEvent, "id"> = {
			type: "heartbeat",
			timestamp: new Date().toISOString(),
		};

		const deadConnections: string[] = [];

		for (const [id, connection] of this.connections) {
			try {
				await this.sendEvent(connection.writer, heartbeat);
			} catch {
				deadConnections.push(id);
			}
		}

		// Clean up dead connections
		for (const id of deadConnections) {
			this.connections.delete(id);
		}

		// Refresh connection TTL in KV if we have an active connection and token
		if (this.connections.size > 0 && this.linearToken) {
			await this.refreshConnectionTTL();
		}

		// Clear heartbeat if no more connections
		if (this.connections.size === 0 && this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = undefined;
		}
	}

	/**
	 * Refresh the connection TTL in KV storage
	 */
	private async refreshConnectionTTL(): Promise<void> {
		if (!this.linearToken) return;

		try {
			const connectionKey = `edge:connection:${this.linearToken}`;
			const existingData = await this.env.EDGE_TOKENS.get(connectionKey);

			if (existingData) {
				const data = JSON.parse(existingData);
				data.lastSeen = Date.now();

				// Refresh with 1 hour TTL
				await this.env.EDGE_TOKENS.put(connectionKey, JSON.stringify(data), {
					expirationTtl: 3600,
				});

				// Also refresh workspace mappings
				for (const workspaceId of this.workspaceIds) {
					const key = `workspace:edges:${workspaceId}`;
					const existing = await this.env.EDGE_TOKENS.get(key);
					if (existing) {
						// Just refresh the TTL by re-putting the same data
						await this.env.EDGE_TOKENS.put(key, existing, {
							expirationTtl: 3600,
						});
					}
				}
			}
		} catch (error) {
			console.error("Failed to refresh connection TTL:", error);
		}
	}
}
