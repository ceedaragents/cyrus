/**
 * Version information for state migrations
 */
export interface VersionInfo {
	major: number;
	minor: number;
	patch: number;
}

/**
 * State change event
 */
export interface StateChangeEvent {
	key: string;
	newState: any;
	previousState?: any;
	timestamp: Date;
}

/**
 * Persistence options
 */
export interface PersistenceOptions {
	version?: VersionInfo;
	ttl?: number; // Time to live in milliseconds
	compress?: boolean;
}

/**
 * Migration callback
 */
export type StateMigration = (
	data: any,
	fromVersion: string,
	toVersion: string,
) => any;

/**
 * Main interface for state persistence
 *
 * This interface provides methods for persisting application state,
 * including versioning, migrations, and batch operations.
 */
export interface IPersistenceProvider {
	/**
	 * State management
	 */

	/**
	 * Save state with a key
	 * @param key - Unique identifier for the state
	 * @param state - State data to save
	 * @param options - Persistence options
	 */
	saveState(
		key: string,
		state: any,
		options?: PersistenceOptions,
	): Promise<void>;

	/**
	 * Load state by key
	 * @param key - Unique identifier for the state
	 * @returns State data or null if not found
	 */
	loadState(key: string): Promise<any | null>;

	/**
	 * Check if state exists
	 * @param key - Unique identifier for the state
	 * @returns True if state exists
	 */
	hasState(key: string): boolean;

	/**
	 * Delete state
	 * @param key - Unique identifier for the state
	 */
	deleteState(key: string): Promise<void>;

	/**
	 * List all state keys
	 * @returns Array of all state keys
	 */
	listStateKeys(): Promise<string[]>;

	/**
	 * Batch operations
	 */

	/**
	 * Save multiple states at once
	 * @param states - Object mapping keys to state data
	 * @param options - Persistence options
	 */
	saveBatch(
		states: Record<string, any>,
		options?: PersistenceOptions,
	): Promise<void>;

	/**
	 * Load multiple states at once
	 * @param keys - Array of state keys to load
	 * @returns Object mapping keys to state data
	 */
	loadBatch(keys: string[]): Promise<Record<string, any>>;

	/**
	 * Delete multiple states at once
	 * @param keys - Array of state keys to delete
	 */
	deleteBatch(keys: string[]): Promise<void>;

	/**
	 * Versioning and migration
	 */

	/**
	 * Get current version
	 * @returns Version information
	 */
	getVersion(): VersionInfo;

	/**
	 * Register migration for a version change
	 * @param fromVersion - Source version string (e.g., "1.0.0")
	 * @param toVersion - Target version string (e.g., "1.1.0")
	 * @param migration - Migration function
	 */
	registerMigration(
		fromVersion: string,
		toVersion: string,
		migration: StateMigration,
	): void;

	/**
	 * Migrate state from one version to another
	 * @param state - State data to migrate
	 * @param fromVersion - Source version string
	 * @param toVersion - Target version string
	 * @returns Migrated state data
	 */
	migrateState(state: any, fromVersion: string, toVersion: string): any;

	/**
	 * Utilities
	 */

	/**
	 * Clear all state
	 */
	clearAll(): Promise<void>;

	/**
	 * Get size of stored state
	 * @returns Size in bytes
	 */
	getSize(): Promise<number>;

	/**
	 * Export all state as JSON
	 * @returns Object containing all state data
	 */
	exportState(): Promise<Record<string, any>>;

	/**
	 * Import state from JSON
	 * @param data - State data to import
	 */
	importState(data: Record<string, any>): Promise<void>;

	/**
	 * Event hooks
	 */

	/**
	 * Register callback for state changes
	 * @param callback - Function to call when state changes
	 */
	onStateChange?(callback: (event: StateChangeEvent) => void): void;

	/**
	 * Register callback for errors
	 * @param callback - Function to call when errors occur
	 */
	onError?(callback: (error: Error) => void): void;
}
