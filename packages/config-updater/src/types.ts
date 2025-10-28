/**
 * Configuration update payload types and API responses
 */

export interface ApiResponse {
	success: boolean;
	message?: string;
	error?: string;
	details?: string;
	data?: any;
}

export interface CyrusConfigPayload {
	[key: string]: any;
	version?: string;
	data?: any;
	force?: boolean;
	repositories?: any[];
	disallowedTools?: any;
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	defaultModel?: string;
	defaultFallbackModel?: string;
	global_setup_script?: string;
	backupConfig?: boolean;
	restartCyrus?: boolean;
}

export interface CyrusEnvPayload {
	[key: string]: any;
	envVars?: Record<string, string>;
	variables?: any;
	force?: boolean;
	backupEnv?: boolean;
	restartCyrus?: boolean;
}

export interface RepositoryPayload {
	[key: string]: any;
	id?: string;
	name?: string;
	url?: string;
	branch?: string;
	repository_url?: string;
	repository_name?: string;
}

export interface TestMcpPayload {
	[key: string]: any;
	transportType?: "stdio" | "sse" | "http";
	command?: string;
	serverUrl?: string;
	mcpConfig?: any;
}

export interface ConfigureMcpPayload {
	[key: string]: any;
	mcpConfigs?: Record<string, any>;
	mcpServers?: Record<string, any>;
}
