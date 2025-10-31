#!/usr/bin/env node

import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentSessionOrchestrator } from "cyrus-orchestrator";
import { FileSessionStorage } from "cyrus-storage";
import express from "express";
import { WebSocketServer } from "ws";
import { BrowserRenderer } from "./BrowserRenderer.js";
import { MockAgentRunner } from "./MockAgentRunner.js";
import { MockIssueTracker } from "./MockIssueTracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3000;
const CYRUS_HOME = process.env.CYRUS_HOME || path.join(os.homedir(), ".cyrusd");
const SESSIONS_DIR = path.join(CYRUS_HOME, "sessions", "browser-demo");

/**
 * Browser Demo Server
 *
 * Serves the browser UI and manages WebSocket connections for real-time updates.
 * Uses the same orchestrator, mock agent runner, and mock issue tracker as the CLI demo.
 */
async function main() {
	console.log("🚀 Starting Cyrus Browser Demo Server...\n");

	// Create Express app
	const app = express();
	const server = createServer(app);

	// Serve static files
	const publicDir = path.join(__dirname, "..", "public");
	console.log(`📂 Serving static files from: ${publicDir}`);
	app.use(express.static(publicDir));

	// Add request logging
	app.use((req, _res, next) => {
		console.log(`📥 ${req.method} ${req.url}`);
		next();
	});

	// Create WebSocket server
	const wss = new WebSocketServer({ server });

	// Initialize components
	console.log("📦 Initializing components...");
	const agentRunner = new MockAgentRunner();
	const issueTracker = new MockIssueTracker();
	const renderer = new BrowserRenderer();
	const storage = new FileSessionStorage(SESSIONS_DIR);

	console.log(`   ✓ Mock Agent Runner`);
	console.log(`   ✓ Mock Issue Tracker`);
	console.log(`   ✓ Browser Renderer`);
	console.log(`   ✓ File Session Storage (${SESSIONS_DIR})`);

	// Create orchestrator
	const orchestrator = new AgentSessionOrchestrator(
		agentRunner,
		issueTracker,
		renderer,
		storage,
		{
			memberId: "agent-1",
			maxConcurrentSessions: 1,
			maxRetries: 3,
		},
	);

	console.log(`   ✓ Agent Session Orchestrator\n`);

	// Handle WebSocket connections
	wss.on("connection", (ws) => {
		console.log("🔌 New browser client connected");
		renderer.addClient(ws);

		ws.on("close", () => {
			console.log("🔌 Browser client disconnected");
		});
	});

	// Set up graceful shutdown
	let isShuttingDown = false;

	const shutdown = async (signal: string) => {
		if (isShuttingDown) {
			return;
		}

		isShuttingDown = true;
		console.log(`\n\n🛑 Received ${signal}, shutting down gracefully...\n`);

		try {
			await orchestrator.stop();
			server.close();
			console.log("✅ Shutdown complete.\n");
			process.exit(0);
		} catch (error) {
			console.error("❌ Error during shutdown:", error);
			process.exit(1);
		}
	};

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	// Set up orchestrator event handlers
	orchestrator.on("started", () => {
		console.log("✨ Orchestrator started");
	});

	orchestrator.on("session:started", (sessionId, issueId) => {
		console.log(`📝 Session started: ${sessionId} for issue ${issueId}`);
	});

	orchestrator.on("session:completed", (sessionId, issueId) => {
		console.log(`✅ Session completed: ${sessionId} for issue ${issueId}`);
	});

	orchestrator.on("session:failed", (sessionId, issueId, error) => {
		console.error(
			`❌ Session failed: ${sessionId} for issue ${issueId}`,
			error,
		);
	});

	orchestrator.on("error", (error, context) => {
		console.error("\n[Orchestrator Error]", error);
		if (context) {
			console.error("[Context]", context);
		}
	});

	// Start the orchestrator
	console.log("🎬 Starting orchestrator...");
	await orchestrator.start();
	console.log("   ✓ Orchestrator watching for issues\n");

	// Start the HTTP server
	server.listen(PORT, () => {
		console.log("━".repeat(60));
		console.log(`🌐 Browser Demo Server running!`);
		console.log(`━`.repeat(60));
		console.log(`\n   📍 URL: http://localhost:${PORT}`);
		console.log(`   📂 Public directory: ${publicDir}`);
		console.log(`   💾 Sessions directory: ${SESSIONS_DIR}`);
		console.log(
			`\n   🎯 Open the URL in your browser to see the interactive demo`,
		);
		console.log(
			`   📊 The demo will automatically start with a mock agent session`,
		);
		console.log(`\n   Press Ctrl+C to stop the server\n`);
		console.log("━".repeat(60));
		console.log();
	});
}

// Run the server
main().catch((error) => {
	console.error("❌ Fatal error:", error);
	if (error instanceof Error) {
		console.error(error.stack);
	}
	process.exit(1);
});
