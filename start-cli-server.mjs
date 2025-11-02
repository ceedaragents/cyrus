#!/usr/bin/env node
/**
 * Start Cyrus EdgeWorker with CLI platform for testing
 *
 * Usage:
 *   node start-cli-server.mjs [port]
 *
 * Environment:
 *   CYRUS_PORT - Server port (default: 3457)
 */

import { EdgeWorker } from "./packages/edge-worker/dist/EdgeWorker.js";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_PORT = 3457;
const port = parseInt(process.env.CYRUS_PORT || process.argv[2] || DEFAULT_PORT);

async function main() {
  console.log("🚀 Starting Cyrus CLI Platform Server...\n");

  // Create temporary directories
  const cyrusHome = join(tmpdir(), "cyrus-cli-server");
  await mkdir(cyrusHome, { recursive: true });
  await mkdir(join(cyrusHome, "worktrees"), { recursive: true });

  console.log(`📁 Using directory: ${cyrusHome}`);
  console.log(`🌐 Port: ${port}\n`);

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

  console.log(`\n✅ Cyrus CLI Platform Server running!`);
  console.log(`📡 RPC endpoint: http://localhost:${port}/cli/rpc\n`);
  console.log(`Use cli-tool.mjs to interact with the server:`);
  console.log(`  CYRUS_PORT=${port} cli-tool.mjs createIssue --title "Test Issue"`);
  console.log(`  CYRUS_PORT=${port} cli-tool.mjs fetchMembers`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n🛑 Stopping server...");
    await edgeWorker.stop();
    console.log("✅ Server stopped");
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await edgeWorker.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
