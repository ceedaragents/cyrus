/**
 * Generic persistence interface for storing and retrieving data.
 * This interface can be implemented using various storage backends:
 * file system, databases, cloud storage, etc.
 *
 * @typeParam T - The type of data being persisted
 */
export interface IPersistence<T> {
  /**
   * Save data to the persistence layer.
   *
   * @param key - Unique key to store the data under
   * @param data - The data to save
   */
  save(key: string, data: T): Promise<void>;

  /**
   * Load data from the persistence layer.
   *
   * @param key - The key of the data to load
   * @returns The loaded data, or null if not found
   */
  load(key: string): Promise<T | null>;

  /**
   * Delete data from the persistence layer.
   *
   * @param key - The key of the data to delete
   */
  delete(key: string): Promise<void>;

  /**
   * List all keys in the persistence layer, optionally filtered by prefix.
   *
   * @param prefix - Optional prefix to filter keys by
   * @returns Array of keys matching the prefix (or all keys if no prefix)
   */
  list(prefix?: string): Promise<string[]>;
}
