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

export type SerializedCyrusAgentSessionEntry = CyrusAgentSessionEntry;

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
 * v3.0 session format (for migration purposes)
 * Sessions were keyed by repository ID, without repositoryIds on the session.
 */
interface V3SerializableEdgeWorkerState {
	agentSessions?: Record<string, Record<string, V3CyrusAgentSession>>;
	agentSessionEntries?: Record<
		string,
		Record<string, SerializedCyrusAgentSessionEntry[]>
	>;
	childToParentAgentSession?: Record<string, string>;
	issueRepositoryCache?: Record<string, string>;
}

interface V3CyrusAgentSession {
	id: string;
	externalSessionId?: string;
	type: string;
	status: string;
	context: string;
	createdAt: number;
	updatedAt: number;
	issueContext?: IssueContext;
	issueId?: string;
	issue?: IssueMinimal;
	workspace: {
		path: string;
		isGitWorktree: boolean;
		historyPath?: string;
	};
	claudeSessionId?: string;
	geminiSessionId?: string;
	codexSessionId?: string;
	cursorSessionId?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Serializable EdgeWorker state for persistence (v4.0)
 *
 * Sessions are stored in a flat map keyed by session ID.
 * Each session carries its own repositoryIds[] (0, 1, or N repos).
 * The per-repository keying from v3.0 is gone.
 */
export interface SerializableEdgeWorkerState {
	/** Agent sessions keyed by session ID */
	agentSessions?: Record<string, SerializedCyrusAgentSession>;
	/** Agent session entries keyed by session ID */
	agentSessionEntries?: Record<string, SerializedCyrusAgentSessionEntry[]>;
	/** Child to parent agent session mapping */
	childToParentAgentSession?: Record<string, string>;
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
	 * Save EdgeWorker state to disk (single file for all sessions)
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
	 * Load EdgeWorker state from disk.
	 * Automatically migrates from v2.0 or v3.0 to v4.0 format if needed.
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

			// Handle version migration
			if (stateData.version === "2.0") {
				this.logger.info("Migrating state from v2.0 to v4.0");
				const v3State = this.migrateV2ToV3(stateData.state);
				const migratedState = this.migrateV3ToV4(v3State);
				await this.saveEdgeWorkerState(migratedState);
				this.logger.info(
					`Migration complete, saved as v${PERSISTENCE_VERSION}`,
				);
				return migratedState;
			}

			if (stateData.version === "3.0") {
				this.logger.info("Migrating state from v3.0 to v4.0");
				const migratedState = this.migrateV3ToV4(stateData.state);
				await this.saveEdgeWorkerState(migratedState);
				this.logger.info(
					`Migration complete, saved as v${PERSISTENCE_VERSION}`,
				);
				return migratedState;
			}

			if (stateData.version !== PERSISTENCE_VERSION) {
				this.logger.warn(
					`Unknown state file version ${stateData.version}, ignoring`,
				);
				return null;
			}

			return stateData.state;
		} catch (error) {
			this.logger.error("Failed to load EdgeWorker state:", error);
			return null;
		}
	}

	/**
	 * Migrate v2.0 state format to v3.0 format
	 *
	 * Changes:
	 * - linearAgentActivitySessionId -> id
	 * - Add externalSessionId
	 * - Add issueContext
	 */
	private migrateV2ToV3(
		v2State: V3SerializableEdgeWorkerState,
	): V3SerializableEdgeWorkerState {
		const migratedState: V3SerializableEdgeWorkerState = {
			...v2State,
			agentSessions: {},
		};

		if (v2State.agentSessions) {
			for (const [repoId, repoSessions] of Object.entries(
				v2State.agentSessions,
			)) {
				migratedState.agentSessions![repoId] = {};
				for (const [_sessionId, v2Session] of Object.entries(repoSessions)) {
					const session = v2Session as unknown as V2CyrusAgentSession;
					const migratedSession = this.migrateSessionV2ToV3(session);
					migratedState.agentSessions![repoId][migratedSession.id] =
						migratedSession;
				}
			}
		}

		return migratedState;
	}

	/**
	 * Migrate a single session from v2.0 to v3.0 format
	 */
	private migrateSessionV2ToV3(
		v2Session: V2CyrusAgentSession,
	): V3CyrusAgentSession {
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
		};
	}

	/**
	 * Migrate v3.0 state format to v4.0 format
	 *
	 * Changes:
	 * - Sessions are flattened from per-repository nesting to flat map
	 * - Each session gets repositoryIds[] populated from its former repo key
	 * - issueRepositoryCache is removed (repo association lives on session)
	 * - issueId deprecated field is removed
	 */
	private migrateV3ToV4(
		v3State: V3SerializableEdgeWorkerState,
	): SerializableEdgeWorkerState {
		const migratedState: SerializableEdgeWorkerState = {
			agentSessions: {},
			agentSessionEntries: {},
			childToParentAgentSession: v3State.childToParentAgentSession,
		};

		// Flatten per-repository sessions into flat map, adding repositoryIds
		if (v3State.agentSessions) {
			for (const [repoId, repoSessions] of Object.entries(
				v3State.agentSessions,
			)) {
				for (const [sessionId, v3Session] of Object.entries(repoSessions)) {
					migratedState.agentSessions![sessionId] = {
						...v3Session,
						repositoryIds: [repoId],
					} as SerializedCyrusAgentSession;
				}
			}
		}

		// Flatten per-repository entries into flat map
		if (v3State.agentSessionEntries) {
			for (const [_repoId, repoEntries] of Object.entries(
				v3State.agentSessionEntries,
			)) {
				for (const [sessionId, entries] of Object.entries(repoEntries)) {
					migratedState.agentSessionEntries![sessionId] = entries;
				}
			}
		}

		// issueRepositoryCache is intentionally not migrated — repo association
		// now lives on each session's repositoryIds field

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
				await writeFile(stateFile, "", "utf8");
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
