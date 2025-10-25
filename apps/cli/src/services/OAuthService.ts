import type { SharedApplicationServer } from "cyrus-edge-worker";
import open from "open";
import type { LinearCredentials } from "../config/types.js";
import type { Logger } from "./Logger.js";

/**
 * Service responsible for OAuth flow orchestration
 */
export class OAuthService {
	constructor(
		_serverPort: number,
		private baseUrl: string | undefined,
		_logger: Logger, // Reserved for future logging needs
	) {}

	/**
	 * Start OAuth flow using an existing EdgeWorker's shared server
	 */
	async startFlowWithServer(
		proxyUrl: string,
		server: SharedApplicationServer,
	): Promise<LinearCredentials> {
		const port = server.getPort();
		const callbackBaseUrl = this.baseUrl || `http://localhost:${port}`;
		const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

		// Let SharedApplicationServer print the messages, but we handle browser opening
		const resultPromise = server.startOAuthFlow(proxyUrl);

		// Open browser after SharedApplicationServer prints its messages
		open(authUrl).catch(() => {
			// Error is already communicated by SharedApplicationServer
		});

		return resultPromise;
	}

	/**
	 * Start OAuth flow with a temporary server (for initial setup)
	 */
	async startFlowWithTempServer(
		proxyUrl: string,
		createServer: () => Promise<SharedApplicationServer>,
	): Promise<LinearCredentials> {
		const tempServer = await createServer();

		try {
			// Start the server
			await tempServer.start();

			const port = tempServer.getPort();
			const callbackBaseUrl = this.baseUrl || `http://localhost:${port}`;
			const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

			// Start OAuth flow (this prints the messages)
			const resultPromise = tempServer.startOAuthFlow(proxyUrl);

			// Open browser after SharedApplicationServer prints its messages
			open(authUrl).catch(() => {
				// Error is already communicated by SharedApplicationServer
			});

			// Wait for OAuth flow to complete
			const result = await resultPromise;

			return {
				linearToken: result.linearToken,
				linearWorkspaceId: result.linearWorkspaceId,
				linearWorkspaceName: result.linearWorkspaceName,
			};
		} finally {
			// Clean up temporary server
			await tempServer.stop();
		}
	}
}
