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
export const PERSISTENCE_VERSION = "4.0";

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
	// Child to parent agent session mapping
	childToParentAgentSession?: Record<string, string>;
	/**
	 * Explicit issue-scoped repository associations derived from routing/selection state.
	 * This replaces the legacy singular issue-to-repository cache.
	 */
	issueRepositoryAssociationsByIssueId?: Record<
		string,
		CyrusAgentSessionRepositoryAssociation[]
	>;
}

interface LegacySerializableEdgeWorkerState
	extends SerializableEdgeWorkerState {
	/** @deprecated Migration-only repo-keyed session buckets. */
	agentSessions?: Record<string, Record<string, SerializedCyrusAgentSession>>;
	/** @deprecated Migration-only repo-keyed session-entry buckets. */
	agentSessionEntries?: Record<
		string,
		Record<string, SerializedCyrusAgentSessionEntry[]>
	>;
	/** @deprecated Migration-only singular issue cache. */
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
	 * Automatically migrates legacy formats into the latest normalized format.
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
			if (stateData.version === "2.0" || stateData.version === "3.0") {
				this.logger.info(
					`Migrating state from v${stateData.version} to v${PERSISTENCE_VERSION}`,
				);
				const migratedState = this.migrateLegacyStateToLatest(
					stateData.state as LegacySerializableEdgeWorkerState,
				);
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

			return this.normalizeSerializableState(
				stateData.state as SerializableEdgeWorkerState,
			);
		} catch (error) {
			this.logger.error("Failed to load EdgeWorker state:", error);
			return null;
		}
	}

	/**
	 * Migrate legacy persisted state into the latest normalized format.
	 */
	private migrateLegacyStateToLatest(
		legacyState: LegacySerializableEdgeWorkerState,
	): SerializableEdgeWorkerState {
		const migratedState: SerializableEdgeWorkerState = {
			agentSessionsById: {},
			agentSessionEntriesById: {},
			childToParentAgentSession: legacyState.childToParentAgentSession
				? { ...legacyState.childToParentAgentSession }
				: undefined,
			issueRepositoryAssociationsByIssueId:
				legacyState.issueRepositoryAssociationsByIssueId
					? this.normalizeIssueRepositoryAssociations(
							legacyState.issueRepositoryAssociationsByIssueId,
						)
					: undefined,
		};

		if (legacyState.agentSessionsById) {
			for (const [sessionId, session] of Object.entries(
				legacyState.agentSessionsById,
			)) {
				migratedState.agentSessionsById![sessionId] =
					this.normalizeSerializedSession(session);
			}
		}

		if (legacyState.agentSessionEntriesById) {
			for (const [sessionId, entries] of Object.entries(
				legacyState.agentSessionEntriesById,
			)) {
				migratedState.agentSessionEntriesById![sessionId] = [...entries];
			}
		}

		if (legacyState.agentSessions) {
			for (const [repoId, repoSessions] of Object.entries(
				legacyState.agentSessions,
			)) {
				for (const [sessionId, repoSession] of Object.entries(repoSessions)) {
					const migratedSession = this.migrateLegacySessionToLatest(
						repoSession,
						repoId,
						sessionId,
					);
					const existingSession =
						migratedState.agentSessionsById![migratedSession.id];
					migratedState.agentSessionsById![migratedSession.id] =
						this.mergeSerializedSessions(existingSession, migratedSession);
				}
			}
		}

		if (legacyState.agentSessionEntries) {
			for (const repoEntries of Object.values(
				legacyState.agentSessionEntries,
			)) {
				for (const [sessionId, entries] of Object.entries(repoEntries)) {
					migratedState.agentSessionEntriesById![sessionId] =
						this.mergeSerializedEntries(
							migratedState.agentSessionEntriesById![sessionId],
							entries,
						);
				}
			}
		}

		if (legacyState.issueRepositoryCache) {
			for (const [issueId, repositoryId] of Object.entries(
				legacyState.issueRepositoryCache,
			)) {
				const issueAssociation = this.createRepositoryAssociation(
					repositoryId,
					{
						associationOrigin: "legacy-migration",
						status: "selected",
					},
				);

				const existingIssueAssociations =
					migratedState.issueRepositoryAssociationsByIssueId?.[issueId] ?? [];
				if (!migratedState.issueRepositoryAssociationsByIssueId) {
					migratedState.issueRepositoryAssociationsByIssueId = {};
				}
				migratedState.issueRepositoryAssociationsByIssueId[issueId] =
					this.mergeRepositoryAssociations(existingIssueAssociations, [
						issueAssociation,
					]);

				for (const [sessionId, session] of Object.entries(
					migratedState.agentSessionsById!,
				)) {
					if (this.getSessionIssueId(session) !== issueId) {
						continue;
					}

					migratedState.agentSessionsById![sessionId] =
						this.ensureSessionAssociation(session, issueAssociation);
				}
			}
		}

		return this.normalizeSerializableState(migratedState);
	}

	/**
	 * Migrate a single session from v2.0 to v3.0 format
	 */
	private migrateLegacySessionToLatest(
		legacySession: SerializedCyrusAgentSession | V2CyrusAgentSession,
		repositoryId: string,
		fallbackSessionId?: string,
	): SerializedCyrusAgentSession {
		if ("linearAgentActivitySessionId" in legacySession) {
			return this.migrateSessionV2ToLatest(legacySession, repositoryId);
		}

		const normalizedSession = this.normalizeSerializedSession({
			...legacySession,
			id:
				legacySession.id ||
				fallbackSessionId ||
				legacySession.externalSessionId!,
		});

		if (
			normalizedSession.repositoryAssociations.some(
				(association) => association.repositoryId === repositoryId,
			)
		) {
			return normalizedSession;
		}

		return this.ensureSessionAssociation(
			normalizedSession,
			this.createRepositoryAssociation(repositoryId, {
				executionWorkspace: normalizedSession.workspace,
			}),
		);
	}

	/**
	 * Migrate a single session from v2.0 to the latest format
	 */
	private migrateSessionV2ToLatest(
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
				this.createRepositoryAssociation(repositoryId, {
					executionWorkspace: v2Session.workspace,
				}),
			],
		} as SerializedCyrusAgentSession;
	}

	private normalizeSerializableState(
		state: SerializableEdgeWorkerState,
	): SerializableEdgeWorkerState {
		return {
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
			childToParentAgentSession: state.childToParentAgentSession
				? Object.fromEntries(Object.entries(state.childToParentAgentSession))
				: state.childToParentAgentSession,
			issueRepositoryAssociationsByIssueId:
				state.issueRepositoryAssociationsByIssueId
					? this.normalizeIssueRepositoryAssociations(
							state.issueRepositoryAssociationsByIssueId,
						)
					: state.issueRepositoryAssociationsByIssueId,
		};
	}

	private normalizeSerializedSession(
		session: SerializedCyrusAgentSession | CyrusAgentSession,
	): SerializedCyrusAgentSession {
		return {
			...session,
			repositoryAssociations: this.mergeRepositoryAssociations(
				[],
				session.repositoryAssociations ?? [],
			),
		};
	}

	private normalizeIssueRepositoryAssociations(
		issueAssociations: Record<string, CyrusAgentSessionRepositoryAssociation[]>,
	): Record<string, CyrusAgentSessionRepositoryAssociation[]> {
		return Object.fromEntries(
			Object.entries(issueAssociations).map(([issueId, associations]) => [
				issueId,
				this.mergeRepositoryAssociations([], associations ?? []),
			]),
		);
	}

	private mergeSerializedSessions(
		existingSession: SerializedCyrusAgentSession | undefined,
		incomingSession: SerializedCyrusAgentSession,
	): SerializedCyrusAgentSession {
		if (!existingSession) {
			return this.normalizeSerializedSession(incomingSession);
		}

		return this.normalizeSerializedSession({
			id: existingSession.id || incomingSession.id,
			externalSessionId:
				existingSession.externalSessionId ?? incomingSession.externalSessionId,
			type: existingSession.type ?? incomingSession.type,
			status: existingSession.status ?? incomingSession.status,
			context: existingSession.context ?? incomingSession.context,
			createdAt: Math.min(existingSession.createdAt, incomingSession.createdAt),
			updatedAt: Math.max(existingSession.updatedAt, incomingSession.updatedAt),
			issueContext:
				existingSession.issueContext ?? incomingSession.issueContext,
			issueId: existingSession.issueId ?? incomingSession.issueId,
			issue: existingSession.issue ?? incomingSession.issue,
			workspace: existingSession.workspace ?? incomingSession.workspace,
			claudeSessionId:
				existingSession.claudeSessionId ?? incomingSession.claudeSessionId,
			geminiSessionId:
				existingSession.geminiSessionId ?? incomingSession.geminiSessionId,
			codexSessionId:
				existingSession.codexSessionId ?? incomingSession.codexSessionId,
			cursorSessionId:
				existingSession.cursorSessionId ?? incomingSession.cursorSessionId,
			metadata: existingSession.metadata ?? incomingSession.metadata,
			repositoryAssociations: this.mergeRepositoryAssociations(
				existingSession.repositoryAssociations,
				incomingSession.repositoryAssociations,
			),
		});
	}

	private mergeSerializedEntries(
		existingEntries: SerializedCyrusAgentSessionEntry[] | undefined,
		incomingEntries: SerializedCyrusAgentSessionEntry[],
	): SerializedCyrusAgentSessionEntry[] {
		if (!existingEntries) {
			return [...incomingEntries];
		}

		if (incomingEntries.length > existingEntries.length) {
			return [...incomingEntries];
		}

		return [...existingEntries];
	}

	private mergeRepositoryAssociations(
		existingAssociations: CyrusAgentSessionRepositoryAssociation[] = [],
		incomingAssociations: CyrusAgentSessionRepositoryAssociation[] = [],
	): CyrusAgentSessionRepositoryAssociation[] {
		const mergedAssociations = new Map<
			string,
			CyrusAgentSessionRepositoryAssociation
		>();

		for (const association of [
			...existingAssociations,
			...incomingAssociations,
		]) {
			const existingAssociation = mergedAssociations.get(
				association.repositoryId,
			);
			if (!existingAssociation) {
				mergedAssociations.set(association.repositoryId, { ...association });
				continue;
			}

			mergedAssociations.set(
				association.repositoryId,
				this.mergeRepositoryAssociation(existingAssociation, association),
			);
		}

		return Array.from(mergedAssociations.values());
	}

	private mergeRepositoryAssociation(
		existingAssociation: CyrusAgentSessionRepositoryAssociation,
		incomingAssociation: CyrusAgentSessionRepositoryAssociation,
	): CyrusAgentSessionRepositoryAssociation {
		const statusPriority: Record<
			CyrusAgentSessionRepositoryAssociation["status"],
			number
		> = {
			candidate: 0,
			selected: 1,
			active: 2,
			complete: 3,
		};

		const preferredStatus =
			statusPriority[incomingAssociation.status] >
			statusPriority[existingAssociation.status]
				? incomingAssociation.status
				: existingAssociation.status;

		const linearWorkspaceId =
			existingAssociation.linearWorkspaceId ??
			incomingAssociation.linearWorkspaceId;
		const executionWorkspace =
			existingAssociation.executionWorkspace ??
			incomingAssociation.executionWorkspace;

		return {
			...existingAssociation,
			...(linearWorkspaceId ? { linearWorkspaceId } : {}),
			associationOrigin:
				existingAssociation.associationOrigin === "legacy-migration" &&
				incomingAssociation.associationOrigin !== "legacy-migration"
					? incomingAssociation.associationOrigin
					: existingAssociation.associationOrigin,
			status: preferredStatus,
			...(executionWorkspace ? { executionWorkspace } : {}),
		};
	}

	private ensureSessionAssociation(
		session: SerializedCyrusAgentSession,
		association: CyrusAgentSessionRepositoryAssociation,
	): SerializedCyrusAgentSession {
		return this.normalizeSerializedSession({
			...session,
			repositoryAssociations: this.mergeRepositoryAssociations(
				session.repositoryAssociations,
				[association],
			),
		});
	}

	private createRepositoryAssociation(
		repositoryId: string,
		overrides: Partial<CyrusAgentSessionRepositoryAssociation> = {},
	): CyrusAgentSessionRepositoryAssociation {
		return {
			repositoryId,
			associationOrigin: "legacy-migration",
			status: "active",
			...overrides,
		};
	}

	private getSessionIssueId(
		session: SerializedCyrusAgentSession,
	): string | undefined {
		return session.issueContext?.issueId ?? session.issueId;
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
