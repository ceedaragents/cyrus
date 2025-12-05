#!/usr/bin/env bun

/**
 * F1 Server - Testing Framework Server for Cyrus
 *
 * This server starts the EdgeWorker in CLI platform mode, providing
 * a complete testing environment for the Cyrus agent system without
 * external dependencies.
 *
 * Features:
 * - EdgeWorker configured with platform: "cli"
 * - Creates temporary directories for worktrees
 * - Beautiful colored connection info display
 * - Graceful shutdown on SIGINT/SIGTERM
 * - Zero `any` types
 *
 * Usage:
 *   CYRUS_PORT=3600 CYRUS_REPO_PATH=/path/to/repo bun run server.ts
 */

import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAllTools } from "cyrus-claude-runner";
import type { EdgeWorkerConfig, RepositoryConfig } from "cyrus-core";
import { EdgeWorker } from "cyrus-edge-worker";
import { bold, cyan, dim, gray, green, success } from "./src/utils/colors.js";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CYRUS_PORT = Number.parseInt(process.env.CYRUS_PORT || "3600", 10);
const CYRUS_REPO_PATH = process.env.CYRUS_REPO_PATH || process.cwd();
const CYRUS_HOME = join(tmpdir(), `cyrus-f1-${Date.now()}`);

// Validate port
if (Number.isNaN(CYRUS_PORT) || CYRUS_PORT < 1 || CYRUS_PORT > 65535) {
	console.error(`❌ Invalid CYRUS_PORT: ${process.env.CYRUS_PORT}`);
	console.error("   Port must be between 1 and 65535");
	process.exit(1);
}

// Validate repository path
if (!existsSync(CYRUS_REPO_PATH)) {
	console.error(`❌ Repository path does not exist: ${CYRUS_REPO_PATH}`);
	console.error("   Set CYRUS_REPO_PATH to a valid directory");
	process.exit(1);
}

// ============================================================================
// DIRECTORY SETUP
// ============================================================================

/**
 * Create required directories for F1 testing
 */
function setupDirectories(): void {
	const requiredDirs = [
		CYRUS_HOME,
		join(CYRUS_HOME, "repos"),
		join(CYRUS_HOME, "worktrees"),
		join(CYRUS_HOME, "mcp-configs"),
		join(CYRUS_HOME, "state"),
	];

	for (const dir of requiredDirs) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
}

// ============================================================================
// EDGEWORKER CONFIGURATION
// ============================================================================

/**
 * Create EdgeWorker configuration for CLI platform
 */
function createEdgeWorkerConfig(): EdgeWorkerConfig {
	// Create a test repository configuration
	const repository: RepositoryConfig = {
		id: "f1-test-repo",
		name: "F1 Test Repository",
		repositoryPath: CYRUS_REPO_PATH,
		baseBranch: "main",
		linearWorkspaceId: "cli-workspace",
		linearWorkspaceName: "F1 Testing",
		linearToken: "f1-test-token", // Dummy token for CLI mode
		workspaceBaseDir: join(CYRUS_HOME, "worktrees"),
		isActive: true,
	};

	const config: EdgeWorkerConfig = {
		platform: "cli" as const,
		repositories: [repository],
		cyrusHome: CYRUS_HOME,
		serverPort: CYRUS_PORT,
		serverHost: "localhost",
		defaultModel: "sonnet",
		defaultFallbackModel: "haiku",
		// Enable all tools including Edit(**), Bash, etc. for full testing capability
		defaultAllowedTools: getAllTools(),
	};

	return config;
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Display beautiful server connection info
 */
function displayConnectionInfo(): void {
	const divider = gray("─".repeat(60));

	console.log(`\n${divider}`);
	console.log(bold(green("  🏎️  F1 Testing Framework Server")));
	console.log(divider);
	console.log(success("Server started successfully"));
	console.log("");
	console.log(
		`  ${cyan("Server:")}    ${bold(`http://localhost:${CYRUS_PORT}`)}`,
	);
	console.log(
		`  ${cyan("RPC:")}       ${bold(`http://localhost:${CYRUS_PORT}/cli/rpc`)}`,
	);
	console.log(`  ${cyan("Platform:")}  ${bold("cli")}`);
	console.log(`  ${cyan("Cyrus Home:")} ${dim(CYRUS_HOME)}`);
	console.log(`  ${cyan("Repository:")} ${dim(CYRUS_REPO_PATH)}`);
	console.log("");
	console.log(dim("  Press Ctrl+C to stop the server"));
	console.log(`${divider}\n`);
}

/**
 * Main server startup function
 */
async function startServer(): Promise<void> {
	try {
		// Setup directories
		setupDirectories();

		// Create EdgeWorker configuration
		const config = createEdgeWorkerConfig();

		// Initialize EdgeWorker
		const edgeWorker = new EdgeWorker(config);

		// Setup graceful shutdown
		const shutdown = async (signal: string): Promise<void> => {
			console.log(`\n\n${dim(`Received ${signal}, shutting down...`)}`);
			try {
				await edgeWorker.stop();
				console.log(success("Server stopped gracefully"));
				process.exit(0);
			} catch (error) {
				console.error(`❌ Error during shutdown: ${error}`);
				process.exit(1);
			}
		};

		process.on("SIGINT", () => shutdown("SIGINT"));
		process.on("SIGTERM", () => shutdown("SIGTERM"));

		// Start EdgeWorker
		await edgeWorker.start();

		// Display connection info
		displayConnectionInfo();
	} catch (error) {
		console.error(`❌ Failed to start server: ${error}`);
		if (error instanceof Error) {
			console.error(dim(`   ${error.message}`));
			if (error.stack) {
				console.error(dim(error.stack));
			}
		}
		process.exit(1);
	}
}

// ============================================================================
// RUN
// ============================================================================

startServer();
