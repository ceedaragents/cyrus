import type { Stream } from "node:stream";

/**
 * Options for file operations
 */
export interface WriteFileOptions {
	encoding?: BufferEncoding;
	mode?: number;
	flag?: string;
}

export interface StreamOptions {
	encoding?: BufferEncoding;
	mode?: number;
	flags?: string;
	highWaterMark?: number;
}

/**
 * File metadata
 */
export interface FileStats {
	size: number;
	isDirectory: boolean;
	isFile: boolean;
	isSymbolicLink: boolean;
	modifiedAt: Date;
	createdAt: Date;
	permissions: number;
}

/**
 * Directory entry
 */
export interface DirectoryEntry {
	name: string;
	path: string;
	isDirectory: boolean;
	isFile: boolean;
	isSymbolicLink: boolean;
}

/**
 * Main interface for file system operations
 *
 * This interface provides comprehensive file system operations including
 * reading, writing, directory management, and streaming capabilities.
 */
export interface IFileSystem {
	/**
	 * Directory operations
	 */

	/**
	 * Ensure directory exists, creating it if necessary
	 * @param path - Directory path
	 */
	ensureDirectory(path: string): Promise<void>;

	/**
	 * Check if directory exists
	 * @param path - Directory path
	 * @returns True if directory exists
	 */
	directoryExists(path: string): boolean;

	/**
	 * List contents of directory
	 * @param path - Directory path
	 * @returns Array of directory entries
	 */
	listDirectory(path: string): Promise<DirectoryEntry[]>;

	/**
	 * Delete directory (recursive optional)
	 * @param path - Directory path
	 * @param recursive - Whether to delete recursively
	 */
	deleteDirectory(path: string, recursive?: boolean): Promise<void>;

	/**
	 * File operations
	 */

	/**
	 * Read file contents as string
	 * @param path - File path
	 * @param encoding - Text encoding (default: 'utf-8')
	 * @returns File contents as string
	 */
	readFile(path: string, encoding?: BufferEncoding): Promise<string>;

	/**
	 * Read file contents as buffer
	 * @param path - File path
	 * @returns File contents as buffer
	 */
	readFileBuffer(path: string): Promise<Buffer>;

	/**
	 * Write file contents
	 * @param path - File path
	 * @param content - Content to write
	 * @param options - Write options
	 */
	writeFile(
		path: string,
		content: string | Buffer,
		options?: WriteFileOptions,
	): Promise<void>;

	/**
	 * Append to file
	 * @param path - File path
	 * @param content - Content to append
	 * @param options - Write options
	 */
	appendFile(
		path: string,
		content: string | Buffer,
		options?: WriteFileOptions,
	): Promise<void>;

	/**
	 * Check if file exists
	 * @param path - File path
	 * @returns True if file exists
	 */
	fileExists(path: string): boolean;

	/**
	 * Delete file
	 * @param path - File path
	 */
	deleteFile(path: string): Promise<void>;

	/**
	 * Copy file
	 * @param source - Source file path
	 * @param destination - Destination file path
	 */
	copyFile(source: string, destination: string): Promise<void>;

	/**
	 * Get file stats
	 * @param path - File path
	 * @returns File statistics
	 */
	getFileStats(path: string): Promise<FileStats>;

	/**
	 * Streaming operations
	 */

	/**
	 * Create a write stream for appending
	 * @param path - File path
	 * @param options - Stream options
	 * @returns Write stream
	 */
	createWriteStream(path: string, options?: StreamOptions): Stream;

	/**
	 * Create a read stream
	 * @param path - File path
	 * @param options - Stream options
	 * @returns Read stream
	 */
	createReadStream(path: string, options?: StreamOptions): Stream;

	/**
	 * Path operations
	 */

	/**
	 * Resolve multiple path segments into absolute path
	 * @param parts - Path segments
	 * @returns Resolved absolute path
	 */
	resolvePath(...parts: string[]): string;

	/**
	 * Get directory name from path
	 * @param path - File path
	 * @returns Directory name
	 */
	getDirectory(path: string): string;

	/**
	 * Get file name from path
	 * @param path - File path
	 * @returns File name
	 */
	getFileName(path: string): string;

	/**
	 * Get file extension
	 * @param path - File path
	 * @returns File extension (including dot)
	 */
	getFileExtension(path: string): string;

	/**
	 * Check if path is absolute
	 * @param path - Path to check
	 * @returns True if path is absolute
	 */
	isAbsolute(path: string): boolean;

	/**
	 * Configuration file operations
	 */

	/**
	 * Read and parse JSON file
	 * @param path - JSON file path
	 * @returns Parsed JSON object
	 */
	readJsonFile<T = any>(path: string): Promise<T>;

	/**
	 * Write object as JSON file
	 * @param path - JSON file path
	 * @param data - Data to write
	 * @param options - Formatting options
	 */
	writeJsonFile(
		path: string,
		data: any,
		options?: { pretty?: boolean; spaces?: number },
	): Promise<void>;

	/**
	 * Special files
	 */

	/**
	 * Load environment variables from .env file
	 * @param path - Path to .env file
	 * @returns Environment variables as key-value pairs
	 */
	loadEnvFile(path: string): Promise<Record<string, string>>;

	/**
	 * Watch for file changes
	 * @param path - File path to watch
	 * @param callback - Callback when file changes
	 */
	watch(
		path: string,
		callback: (event: string, filename: string) => void,
	): void;

	/**
	 * Stop watching file
	 * @param path - File path to stop watching
	 */
	unwatch(path: string): void;
}
