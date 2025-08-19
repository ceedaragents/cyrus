import * as net from "node:net";

/**
 * Configuration options for dynamic port selection
 */
export interface PortSelectorOptions {
	/**
	 * Linear issue identifier (e.g., PACK-292) to derive port from
	 */
	linearIssueIdentifier?: string;

	/**
	 * Base port to start from (default: 30000)
	 */
	basePort?: number;

	/**
	 * Number of slots/instances to support (default: 50)
	 */
	maxSlots?: number;

	/**
	 * Preferred port if explicitly set via environment variable
	 */
	preferredPort?: number;

	/**
	 * Fallback ports to try if dynamic selection fails
	 */
	fallbackPorts?: number[];
}

/**
 * Dynamically selects an available port for running multiple Cyrus instances
 */
export class PortSelector {
	private readonly basePort: number;
	private readonly maxSlots: number;
	private readonly fallbackPorts: number[];

	constructor(options: PortSelectorOptions = {}) {
		this.basePort = options.basePort || 30000;
		this.maxSlots = options.maxSlots || 50;
		this.fallbackPorts = options.fallbackPorts || [3456, 3457, 3458, 3459];
	}

	/**
	 * Get a port based on Linear issue identifier
	 * Uses the numeric ID from the issue identifier to calculate a consistent port
	 */
	private getPortFromIssueId(linearIssueIdentifier: string): number {
		// Extract numeric ID from identifier (e.g., PACK-292 -> 292)
		const match = linearIssueIdentifier.match(/\d+$/);
		if (!match) {
			return this.basePort;
		}

		const id = parseInt(match[0], 10);
		const slot = id % this.maxSlots;
		return this.basePort + slot * 2; // Use *2 to leave room for potential frontend/backend pairs
	}

	/**
	 * Check if a port is available
	 */
	private async isPortAvailable(port: number): Promise<boolean> {
		return new Promise((resolve) => {
			const server = net.createServer();

			server.once("error", (err: any) => {
				if (err.code === "EADDRINUSE") {
					resolve(false);
				} else {
					resolve(false); // Treat other errors as port unavailable
				}
			});

			server.once("listening", () => {
				server.close();
				resolve(true);
			});

			server.listen(port, "127.0.0.1");
		});
	}

	/**
	 * Find the next available port starting from a given port
	 */
	private async findNextAvailablePort(
		startPort: number,
		maxAttempts: number = 100,
	): Promise<number | null> {
		for (let i = 0; i < maxAttempts; i++) {
			const port = startPort + i;
			if (await this.isPortAvailable(port)) {
				return port;
			}
		}
		return null;
	}

	/**
	 * Select an available port based on the provided options
	 */
	async selectPort(options: PortSelectorOptions = {}): Promise<number> {
		// 1. If a preferred port is explicitly set and available, use it
		if (options.preferredPort) {
			if (await this.isPortAvailable(options.preferredPort)) {
				return options.preferredPort;
			}
			console.warn(
				`Preferred port ${options.preferredPort} is not available, trying alternatives...`,
			);
		}

		// 2. Try to derive port from Linear issue identifier
		if (options.linearIssueIdentifier) {
			const derivedPort = this.getPortFromIssueId(
				options.linearIssueIdentifier,
			);
			if (await this.isPortAvailable(derivedPort)) {
				return derivedPort;
			}

			// Try to find next available port near the derived port
			const nearbyPort = await this.findNextAvailablePort(derivedPort, 10);
			if (nearbyPort) {
				return nearbyPort;
			}
		}

		// 3. Try fallback ports
		for (const port of this.fallbackPorts) {
			if (await this.isPortAvailable(port)) {
				return port;
			}
		}

		// 4. Find any available port in the base range
		const availablePort = await this.findNextAvailablePort(
			this.basePort,
			this.maxSlots * 2,
		);
		if (availablePort) {
			return availablePort;
		}

		// 5. Last resort: let the OS assign a random port
		return 0;
	}

	/**
	 * Get port configuration for Cyrus based on environment and context
	 */
	static async getCyrusPort(linearIssueIdentifier?: string): Promise<number> {
		const selector = new PortSelector();

		// Check for explicitly set port via environment variable
		const envPort = process.env.CYRUS_SERVER_PORT;
		const preferredPort = envPort ? parseInt(envPort, 10) : undefined;

		// If CYRUS_DYNAMIC_PORT is set to "true", always use dynamic selection
		const useDynamicPort = process.env.CYRUS_DYNAMIC_PORT === "true";

		if (preferredPort && !useDynamicPort) {
			// If port is explicitly set and dynamic mode is not forced, try to use it
			if (await selector.isPortAvailable(preferredPort)) {
				return preferredPort;
			}
			// If preferred port is taken, fall through to dynamic selection
			console.warn(
				`Port ${preferredPort} from CYRUS_SERVER_PORT is in use, selecting alternative...`,
			);
		}

		return selector.selectPort({
			linearIssueIdentifier,
			preferredPort: useDynamicPort ? undefined : preferredPort,
		});
	}
}
