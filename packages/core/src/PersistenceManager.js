import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
/**
 * Manages persistence of critical mappings to survive restarts
 */
export class PersistenceManager {
	persistencePath;
	constructor(persistencePath) {
		this.persistencePath =
			persistencePath || join(homedir(), ".cyrus", "state");
	}
	/**
	 * Get the full path to the single EdgeWorker state file
	 */
	getEdgeWorkerStateFilePath() {
		return join(this.persistencePath, "edge-worker-state.json");
	}
	/**
	 * Ensure the persistence directory exists
	 */
	async ensurePersistenceDirectory() {
		await mkdir(this.persistencePath, { recursive: true });
	}
	/**
	 * Save EdgeWorker state to disk (single file for all repositories)
	 */
	async saveEdgeWorkerState(state) {
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
	async loadEdgeWorkerState() {
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
	hasStateFile() {
		return existsSync(this.getEdgeWorkerStateFilePath());
	}
	/**
	 * Delete EdgeWorker state file
	 */
	async deleteStateFile() {
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
	static mapToRecord(map) {
		return Object.fromEntries(map.entries());
	}
	/**
	 * Convert Record to Map for deserialization
	 */
	static recordToMap(record) {
		return new Map(Object.entries(record));
	}
	/**
	 * Convert Set to Array for serialization
	 */
	static setToArray(set) {
		return Array.from(set);
	}
	/**
	 * Convert Array to Set for deserialization
	 */
	static arrayToSet(array) {
		return new Set(array);
	}
}
//# sourceMappingURL=PersistenceManager.js.map
