import type { ApiResponse, ConfigureMcpPayload } from "../types.js";
/**
 * Handle MCP server configuration
 * Writes individual MCP config files to ~/.cyrus/mcp-{slug}.json
 */
export declare function handleConfigureMcp(
	payload: ConfigureMcpPayload,
	cyrusHome: string,
): Promise<ApiResponse>;
//# sourceMappingURL=configureMcp.d.ts.map
