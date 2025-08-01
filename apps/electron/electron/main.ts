import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	app,
	BrowserWindow,
	dialog,
	ipcMain,
	Menu,
	shell,
	Tray,
} from "electron";
import { Conf } from "electron-conf/main";
import { EventProcessor } from "./event-processor";
import { NdjsonClient } from "./ndjson-client";

// Add isQuitting property to app
const extendedApp = app as typeof app & { isQuitting?: boolean };

const store = new Conf({
	defaults: {
		claudePath: "/usr/local/bin/claude",
		workspaceBaseDir: join(app.getPath("home"), "cyrus-workspaces"),
	},
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let ndjsonClient: NdjsonClient | null = null;
let eventProcessor: EventProcessor | null = null;
let isConnecting = false;

// Register cyrus:// protocol
if (process.defaultApp) {
	if (process.argv.length >= 2) {
		app.setAsDefaultProtocolClient("cyrus", process.execPath, [
			process.argv[1],
		]);
	}
} else {
	app.setAsDefaultProtocolClient("cyrus");
}

// Handle protocol on Windows/Linux
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, commandLine) => {
		// Someone tried to run a second instance, we should focus our window instead.
		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}

		// Handle cyrus:// protocol
		const url = commandLine.find((arg) => arg.startsWith("cyrus://"));
		if (url) {
			handleCyrusProtocol(url);
		}
	});
}

function createWindow(): void {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: join(__dirname, "preload.js"),
			sandbox: false,
		},
	});

	mainWindow.on("ready-to-show", () => {
		mainWindow?.show();
	});

	mainWindow.webContents.setWindowOpenHandler((details) => {
		shell.openExternal(details.url);
		return { action: "deny" };
	});

	// Development vs production loading
	if (process.env.ELECTRON_RENDERER_URL) {
		mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
	} else {
		mainWindow.loadFile(join(__dirname, "../dist/index.html"));
	}

	// Hide instead of close
	mainWindow.on("close", (event) => {
		if (!extendedApp.isQuitting) {
			event.preventDefault();
			mainWindow?.hide();
		}
	});
}

function createTray() {
	try {
		// Use template icon for macOS
		const iconPath =
			process.platform === "darwin"
				? join(__dirname, "../../resources/tray-iconTemplate.png")
				: join(__dirname, "../../resources/tray-icon.png");

		console.log("Creating tray with icon path:", iconPath);

		tray = new Tray(iconPath);

		const contextMenu = Menu.buildFromTemplate([
			{ label: "Show Dashboard", click: () => mainWindow?.show() },
			{ type: "separator" },
			{
				label: "Quit Cyrus",
				click: () => {
					extendedApp.isQuitting = true;
					app.quit();
				},
			},
		]);

		tray.setToolTip("Cyrus");
		tray.setContextMenu(contextMenu);

		tray.on("click", () => {
			mainWindow?.show();
		});
	} catch (error) {
		console.error("Failed to create tray:", error);
	}
}

function handleCyrusProtocol(url: string) {
	try {
		const parsedUrl = new URL(url);

		if (parsedUrl.hostname === "setup") {
			const params = parsedUrl.searchParams;
			const config = {
				proxyUrl: params.get("proxyUrl"),
				edgeToken: params.get("edgeToken"),
				linearToken: params.get("linearToken"),
				workspaceId: params.get("workspaceId"),
				workspaceName: params.get("workspaceName"),
				timestamp: parseInt(params.get("timestamp") || "0"),
			};

			// Validate timestamp (5 minute expiry)
			if (Date.now() - config.timestamp > 5 * 60 * 1000) {
				mainWindow?.webContents.send("setup-error", "Setup link has expired");
				return;
			}

			// Store configuration
			store.set("proxyUrl", config.proxyUrl);
			store.set("edgeToken", config.edgeToken);
			store.set("linearToken", config.linearToken);
			store.set("workspaceId", config.workspaceId);
			store.set("workspaceName", config.workspaceName);

			// Connect to proxy
			connectToProxy();

			// Notify renderer
			mainWindow?.webContents.send("setup-complete", {
				workspaceId: config.workspaceId,
				workspaceName: config.workspaceName,
			});
		}
	} catch (error) {
		console.error("Error handling cyrus:// protocol:", error);
		mainWindow?.webContents.send(
			"setup-error",
			error instanceof Error ? error.message : String(error),
		);
	}
}

async function connectToProxy() {
	console.log("[Main] connectToProxy called");

	// Prevent concurrent connections
	if (isConnecting) {
		console.log("[Main] Already connecting, skipping");
		return;
	}

	// Check if already connected
	if (ndjsonClient?.isConnected()) {
		console.log("[Main] Already connected");
		return;
	}

	isConnecting = true;

	try {
		// Disconnect existing client if any
		if (ndjsonClient) {
			console.log("[Main] Disconnecting existing client");
			await ndjsonClient.disconnect();
			ndjsonClient = null;
		}

		const proxyUrl = store.get("proxyUrl") as string;
		const edgeToken = store.get("edgeToken") as string;
		const linearToken = store.get("linearToken") as string;

		if (!proxyUrl || !edgeToken) {
			console.error("Missing proxy configuration");
			isConnecting = false;
			return;
		}

		console.log(`[Main] Connecting to proxy at ${proxyUrl}`);

		// Initialize event processor
		eventProcessor = new EventProcessor({
			linearToken,
			claudePath: store.get("claudePath") as string,
			workspaceBaseDir: store.get("workspaceBaseDir") as string,
		});

		// Listen to EventProcessor events
		eventProcessor.on("session-started", (data) => {
			console.log("Session started:", data);
			mainWindow?.webContents.send("session-started", data);
		});

		eventProcessor.on("session-ended", (data) => {
			console.log("Session ended:", data);
			mainWindow?.webContents.send("session-ended", data);
		});

		// Initialize NDJSON client
		ndjsonClient = new NdjsonClient(proxyUrl, edgeToken);

		ndjsonClient.on("event", async (event) => {
			try {
				if (eventProcessor) {
					await eventProcessor.processEvent(event);
					mainWindow?.webContents.send("event-processed", event);
				}
			} catch (error) {
				console.error("Error processing event:", error);
				mainWindow?.webContents.send("event-error", {
					event,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});

		ndjsonClient.on("connect", () => {
			mainWindow?.webContents.send("proxy-connected");
		});

		ndjsonClient.on("disconnect", () => {
			mainWindow?.webContents.send("proxy-disconnected");
		});

		await ndjsonClient.connect();
	} finally {
		isConnecting = false;
	}
}

// App event handlers
app.whenReady().then(() => {
	console.log("App ready, creating window...");

	// Handle cyrus:// protocol on macOS
	app.on("open-url", (event, url) => {
		event.preventDefault();
		handleCyrusProtocol(url);
	});

	createWindow();
	createTray();

	// Auto-connect if configured
	if (store.get("proxyUrl") && store.get("edgeToken")) {
		connectToProxy();
	}
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow();
	}
});

// IPC handlers
ipcMain.handle("get-config", () => {
	// Return all stored config
	return store.store;
});

ipcMain.handle("get-connection-status", () => {
	return {
		connected: ndjsonClient?.isConnected() || false,
		proxyUrl: store.get("proxyUrl") as string,
		hasToken: !!store.get("edgeToken"),
	};
});

ipcMain.handle("save-config", (_, config) => {
	Object.entries(config).forEach(([key, value]) => {
		if (value !== undefined && value !== null) {
			store.set(key, value);
		}
	});
});

ipcMain.handle("connect", async () => {
	await connectToProxy();
});

ipcMain.handle("disconnect", async () => {
	await ndjsonClient?.disconnect();
	ndjsonClient = null;
	eventProcessor = null;
});

ipcMain.handle("start-oauth", async () => {
	const proxyUrl = (store.get("proxyUrl") as string) || "http://localhost:3456";
	shell.openExternal(`${proxyUrl}/oauth/authorize`);
});

ipcMain.handle("get-active-sessions", () => {
	return eventProcessor?.getActiveSessions() || [];
});

ipcMain.handle("select-file", async () => {
	const result = await dialog.showOpenDialog(mainWindow!, {
		properties: ["openFile"],
		filters: [
			{ name: "Executable", extensions: ["exe", "sh", "command", "app", ""] },
			{ name: "All Files", extensions: ["*"] },
		],
	});

	if (!result.canceled && result.filePaths.length > 0) {
		return result.filePaths[0];
	}
	return null;
});

ipcMain.handle("select-folder", async () => {
	const result = await dialog.showOpenDialog(mainWindow!, {
		properties: ["openDirectory", "createDirectory"],
	});

	if (!result.canceled && result.filePaths.length > 0) {
		return result.filePaths[0];
	}
	return null;
});

ipcMain.handle(
	"validate-paths",
	async (
		_,
		paths: {
			claudePath?: string;
			repository?: string;
			workspaceBaseDir?: string;
		},
	) => {
		const errors: Record<string, string> = {};

		if (paths.claudePath) {
			// Expand ~ to home directory
			const expandedPath = paths.claudePath.replace(/^~/, app.getPath("home"));
			if (!existsSync(expandedPath)) {
				errors.claudePath = "Claude executable not found at this path";
			}
		}

		if (paths.repository) {
			const expandedPath = paths.repository.replace(/^~/, app.getPath("home"));
			if (!existsSync(expandedPath)) {
				errors.repository = "Repository directory not found";
			}
		}

		if (paths.workspaceBaseDir) {
			const expandedPath = paths.workspaceBaseDir.replace(
				/^~/,
				app.getPath("home"),
			);
			// For workspace directory, we'll create it if it doesn't exist
			// So we just check if the parent directory exists
			const parentDir = join(expandedPath, "..");
			if (!existsSync(parentDir)) {
				errors.workspaceBaseDir = "Parent directory does not exist";
			}
		}

		return errors;
	},
);
