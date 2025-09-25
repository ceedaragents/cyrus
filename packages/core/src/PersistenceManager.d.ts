import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
} from "./CyrusAgentSession.js";
export type SerializedCyrusAgentSession = CyrusAgentSession;
export type SerializedCyrusAgentSessionEntry = CyrusAgentSessionEntry;
/**
 * Serializable EdgeWorker state for persistence
 */
export interface SerializableEdgeWorkerState {
	agentSessions?: Record<string, Record<string, SerializedCyrusAgentSession>>;
	agentSessionEntries?: Record<
		string,
		Record<string, SerializedCyrusAgentSessionEntry[]>
	>;
	childToParentAgentSession?: Record<string, string>;
}
/**
 * Manages persistence of critical mappings to survive restarts
 */
export declare class PersistenceManager {
	private persistencePath;
	constructor(persistencePath?: string);
	/**
	 * Get the full path to the single EdgeWorker state file
	 */
	private getEdgeWorkerStateFilePath;
	/**
	 * Ensure the persistence directory exists
	 */
	private ensurePersistenceDirectory;
	/**
	 * Save EdgeWorker state to disk (single file for all repositories)
	 */
	saveEdgeWorkerState(state: SerializableEdgeWorkerState): Promise<void>;
	/**
	 * Load EdgeWorker state from disk (single file for all repositories)
	 */
	loadEdgeWorkerState(): Promise<SerializableEdgeWorkerState | null>;
	/**
	 * Check if EdgeWorker state file exists
	 */
	hasStateFile(): boolean;
	/**
	 * Delete EdgeWorker state file
	 */
	deleteStateFile(): Promise<void>;
	/**
	 * Convert Map to Record for serialization
	 */
	static mapToRecord<T>(map: Map<string, T>): Record<string, T>;
	/**
	 * Convert Record to Map for deserialization
	 */
	static recordToMap<T>(record: Record<string, T>): Map<string, T>;
	/**
	 * Convert Set to Array for serialization
	 */
	static setToArray<T>(set: Set<T>): T[];
	/**
	 * Convert Array to Set for deserialization
	 */
	static arrayToSet<T>(array: T[]): Set<T>;
}
//# sourceMappingURL=PersistenceManager.d.ts.map
