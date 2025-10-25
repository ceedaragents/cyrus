import type { Application } from "../Application.js";

/**
 * Interface for all CLI commands
 */
export interface ICommand {
	/**
	 * Execute the command
	 * @param args Command-line arguments
	 */
	execute(args: string[]): Promise<void>;
}

/**
 * Base class for commands with common functionality
 */
export abstract class BaseCommand implements ICommand {
	constructor(protected app: Application) {}

	abstract execute(args: string[]): Promise<void>;

	/**
	 * Helper to exit with error
	 */
	protected exitWithError(message: string, code = 1): never {
		console.error(message);
		process.exit(code);
	}

	/**
	 * Helper to log success
	 */
	protected logSuccess(message: string): void {
		console.log(`✅ ${message}`);
	}

	/**
	 * Helper to log error
	 */
	protected logError(message: string): void {
		console.error(`❌ ${message}`);
	}

	/**
	 * Helper to log section divider
	 */
	protected logDivider(): void {
		console.log("─".repeat(50));
	}
}
