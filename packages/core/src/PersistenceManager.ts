import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	IssueContext,
	IssueMinimal,
} from "./CyrusAgentSession.js";
import { createLogger, type ILogger } from "./logging/index.js";

/** Current persistence format version */
export const PERSISTENCE_VERSION = "4.0";

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
 * v2.0 session format (for migration purposes)
 */
interface V2CyrusAgentSession {
	linearAgentActivitySessionId: string;
	type: string;
	status: string;
	context: string;
	createdAt: number;
	updatedAt: number;
	issueId: string;
	issue: IssueMinimal;
	workspace: {
		path: string;
		isGitWorktree: boolean;
		historyPath?: string;
	};
	claudeSessionId?: string;
	geminiSessionId?: string;
	metadata?: Record<string, unknown>;
}

/**
 * v3.0 state format (for migration purposes)
 * In v3.0, issueRepositoryCache maps issueId to a single repository ID string.
 */
interface V3SerializableEdgeWorkerState {
	agentSessions?: Record<string, Record<string, Record<string, unknown>>>;
	agentSessionEntries?: Record<
		string,
		Record<string, SerializedCyrusAgentSessionEntry[]>
	>;
	childToParentAgentSession?: Record<string, string>;
	issueRepositoryCache?: Record<string, string>;
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
	// Issue to repositories mapping (supports 0, 1, or N repositories per issue)
	issueRepositoryCache?: Record<string, string[]>;
}

/**
 * Manages persistence of critical mappings to survive restarts
 */
export class PersistenceManager {
	private persistencePath: string;
	private logger: ILogger;

	constructor(persistencePath?: string, logger?: ILogger) {
		this.persistencePath =
			persistencePath || join(homedir(), ".cyrus", "state");
		this.logger = logger ?? createLogger({ component: "PersistenceManager" });
	}

	/**
	 * Get the full path to the single EdgeWorker state file
	 */
	private getEdgeWorkerStateFilePath(): string {
		return join(this.persistencePath, "edge-worker-state.json");
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
				version: PERSISTENCE_VERSION,
				savedAt: new Date().toISOString(),
				state,
			};
			await writeFile(stateFile, JSON.stringify(stateData, null, 2), "utf8");
		} catch (error) {
			this.logger.error("Failed to save EdgeWorker state:", error);
			throw error;
		}
	}

	/**
	 * Load EdgeWorker state from disk (single file for all repositories)
	 * Automatically migrates from v2.0/v3.0 to v4.0 format if needed.
	 */
	async loadEdgeWorkerState(): Promise<SerializableEdgeWorkerState | null> {
		try {
			const stateFile = this.getEdgeWorkerStateFilePath();
			if (!existsSync(stateFile)) {
				return null;
			}

			const stateData = JSON.parse(await readFile(stateFile, "utf8"));

			// Validate state structure exists
			if (!stateData.state) {
				this.logger.warn("Invalid state file (missing state), ignoring");
				return null;
			}

			let state = stateData.state;
			let needsSave = false;

			// Handle version migration chain: v2.0 → v3.0 → v4.0
			if (stateData.version === "2.0") {
				this.logger.info("Migrating state from v2.0 → v3.0 → v4.0");
				state = this.migrateV2ToV3(state);
				state = this.migrateV3ToV4(state);
				needsSave = true;
			} else if (stateData.version === "3.0") {
				this.logger.info("Migrating state from v3.0 → v4.0");
				state = this.migrateV3ToV4(state);
				needsSave = true;
			} else if (stateData.version !== PERSISTENCE_VERSION) {
				this.logger.warn(
					`Unknown state file version ${stateData.version}, ignoring`,
				);
				return null;
			}

			if (needsSave) {
				await this.saveEdgeWorkerState(state);
				this.logger.info(
					`Migration complete, saved as v${PERSISTENCE_VERSION}`,
				);
			}

			return state;
		} catch (error) {
			this.logger.error("Failed to load EdgeWorker state:", error);
			return null;
		}
	}

	/**
	 * Migrate v2.0 state format to v3.0 format (intermediate step)
	 *
	 * Changes:
	 * - linearAgentActivitySessionId -> id
	 * - Add externalSessionId (set to original linearAgentActivitySessionId for Linear sessions)
	 * - Add issueContext object with trackerId, issueId, issueIdentifier
	 * - issueId becomes optional (kept for backwards compatibility)
	 * - issue becomes optional
	 */
	private migrateV2ToV3(
		v2State: V3SerializableEdgeWorkerState,
	): V3SerializableEdgeWorkerState {
		const migratedState: V3SerializableEdgeWorkerState = {
			...v2State,
			agentSessions: {},
		};

		// Migrate agent sessions
		if (v2State.agentSessions) {
			for (const [repoId, repoSessions] of Object.entries(
				v2State.agentSessions,
			)) {
				migratedState.agentSessions![repoId] = {};
				for (const [_sessionId, v2Session] of Object.entries(repoSessions)) {
					const session = v2Session as unknown as V2CyrusAgentSession;
					const migratedSession = this.migrateSessionV2ToV3(session, repoId);
					migratedState.agentSessions![repoId][migratedSession.id as string] =
						migratedSession as unknown as Record<string, unknown>;
				}
			}
		}

		return migratedState;
	}

	/**
	 * Migrate a single session from v2.0 to v3.0 format (intermediate)
	 */
	private migrateSessionV2ToV3(
		v2Session: V2CyrusAgentSession,
		repoId: string,
	): SerializedCyrusAgentSession {
		const issueContext: IssueContext = {
			trackerId: "linear",
			issueId: v2Session.issueId,
			issueIdentifier: v2Session.issue?.identifier || v2Session.issueId,
		};

		return {
			id: v2Session.linearAgentActivitySessionId,
			externalSessionId: v2Session.linearAgentActivitySessionId,
			type: v2Session.type,
			status: v2Session.status,
			context: v2Session.context,
			createdAt: v2Session.createdAt,
			updatedAt: v2Session.updatedAt,
			workspace: v2Session.workspace,
			claudeSessionId: v2Session.claudeSessionId,
			geminiSessionId: v2Session.geminiSessionId,
			metadata: v2Session.metadata,
			issueContext,
			issueId: v2Session.issueId,
			issue: v2Session.issue,
			repositoryIds: [repoId],
		} as SerializedCyrusAgentSession;
	}

	/**
	 * Migrate v3.0 state format to v4.0 format
	 *
	 * Changes:
	 * - issueRepositoryCache values: string → string[] (wrap single values in arrays)
	 * - Add repositoryIds field to all sessions (derived from the repo key they're stored under)
	 */
	private migrateV3ToV4(
		v3State: V3SerializableEdgeWorkerState,
	): SerializableEdgeWorkerState {
		const migratedState: SerializableEdgeWorkerState = {
			...v3State,
			agentSessions: {},
			issueRepositoryCache: {},
		};

		// Migrate issueRepositoryCache: string → string[]
		if (v3State.issueRepositoryCache) {
			for (const [issueId, repoId] of Object.entries(
				v3State.issueRepositoryCache,
			)) {
				migratedState.issueRepositoryCache![issueId] = [repoId];
			}
		}

		// Migrate agent sessions: add repositoryIds field
		if (v3State.agentSessions) {
			for (const [repoId, repoSessions] of Object.entries(
				v3State.agentSessions,
			)) {
				migratedState.agentSessions![repoId] = {};
				for (const [sessionId, session] of Object.entries(repoSessions)) {
					const v3Session = session as Record<string, unknown>;
					migratedState.agentSessions![repoId][sessionId] = {
						...v3Session,
						repositoryIds: (v3Session.repositoryIds as
							| string[]
							| undefined) ?? [repoId],
					} as SerializedCyrusAgentSession;
				}
			}
		}

		// Pass through entries unchanged
		if (v3State.agentSessionEntries) {
			migratedState.agentSessionEntries = v3State.agentSessionEntries;
		}

		return migratedState;
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
			this.logger.error("Failed to delete EdgeWorker state file:", error);
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
}
