export interface CyrusAPI {
	getConfig: () => Promise<{
		proxyUrl?: string;
		workspaceId?: string;
		workspaceName?: string;
		claudePath?: string;
		workspaceBaseDir?: string;
	}>;
	saveConfig: (config: any) => Promise<void>;
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
	getConnectionStatus: () => Promise<{
		connected: boolean;
		proxyUrl: string;
		hasToken: boolean;
	}>;
	startOAuth: () => Promise<void>;
	selectFile: () => Promise<string | null>;
	selectFolder: () => Promise<string | null>;
	validatePaths: (paths: {
		claudePath?: string;
		repository?: string;
		workspaceBaseDir?: string;
	}) => Promise<Record<string, string>>;
	onSetupComplete: (callback: (data: any) => void) => void;
	onSetupError: (callback: (error: string) => void) => void;
	onProxyConnected: (callback: () => void) => void;
	onProxyDisconnected: (callback: () => void) => void;
	onEventProcessed: (callback: (event: any) => void) => void;
	onEventError: (callback: (data: any) => void) => void;
	removeAllListeners: (channel: string) => void;
}

declare global {
	interface Window {
		cyrus: CyrusAPI;
	}
}
