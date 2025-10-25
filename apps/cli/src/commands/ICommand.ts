import type { Application } from "../Application.js";
import type { Logger } from "../services/Logger.js";

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
	protected logger: Logger;

	constructor(protected app: Application) {
		this.logger = app.logger;
	}

	abstract execute(args: string[]): Promise<void>;

	/**
	 * Helper to exit with error
	 */
	protected exitWithError(message: string, code = 1): never {
		this.logger.error(message);
		process.exit(code);
	}

	/**
	 * Helper to log success
	 */
	protected logSuccess(message: string): void {
		this.logger.success(message);
	}

	/**
	 * Helper to log error
	 */
	protected logError(message: string): void {
		this.logger.error(message);
	}

	/**
	 * Helper to log section divider
	 */
	protected logDivider(): void {
		this.logger.divider(50);
	}
}
