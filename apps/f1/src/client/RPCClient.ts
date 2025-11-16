import type {
	RPCClientOptions,
	RPCRequest,
	RPCResponse,
} from "../types/index.js";
import { c } from "../utils/colors.js";

const DEFAULT_PORT = 3457;

/**
 * Get the RPC URL from environment variables
 */
export function getRPCUrl(): string {
	const port = process.env.CYRUS_PORT || DEFAULT_PORT;
	return `http://localhost:${port}/cli/rpc`;
}

/**
 * Make an RPC call to the Cyrus CLI platform
 */
export async function rpc<T = unknown>(
	method: string,
	params: Record<string, unknown> = {},
	options: RPCClientOptions = {},
): Promise<RPCResponse<T>> {
	const { silent = false } = options;
	const rpcUrl = getRPCUrl();

	if (!silent) {
		console.log(c.dim(`→ Connecting to ${rpcUrl}...`));
	}

	try {
		const response = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ method, params } as RPCRequest),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result = (await response.json()) as RPCResponse<T>;

		if (!silent) {
			console.log(c.success("✓ Connected\n"));
		}

		return result;
	} catch (error) {
		if (error instanceof Error && "cause" in error) {
			const cause = error.cause as { code?: string };
			if (cause.code === "ECONNREFUSED") {
				handleConnectionError(rpcUrl);
			}
		}
		throw error;
	}
}

/**
 * Handle connection errors with helpful messages
 */
function handleConnectionError(rpcUrl: string): never {
	console.error(c.error("\n❌ Cannot connect to Cyrus server\n"));
	console.error(c.dim(`   Server URL: ${rpcUrl}`));
	console.error(c.dim("   Make sure the CLI server is running."));
	console.error(
		c.dim(`   Start it with: ${c.command("node start-cli-server.mjs")}\n`),
	);

	const customPort = process.env.CYRUS_PORT;
	if (customPort && Number.parseInt(customPort, 10) !== DEFAULT_PORT) {
		console.error(c.dim(`   Using custom port from CYRUS_PORT=${customPort}`));
	}

	console.error();
	process.exit(1);
}

/**
 * Display a standard RPC result
 */
export async function displayResult<T>(result: RPCResponse<T>): Promise<void> {
	if (result.success) {
		console.log(c.success("✅ Success\n"));
		const { printJSON } = await import("../utils/formatter.js");
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
