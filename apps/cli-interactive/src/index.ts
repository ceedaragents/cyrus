#!/usr/bin/env node

import * as os from "node:os";
import * as path from "node:path";
import { ClaudeAgentRunner } from "@cyrus/agent-runners/claude";
import { CLIRenderer } from "@cyrus/renderers/cli";
import { AgentSessionOrchestrator } from "cyrus-orchestrator";
import { FileSessionStorage } from "cyrus-storage";
import { config as loadEnv } from "dotenv";
import { MockAgentRunner } from "./MockAgentRunner.js";
import { MockIssueTracker } from "./MockIssueTracker.js";

/**
 * Command-line argument parser
 */
interface CLIArgs {
	issue?: string;
	demo?: boolean;
	help?: boolean;
	cyrusHome?: string;
	workingDir?: string;
}

function parseArgs(args: string[]): CLIArgs {
	const parsed: CLIArgs = {};

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (arg === "--help" || arg === "-h") {
			parsed.help = true;
		} else if (arg === "--demo") {
			parsed.demo = true;
		} else if (arg === "--issue") {
			parsed.issue = args[++i];
		} else if (arg === "--cyrus-home") {
			parsed.cyrusHome = args[++i];
		} else if (arg === "--working-dir" || arg === "--cwd") {
			parsed.workingDir = args[++i];
		}
	}

	return parsed;
}

function printHelp(): void {
	console.log(`
Cyrus CLI Interactive - Interactive terminal UI for agent sessions

USAGE:
  cyrus-cli-interactive [OPTIONS]

OPTIONS:
  --issue <ID>        Issue ID or identifier to work on (e.g., CYPACK-264, DEMO-1)
  --demo              Run in demo mode with mock components (no real Claude/Linear)
  --cyrus-home <DIR>  Cyrus home directory (default: ~/.cyrusd)
  --working-dir <DIR> Working directory for the session (default: current directory)
  --help, -h          Show this help message

EXAMPLES:
  # Run in demo mode (no credentials needed)
  cyrus-cli-interactive --demo --issue DEMO-1

  # Work on a real Linear issue (requires ANTHROPIC_API_KEY)
  cyrus-cli-interactive --issue CYPACK-264

  # Specify custom directories
  cyrus-cli-interactive --demo --cyrus-home /tmp/cyrus --working-dir /path/to/project

ENVIRONMENT VARIABLES:
  ANTHROPIC_API_KEY   API key for Claude (required for real mode)
  CYRUS_HOME          Cyrus home directory (default: ~/.cyrusd)

INTERACTIVE CONTROLS:
  Type a message      Send a message to the agent
  Ctrl+S             Send stop signal to agent
  Ctrl+C             Exit the application

For more information, see the README.md file.
`);
}

/**
 * Main entry point
 */
async function main() {
	// Load environment variables
	loadEnv();

	// Parse command-line arguments
	const args = parseArgs(process.argv.slice(2));

	if (args.help) {
		printHelp();
		process.exit(0);
	}

	// Determine mode
	const demoMode = args.demo ?? false;
	const issueId = args.issue || "DEMO-1";

	console.log("\n🚀 Cyrus CLI Interactive\n");
	console.log(`Mode: ${demoMode ? "DEMO" : "REAL"}`);
	console.log(`Issue: ${issueId}\n`);

	if (!demoMode && !process.env.ANTHROPIC_API_KEY) {
		console.error(
			"❌ Error: ANTHROPIC_API_KEY environment variable is required for real mode.",
		);
		console.error("   Set it in your .env file or run with --demo flag.\n");
		process.exit(1);
	}

	try {
		// Determine directories
		const cyrusHome =
			args.cyrusHome ||
			process.env.CYRUS_HOME ||
			path.join(os.homedir(), ".cyrusd");
		const workingDir = args.workingDir || process.cwd();
		const sessionsDir = path.join(cyrusHome, "sessions");

		console.log(`Cyrus home: ${cyrusHome}`);
		console.log(`Working directory: ${workingDir}`);
		console.log(`Sessions directory: ${sessionsDir}\n`);

		// Initialize components based on mode
		let agentRunner: MockAgentRunner | ClaudeAgentRunner;
		let issueTracker: MockIssueTracker;

		if (demoMode) {
			console.log("✨ Initializing demo components...\n");
			agentRunner = new MockAgentRunner();
			issueTracker = new MockIssueTracker();
		} else {
			console.log("🔧 Initializing real components...\n");
			agentRunner = new ClaudeAgentRunner({
				cyrusHome,
			});

			// For real mode, we'd need to initialize LinearIssueTracker
			// For now, fallback to mock
			console.warn(
				"⚠️  Warning: Real LinearIssueTracker not implemented yet, using mock.\n",
			);
			issueTracker = new MockIssueTracker();
		}

		// Initialize renderer and storage
		const renderer = new CLIRenderer({
			verboseFormatting: true,
			maxActivities: 100,
		});

		const storage = new FileSessionStorage(sessionsDir);

		// Create orchestrator
		const orchestrator = new AgentSessionOrchestrator(
			agentRunner,
			issueTracker,
			renderer,
			storage,
			{
				memberId: "agent-1", // Mock member ID
				maxConcurrentSessions: 1,
				maxRetries: 3,
			},
		);

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
				renderer.stop();
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
			console.log("📡 Orchestrator started\n");
		});

		orchestrator.on("session:started", (sessionId, issueId) => {
			console.log(`✅ Session started: ${sessionId} for issue ${issueId}\n`);
		});

		orchestrator.on("session:completed", (sessionId, issueId) => {
			console.log(
				`\n✅ Session completed: ${sessionId} for issue ${issueId}\n`,
			);
		});

		orchestrator.on("session:failed", (sessionId, issueId, error) => {
			console.error(`\n❌ Session failed: ${sessionId} for issue ${issueId}`);
			console.error(`   Error: ${error.message}\n`);
		});

		orchestrator.on("error", (error, context) => {
			console.error(`\n❌ Orchestrator error:`, error);
			if (context) {
				console.error(`   Context:`, context);
			}
		});

		// Start the orchestrator
		await orchestrator.start();

		// Get the issue and start a session
		console.log(`📋 Fetching issue: ${issueId}...\n`);
		const issue = await issueTracker.getIssue(issueId);

		console.log(`📝 Issue: ${issue.title}`);
		console.log(`   ${issue.description.split("\n")[0]}\n`);

		console.log(`🎬 Starting agent session...\n`);
		await orchestrator.startSession(issue, {
			workingDirectory: workingDir,
		});

		console.log(
			"🎨 Rendering interactive UI below. Type messages to interact with the agent.\n",
		);
		console.log("─".repeat(80));
		console.log();

		// Keep the process running
		// The orchestrator and renderer will handle everything from here
		// The process will exit when user presses Ctrl+C
	} catch (error) {
		console.error("\n❌ Fatal error:", error);
		if (error instanceof Error) {
			console.error(error.stack);
		}
		process.exit(1);
	}
}

// Run the main function
main().catch((error) => {
	console.error("Unhandled error:", error);
	process.exit(1);
});
