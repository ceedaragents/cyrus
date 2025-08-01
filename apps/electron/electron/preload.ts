import { contextBridge, ipcRenderer } from "electron";

// Define types for better TypeScript support
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
	getConnectionStatus: () => Promise<any>;
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

// Custom APIs for renderer
const api: CyrusAPI = {
	// Config management
	getConfig: () => ipcRenderer.invoke("get-config"),
	saveConfig: (config: any) => ipcRenderer.invoke("save-config", config),

	// Connection management
	connect: () => ipcRenderer.invoke("connect"),
	disconnect: () => ipcRenderer.invoke("disconnect"),
	getConnectionStatus: () => ipcRenderer.invoke("get-connection-status"),
	startOAuth: () => ipcRenderer.invoke("start-oauth"),

	// File/folder selection
	selectFile: () => ipcRenderer.invoke("select-file"),
	selectFolder: () => ipcRenderer.invoke("select-folder"),
	validatePaths: (paths) => ipcRenderer.invoke("validate-paths", paths),

	// Event listeners
	onSetupComplete: (callback: (data: any) => void) => {
		ipcRenderer.on("setup-complete", (_, data) => callback(data));
	},
	onSetupError: (callback: (error: string) => void) => {
		ipcRenderer.on("setup-error", (_, error) => callback(error));
	},
	onProxyConnected: (callback: () => void) => {
		ipcRenderer.on("proxy-connected", callback);
	},
	onProxyDisconnected: (callback: () => void) => {
		ipcRenderer.on("proxy-disconnected", callback);
	},
	onEventProcessed: (callback: (event: any) => void) => {
		ipcRenderer.on("event-processed", (_, event) => callback(event));
	},
	onEventError: (callback: (data: any) => void) => {
		ipcRenderer.on("event-error", (_, data) => callback(data));
	},

	// Remove listeners
	removeAllListeners: (channel: string) => {
		ipcRenderer.removeAllListeners(channel);
	},
};

// Use contextBridge to expose protected methods
if (process.contextIsolated) {
	try {
		contextBridge.exposeInMainWorld("cyrus", api);
	} catch (error) {
		console.error(error);
	}
} else {
	(globalThis as any).cyrus = api;
}

// TypeScript declarations
declare global {
	interface Window {
		cyrus: CyrusAPI;
	}
}
