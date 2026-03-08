import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	CyrusAgentSessionRepositoryAssociation,
	IssueContext,
	IssueMinimal,
} from "./CyrusAgentSession.js";
import { createLogger, type ILogger } from "./logging/index.js";

/** Current persistence format version */
export const PERSISTENCE_VERSION = "3.0";

// Serialized versions with Date fields as strings
export type SerializedCyrusAgentSession = Omit<
	CyrusAgentSession,
	"repositoryAssociations"
> & {
	repositoryAssociations: CyrusAgentSessionRepositoryAssociation[];
};
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
 * Serializable EdgeWorker state for persistence
 */
export interface SerializableEdgeWorkerState {
	/**
	 * Explicit normalized session store keyed by session id.
	 * Prefer this over repo-keyed containers when repository identity must remain explicit.
	 */
	agentSessionsById?: Record<string, SerializedCyrusAgentSession>;
	/** Explicit normalized entry store keyed by session id. */
	agentSessionEntriesById?: Record<string, SerializedCyrusAgentSessionEntry[]>;
	// Agent Session state - keyed by repository ID, since that's how we construct AgentSessionManagers
	/**
	 * @deprecated Migration-only repo-keyed session buckets. Do not treat these as the steady-state source of truth.
	 */
	agentSessions?: Record<string, Record<string, SerializedCyrusAgentSession>>;
	/**
	 * @deprecated Migration-only repo-keyed session-entry buckets. Do not treat these as the steady-state source of truth.
	 */
	agentSessionEntries?: Record<
		string,
		Record<string, SerializedCyrusAgentSessionEntry[]>
	>;
	// Child to parent agent session mapping
	childToParentAgentSession?: Record<string, string>;
	// Issue to repository mapping (for caching user repository selections)
	/** @deprecated Migration-only cache; repository identity should come from explicit session associations. */
	issueRepositoryCache?: Record<string, string>;
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
			const normalizedState = this.normalizeSerializableState(state);
			const stateData = {
				version: PERSISTENCE_VERSION,
				savedAt: new Date().toISOString(),
				state: normalizedState,
			};
			await writeFile(stateFile, JSON.stringify(stateData, null, 2), "utf8");
		} catch (error) {
			this.logger.error("Failed to save EdgeWorker state:", error);
			throw error;
		}
	}

	/**
	 * Load EdgeWorker state from disk (single file for all repositories)
	 * Automatically migrates from v2.0 to v3.0 format if needed.
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
				this.logger.info("Migrating state from v2.0 to v3.0");
				const migratedState = this.migrateV2ToV3(stateData.state);
				// Save the migrated state
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

			return this.normalizeSerializableState(stateData.state);
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
	 * - Add externalSessionId (set to original linearAgentActivitySessionId for Linear sessions)
	 * - Add issueContext object with trackerId, issueId, issueIdentifier
	 * - issueId becomes optional (kept for backwards compatibility)
	 * - issue becomes optional
	 */
	private migrateV2ToV3(
		v2State: SerializableEdgeWorkerState,
	): SerializableEdgeWorkerState {
		const migratedState: SerializableEdgeWorkerState = {
			...v2State,
			agentSessionsById: {},
			agentSessionEntriesById: {},
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
					// Use the new id as the key
					migratedState.agentSessions![repoId][migratedSession.id] =
						migratedSession;
					migratedState.agentSessionsById![migratedSession.id] =
						migratedSession;
				}
			}
		}

		if (v2State.agentSessionEntries) {
			for (const repoEntries of Object.values(v2State.agentSessionEntries)) {
				for (const [sessionId, entries] of Object.entries(repoEntries)) {
					migratedState.agentSessionEntriesById![sessionId] = entries;
				}
			}
		}

		// agentSessionEntries keys need to be updated to use new session IDs
		// Since linearAgentActivitySessionId becomes id, the keys remain the same
		// The entries themselves don't need modification

		return this.normalizeSerializableState(migratedState);
	}

	/**
	 * Migrate a single session from v2.0 to v3.0 format
	 */
	private migrateSessionV2ToV3(
		v2Session: V2CyrusAgentSession,
		repositoryId: string,
	): SerializedCyrusAgentSession {
		// Build issueContext from v2.0 fields
		const issueContext: IssueContext = {
			trackerId: "linear", // v2.0 only supported Linear
			issueId: v2Session.issueId,
			issueIdentifier: v2Session.issue?.identifier || v2Session.issueId,
		};

		return {
			// New field: rename linearAgentActivitySessionId to id
			id: v2Session.linearAgentActivitySessionId,
			// New field: store the original Linear session ID as externalSessionId
			externalSessionId: v2Session.linearAgentActivitySessionId,
			// Preserved fields
			type: v2Session.type,
			status: v2Session.status,
			context: v2Session.context,
			createdAt: v2Session.createdAt,
			updatedAt: v2Session.updatedAt,
			workspace: v2Session.workspace,
			claudeSessionId: v2Session.claudeSessionId,
			geminiSessionId: v2Session.geminiSessionId,
			metadata: v2Session.metadata,
			// New field: structured issue context
			issueContext,
			// Kept for backwards compatibility (marked as deprecated in interface)
			issueId: v2Session.issueId,
			// Now optional
			issue: v2Session.issue,
			repositoryAssociations: [
				{
					repositoryId,
					associationOrigin: "legacy-migration",
					status: "active",
					executionWorkspace: v2Session.workspace,
				},
			],
		} as SerializedCyrusAgentSession;
	}

	private normalizeSerializableState(
		state: SerializableEdgeWorkerState,
	): SerializableEdgeWorkerState {
		return {
			...state,
			agentSessionsById: state.agentSessionsById
				? Object.fromEntries(
						Object.entries(state.agentSessionsById).map(
							([sessionId, session]) => [
								sessionId,
								this.normalizeSerializedSession(session),
							],
						),
					)
				: state.agentSessionsById,
			agentSessionEntriesById: state.agentSessionEntriesById
				? Object.fromEntries(Object.entries(state.agentSessionEntriesById))
				: state.agentSessionEntriesById,
			agentSessions: state.agentSessions
				? Object.fromEntries(
						Object.entries(state.agentSessions).map(
							([repositoryId, sessions]) => [
								repositoryId,
								Object.fromEntries(
									Object.entries(sessions).map(([sessionId, session]) => [
										sessionId,
										this.normalizeSerializedSession(session),
									]),
								),
							],
						),
					)
				: state.agentSessions,
			agentSessionEntries: state.agentSessionEntries
				? Object.fromEntries(
						Object.entries(state.agentSessionEntries).map(
							([repositoryId, entries]) => [
								repositoryId,
								Object.fromEntries(Object.entries(entries)),
							],
						),
					)
				: state.agentSessionEntries,
		};
	}

	private normalizeSerializedSession(
		session: SerializedCyrusAgentSession | CyrusAgentSession,
	): SerializedCyrusAgentSession {
		return {
			...session,
			repositoryAssociations: session.repositoryAssociations ?? [],
		};
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
