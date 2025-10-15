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
