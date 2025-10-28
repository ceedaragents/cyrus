/**
 * Repository configuration payload
 * Matches the format sent by cyrus-hosted
 */
export interface RepositoryPayload {
    repository_url: string;
    repository_name: string;
}
/**
 * Cyrus config update payload
 */
export interface CyrusConfigPayload {
    repositories: Array<{
        id: string;
        name: string;
        repositoryPath: string;
        baseBranch: string;
        linearWorkspaceId?: string;
        linearToken?: string;
        workspaceBaseDir?: string;
        isActive?: boolean;
        allowedTools?: string[];
        mcpConfigPath?: string[];
        teamKeys?: string[];
        labelPrompts?: Record<string, string[]>;
    }>;
    disallowedTools?: string[];
    ngrokAuthToken?: string;
    stripeCustomerId?: string;
    defaultModel?: string;
    defaultFallbackModel?: string;
    global_setup_script?: string;
    restartCyrus?: boolean;
    backupConfig?: boolean;
}
/**
 * Cyrus environment variables payload (for Claude token)
 */
export interface CyrusEnvPayload {
    variables?: Record<string, string>;
    ANTHROPIC_API_KEY?: string;
    restartCyrus?: boolean;
    backupEnv?: boolean;
    [key: string]: string | boolean | Record<string, string> | undefined;
}
/**
 * MCP server configuration
 */
export interface McpServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    transport?: "stdio" | "sse";
    headers?: Record<string, string>;
}
/**
 * Test MCP connection payload
 */
export interface TestMcpPayload {
    transportType: "stdio" | "sse";
    serverUrl?: string | null;
    command?: string | null;
    commandArgs?: Array<{
        value: string;
        order: number;
    }> | null;
    headers?: Array<{
        name: string;
        value: string;
    }> | null;
    envVars?: Array<{
        key: string;
        value: string;
    }> | null;
}
/**
 * Configure MCP servers payload
 */
export interface ConfigureMcpPayload {
    mcpServers: Record<string, McpServerConfig>;
}
/**
 * Error response
 */
export interface ErrorResponse {
    success: false;
    error: string;
    details?: string;
}
/**
 * Success response
 */
export interface SuccessResponse {
    success: true;
    message: string;
    data?: any;
}
/**
 * API response type (union of success/error)
 */
export type ApiResponse = SuccessResponse | ErrorResponse;
//# sourceMappingURL=types.d.ts.map