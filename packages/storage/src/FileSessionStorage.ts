import { existsSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	unlink,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	Message,
	SessionFilters,
	SessionState,
	SessionStatus,
	SessionStorage,
} from "cyrus-interfaces";

/**
 * File-based implementation of SessionStorage interface.
 * Stores session data as JSON files in a structured directory layout.
 *
 * Directory structure: <baseDir>/<issueId>/session-<sessionId>.json
 * Metadata file: <baseDir>/<issueId>/metadata.json
 */
export class FileSessionStorage implements SessionStorage {
	private readonly baseDir: string;

	/**
	 * Create a new FileSessionStorage instance
	 *
	 * @param baseDir - Base directory for storage (default: ~/.cyrus/sessions)
	 */
	constructor(baseDir?: string) {
		this.baseDir = baseDir || join(homedir(), ".cyrus", "sessions");
	}

	/**
	 * Ensure a directory exists, creating it if necessary
	 */
	private async ensureDirectory(path: string): Promise<void> {
		if (!existsSync(path)) {
			await mkdir(path, { recursive: true });
		}
	}

	/**
	 * Get the directory path for an issue
	 */
	private getIssueDir(issueId: string): string {
		return join(this.baseDir, issueId);
	}

	/**
	 * Get the file path for a session
	 */
	private getSessionPath(issueId: string, sessionId: string): string {
		return join(this.getIssueDir(issueId), `session-${sessionId}.json`);
	}

	/**
	 * Get the metadata file path for an issue
	 */
	private getMetadataPath(issueId: string): string {
		return join(this.getIssueDir(issueId), "metadata.json");
	}

	/**
	 * Perform an atomic write operation using temp file + rename
	 */
	private async atomicWrite(filePath: string, data: string): Promise<void> {
		const tempPath = `${filePath}.tmp`;
		const dir = dirname(filePath);

		await this.ensureDirectory(dir);

		try {
			// Write to temp file
			await writeFile(tempPath, data, "utf8");

			// Atomic rename
			await writeFile(filePath, data, "utf8");

			// Clean up temp file if it still exists
			if (existsSync(tempPath)) {
				await unlink(tempPath);
			}
		} catch (error) {
			// Clean up temp file on error
			if (existsSync(tempPath)) {
				try {
					await unlink(tempPath);
				} catch {
					// Ignore cleanup errors
				}
			}
			throw error;
		}
	}

	/**
	 * Serialize a session state to JSON string
	 */
	private serializeSession(session: SessionState): string {
		return JSON.stringify(
			{
				...session,
				startedAt: session.startedAt.toISOString(),
				endedAt: session.endedAt?.toISOString(),
				messages: session.messages.map((msg) => ({
					...msg,
					timestamp: msg.timestamp.toISOString(),
				})),
			},
			null,
			2,
		);
	}

	/**
	 * Deserialize a session state from JSON string
	 */
	private deserializeSession(data: string): SessionState {
		const parsed = JSON.parse(data);
		return {
			...parsed,
			startedAt: new Date(parsed.startedAt),
			endedAt: parsed.endedAt ? new Date(parsed.endedAt) : undefined,
			messages: parsed.messages.map((msg: any) => ({
				...msg,
				timestamp: new Date(msg.timestamp),
			})),
		};
	}

	/**
	 * Update metadata index for an issue
	 */
	private async updateMetadata(session: SessionState): Promise<void> {
		const metadataPath = this.getMetadataPath(session.issueId);

		let metadata: Record<string, any> = {};

		// Load existing metadata if it exists
		if (existsSync(metadataPath)) {
			try {
				const data = await readFile(metadataPath, "utf8");
				metadata = JSON.parse(data);
			} catch (_error) {
				// If metadata is corrupted, start fresh
				console.warn(
					`Corrupted metadata file for issue ${session.issueId}, recreating`,
				);
				metadata = {};
			}
		}

		// Update metadata for this session
		metadata[session.id] = {
			id: session.id,
			issueId: session.issueId,
			agentSessionId: session.agentSessionId,
			status: session.status,
			startedAt: session.startedAt.toISOString(),
			endedAt: session.endedAt?.toISOString(),
			turns: session.turns,
		};

		await this.atomicWrite(metadataPath, JSON.stringify(metadata, null, 2));
	}

	/**
	 * Remove a session from metadata index
	 */
	private async removeFromMetadata(
		issueId: string,
		sessionId: string,
	): Promise<void> {
		const metadataPath = this.getMetadataPath(issueId);

		if (!existsSync(metadataPath)) {
			return;
		}

		try {
			const data = await readFile(metadataPath, "utf8");
			const metadata = JSON.parse(data);

			delete metadata[sessionId];

			// If no sessions left, remove the metadata file
			if (Object.keys(metadata).length === 0) {
				await unlink(metadataPath);
			} else {
				await this.atomicWrite(metadataPath, JSON.stringify(metadata, null, 2));
			}
		} catch (error) {
			// If metadata doesn't exist or is corrupted, that's okay
			console.warn(`Failed to update metadata for issue ${issueId}:`, error);
		}
	}

	/**
	 * Find the issueId for a given sessionId by scanning all issue directories
	 */
	private async findIssueIdForSession(
		sessionId: string,
	): Promise<string | null> {
		if (!existsSync(this.baseDir)) {
			return null;
		}

		try {
			const issues = await readdir(this.baseDir);

			for (const issueId of issues) {
				const sessionPath = this.getSessionPath(issueId, sessionId);
				if (existsSync(sessionPath)) {
					return issueId;
				}
			}

			return null;
		} catch (error) {
			console.error(`Error finding issueId for session ${sessionId}:`, error);
			return null;
		}
	}

	/**
	 * Save or update a session state
	 */
	async saveSession(session: SessionState): Promise<void> {
		try {
			const sessionPath = this.getSessionPath(session.issueId, session.id);
			const serialized = this.serializeSession(session);

			await this.atomicWrite(sessionPath, serialized);
			await this.updateMetadata(session);
		} catch (error) {
			console.error(`Failed to save session ${session.id}:`, error);
			throw new Error(`Failed to save session: ${error}`);
		}
	}

	/**
	 * Load a session state by ID
	 */
	async loadSession(sessionId: string): Promise<SessionState | null> {
		try {
			// Find which issue directory contains this session
			const issueId = await this.findIssueIdForSession(sessionId);

			if (!issueId) {
				return null;
			}

			const sessionPath = this.getSessionPath(issueId, sessionId);

			if (!existsSync(sessionPath)) {
				return null;
			}

			const data = await readFile(sessionPath, "utf8");
			return this.deserializeSession(data);
		} catch (error) {
			console.error(`Failed to load session ${sessionId}:`, error);
			return null;
		}
	}

	/**
	 * List all sessions for a specific issue
	 */
	async listSessions(issueId: string): Promise<SessionState[]> {
		const issueDir = this.getIssueDir(issueId);

		if (!existsSync(issueDir)) {
			return [];
		}

		try {
			const files = await readdir(issueDir);
			const sessionFiles = files.filter(
				(f) => f.startsWith("session-") && f.endsWith(".json"),
			);

			const sessions: SessionState[] = [];

			for (const file of sessionFiles) {
				try {
					const data = await readFile(join(issueDir, file), "utf8");
					sessions.push(this.deserializeSession(data));
				} catch (error) {
					console.warn(`Failed to load session file ${file}:`, error);
				}
			}

			return sessions;
		} catch (error) {
			console.error(`Failed to list sessions for issue ${issueId}:`, error);
			return [];
		}
	}

	/**
	 * Query sessions with filters
	 */
	async querySessions(filters: SessionFilters): Promise<SessionState[]> {
		let sessions: SessionState[] = [];

		// If issueId filter is provided, only load sessions for that issue
		if (filters.issueId) {
			sessions = await this.listSessions(filters.issueId);
		} else {
			// Load all sessions from all issues
			if (!existsSync(this.baseDir)) {
				return [];
			}

			try {
				const issues = await readdir(this.baseDir);

				for (const issueId of issues) {
					const issueSessions = await this.listSessions(issueId);
					sessions.push(...issueSessions);
				}
			} catch (error) {
				console.error(`Failed to query sessions:`, error);
				return [];
			}
		}

		// Apply filters
		let filtered = sessions;

		// Status filter
		if (filters.status) {
			const statuses = Array.isArray(filters.status)
				? filters.status
				: [filters.status];
			filtered = filtered.filter((s) => statuses.includes(s.status));
		}

		// Date range filters
		if (filters.startedAfter) {
			filtered = filtered.filter((s) => s.startedAt >= filters.startedAfter!);
		}

		if (filters.startedBefore) {
			filtered = filtered.filter((s) => s.startedAt <= filters.startedBefore!);
		}

		if (filters.endedAfter) {
			filtered = filtered.filter(
				(s) => s.endedAt && s.endedAt >= filters.endedAfter!,
			);
		}

		if (filters.endedBefore) {
			filtered = filtered.filter(
				(s) => s.endedAt && s.endedAt <= filters.endedBefore!,
			);
		}

		// Sorting
		const sortBy = filters.sortBy || "startedAt";
		const sortOrder = filters.sortOrder || "desc";

		filtered.sort((a, b) => {
			const aValue =
				sortBy === "startedAt" ? a.startedAt : a.endedAt || new Date(0);
			const bValue =
				sortBy === "startedAt" ? b.startedAt : b.endedAt || new Date(0);

			return sortOrder === "asc"
				? aValue.getTime() - bValue.getTime()
				: bValue.getTime() - aValue.getTime();
		});

		// Pagination
		const offset = filters.offset || 0;
		const limit = filters.limit || filtered.length;

		return filtered.slice(offset, offset + limit);
	}

	/**
	 * Delete a session by ID
	 */
	async deleteSession(sessionId: string): Promise<void> {
		try {
			// Find which issue directory contains this session
			const issueId = await this.findIssueIdForSession(sessionId);

			if (!issueId) {
				throw new Error(`Session ${sessionId} not found`);
			}

			const sessionPath = this.getSessionPath(issueId, sessionId);

			if (!existsSync(sessionPath)) {
				throw new Error(`Session ${sessionId} not found`);
			}

			// Remove the session file
			await unlink(sessionPath);

			// Update metadata
			await this.removeFromMetadata(issueId, sessionId);

			// Check if issue directory is now empty and remove it
			const issueDir = this.getIssueDir(issueId);
			const files = await readdir(issueDir);

			if (files.length === 0) {
				await rm(issueDir, { recursive: true });
			}
		} catch (error) {
			console.error(`Failed to delete session ${sessionId}:`, error);
			throw new Error(`Failed to delete session: ${error}`);
		}
	}

	/**
	 * Check if a session exists
	 */
	async sessionExists(sessionId: string): Promise<boolean> {
		const issueId = await this.findIssueIdForSession(sessionId);

		if (!issueId) {
			return false;
		}

		const sessionPath = this.getSessionPath(issueId, sessionId);
		return existsSync(sessionPath);
	}

	/**
	 * Add a message to an existing session
	 */
	async addMessage(sessionId: string, message: Message): Promise<void> {
		try {
			const session = await this.loadSession(sessionId);

			if (!session) {
				throw new Error(`Session ${sessionId} not found`);
			}

			session.messages.push(message);

			await this.saveSession(session);
		} catch (error) {
			console.error(`Failed to add message to session ${sessionId}:`, error);
			throw new Error(`Failed to add message: ${error}`);
		}
	}

	/**
	 * Update session status
	 */
	async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
		try {
			const session = await this.loadSession(sessionId);

			if (!session) {
				throw new Error(`Session ${sessionId} not found`);
			}

			session.status = status;

			// If marking as completed or failed, set endedAt
			if ((status === "completed" || status === "failed") && !session.endedAt) {
				session.endedAt = new Date();
			}

			await this.saveSession(session);
		} catch (error) {
			console.error(`Failed to update status for session ${sessionId}:`, error);
			throw new Error(`Failed to update status: ${error}`);
		}
	}
}
