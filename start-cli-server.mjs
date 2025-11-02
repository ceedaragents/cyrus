#!/usr/bin/env node
/**
 * 🏎️  Start Cyrus CLI Platform Server
 *
 * A beautiful, portable server startup script for the Cyrus CLI platform.
 * No absolute paths required!
 *
 * Usage:
 *   node start-cli-server.mjs [port]
 *   CYRUS_PORT=8080 node start-cli-server.mjs
 *
 * Environment:
 *   CYRUS_PORT - Server port (default: 3457)
 */

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Get the directory where this script is located
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import EdgeWorker using relative path from script location
const { EdgeWorker } = await import(join(__dirname, "packages/edge-worker/dist/EdgeWorker.js"));

// ANSI color codes
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  success: (text) => `\x1b[32m${text}\x1b[0m`,
  info: (text) => `\x1b[36m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  dim: (text) => `\x1b[2m${text}\x1b[0m`,
};

const DEFAULT_PORT = 3457;
const port = parseInt(process.env.CYRUS_PORT || process.argv[2] || DEFAULT_PORT);

async function main() {
  console.log(c.bold("\n🏎️  Cyrus CLI Platform Server\n"));
  console.log(c.dim("   Starting up...\n"));

  // Create temporary directories
  const cyrusHome = join(tmpdir(), "cyrus-cli-server");
  await mkdir(cyrusHome, { recursive: true });
  await mkdir(join(cyrusHome, "worktrees"), { recursive: true });

  console.log(c.dim(`   Directory: ${cyrusHome}`));
  console.log(c.dim(`   Port: ${port}\n`));

  // Configure EdgeWorker with CLI platform
  const config = {
    cyrusHome,
    serverPort: port,
    repositories: [
      {
        id: "cli-repo",
        name: "CLI Repository",
        repositoryPath: process.cwd(),
        baseBranch: "main",
        workspaceBaseDir: join(cyrusHome, "worktrees"),
        platform: "cli",
        linearWorkspaceId: "cli-workspace",
        teamKeys: ["CLI"],
      },
    ],
    agentHandle: "cyrus",
    agentUserId: "agent-user-1",
  };

  const edgeWorker = new EdgeWorker(config);
  await edgeWorker.start();

  console.log(c.success("\n✅ Server is running!\n"));
  console.log(c.bold("   RPC Endpoint:\n"));
  console.log(c.info(`   http://localhost:${port}/cli/rpc\n`));
  console.log(c.bold("   Quick Start:\n"));
  console.log(c.dim(`   # Check server health`));
  console.log(`   ${c.info("cli-tool.mjs ping")}\n`);
  console.log(c.dim(`   # Create an issue`));
  console.log(`   ${c.info(`cli-tool.mjs createIssue --title "Test Issue"`)}\n`);
  console.log(c.dim(`   # View all commands`));
  console.log(`   ${c.info("cli-tool.mjs help")}\n`);

  if (port !== DEFAULT_PORT) {
    console.log(c.dim(`   Using custom port ${port}. Set CYRUS_PORT=${port} when using cli-tool.mjs\n`));
  }

  console.log(c.dim("   Press Ctrl+C to stop.\n"));

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log(c.dim("\n\n   Shutting down..."));
    await edgeWorker.stop();
    console.log(c.success("   ✅ Server stopped gracefully\n"));
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await edgeWorker.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(c.success("\n❌ Fatal error:"), error.message);
  console.error(c.dim("\nStack trace:"));
  console.error(c.dim(error.stack));
  process.exit(1);
});
