import type {
	OAuthHandlerModule,
	SharedApplicationServer,
} from "cyrus-edge-worker";
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
	 * TODO: Update this to use OAuthHandlerModule from EdgeWorker
	 */
	async startFlowWithServer(
		_proxyUrl: string,
		_server: SharedApplicationServer,
	): Promise<LinearCredentials> {
		// This method needs refactoring to work with the new handler module pattern
		// The EdgeWorker should expose the OAuthHandlerModule for this use case
		throw new Error(
			"startFlowWithServer needs to be updated for the new handler module pattern",
		);
	}

	/**
	 * Start OAuth flow with a temporary server (for initial setup)
	 */
	async startFlowWithTempServer(
		proxyUrl: string,
		createServer: () => Promise<{
			server: SharedApplicationServer;
			oauthHandler: OAuthHandlerModule;
		}>,
	): Promise<LinearCredentials> {
		const { server: tempServer, oauthHandler } = await createServer();

		try {
			// Start the server
			await tempServer.start();

			const port = tempServer.getPort();
			const callbackBaseUrl = this.baseUrl || `http://localhost:${port}`;
			const authUrl = `${proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;

			// Start OAuth flow using the OAuth handler module
			const resultPromise = oauthHandler.startOAuthFlow();

			// Open browser after messages are printed
			open(authUrl).catch(() => {
				// Error is already communicated
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
