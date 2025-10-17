import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { ConfigManager } from "../ConfigManager.js";
import type { HandlerResult } from "../types.js";
export interface ConfigUpdateHandlerConfig {
	configManager: ConfigManager;
}
/**
 * Handles configuration update requests from cyrus-hosted
 */
export declare class ConfigUpdateHandler extends EventEmitter {
	private configManager;
	constructor(config: ConfigUpdateHandlerConfig);
	/**
	 * Handle paths update request
	 */
	handlePaths(req: IncomingMessage, body: string): Promise<HandlerResult>;
	/**
	 * Handle GitHub credentials update
	 */
	handleGitHubCredentials(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult>;
	/**
	 * Handle Linear credentials update
	 */
	handleLinearCredentials(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult>;
	/**
	 * Handle Claude API key update
	 */
	handleClaudeApiKey(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult>;
	/**
	 * Handle repositories configuration update
	 */
	handleRepositories(
		req: IncomingMessage,
		body: string,
	): Promise<HandlerResult>;
	/**
	 * Handle get configuration request
	 */
	handleGetConfig(req: IncomingMessage, body: string): Promise<HandlerResult>;
}
//# sourceMappingURL=ConfigUpdateHandler.d.ts.map
