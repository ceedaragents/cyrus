#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunner } from "@cyrus/agent-runners";
import { ClaudeAgentRunner } from "@cyrus/agent-runners";
import { AgentSessionOrchestrator } from "cyrus-orchestrator";
import { FileSessionStorage } from "cyrus-storage";
import express from "express";
import { WebSocketServer } from "ws";
import { BrowserRenderer } from "./BrowserRenderer.js";
import { MockAgentRunner } from "./MockAgentRunner.js";
import { MockIssueTracker } from "./MockIssueTracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command-line arguments
interface CLIArgs {
	demo?: boolean;
	port?: number;
	help?: boolean;
}

function parseArgs(args: string[]): CLIArgs {
	const parsed: CLIArgs = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			parsed.help = true;
		} else if (arg === "--demo") {
			parsed.demo = true;
		} else if (arg === "--port" || arg === "-p") {
			const portArg = args[++i];
			if (portArg) {
				parsed.port = Number.parseInt(portArg, 10);
			}
		}
	}

	return parsed;
}

function printHelp(): void {
	console.log(`
Cyrus Browser Demo - Browser-based interactive agent session viewer

USAGE:
  cyrus-browser-demo [OPTIONS]

OPTIONS:
  --demo              Run in demo mode with mock components (no real Claude/Linear)
  --port, -p <PORT>   Port to run the server on (default: 3000)
  --help, -h          Show this help message

EXAMPLES:
  # Run in demo mode (no credentials needed)
  cyrus-browser-demo --demo

  # Run with real Claude (requires authentication)
  cyrus-browser-demo

  # Run on custom port
  cyrus-browser-demo --port 8080

ENVIRONMENT VARIABLES:
  CLAUDE_CODE_OAUTH_TOKEN  OAuth token for Claude (recommended, get via: claude setup-token)
  ANTHROPIC_API_KEY        API key for Claude (alternative to OAuth token)
  CYRUS_HOME               Cyrus home directory (default: ~/.cyrusd)
  PORT                     Port to run the server on (default: 3000)

  Note: Use either CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY, not both

For more information, see the README.md file.
`);
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
	printHelp();
	process.exit(0);
}

// Configuration
const DEMO_MODE = args.demo ?? false;
const PORT = args.port || Number.parseInt(process.env.PORT || "3000", 10);
const CYRUS_HOME = process.env.CYRUS_HOME || path.join(os.homedir(), ".cyrusd");
const SESSIONS_DIR = path.join(CYRUS_HOME, "sessions", "browser-demo");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;

/**
 * Browser Demo Server
 *
 * Serves the browser UI and manages WebSocket connections for real-time updates.
 * Supports both demo mode (mock) and real mode (Claude Code).
 */
async function main() {
	console.log("🚀 Starting Cyrus Browser Demo Server...\n");

	// Validate authentication for real mode
	if (!DEMO_MODE) {
		const hasApiKey = !!ANTHROPIC_API_KEY;
		const hasOAuthToken = !!CLAUDE_CODE_OAUTH_TOKEN;

		if (!hasApiKey && !hasOAuthToken) {
			console.error("❌ Error: Authentication required for real mode");
			console.error("   Set one of the following environment variables:");
			console.error(
				"   - CLAUDE_CODE_OAUTH_TOKEN (recommended, get via: claude setup-token)",
			);
			console.error("   - ANTHROPIC_API_KEY");
			console.error("   Or run with --demo flag for demo mode\n");
			process.exit(1);
		}

		if (hasApiKey && hasOAuthToken) {
			console.error(
				"❌ Error: Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set",
			);
			console.error("   Please use only one authentication method");
			console.error("   Unset one of the environment variables\n");
			process.exit(1);
		}
	}

	// Create Express app
	const app = express();
	const server = createServer(app);

	// Serve static files
	// Support both running from dist/ and from project root
	let publicDir = path.join(__dirname, "..", "public");
	if (!existsSync(publicDir)) {
		publicDir = path.join(__dirname, "public");
	}
	console.log(`📂 Serving static files from: ${publicDir}`);
	app.use(express.static(publicDir));

	// Add request logging
	app.use((req, _res, next) => {
		console.log(`📥 ${req.method} ${req.url}`);
		next();
	});

	// Create WebSocket server
	const wss = new WebSocketServer({ server });

	// Initialize components based on mode
	console.log("📦 Initializing components...");

	let agentRunner: AgentRunner;

	if (DEMO_MODE) {
		agentRunner = new MockAgentRunner();
		console.log(`   ✓ Mock Agent Runner (demo mode)`);
	} else {
		agentRunner = new ClaudeAgentRunner({
			cyrusHome: CYRUS_HOME,
		});
		console.log(`   ✓ Claude Agent Runner (real Claude Code)`);
	}

	const issueTracker = new MockIssueTracker();
	const renderer = new BrowserRenderer();
	const storage = new FileSessionStorage(SESSIONS_DIR);

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
		console.log("━".repeat(60));
		console.log(`\n   📍 URL: http://localhost:${PORT}`);
		console.log(`   📂 Public directory: ${publicDir}`);
		console.log(`   💾 Sessions directory: ${SESSIONS_DIR}`);
		console.log(
			`   🎭 Mode: ${DEMO_MODE ? "Demo (mock responses)" : "Real (Claude Code)"}`,
		);
		console.log(
			`\n   🎯 Open the URL in your browser to see the interactive demo`,
		);
		if (!DEMO_MODE) {
			console.log(
				`   🤖 Using real Claude Code agent - sessions will show actual Claude responses`,
			);
		}
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
