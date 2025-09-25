import type { EdgeEvent, Env, LinearWebhook } from "../types";

export class EventStreamer {
	private eventCounter = 0;

	constructor(private env: Env) {}

	/**
	 * Handle event stream request
	 */
	async handleStream(request: Request): Promise<Response> {
		// Extract Linear OAuth token
		const authHeader = request.headers.get("authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return new Response("Missing or invalid authorization header", {
				status: 401,
			});
		}

		const linearToken = authHeader.substring(7);

		// Validate token and get workspace access from Linear
		const workspaceIds = await this.validateLinearToken(linearToken);

		if (!workspaceIds || workspaceIds.length === 0) {
			return new Response("Invalid token or no workspace access", {
				status: 401,
			});
		}

		// Track this edge connection
		await this.trackEdgeConnection(linearToken, workspaceIds);

		// Use token as edge ID (it's unique per edge connection)
		const edgeId = linearToken;
		const durableObjectId = this.env.EVENT_STREAM.idFromName(edgeId);
		const durableObject = this.env.EVENT_STREAM.get(durableObjectId);

		// Obscure token for logging
		const obscuredId = `${linearToken.substring(0, 10)}...${linearToken.substring(linearToken.length - 4)}`;
		console.log(
			`Edge worker ${obscuredId} connected for streaming with access to ${workspaceIds.length} workspace(s)`,
		);

		// Forward request to durable object with workspace info
		const internalUrl = `http://internal/events/stream?workspaceIds=${workspaceIds.join(",")}`;

		const doRequest = new Request(internalUrl, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		return durableObject.fetch(doRequest);
	}

	/**
	 * Handle status update from edge worker
	 */
	async handleStatus(request: Request): Promise<Response> {
		const { eventId, status } = (await request.json()) as any;

		// Extract edge authentication
		const authHeader = request.headers.get("authorization");
		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return new Response("Missing or invalid authorization header", {
				status: 401,
			});
		}

		const linearToken = authHeader.substring(7);

		// Obscure token for logging (show first 10 chars only)
		const obscuredId = `${linearToken.substring(0, 10)}...${linearToken.substring(linearToken.length - 4)}`;
		console.log(
			`Edge ${obscuredId} reported status for event ${eventId}: ${status}`,
		);

		// TODO: Handle status update (update Linear, etc.)

		return new Response(JSON.stringify({ received: true }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	/**
	 * Validate Linear token and get workspace access
	 */
	private async validateLinearToken(token: string): Promise<string[] | null> {
		try {
			const response = await fetch("https://api.linear.app/graphql", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					query: `
            query {
              viewer {
                id
                name
                organization {
                  id
                  name
                  urlKey
                  teams {
                    nodes {
                      id
                      key
                      name
                    }
                  }
                }
              }
            }
          `,
				}),
			});

			if (!response.ok) {
				console.error("Failed to validate token:", response.status);
				return null;
			}

			const data = (await response.json()) as any;

			if (data.errors) {
				console.error("GraphQL errors:", data.errors);
				return null;
			}

			// Extract workspace IDs (organization ID and all team IDs)
			const workspaceIds: string[] = [];

			if (data.data?.viewer?.organization) {
				const org = data.data.viewer.organization;
				workspaceIds.push(org.id);

				// Add all team IDs
				if (org.teams?.nodes) {
					for (const team of org.teams.nodes) {
						workspaceIds.push(team.id);
					}
				}
			}

			return workspaceIds;
		} catch (error) {
			console.error("Error validating token:", error);
			return null;
		}
	}

	/**
	 * Transform webhook to streaming event
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
	 * Broadcast event to edge workers for a workspace
	 */
	async broadcastToWorkspace(
		event: EdgeEvent,
		workspaceId: string,
	): Promise<number> {
		// Get all edge workers that have access to this workspace
		const edgeWorkers = await this.getEdgeWorkersForWorkspace(workspaceId);

		let successCount = 0;

		for (const edgeId of edgeWorkers) {
			try {
				const durableObjectId = this.env.EVENT_STREAM.idFromName(edgeId);
				const durableObject = this.env.EVENT_STREAM.get(durableObjectId);

				// Send event to durable object
				const response = await durableObject.fetch(
					new Request("http://internal/send-event", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(event),
					}),
				);

				if (response.ok) {
					successCount++;
				}
			} catch (error) {
				console.error(`Failed to send event to edge ${edgeId}:`, error);
			}
		}

		return successCount;
	}

	/**
	 * Get all edge workers that have access to a workspace
	 */
	private async getEdgeWorkersForWorkspace(
		workspaceId: string,
	): Promise<string[]> {
		const key = `workspace:edges:${workspaceId}`;
		const data = await this.env.EDGE_TOKENS.get(key);

		if (!data) return [];

		const edgeTokens: string[] = JSON.parse(data);
		const activeEdges: string[] = [];

		// Verify each edge is still connected
		for (const token of edgeTokens) {
			const connectionData = await this.env.EDGE_TOKENS.get(
				`edge:connection:${token}`,
			);
			if (connectionData) {
				activeEdges.push(token);
			}
		}

		// Update the list to remove stale connections
		if (activeEdges.length !== edgeTokens.length) {
			await this.env.EDGE_TOKENS.put(key, JSON.stringify(activeEdges), {
				expirationTtl: 3600,
			});
		}

		return activeEdges;
	}

	/**
	 * Track edge worker connection with workspace mapping
	 */
	async trackEdgeConnection(
		linearToken: string,
		workspaceIds: string[],
	): Promise<void> {
		// Store the mapping of token to workspaces in KV with TTL
		const data = {
			workspaceIds,
			connectedAt: Date.now(),
			lastSeen: Date.now(),
		};

		await this.env.EDGE_TOKENS.put(
			`edge:connection:${linearToken}`,
			JSON.stringify(data),
			{ expirationTtl: 3600 }, // 1 hour TTL, refreshed on each heartbeat
		);

		// Update workspace-to-edge mapping
		for (const workspaceId of workspaceIds) {
			const key = `workspace:edges:${workspaceId}`;
			const existing = await this.env.EDGE_TOKENS.get(key);
			const edges = existing ? JSON.parse(existing) : [];

			if (!edges.includes(linearToken)) {
				edges.push(linearToken);
				await this.env.EDGE_TOKENS.put(key, JSON.stringify(edges), {
					expirationTtl: 3600,
				});
			}
		}
	}
}
