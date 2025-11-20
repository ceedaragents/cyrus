import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
} from "./CyrusAgentSession.js";

// Serialized versions with Date fields as strings
export type SerializedCyrusAgentSession = CyrusAgentSession;
// extends Omit<CyrusAgentSession, 'createdAt' | 'updatedAt'> {
//   createdAt: string
//   updatedAt: string
// }

export type SerializedCyrusAgentSessionEntry = CyrusAgentSessionEntry;
// extends Omit<CyrusAgentSessionEntry, 'metadata'> {
//   metadata?: Omit<CyrusAgentSessionEntry['metadata'], 'timestamp'> & {
//     timestamp?: string
//   }
// }

/**
 * Information about an active work session
 */
export interface ActiveWorkSession {
	/** Linear issue ID being worked on */
	issueId: string;
	/** Linear issue identifier (e.g., TEAM-123) */
	issueIdentifier: string;
	/** Repository ID handling this work */
	repositoryId: string;
	/** Linear agent session ID */
	sessionId: string;
	/** Timestamp when work started (milliseconds since epoch) */
	startedAt: number;
}

/**
 * Represents the current active work status
 */
export interface ActiveWorkStatus {
	/** Indicates if Cyrus is currently working on any issues */
	isWorking: boolean;
	/** Map of session IDs to active work sessions */
	activeSessions: Record<string, ActiveWorkSession>;
	/** Timestamp of last update (milliseconds since epoch) */
	lastUpdated: number;
}

/**
 * Serializable EdgeWorker state for persistence
 */
export interface SerializableEdgeWorkerState {
	// Agent Session state - keyed by repository ID, since that's how we construct AgentSessionManagers
	agentSessions?: Record<string, Record<string, SerializedCyrusAgentSession>>;
	agentSessionEntries?: Record<
		string,
		Record<string, SerializedCyrusAgentSessionEntry[]>
	>;
	// Child to parent agent session mapping
	childToParentAgentSession?: Record<string, string>;
	// Issue to repository mapping (for caching user repository selections)
	issueRepositoryCache?: Record<string, string>;
}

/**
 * Manages persistence of critical mappings to survive restarts
 */
export class PersistenceManager {
	private persistencePath: string;

	constructor(persistencePath?: string) {
		this.persistencePath =
			persistencePath || join(homedir(), ".cyrus", "state");
	}

	/**
	 * Get the full path to the single EdgeWorker state file
	 */
	private getEdgeWorkerStateFilePath(): string {
		return join(this.persistencePath, "edge-worker-state.json");
	}

	/**
	 * Get the full path to the active work status file
	 */
	private getActiveWorkStatusFilePath(): string {
		return join(this.persistencePath, "active-work.json");
	}

	/**
	 * Ensure the persistence directory exists
	 */
	private async ensurePersistenceDirectory(): Promise<void> {
		await mkdir(this.persistencePath, { recursive: true });
	}

	/**
	 * Save EdgeWorker state to disk (single file for all repositories)
	 */
	async saveEdgeWorkerState(state: SerializableEdgeWorkerState): Promise<void> {
		try {
			await this.ensurePersistenceDirectory();
			const stateFile = this.getEdgeWorkerStateFilePath();
			const stateData = {
				version: "2.0",
				savedAt: new Date().toISOString(),
				state,
			};
			await writeFile(stateFile, JSON.stringify(stateData, null, 2), "utf8");
		} catch (error) {
			console.error(`Failed to save EdgeWorker state:`, error);
			throw error;
		}
	}

	/**
	 * Load EdgeWorker state from disk (single file for all repositories)
	 */
	async loadEdgeWorkerState(): Promise<SerializableEdgeWorkerState | null> {
		try {
			const stateFile = this.getEdgeWorkerStateFilePath();
			if (!existsSync(stateFile)) {
				return null;
			}

			const stateData = JSON.parse(await readFile(stateFile, "utf8"));

			// Validate state structure
			if (!stateData.state || stateData.version !== "2.0") {
				console.warn(`Invalid or outdated state file, ignoring`);
				return null;
			}

			return stateData.state;
		} catch (error) {
			console.error(`Failed to load EdgeWorker state:`, error);
			return null;
		}
	}

	/**
	 * Check if EdgeWorker state file exists
	 */
	hasStateFile(): boolean {
		return existsSync(this.getEdgeWorkerStateFilePath());
	}

	/**
	 * Delete EdgeWorker state file
	 */
	async deleteStateFile(): Promise<void> {
		try {
			const stateFile = this.getEdgeWorkerStateFilePath();
			if (existsSync(stateFile)) {
				await writeFile(stateFile, "", "utf8"); // Clear file instead of deleting
			}
		} catch (error) {
			console.error(`Failed to delete EdgeWorker state file:`, error);
		}
	}

	/**
	 * Convert Map to Record for serialization
	 */
	static mapToRecord<T>(map: Map<string, T>): Record<string, T> {
		return Object.fromEntries(map.entries());
	}

	/**
	 * Convert Record to Map for deserialization
	 */
	static recordToMap<T>(record: Record<string, T>): Map<string, T> {
		return new Map(Object.entries(record));
	}

	/**
	 * Convert Set to Array for serialization
	 */
	static setToArray<T>(set: Set<T>): T[] {
		return Array.from(set);
	}

	/**
	 * Convert Array to Set for deserialization
	 */
	static arrayToSet<T>(array: T[]): Set<T> {
		return new Set(array);
	}

	/**
	 * Add an active work session
	 */
	async addActiveSession(session: ActiveWorkSession): Promise<void> {
		try {
			await this.ensurePersistenceDirectory();
			const activeWorkFile = this.getActiveWorkStatusFilePath();

			// Load current status or create new one
			const currentStatus = (await this.getActiveWorkStatus()) || {
				isWorking: false,
				activeSessions: {},
				lastUpdated: Date.now(),
			};

			// Add the new session
			currentStatus.activeSessions[session.sessionId] = session;
			currentStatus.isWorking =
				Object.keys(currentStatus.activeSessions).length > 0;
			currentStatus.lastUpdated = Date.now();

			await writeFile(
				activeWorkFile,
				JSON.stringify(currentStatus, null, 2),
				"utf8",
			);
		} catch (error) {
			console.error("Failed to add active session:", error);
			throw error;
		}
	}

	/**
	 * Remove an active work session
	 */
	async removeActiveSession(sessionId: string): Promise<void> {
		try {
			await this.ensurePersistenceDirectory();
			const activeWorkFile = this.getActiveWorkStatusFilePath();

			// Load current status
			const currentStatus = await this.getActiveWorkStatus();
			if (!currentStatus) {
				return; // Nothing to remove
			}

			// Remove the session
			delete currentStatus.activeSessions[sessionId];
			currentStatus.isWorking =
				Object.keys(currentStatus.activeSessions).length > 0;
			currentStatus.lastUpdated = Date.now();

			await writeFile(
				activeWorkFile,
				JSON.stringify(currentStatus, null, 2),
				"utf8",
			);
		} catch (error) {
			console.error("Failed to remove active session:", error);
			throw error;
		}
	}

	/**
	 * Clear all active work sessions (Cyrus is not working on anything)
	 */
	async clearActiveWork(): Promise<void> {
		try {
			await this.ensurePersistenceDirectory();
			const activeWorkFile = this.getActiveWorkStatusFilePath();
			const workStatus: ActiveWorkStatus = {
				isWorking: false,
				activeSessions: {},
				lastUpdated: Date.now(),
			};
			await writeFile(
				activeWorkFile,
				JSON.stringify(workStatus, null, 2),
				"utf8",
			);
		} catch (error) {
			console.error("Failed to clear active work status:", error);
			throw error;
		}
	}

	/**
	 * Get the current active work status
	 */
	async getActiveWorkStatus(): Promise<ActiveWorkStatus | null> {
		try {
			const activeWorkFile = this.getActiveWorkStatusFilePath();
			if (!existsSync(activeWorkFile)) {
				return null;
			}

			const statusData = JSON.parse(await readFile(activeWorkFile, "utf8"));
			return statusData as ActiveWorkStatus;
		} catch (error) {
			console.error("Failed to get active work status:", error);
			return null;
		}
	}

	/**
	 * Check if Cyrus is currently working on an issue
	 */
	async isCurrentlyWorking(): Promise<boolean> {
		const status = await this.getActiveWorkStatus();
		return status?.isWorking ?? false;
	}
}
