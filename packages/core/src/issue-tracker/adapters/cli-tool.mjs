#!/usr/bin/env node
/**
 * CLI tool for controlling Cyrus CLI IssueTracker platform via RPC
 *
 * Usage:
 *   cli-tool.mjs createIssue --title "Fix bug" --description "Urgent fix"
 *   cli-tool.mjs createComment --issue-id issue-1 --body "Test comment"
 *   cli-tool.mjs startSession --issue-id issue-1
 *   cli-tool.mjs viewSession --session-id session-1
 *   cli-tool.mjs fetchLabels
 *   cli-tool.mjs fetchMembers
 */

const DEFAULT_PORT = 3457;
const RPC_URL = `http://localhost:${process.env.CYRUS_PORT || DEFAULT_PORT}/cli/rpc`;

/**
 * Make an RPC call to the Cyrus CLI platform
 */
async function rpc(method, params = {}) {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method, params }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") {
      console.error(`❌ Error: Cannot connect to Cyrus server at ${RPC_URL}`);
      console.error(`   Make sure Cyrus is running with CLI platform enabled.`);
      console.error(`   Set CYRUS_PORT environment variable if using a different port.`);
      process.exit(1);
    }
    throw error;
  }
}

/**
 * Parse command-line arguments into an object
 */
function parseArgs(args) {
  const params = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        params[key] = value;
        i++;
      } else {
        params[key] = true;
      }
    }
  }
  return params;
}

/**
 * Display help message
 */
function showHelp() {
  console.log(`
Cyrus CLI IssueTracker Tool

Usage: cli-tool.mjs <command> [options]

Commands:

  Issue Management:
    createIssue --title <title> [--description <desc>]
        Create a new issue

    getIssue --issue-id <id>
        Get issue details

  Comment Management:
    createComment --issue-id <id> --body <text> [--mention-agent]
        Create a comment on an issue
        Use --mention-agent to trigger an agent session

  Agent Session Management:
    startSession --issue-id <id>
        Start an agent session on an issue

    startSessionOnComment --comment-id <id>
        Start an agent session on a root comment

    viewSession --session-id <id>
        View agent session details

    promptSession --session-id <id> --message <text>
        Send a prompt to an agent session

    stopSession --session-id <id>
        Stop an agent session

  Team & Labels:
    fetchLabels
        Get all labels

    fetchMembers
        Get all team members

    createLabel --name <name> [--color <hex>]
        Create a new label

    createMember --name <name> [--email <email>]
        Create a new team member

  Debugging:
    getState
        Get entire in-memory state (for debugging)

    help
        Show this help message

Environment Variables:
  CYRUS_PORT    Port where Cyrus server is running (default: ${DEFAULT_PORT})

Examples:
  # Create an issue
  cli-tool.mjs createIssue --title "Fix login bug" --description "Users can't log in"

  # Create a comment that mentions the agent
  cli-tool.mjs createComment --issue-id issue-1 --body "@cyrus please fix this" --mention-agent

  # Start an agent session
  cli-tool.mjs startSession --issue-id issue-1

  # View the session
  cli-tool.mjs viewSession --session-id session-1

  # Fetch all labels
  cli-tool.mjs fetchLabels
`);
}

/**
 * Main CLI handler
 */
async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  const params = parseArgs(args);

  let method;
  let rpcParams = {};

  switch (command) {
    // Issue commands
    case "createIssue":
      if (!params.title) {
        console.error("❌ Error: --title is required");
        process.exit(1);
      }
      method = "createIssue";
      rpcParams = {
        title: params.title,
        description: params.description,
        options: {},
      };
      break;

    case "getIssue":
      if (!params.issueId) {
        console.error("❌ Error: --issue-id is required");
        process.exit(1);
      }
      // This would need to be implemented in CLIRPCServer
      console.error("❌ Error: getIssue not yet implemented in RPC server");
      process.exit(1);

    // Comment commands
    case "createComment":
      if (!params.issueId || !params.body) {
        console.error("❌ Error: --issue-id and --body are required");
        process.exit(1);
      }
      method = "createComment";
      rpcParams = {
        issueId: params.issueId,
        body: params.body,
        mentionAgent: params.mentionAgent === true,
      };
      break;

    // Agent session commands
    case "startSession":
      if (!params.issueId) {
        console.error("❌ Error: --issue-id is required");
        process.exit(1);
      }
      method = "startAgentSessionOnIssue";
      rpcParams = { issueId: params.issueId };
      break;

    case "startSessionOnComment":
      if (!params.commentId) {
        console.error("❌ Error: --comment-id is required");
        process.exit(1);
      }
      method = "startAgentSessionOnComment";
      rpcParams = { commentId: params.commentId };
      break;

    case "viewSession":
      if (!params.sessionId) {
        console.error("❌ Error: --session-id is required");
        process.exit(1);
      }
      method = "viewAgentSession";
      rpcParams = { sessionId: params.sessionId };
      break;

    case "promptSession":
      if (!params.sessionId || !params.message) {
        console.error("❌ Error: --session-id and --message are required");
        process.exit(1);
      }
      method = "promptAgentSession";
      rpcParams = {
        sessionId: params.sessionId,
        message: params.message,
      };
      break;

    case "stopSession":
      if (!params.sessionId) {
        console.error("❌ Error: --session-id is required");
        process.exit(1);
      }
      method = "stopAgentSession";
      rpcParams = { sessionId: params.sessionId };
      break;

    // Label and member commands
    case "fetchLabels":
      method = "fetchLabels";
      rpcParams = {};
      break;

    case "fetchMembers":
      method = "fetchMembers";
      rpcParams = {};
      break;

    case "createLabel":
      if (!params.name) {
        console.error("❌ Error: --name is required");
        process.exit(1);
      }
      method = "createLabel";
      rpcParams = {
        name: params.name,
        options: params.color ? { color: params.color } : {},
      };
      break;

    case "createMember":
      if (!params.name) {
        console.error("❌ Error: --name is required");
        process.exit(1);
      }
      method = "createMember";
      rpcParams = {
        name: params.name,
        options: params.email ? { email: params.email } : {},
      };
      break;

    // Debug command
    case "getState":
      method = "getState";
      rpcParams = {};
      break;

    default:
      console.error(`❌ Error: Unknown command: ${command}`);
      console.error(`   Run 'cli-tool.mjs help' for usage information`);
      process.exit(1);
  }

  // Make the RPC call
  const result = await rpc(method, rpcParams);

  // Display results
  if (result.success) {
    console.log("✅ Success\n");
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error("❌ Error:", result.error);
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error("❌ Fatal error:", error.message);
  process.exit(1);
});
