import type { Env } from "../types";
import { generateSecureSecret } from "../utils/crypto.js";

export interface EdgeWorkerRegistration {
	webhookUrl: string;
	linearToken: string;
	name: string;
	capabilities: string[];
}

export interface StoredEdgeWorker {
	webhookUrl: string;
	name: string;
	capabilities: string[];
	workspaceIds: string[];
	webhookSecret: string;
	registeredAt: number;
	lastSeen: number;
}

/**
 * Manages edge worker webhook registrations
 */
export class EdgeWorkerRegistry {
	constructor(private env: Env) {}

	/**
	 * Register an edge worker with webhook endpoint
	 */
	async registerEdgeWorker(
		registration: EdgeWorkerRegistration,
	): Promise<{ webhookSecret: string }> {
		// Validate Linear token and get workspace access
		const workspaceIds = await this.validateLinearToken(
			registration.linearToken,
		);

		if (!workspaceIds || workspaceIds.length === 0) {
			throw new Error("Authentication required, not authenticated");
		}

		// Generate webhook secret for this edge worker
		const webhookSecret = generateSecureSecret();

		const edgeWorker: StoredEdgeWorker = {
			webhookUrl: registration.webhookUrl,
			name: registration.name,
			capabilities: registration.capabilities,
			workspaceIds,
			webhookSecret,
			registeredAt: Date.now(),
			lastSeen: Date.now(),
		};

		// Store edge worker data
		const edgeWorkerId = this.generateEdgeWorkerId(registration.linearToken);
		await this.env.EDGE_TOKENS.put(
			`edge:worker:${edgeWorkerId}`,
			JSON.stringify(edgeWorker),
			{ expirationTtl: 7776000 }, // 90 days TTL, refreshed on activity
		);

		// Update workspace-to-edge mapping
		for (const workspaceId of workspaceIds) {
			await this.addEdgeWorkerToWorkspace(workspaceId, edgeWorkerId);
		}

		console.log(
			`Registered edge worker ${registration.name} for ${workspaceIds.length} workspace(s)`,
		);
		return { webhookSecret };
	}

	/**
	 * Get all edge workers for a workspace
	 */
	async getEdgeWorkersForWorkspace(
		workspaceId: string,
	): Promise<StoredEdgeWorker[]> {
		const key = `workspace:edges:${workspaceId}`;
		const data = await this.env.EDGE_TOKENS.get(key);

		if (!data) return [];

		const edgeWorkerIds: string[] = JSON.parse(data);
		const edgeWorkers: StoredEdgeWorker[] = [];

		// Fetch each edge worker and verify it's still active
		for (const edgeWorkerId of edgeWorkerIds) {
			const workerData = await this.env.EDGE_TOKENS.get(
				`edge:worker:${edgeWorkerId}`,
			);
			if (workerData) {
				edgeWorkers.push(JSON.parse(workerData));
			}
		}

		return edgeWorkers;
	}

	/**
	 * Update last seen timestamp for edge worker
	 */
	async updateLastSeen(edgeWorkerId: string): Promise<void> {
		const workerData = await this.env.EDGE_TOKENS.get(
			`edge:worker:${edgeWorkerId}`,
		);
		if (workerData) {
			const edgeWorker: StoredEdgeWorker = JSON.parse(workerData);
			edgeWorker.lastSeen = Date.now();

			await this.env.EDGE_TOKENS.put(
				`edge:worker:${edgeWorkerId}`,
				JSON.stringify(edgeWorker),
				{ expirationTtl: 7776000 },
			);
		}
	}

	/**
	 * Remove edge worker registration
	 */
	async unregisterEdgeWorker(edgeWorkerId: string): Promise<void> {
		const workerData = await this.env.EDGE_TOKENS.get(
			`edge:worker:${edgeWorkerId}`,
		);
		if (workerData) {
			const edgeWorker: StoredEdgeWorker = JSON.parse(workerData);

			// Remove from workspace mappings
			for (const workspaceId of edgeWorker.workspaceIds) {
				await this.removeEdgeWorkerFromWorkspace(workspaceId, edgeWorkerId);
			}

			// Remove edge worker data
			await this.env.EDGE_TOKENS.delete(`edge:worker:${edgeWorkerId}`);
		}
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
	 * Generate deterministic edge worker ID from Linear token
	 */
	private generateEdgeWorkerId(linearToken: string): string {
		// Use a portion of the token as ID (first 20 chars should be unique enough)
		return linearToken.substring(0, 20);
	}

	/**
	 * Add edge worker to workspace mapping
	 */
	private async addEdgeWorkerToWorkspace(
		workspaceId: string,
		edgeWorkerId: string,
	): Promise<void> {
		const key = `workspace:edges:${workspaceId}`;
		const existing = await this.env.EDGE_TOKENS.get(key);
		const edges = existing ? JSON.parse(existing) : [];

		if (!edges.includes(edgeWorkerId)) {
			edges.push(edgeWorkerId);
			await this.env.EDGE_TOKENS.put(key, JSON.stringify(edges), {
				expirationTtl: 7776000,
			});
		}
	}

	/**
	 * Remove edge worker from workspace mapping
	 */
	private async removeEdgeWorkerFromWorkspace(
		workspaceId: string,
		edgeWorkerId: string,
	): Promise<void> {
		const key = `workspace:edges:${workspaceId}`;
		const existing = await this.env.EDGE_TOKENS.get(key);

		if (existing) {
			const edges: string[] = JSON.parse(existing);
			const filteredEdges = edges.filter((id) => id !== edgeWorkerId);

			if (filteredEdges.length > 0) {
				await this.env.EDGE_TOKENS.put(key, JSON.stringify(filteredEdges), {
					expirationTtl: 7776000,
				});
			} else {
				await this.env.EDGE_TOKENS.delete(key);
			}
		}
	}
}
