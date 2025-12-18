/**
 * Port Allocator for OpenCode SDK Server
 *
 * Provides utilities for allocating available ports for the OpenCode server.
 * The OpenCode SDK requires a port to run its local server, and this utility
 * helps find available ports and manage port allocation.
 *
 * @packageDocumentation
 */

import { type AddressInfo, createServer, type Server } from "node:net";

/**
 * Default port range for OpenCode servers.
 */
export const DEFAULT_PORT_RANGE = {
	min: 54321,
	max: 54399,
} as const;

/**
 * OpenCode's default server port.
 */
export const OPENCODE_DEFAULT_PORT = 54321;

/**
 * Options for port allocation.
 */
export interface PortAllocationOptions {
	/**
	 * Minimum port number to try.
	 * @default 54321
	 */
	minPort?: number;

	/**
	 * Maximum port number to try.
	 * @default 54399
	 */
	maxPort?: number;

	/**
	 * Preferred port to try first.
	 * If available, this port will be used.
	 */
	preferredPort?: number;

	/**
	 * Host to bind to when checking port availability.
	 * @default "127.0.0.1"
	 */
	host?: string;
}

/**
 * Result of port allocation.
 */
export interface PortAllocationResult {
	/**
	 * The allocated port number.
	 */
	port: number;

	/**
	 * Whether this was the preferred port.
	 */
	isPreferred: boolean;

	/**
	 * The host the port is bound to.
	 */
	host: string;
}

/**
 * Error thrown when no available port is found.
 */
export class PortAllocationError extends Error {
	constructor(
		message: string,
		public readonly minPort: number,
		public readonly maxPort: number,
	) {
		super(message);
		this.name = "PortAllocationError";
	}
}

/**
 * Check if a specific port is available.
 *
 * @param port - The port number to check
 * @param host - The host to bind to (default: "127.0.0.1")
 * @returns Promise resolving to true if available, false otherwise
 */
export async function isPortAvailable(
	port: number,
	host = "127.0.0.1",
): Promise<boolean> {
	return new Promise((resolve) => {
		const server: Server = createServer();

		server.once("error", () => {
			resolve(false);
		});

		server.once("listening", () => {
			server.close(() => {
				resolve(true);
			});
		});

		server.listen(port, host);
	});
}

/**
 * Find an available port within a specified range.
 *
 * @param options - Port allocation options
 * @returns Promise resolving to an available port number
 * @throws PortAllocationError if no port is available in the range
 */
export async function findAvailablePort(
	options: PortAllocationOptions = {},
): Promise<PortAllocationResult> {
	const {
		minPort = DEFAULT_PORT_RANGE.min,
		maxPort = DEFAULT_PORT_RANGE.max,
		preferredPort,
		host = "127.0.0.1",
	} = options;

	// Try preferred port first if specified
	if (preferredPort !== undefined) {
		if (await isPortAvailable(preferredPort, host)) {
			return {
				port: preferredPort,
				isPreferred: true,
				host,
			};
		}
	}

	// Try ports in range
	for (let port = minPort; port <= maxPort; port++) {
		if (await isPortAvailable(port, host)) {
			return {
				port,
				isPreferred: preferredPort === port,
				host,
			};
		}
	}

	throw new PortAllocationError(
		`No available port found in range ${minPort}-${maxPort}`,
		minPort,
		maxPort,
	);
}

/**
 * Get a random available port from the OS.
 * This binds to port 0 and lets the OS assign an available port.
 *
 * @param host - The host to bind to (default: "127.0.0.1")
 * @returns Promise resolving to the allocated port number
 */
export async function getRandomAvailablePort(
	host = "127.0.0.1",
): Promise<number> {
	return new Promise((resolve, reject) => {
		const server: Server = createServer();

		server.once("error", (err) => {
			reject(err);
		});

		server.once("listening", () => {
			const address = server.address() as AddressInfo;
			const port = address.port;
			server.close(() => {
				resolve(port);
			});
		});

		// Port 0 tells the OS to assign any available port
		server.listen(0, host);
	});
}

/**
 * Allocate a port for the OpenCode server.
 * This is the main entry point for port allocation.
 *
 * Strategy:
 * 1. If a preferred port is specified and available, use it
 * 2. Otherwise, try the OpenCode default port (54321)
 * 3. If that's not available, find any available port in the range
 *
 * @param options - Port allocation options
 * @returns Promise resolving to the allocation result
 */
export async function allocateOpenCodePort(
	options: PortAllocationOptions = {},
): Promise<PortAllocationResult> {
	const { preferredPort, ...rest } = options;

	// If preferred port specified, use standard findAvailablePort
	if (preferredPort !== undefined) {
		return findAvailablePort(options);
	}

	// Try OpenCode default port first
	return findAvailablePort({
		...rest,
		preferredPort: OPENCODE_DEFAULT_PORT,
	});
}

/**
 * Build the base URL for an OpenCode server.
 *
 * @param port - The port number
 * @param host - The host (default: "localhost")
 * @param protocol - The protocol (default: "http")
 * @returns The base URL string
 */
export function buildServerUrl(
	port: number,
	host = "localhost",
	protocol = "http",
): string {
	return `${protocol}://${host}:${port}`;
}
