import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	getDefaultEnvironment,
	StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ApiResponse, TestMcpPayload } from "../types.js";

const CONNECT_TIMEOUT_MS = 10_000; // 10s for protocol handshake
const LIST_TOOLS_TIMEOUT_MS = 10_000; // 10s for tool discovery
const CLOSE_TIMEOUT_MS = 5_000; // 5s for graceful close

/** Patterns that indicate credential/auth failures on stderr. */
const STDERR_ERROR_PATTERNS = [
	/unauthori[zs]ed/i,
	/invalid[_ -]?(api[_ -]?)?key/i,
	/authentication failed/i,
	/auth(entication|orization)?\s+error/i,
	/forbidden/i,
	/401/,
	/403/,
	/invalid[_ -]?token/i,
	/access[_ -]?denied/i,
	/permission[_ -]?denied/i,
	/credentials?\s+(are\s+)?invalid/i,
	/api[_ -]?key\s+(is\s+)?invalid/i,
	/not[_ -]?authori[zs]ed/i,
];

/**
 * Handle MCP connection test
 * Spawns the MCP server, connects via the MCP protocol, and discovers available tools.
 */
export async function handleTestMcp(
	payload: TestMcpPayload,
): Promise<ApiResponse> {
	try {
		if (!payload.transportType) {
			return {
				success: false,
				error: "MCP test requires transport type",
			};
		}

		if (payload.transportType === "stdio") {
			if (!payload.command) {
				return {
					success: false,
					error: "MCP stdio transport requires a command",
				};
			}
			return await testStdioMcp(payload);
		}

		if (payload.transportType === "http" || payload.transportType === "sse") {
			if (!payload.serverUrl) {
				return {
					success: false,
					error: "MCP HTTP/SSE transport requires a server URL",
				};
			}
			return await testHttpMcp(payload);
		}

		return {
			success: false,
			error: `Unsupported transport type: ${payload.transportType}`,
		};
	} catch (error) {
		return {
			success: false,
			error:
				error instanceof Error ? error.message : "MCP connection test failed",
		};
	}
}

/**
 * Test a stdio MCP server by spawning the process, connecting, and listing tools.
 * Monitors stderr for auth errors and detects process exit for fast failure.
 */
async function testStdioMcp(payload: TestMcpPayload): Promise<ApiResponse> {
	const args = payload.commandArgs
		? [...payload.commandArgs]
				.sort((a, b) => a.order - b.order)
				.map((a) => a.value)
		: [];

	// Start with the default safe environment (PATH, HOME, etc.)
	const env = getDefaultEnvironment();

	// Layer on user-provided env vars
	if (payload.envVars) {
		for (const { key, value } of payload.envVars) {
			env[key] = value;
		}
	}

	const transport = new StdioClientTransport({
		command: payload.command!,
		args,
		env,
		stderr: "pipe",
	});

	// Set up stderr monitoring and process exit detection before connecting
	const stderrChunks: string[] = [];
	let earlyFailure: Promise<never> | undefined;

	const stderrStream = transport.stderr;
	if (stderrStream) {
		earlyFailure = new Promise<never>((_resolve, reject) => {
			stderrStream.on("data", (chunk: Buffer) => {
				const text = chunk.toString();
				stderrChunks.push(text);

				// Check if stderr contains auth error patterns
				if (containsAuthError(text)) {
					reject(
						new McpCredentialError(
							`MCP server reported an authentication error: ${text.trim()}`,
						),
					);
				}
			});
		});
	}

	// Detect process exit via the transport's onclose callback
	const processExitPromise = new Promise<never>((_resolve, reject) => {
		const originalOnClose = transport.onclose;
		transport.onclose = () => {
			originalOnClose?.();
			const stderrOutput = stderrChunks.join("").trim();
			const message = stderrOutput
				? `MCP process exited unexpectedly: ${stderrOutput}`
				: "MCP process exited unexpectedly before completing the test";
			reject(new McpProcessExitError(message));
		};
	});

	return await connectAndDiscover(
		transport,
		payload.command!,
		earlyFailure,
		processExitPromise,
		() => stderrChunks.join("").trim(),
	);
}

/**
 * Test an HTTP/SSE MCP server by connecting and listing tools.
 */
async function testHttpMcp(payload: TestMcpPayload): Promise<ApiResponse> {
	// Build headers, substituting env vars
	const headers: Record<string, string> = {};
	if (payload.headers) {
		for (const { name, value } of payload.headers) {
			headers[name] = value;
		}
	}

	// Substitute ${VAR} placeholders in URL and headers
	let url = payload.serverUrl!;
	if (payload.envVars) {
		for (const { key, value } of payload.envVars) {
			const placeholder = `\${${key}}`;
			url = url.replaceAll(placeholder, value);
			for (const headerName of Object.keys(headers)) {
				const current = headers[headerName];
				if (current !== undefined) {
					headers[headerName] = current.replaceAll(placeholder, value);
				}
			}
		}
	}

	const transport = new StreamableHTTPClientTransport(new URL(url), {
		requestInit: {
			headers,
		},
	});

	return await connectAndDiscover(transport, url);
}

/**
 * Connect to an MCP server via the given transport, list tools, and return the result.
 * Optionally races against early failure signals (stderr auth errors, process exit).
 */
async function connectAndDiscover(
	transport: Transport,
	fallbackName: string,
	earlyFailure?: Promise<never>,
	processExit?: Promise<never>,
	getStderr?: () => string,
): Promise<ApiResponse> {
	const client = new Client({
		name: "cyrus-mcp-tester",
		version: "1.0.0",
	});

	// Build the list of signals to race against
	const raceSignals = [earlyFailure, processExit].filter(
		(p): p is Promise<never> => p !== undefined,
	);

	try {
		await raceWithSignals(
			client.connect(transport),
			"Connection timed out",
			CONNECT_TIMEOUT_MS,
			raceSignals,
		);

		const toolsResult = await raceWithSignals(
			client.listTools(),
			"Tool listing timed out",
			LIST_TOOLS_TIMEOUT_MS,
			raceSignals,
		);

		const tools = toolsResult.tools.map((t) => ({
			name: t.name,
			description: t.description || "",
		}));

		const serverVersion = client.getServerVersion();

		return {
			success: true,
			message: `MCP connection test successful — discovered ${tools.length} tool(s)`,
			data: {
				tools,
				serverInfo: {
					name: serverVersion?.name || fallbackName,
					version: serverVersion?.version || "unknown",
					protocol: "mcp/1.0",
				},
			},
		};
	} catch (error) {
		// Enrich timeout errors with stderr context when available
		if (
			error instanceof Error &&
			error.message.includes("timed out") &&
			getStderr
		) {
			const stderr = getStderr();
			if (stderr) {
				throw new Error(`${error.message}\nServer stderr: ${stderr}`);
			}
		}
		throw error;
	} finally {
		try {
			await withTimeout(client.close(), "Close timed out", CLOSE_TIMEOUT_MS);
		} catch {
			// Best-effort cleanup — if close hangs, let it go
		}
	}
}

/** Check whether a stderr line contains a known auth/credential error pattern. */
function containsAuthError(text: string): boolean {
	return STDERR_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Race a promise against a timeout and optional early-failure signals.
 * Clears the timer on settlement.
 */
function raceWithSignals<T>(
	promise: Promise<T>,
	timeoutMessage: string,
	ms: number,
	signals: Promise<never>[] = [],
): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
		}),
		...signals,
	]).finally(() => clearTimeout(timer));
}

/** Race a promise against a timeout, clearing the timer on settlement. */
function withTimeout<T>(
	promise: Promise<T>,
	message: string,
	ms: number,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error(message)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/** Error thrown when stderr contains auth/credential error patterns. */
class McpCredentialError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpCredentialError";
	}
}

/** Error thrown when the MCP process exits unexpectedly. */
class McpProcessExitError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpProcessExitError";
	}
}

export {
	containsAuthError,
	McpCredentialError,
	McpProcessExitError,
	STDERR_ERROR_PATTERNS,
};
