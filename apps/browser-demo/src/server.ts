#!/usr/bin/env node

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRunner } from "@cyrus/agent-runners";
import { ClaudeAgentRunner } from "@cyrus/agent-runners";
import { MasterSessionManager } from "cyrus-orchestrator";
import { FileSessionStorage } from "cyrus-storage";
import express from "express";
import { WebSocketServer } from "ws";
import { BrowserRenderer } from "./BrowserRenderer.js";
import { MockAgentRunner } from "./MockAgentRunner.js";
import { MockIssueTracker } from "./MockIssueTracker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Handle test control messages from the browser client
 */
function handleTestControlMessage(
	ws: any,
	message: any,
	context: {
		orchestrator: any;
		issueTracker: MockIssueTracker;
		storage: FileSessionStorage;
		agentRunner: AgentRunner;
	},
): void {
	const { issueTracker, storage } = context;
	// agentRunner available in context for future use

	switch (message.type) {
		case "test:switch-runner":
			// Note: Runner switching requires server restart
			// This is a UI-only acknowledgment
			console.log(
				`[Test Control] Runner mode switch requested: ${message.mode}`,
			);
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "success",
					message: `Note: Switching runner modes requires server restart with --fake-data flag or without`,
				}),
			);
			break;

		case "test:create-issue":
			console.log(`[Test Control] Creating test issue: ${message.title}`);
			// The MockIssueTracker doesn't have a public createIssue method
			// But we can simulate it by triggering an assignment event
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "success",
					message: "Test issue creation simulated",
				}),
			);
			break;

		case "test:list-issues": {
			console.log("[Test Control] Listing all issues");
			const issues = (issueTracker as any).getAllIssues?.() || [];
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "list-issues",
					data: issues,
				}),
			);
			break;
		}

		case "test:simulate-comment":
			console.log(
				`[Test Control] Simulating comment for session: ${message.sessionId}`,
			);
			// Use the MockIssueTracker's simulateUserComment method
			if (typeof (issueTracker as any).simulateUserComment === "function") {
				// Find the issue ID from the session
				const issues = (issueTracker as any).getAllIssues?.() || [];
				if (issues.length > 0) {
					(issueTracker as any).simulateUserComment(
						issues[0].id,
						message.comment,
					);
				}
			}
			break;

		case "test:view-storage": {
			console.log("[Test Control] Viewing stored sessions");
			// List all session files
			const sessionsDir = (storage as any).sessionsDir;
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "view-storage",
					data: {
						directory: sessionsDir,
						message: "Session storage location",
					},
				}),
			);
			break;
		}

		case "test:load-session":
			console.log(`[Test Control] Loading session: ${message.sessionId}`);
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "success",
					message: "Session loading not yet implemented",
				}),
			);
			break;

		case "test:clear-storage":
			console.log("[Test Control] Clearing all sessions");
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "success",
					message:
						"Manual deletion required - check CYRUS_HOME/sessions/browser-demo",
				}),
			);
			break;

		case "test:run-scenario":
			console.log(`[Test Control] Running test scenario: ${message.scenario}`);
			runTestScenario(message.scenario, { issueTracker });
			ws.send(
				JSON.stringify({
					type: "test:response",
					action: "success",
					message: `Test scenario "${message.scenario}" started`,
				}),
			);
			break;

		default:
			console.log(`[Test Control] Unknown message type: ${message.type}`);
	}
}

/**
 * Run a predefined test scenario
 */
function runTestScenario(
	scenario: string,
	context: { issueTracker: MockIssueTracker },
): void {
	const { issueTracker } = context;

	const scenarios: Record<string, () => void> = {
		basic: () => {
			console.log("[Scenario] Running basic scenario: Simple file edit");
			// Simulate a user comment for a basic edit task
			const issues = (issueTracker as any).getAllIssues?.() || [];
			if (issues.length > 0) {
				(issueTracker as any).simulateUserComment?.(
					issues[0].id,
					"Please update the README file with better documentation",
				);
			}
		},
		"multi-turn": () => {
			console.log("[Scenario] Running multi-turn scenario: Conversation flow");
			const issues = (issueTracker as any).getAllIssues?.() || [];
			if (issues.length > 0) {
				setTimeout(() => {
					(issueTracker as any).simulateUserComment?.(
						issues[0].id,
						"Can you add unit tests for the new feature?",
					);
				}, 2000);
				setTimeout(() => {
					(issueTracker as any).simulateUserComment?.(
						issues[0].id,
						"Also update the changelog",
					);
				}, 5000);
			}
		},
		"error-handling": () => {
			console.log("[Scenario] Running error handling scenario");
			const issues = (issueTracker as any).getAllIssues?.() || [];
			if (issues.length > 0) {
				(issueTracker as any).simulateUserComment?.(
					issues[0].id,
					"Try to read a file that doesn't exist",
				);
			}
		},
		"file-ops": () => {
			console.log("[Scenario] Running file operations scenario");
			const issues = (issueTracker as any).getAllIssues?.() || [];
			if (issues.length > 0) {
				(issueTracker as any).simulateUserComment?.(
					issues[0].id,
					"Create a new file called example.ts, write some code, then read it back",
				);
			}
		},
		"long-running": () => {
			console.log("[Scenario] Running long-running scenario");
			const issues = (issueTracker as any).getAllIssues?.() || [];
			if (issues.length > 0) {
				(issueTracker as any).simulateUserComment?.(
					issues[0].id,
					"Implement a complete feature with multiple files, tests, and documentation",
				);
			}
		},
	};

	const scenarioFn = scenarios[scenario];
	if (scenarioFn) {
		scenarioFn();
	} else {
		console.error(`[Scenario] Unknown scenario: ${scenario}`);
	}
}

// Parse command-line arguments
interface CLIArgs {
	fakeData?: boolean;
	port?: number;
	help?: boolean;
}

function parseArgs(args: string[]): CLIArgs {
	const parsed: CLIArgs = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			parsed.help = true;
		} else if (arg === "--fake-data") {
			parsed.fakeData = true;
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
  --fake-data         Run in fake data mode with mock responses (no real Claude/Linear)
  --port, -p <PORT>   Port to run the server on (default: 3000)
  --help, -h          Show this help message

EXAMPLES:
  # Run in fake data mode (no credentials needed)
  cyrus-browser-demo --fake-data

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
const FAKE_DATA_MODE = args.fakeData ?? false;
const PORT = args.port || Number.parseInt(process.env.PORT || "3000", 10);
const CYRUS_HOME = process.env.CYRUS_HOME || path.join(os.homedir(), ".cyrusd");
const SESSIONS_DIR = path.join(CYRUS_HOME, "sessions", "browser-demo");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;

/**
 * Browser Demo Server
 *
 * Serves the browser UI and manages WebSocket connections for real-time updates.
 * Supports both fake data mode (mock) and real mode (Claude Code).
 */
async function main() {
	console.log("🚀 Starting Cyrus Browser Demo Server...\n");

	// Validate authentication for real mode
	if (!FAKE_DATA_MODE) {
		const hasApiKey = !!ANTHROPIC_API_KEY;
		const hasOAuthToken = !!CLAUDE_CODE_OAUTH_TOKEN;

		if (!hasApiKey && !hasOAuthToken) {
			console.error("❌ Error: Authentication required for real mode");
			console.error("   Set one of the following environment variables:");
			console.error(
				"   - CLAUDE_CODE_OAUTH_TOKEN (recommended, get via: claude setup-token)",
			);
			console.error("   - ANTHROPIC_API_KEY");
			console.error("   Or run with --fake-data flag for fake data mode\n");
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

	if (FAKE_DATA_MODE) {
		agentRunner = new MockAgentRunner();
		console.log(`   ✓ Mock Agent Runner (fake data mode)`);
	} else {
		agentRunner = new ClaudeAgentRunner({
			cyrusHome: CYRUS_HOME,
		});
		console.log(`   ✓ Claude Agent Runner (real Claude Code)`);
	}

	const issueTracker = new MockIssueTracker();
	const renderer = new BrowserRenderer();
	const storage = new FileSessionStorage(SESSIONS_DIR);

	// Wire IssueTracker to BrowserRenderer for proper comment-based message flow
	// This enables the browser emulator to work like Linear's "prompted" webhook
	renderer.setIssueTracker(issueTracker);

	console.log(`   ✓ Mock Issue Tracker`);
	console.log(`   ✓ Browser Renderer (with IssueTracker integration)`);
	console.log(`   ✓ File Session Storage (${SESSIONS_DIR})`);

	// Create orchestrator
	const orchestrator = new MasterSessionManager(
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

	console.log(`   ✓ Master Session Manager\n`);

	// Handle WebSocket connections
	wss.on("connection", (ws) => {
		console.log("🔌 New browser client connected");
		renderer.addClient(ws);

		// Handle test control messages (renderer.addClient already handles user:* messages)
		ws.on("message", (data: Buffer) => {
			try {
				const message = JSON.parse(data.toString());
				// Only handle test:* messages here, let renderer handle user:* messages
				if (message.type?.startsWith("test:")) {
					handleTestControlMessage(ws, message, {
						orchestrator,
						issueTracker,
						storage,
						agentRunner,
					});
				}
				// user:message and user:stop are handled by BrowserRenderer.addClient
			} catch (error) {
				console.error("Failed to parse WebSocket message:", error);
			}
		});

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
			`   🎭 Mode: ${FAKE_DATA_MODE ? "Fake data mode (mock responses)" : "Real (Claude Code)"}`,
		);
		console.log(
			`\n   🎯 Open the URL in your browser to see the interactive demo`,
		);
		if (!FAKE_DATA_MODE) {
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
