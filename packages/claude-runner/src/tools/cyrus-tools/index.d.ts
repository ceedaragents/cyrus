/**
 * Options for creating Cyrus tools with session management capabilities
 */
export interface CyrusToolsOptions {
	/**
	 * Callback to register a child-to-parent session mapping
	 * Called when a new agent session is created
	 */
	onSessionCreated?: (childSessionId: string, parentSessionId: string) => void;
	/**
	 * Callback to deliver feedback to a parent session
	 * Called when feedback is given to a child session
	 */
	onFeedbackDelivery?: (
		childSessionId: string,
		message: string,
	) => Promise<boolean>;
	/**
	 * The ID of the current parent session (if any)
	 */
	parentSessionId?: string;
}
/**
 * Create an SDK MCP server with the inline Cyrus tools
 */
export declare function createCyrusToolsServer(
	linearApiToken: string,
	options?: CyrusToolsOptions,
): import("@anthropic-ai/claude-code").McpSdkServerConfigWithInstance;
//# sourceMappingURL=index.d.ts.map
