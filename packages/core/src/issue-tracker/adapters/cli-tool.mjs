#!/usr/bin/env node
/**
 * 🏎️  Cyrus CLI Tool - Premium command-line interface
 *
 * A beautiful, professional CLI for controlling Cyrus via RPC.
 * Features: colors, pagination, search, excellent help, and premium UX.
 *
 * Usage:
 *   cli-tool.mjs <command> [options]
 *   cli-tool.mjs help
 *   cli-tool.mjs <command> --help
 */

const DEFAULT_PORT = 3457;
const RPC_URL = `http://localhost:${process.env.CYRUS_PORT || DEFAULT_PORT}/cli/rpc`;

// ============================================================================
// ANSI COLOR CODES (lightweight, no dependencies)
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",

  // Foreground colors
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // Background colors
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgCyan: "\x1b[46m",
};

const c = {
  error: (text) => `${colors.red}${text}${colors.reset}`,
  success: (text) => `${colors.green}${text}${colors.reset}`,
  warning: (text) => `${colors.yellow}${text}${colors.reset}`,
  info: (text) => `${colors.cyan}${text}${colors.reset}`,
  dim: (text) => `${colors.dim}${text}${colors.reset}`,
  bold: (text) => `${colors.bold}${text}${colors.reset}`,
  command: (text) => `${colors.cyan}${text}${colors.reset}`,
  param: (text) => `${colors.yellow}${text}${colors.reset}`,
  value: (text) => `${colors.green}${text}${colors.reset}`,
  url: (text) => `${colors.blue}${colors.dim}${text}${colors.reset}`,
};

// ============================================================================
// RPC CLIENT
// ============================================================================

/**
 * Make an RPC call to the Cyrus CLI platform with connection feedback
 */
async function rpc(method, params = {}, options = {}) {
  const { silent = false } = options;

  if (!silent) {
    console.log(c.dim(`→ Connecting to ${RPC_URL}...`));
  }

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

    if (!silent) {
      console.log(c.success("✓ Connected\n"));
    }

    return result;
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED") {
      console.error(c.error("\n❌ Cannot connect to Cyrus server\n"));
      console.error(c.dim(`   Server URL: ${RPC_URL}`));
      console.error(c.dim(`   Make sure the CLI server is running.`));
      console.error(c.dim(`   Start it with: ${c.command("node start-cli-server.mjs")}\n`));
      if (DEFAULT_PORT !== parseInt(process.env.CYRUS_PORT || DEFAULT_PORT)) {
        console.error(c.dim(`   Using custom port from CYRUS_PORT=${process.env.CYRUS_PORT}`));
      }
      console.error();
      process.exit(1);
    }
    throw error;
  }
}

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

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
        // Try to parse numbers
        if (/^\d+$/.test(value)) {
          params[key] = parseInt(value, 10);
        } else {
          params[key] = value;
        }
        i++;
      } else {
        params[key] = true;
      }
    }
  }
  return params;
}

// ============================================================================
// OUTPUT FORMATTING
// ============================================================================

/**
 * Pretty-print JSON with colors
 */
function printJSON(obj, indent = 0) {
  const spaces = "  ".repeat(indent);

  if (obj === null) return c.dim("null");
  if (obj === undefined) return c.dim("undefined");
  if (typeof obj === "string") return c.value(`"${obj}"`);
  if (typeof obj === "number") return c.value(String(obj));
  if (typeof obj === "boolean") return c.value(String(obj));

  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    console.log("[");
    obj.forEach((item, i) => {
      process.stdout.write(spaces + "  ");
      printJSON(item, indent + 1);
      console.log(i < obj.length - 1 ? "," : "");
    });
    console.log(spaces + "]");
    return;
  }

  if (typeof obj === "object") {
    const keys = Object.keys(obj);
    if (keys.length === 0) return "{}";
    console.log("{");
    keys.forEach((key, i) => {
      process.stdout.write(spaces + `  ${c.info(key)}: `);
      printJSON(obj[key], indent + 1);
      console.log(i < keys.length - 1 ? "," : "");
    });
    console.log(spaces + "}");
    return;
  }

  return String(obj);
}

/**
 * Display a formatted result
 */
function displayResult(result) {
  if (result.success) {
    console.log(c.success("✅ Success\n"));
    printJSON(result.data);
    console.log();
  } else {
    console.error(c.error(`\n❌ Error: ${result.error}\n`));
    process.exit(1);
  }
}

/**
 * Display paginated activities with search
 */
function displayActivities(activities, options = {}) {
  const { limit = 20, offset = 0, search = "" } = options;

  // Filter by search term
  let filtered = activities;
  if (search) {
    const searchLower = search.toLowerCase();
    filtered = activities.filter((activity) => {
      const body = activity.content?.body || "";
      const type = activity.content?.type || "";
      return (
        body.toLowerCase().includes(searchLower) ||
        type.toLowerCase().includes(searchLower) ||
        activity.id.toLowerCase().includes(searchLower)
      );
    });
  }

  // Sort by most recent first
  const sorted = [...filtered].sort((a, b) => {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Apply pagination
  const paginated = sorted.slice(offset, offset + limit);
  const total = sorted.length;

  console.log(c.bold(`\n📝 Activities (showing ${Math.min(limit, total - offset)} of ${total})`));

  if (search) {
    console.log(c.dim(`   Filtered by: "${search}"`));
  }

  if (offset > 0) {
    console.log(c.dim(`   Starting from: ${offset}`));
  }

  console.log();

  if (paginated.length === 0) {
    console.log(c.dim("   No activities found."));
    return;
  }

  paginated.forEach((activity, i) => {
    const num = offset + i + 1;
    const date = new Date(activity.createdAt).toLocaleString();
    const type = activity.content?.type || "unknown";
    const body = activity.content?.body || "";
    const signal = activity.signal ? ` [${c.warning(activity.signal.toUpperCase())}]` : "";

    console.log(c.bold(`${num}. ${activity.id}`) + signal);
    console.log(c.dim(`   ${date} • ${type}`));

    if (body) {
      const preview = body.length > 100 ? body.slice(0, 100) + "..." : body;
      console.log(`   ${preview.split("\n").join("\n   ")}`);
    }

    console.log();
  });

  // Show pagination hints
  if (offset + limit < total) {
    const nextOffset = offset + limit;
    console.log(c.dim(`→ More activities available. Use ${c.param(`--offset ${nextOffset}`)} to see next page.`));
  }

  if (offset > 0) {
    const prevOffset = Math.max(0, offset - limit);
    console.log(c.dim(`← Previous page: ${c.param(`--offset ${prevOffset}`)}`));
  }

  console.log();
}

// ============================================================================
// HELP SYSTEM
// ============================================================================

/**
 * Show general help
 */
function showHelp() {
  console.log(c.bold("\n🏎️  Cyrus CLI Tool - Premium Interface\n"));
  console.log(`${c.dim("Usage:")} ${c.command("cli-tool.mjs")} ${c.param("<command>")} ${c.dim("[options]")}\n`);

  console.log(c.bold("📚 Commands:\n"));

  console.log(c.info("  Health & Status:"));
  console.log(`    ${c.command("ping")}                    Check server connectivity`);
  console.log(`    ${c.command("status")}                  Get server status and version`);
  console.log(`    ${c.command("version")}                 Show server version`);
  console.log();

  console.log(c.info("  Issue Management:"));
  console.log(`    ${c.command("createIssue")}             Create a new issue`);
  console.log(`    ${c.command("getIssue")}                Get issue details`);
  console.log(`    ${c.command("assignIssue")}             Assign an issue to a user`);
  console.log();

  console.log(c.info("  Comment Management:"));
  console.log(`    ${c.command("createComment")}           Create a comment on an issue`);
  console.log();

  console.log(c.info("  Agent Sessions:"));
  console.log(`    ${c.command("startSession")}            Start an agent session on an issue`);
  console.log(`    ${c.command("startSessionOnComment")}   Start an agent session on a comment`);
  console.log(`    ${c.command("viewSession")}             View agent session with pagination`);
  console.log(`    ${c.command("promptSession")}           Send a prompt to an agent session`);
  console.log(`    ${c.command("stopSession")}             Stop an agent session`);
  console.log();

  console.log(c.info("  Team & Labels:"));
  console.log(`    ${c.command("fetchLabels")}             List all labels`);
  console.log(`    ${c.command("fetchMembers")}            List all team members`);
  console.log(`    ${c.command("createLabel")}             Create a new label`);
  console.log(`    ${c.command("createMember")}            Create a new team member`);
  console.log();

  console.log(c.info("  Debugging:"));
  console.log(`    ${c.command("getState")}                Get entire in-memory state`);
  console.log();

  console.log(c.bold("💡 Per-Command Help:\n"));
  console.log(c.dim(`   Get detailed help for any command:`));
  console.log(`   ${c.command("cli-tool.mjs createIssue --help")}`);
  console.log(`   ${c.command("cli-tool.mjs viewSession --help")}`);
  console.log();

  console.log(c.bold("🌐 Environment:\n"));
  console.log(c.dim(`   CYRUS_PORT    Server port (default: ${DEFAULT_PORT})`));
  console.log(c.dim(`   Current URL:  ${RPC_URL}\n`));

  console.log(c.bold("✨ Examples:\n"));
  console.log(`   ${c.dim("# Check if server is running")}`);
  console.log(`   ${c.command("cli-tool.mjs ping")}`);
  console.log();
  console.log(`   ${c.dim("# Create an issue")}`);
  console.log(`   ${c.command('cli-tool.mjs createIssue --title "Fix bug" --description "Critical fix"')}`);
  console.log();
  console.log(`   ${c.dim("# View session with pagination")}`);
  console.log(`   ${c.command("cli-tool.mjs viewSession --session-id session-1 --limit 10 --offset 20")}`);
  console.log();
  console.log(`   ${c.dim("# Search activities")}`);
  console.log(`   ${c.command('cli-tool.mjs viewSession --session-id session-1 --search "error"')}`);
  console.log();
}

/**
 * Show help for a specific command
 */
function showCommandHelp(command) {
  const helps = {
    ping: {
      description: "Check server connectivity",
      usage: "cli-tool.mjs ping",
      options: [],
      examples: ["cli-tool.mjs ping"],
    },
    status: {
      description: "Get server status, version, and health information",
      usage: "cli-tool.mjs status",
      options: [],
      examples: ["cli-tool.mjs status"],
    },
    version: {
      description: "Show server version",
      usage: "cli-tool.mjs version",
      options: [],
      examples: ["cli-tool.mjs version"],
    },
    createIssue: {
      description: "Create a new issue in the CLI platform",
      usage: "cli-tool.mjs createIssue --title <title> [options]",
      options: [
        { name: "--title", required: true, description: "Issue title (required)" },
        { name: "--description", description: "Issue description" },
        { name: "--assignee-id", description: "User ID to assign the issue to" },
        { name: "--team-id", description: "Team ID (default: team-1)" },
        { name: "--state-id", description: "Workflow state ID (default: state-todo)" },
      ],
      examples: [
        'cli-tool.mjs createIssue --title "Fix login bug"',
        'cli-tool.mjs createIssue --title "Add feature" --description "New cool feature" --assignee-id agent-user-1',
      ],
    },
    assignIssue: {
      description: "Assign an issue to a user or remove assignee",
      usage: "cli-tool.mjs assignIssue --issue-id <id> --assignee-id <user-id>",
      options: [
        { name: "--issue-id", required: true, description: "Issue ID (required)" },
        { name: "--assignee-id", description: "User ID to assign (omit to unassign)" },
      ],
      examples: [
        "cli-tool.mjs assignIssue --issue-id issue-1 --assignee-id agent-user-1",
        "cli-tool.mjs assignIssue --issue-id issue-1 --assignee-id user-2",
      ],
    },
    createComment: {
      description: "Create a comment on an issue",
      usage: "cli-tool.mjs createComment --issue-id <id> --body <text> [options]",
      options: [
        { name: "--issue-id", required: true, description: "Issue ID (required)" },
        { name: "--body", required: true, description: "Comment body text (required)" },
        { name: "--mention-agent", description: "Mention the agent (triggers session)" },
      ],
      examples: [
        'cli-tool.mjs createComment --issue-id issue-1 --body "This is urgent"',
        'cli-tool.mjs createComment --issue-id issue-1 --body "Please fix" --mention-agent',
      ],
    },
    startSession: {
      description: "Start an agent session on an issue",
      usage: "cli-tool.mjs startSession --issue-id <id>",
      options: [
        { name: "--issue-id", required: true, description: "Issue ID (required)" },
      ],
      examples: ["cli-tool.mjs startSession --issue-id issue-1"],
    },
    startSessionOnComment: {
      description: "Start an agent session on a root comment",
      usage: "cli-tool.mjs startSessionOnComment --comment-id <id>",
      options: [
        { name: "--comment-id", required: true, description: "Comment ID (required)" },
      ],
      examples: ["cli-tool.mjs startSessionOnComment --comment-id comment-1"],
    },
    viewSession: {
      description: "View agent session details with pagination and search",
      usage: "cli-tool.mjs viewSession --session-id <id> [options]",
      options: [
        { name: "--session-id", required: true, description: "Session ID (required)" },
        { name: "--limit", description: "Number of activities to show (default: 20)" },
        { name: "--offset", description: "Starting offset for pagination (default: 0)" },
        { name: "--search", description: "Search term to filter activities" },
      ],
      examples: [
        "cli-tool.mjs viewSession --session-id session-1",
        "cli-tool.mjs viewSession --session-id session-1 --limit 10 --offset 20",
        'cli-tool.mjs viewSession --session-id session-1 --search "error"',
      ],
    },
    promptSession: {
      description: "Send a prompt/message to an agent session",
      usage: "cli-tool.mjs promptSession --session-id <id> --message <text>",
      options: [
        { name: "--session-id", required: true, description: "Session ID (required)" },
        { name: "--message", required: true, description: "Message to send (required)" },
      ],
      examples: [
        'cli-tool.mjs promptSession --session-id session-1 --message "Fix the bug"',
      ],
    },
    stopSession: {
      description: "Stop a running agent session",
      usage: "cli-tool.mjs stopSession --session-id <id>",
      options: [
        { name: "--session-id", required: true, description: "Session ID (required)" },
      ],
      examples: ["cli-tool.mjs stopSession --session-id session-1"],
    },
    fetchLabels: {
      description: "List all labels in the workspace",
      usage: "cli-tool.mjs fetchLabels",
      options: [],
      examples: ["cli-tool.mjs fetchLabels"],
    },
    fetchMembers: {
      description: "List all team members",
      usage: "cli-tool.mjs fetchMembers",
      options: [],
      examples: ["cli-tool.mjs fetchMembers"],
    },
    createLabel: {
      description: "Create a new label",
      usage: "cli-tool.mjs createLabel --name <name> [options]",
      options: [
        { name: "--name", required: true, description: "Label name (required)" },
        { name: "--color", description: "Label color (hex code, e.g., #ff0000)" },
      ],
      examples: [
        'cli-tool.mjs createLabel --name "bug"',
        'cli-tool.mjs createLabel --name "urgent" --color "#ff0000"',
      ],
    },
    createMember: {
      description: "Create a new team member",
      usage: "cli-tool.mjs createMember --name <name> [options]",
      options: [
        { name: "--name", required: true, description: "Member name (required)" },
        { name: "--email", description: "Member email address" },
      ],
      examples: [
        'cli-tool.mjs createMember --name "John Doe"',
        'cli-tool.mjs createMember --name "Jane Smith" --email "jane@example.com"',
      ],
    },
    getState: {
      description: "Get entire in-memory state (for debugging)",
      usage: "cli-tool.mjs getState",
      options: [],
      examples: ["cli-tool.mjs getState"],
    },
  };

  const help = helps[command];

  if (!help) {
    console.error(c.error(`\n❌ Unknown command: ${command}\n`));
    console.log(c.dim(`   Run ${c.command("cli-tool.mjs help")} to see all commands.\n`));
    process.exit(1);
  }

  console.log(c.bold(`\n${command} - ${help.description}\n`));
  console.log(c.dim("Usage:"));
  console.log(`  ${c.command(help.usage)}\n`);

  if (help.options.length > 0) {
    console.log(c.bold("Options:\n"));
    help.options.forEach((opt) => {
      const req = opt.required ? c.error(" (required)") : "";
      console.log(`  ${c.param(opt.name)}${req}`);
      console.log(c.dim(`    ${opt.description}`));
    });
    console.log();
  }

  console.log(c.bold("Examples:\n"));
  help.examples.forEach((ex) => {
    console.log(`  ${c.command(ex)}`);
  });
  console.log();
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

/**
 * Main CLI handler
 */
async function main() {
  const [, , command, ...args] = process.argv;

  // Show help if no command or help requested
  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    process.exit(0);
  }

  const params = parseArgs(args);

  // Check for per-command help
  if (params.help || params.h) {
    showCommandHelp(command);
    process.exit(0);
  }

  let method;
  let rpcParams = {};

  try {
    switch (command) {
      // ====================================================================
      // HEALTH & STATUS COMMANDS
      // ====================================================================

      case "ping": {
        console.log(c.info("\n🏓 Pinging Cyrus server...\n"));
        const result = await rpc("ping", {}, { silent: false });
        if (result.success) {
          console.log(c.success("✅ Server is responding"));
          console.log(c.dim(`   URL: ${RPC_URL}\n`));
        }
        return;
      }

      case "status": {
        console.log(c.info("\n📊 Fetching server status...\n"));
        const result = await rpc("status", {}, { silent: false });
        if (result.success) {
          console.log(c.success("✅ Server Status\n"));
          console.log(`   ${c.bold("Version:")} ${c.value(result.data.version)}`);
          console.log(`   ${c.bold("Platform:")} ${c.value(result.data.platform)}`);
          console.log(`   ${c.bold("Mode:")} ${c.value(result.data.mode)}`);
          console.log(`   ${c.bold("Uptime:")} ${c.value(result.data.uptime || "N/A")}`);
          console.log(`   ${c.bold("URL:")} ${c.url(RPC_URL)}\n`);
        }
        return;
      }

      case "version": {
        const result = await rpc("status", {}, { silent: true });
        if (result.success) {
          console.log(c.value(result.data.version));
        }
        return;
      }

      // ====================================================================
      // ISSUE COMMANDS
      // ====================================================================

      case "createIssue": {
        if (!params.title) {
          console.error(c.error("\n❌ Missing required parameter: --title\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs createIssue --help")} for usage.\n`));
          process.exit(1);
        }
        method = "createIssue";
        rpcParams = {
          title: params.title,
          description: params.description,
          options: {
            assigneeId: params.assigneeId,
            teamId: params.teamId,
            stateId: params.stateId,
          },
        };
        break;
      }

      case "getIssue": {
        if (!params.issueId) {
          console.error(c.error("\n❌ Missing required parameter: --issue-id\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs getIssue --help")} for usage.\n`));
          process.exit(1);
        }
        console.error(c.error("\n❌ getIssue not yet implemented in RPC server\n"));
        console.log(c.dim(`   Use ${c.command("getState")} to see all issues.\n`));
        process.exit(1);
      }

      case "assignIssue": {
        if (!params.issueId) {
          console.error(c.error("\n❌ Missing required parameter: --issue-id\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs assignIssue --help")} for usage.\n`));
          process.exit(1);
        }
        method = "assignIssue";
        rpcParams = {
          issueId: params.issueId,
          assigneeId: params.assigneeId || null,
        };
        break;
      }

      // ====================================================================
      // COMMENT COMMANDS
      // ====================================================================

      case "createComment": {
        if (!params.issueId || !params.body) {
          console.error(c.error("\n❌ Missing required parameters\n"));
          console.log(c.dim("   Required: --issue-id and --body"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs createComment --help")} for usage.\n`));
          process.exit(1);
        }
        method = "createComment";
        rpcParams = {
          issueId: params.issueId,
          body: params.body,
          mentionAgent: params.mentionAgent === true,
        };
        break;
      }

      // ====================================================================
      // AGENT SESSION COMMANDS
      // ====================================================================

      case "startSession": {
        if (!params.issueId) {
          console.error(c.error("\n❌ Missing required parameter: --issue-id\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs startSession --help")} for usage.\n`));
          process.exit(1);
        }
        method = "startAgentSessionOnIssue";
        rpcParams = { issueId: params.issueId };
        break;
      }

      case "startSessionOnComment": {
        if (!params.commentId) {
          console.error(c.error("\n❌ Missing required parameter: --comment-id\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs startSessionOnComment --help")} for usage.\n`));
          process.exit(1);
        }
        method = "startAgentSessionOnComment";
        rpcParams = { commentId: params.commentId };
        break;
      }

      case "viewSession": {
        if (!params.sessionId) {
          console.error(c.error("\n❌ Missing required parameter: --session-id\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs viewSession --help")} for usage.\n`));
          process.exit(1);
        }

        // Special handling for viewSession with pagination
        const result = await rpc("viewAgentSession", { sessionId: params.sessionId });

        if (result.success) {
          const { session, activities } = result.data;

          console.log(c.success("\n✅ Agent Session\n"));
          console.log(`   ${c.bold("ID:")} ${c.value(session.id)}`);
          console.log(`   ${c.bold("Status:")} ${c.value(session.status)}`);
          console.log(`   ${c.bold("Type:")} ${c.value(session.type)}`);
          console.log(`   ${c.bold("Issue ID:")} ${c.value(session.issueId)}`);
          if (session.commentId) {
            console.log(`   ${c.bold("Comment ID:")} ${c.value(session.commentId)}`);
          }
          console.log(`   ${c.bold("Created:")} ${c.dim(new Date(session.createdAt).toLocaleString())}`);
          console.log(`   ${c.bold("Updated:")} ${c.dim(new Date(session.updatedAt).toLocaleString())}`);

          // Display paginated activities
          displayActivities(activities, {
            limit: params.limit,
            offset: params.offset,
            search: params.search,
          });
        } else {
          console.error(c.error(`\n❌ Error: ${result.error}\n`));
          process.exit(1);
        }

        return; // Exit early, already handled output
      }

      case "promptSession": {
        if (!params.sessionId || !params.message) {
          console.error(c.error("\n❌ Missing required parameters\n"));
          console.log(c.dim("   Required: --session-id and --message"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs promptSession --help")} for usage.\n`));
          process.exit(1);
        }
        method = "promptAgentSession";
        rpcParams = {
          sessionId: params.sessionId,
          message: params.message,
        };
        break;
      }

      case "stopSession": {
        if (!params.sessionId) {
          console.error(c.error("\n❌ Missing required parameter: --session-id\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs stopSession --help")} for usage.\n`));
          process.exit(1);
        }
        method = "stopAgentSession";
        rpcParams = { sessionId: params.sessionId };
        break;
      }

      // ====================================================================
      // LABEL AND MEMBER COMMANDS
      // ====================================================================

      case "fetchLabels": {
        method = "fetchLabels";
        rpcParams = {};
        break;
      }

      case "fetchMembers": {
        method = "fetchMembers";
        rpcParams = {};
        break;
      }

      case "createLabel": {
        if (!params.name) {
          console.error(c.error("\n❌ Missing required parameter: --name\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs createLabel --help")} for usage.\n`));
          process.exit(1);
        }
        method = "createLabel";
        rpcParams = {
          name: params.name,
          options: params.color ? { color: params.color } : {},
        };
        break;
      }

      case "createMember": {
        if (!params.name) {
          console.error(c.error("\n❌ Missing required parameter: --name\n"));
          console.log(c.dim(`   Run ${c.command("cli-tool.mjs createMember --help")} for usage.\n`));
          process.exit(1);
        }
        method = "createMember";
        rpcParams = {
          name: params.name,
          options: params.email ? { email: params.email } : {},
        };
        break;
      }

      // ====================================================================
      // DEBUG COMMAND
      // ====================================================================

      case "getState": {
        method = "getState";
        rpcParams = {};
        break;
      }

      default: {
        console.error(c.error(`\n❌ Unknown command: ${command}\n`));
        console.log(c.dim(`   Run ${c.command("cli-tool.mjs help")} to see all commands.`));
        console.log(c.dim(`   Run ${c.command(`cli-tool.mjs ${command} --help`)} for command-specific help.\n`));
        process.exit(1);
      }
    }

    // Make the RPC call
    const result = await rpc(method, rpcParams);

    // Display results
    displayResult(result);

  } catch (error) {
    console.error(c.error("\n❌ Fatal error:"), error.message);
    if (process.env.DEBUG) {
      console.error(c.dim("\nStack trace:"));
      console.error(c.dim(error.stack));
    } else {
      console.error(c.dim(`\n   Set DEBUG=1 for stack trace.\n`));
    }
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error(c.error("\n❌ Fatal error:"), error.message);
  process.exit(1);
});
