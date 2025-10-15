// Type definitions for config-server
// Ported from Go update-server

export interface GitHubCredentialsPayload {
	token: string;
}

export interface RepositoryPayload {
	repository_url: string;
	repository_name?: string;
}

export interface DeleteRepositoryPayload {
	repository_name: string;
	linear_team_key?: string;
}

export interface RepositoryInfo {
	name: string;
	path: string;
}

export interface CyrusConfigPayload {
	repositories: RepositoryConfigItem[];
	disallowedTools?: string[];
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	defaultModel?: string;
	defaultFallbackModel?: string;
	global_setup_script?: string;
	restartCyrus?: boolean;
	backupConfig?: boolean;
}

export interface RepositoryConfigItem {
	id?: string;
	name: string;
	repositoryPath?: string;
	baseBranch?: string;
	linearWorkspaceId?: string;
	linearToken?: string;
	workspaceBaseDir?: string;
	isActive?: boolean;
	allowedTools?: string[];
	mcpConfigPath?: string[];
	teamKeys?: string[];
	labelPrompts?: Record<string, string[]>;
}

export interface CyrusEnvPayload {
	variables: Record<string, string>;
	restartCyrus?: boolean;
	backupEnv?: boolean;
}

export interface EnvVariablesPayload {
	repository: string;
	file_path: string;
	variables: Array<{ key: string; value: string }>;
	append?: boolean;
}

export interface EnvManifest {
	version: string;
	repositories: Record<string, RepositoryConfig>;
}

export interface RepositoryConfig {
	env_files: Record<string, EnvFileConfig>;
}

export interface EnvFileConfig {
	variables: Record<string, string>;
	last_updated: string;
}

export interface MCPServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	transport?: "stdio" | "sse" | "http";
	headers?: Record<string, string>;
}

export interface ConfigureMCPPayload {
	mcpServers: Record<string, MCPServerConfig>;
}

export interface TestMCPPayload {
	transportType: "stdio" | "sse" | "http";
	serverUrl?: string;
	command?: string;
	commandArgs?: Array<{ value: string; order: number }>;
	headers?: Array<{ name: string; value: string }>;
	envVars?: Array<{ key: string; value: string }>;
}

export interface TestMCPResponse {
	success: boolean;
	server_info?: {
		name: string;
		version: string;
	};
	tools?: Array<{
		name: string;
		description?: string;
	}>;
	error?: string;
}

export interface ConfigServerOptions {
	port: number;
	secret: string;
	cyrusHome: string;
	workspacesDir?: string;
	repositoriesDir?: string;
	onConfigUpdate?: (type: string) => void;
}

export interface HealthResponse {
	status: string;
	version: string;
	uptime: number;
}
