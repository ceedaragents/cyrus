# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cyrus (Linear Claude Agent) is a monorepo JavaScript/TypeScript application that integrates Linear's issue tracking with Anthropic's Claude Code to automate software development tasks. The project is transitioning to an edge-proxy architecture that separates OAuth/webhook handling (proxy) from Claude processing (edge workers).

**Key capabilities:**
- Monitors Linear issues assigned to a specific user
- Creates isolated Git worktrees for each issue
- Runs Claude Code sessions to process issues
- Posts responses back to Linear as comments
- Maintains conversation continuity using the `--continue` flag
- Supports edge worker mode for distributed processing
Here's a refined version of your message:

## Working with SDKs

When examining or working with a package SDK:

1. First, install the dependencies:
   ```bash
   pnpm install
   ```

2. Locate the specific SDK in the `node_modules` directory to examine its structure, types, and implementation details.

3. Review the SDK's documentation, source code, and type definitions to understand its API and usage patterns.

## Architecture Overview

The codebase follows a pnpm monorepo structure:

cyrus/
├── apps/
│   ├── cli/          # Main CLI application
│   ├── electron/     # Future Electron GUI (in development)
│   └── proxy/        # Edge proxy server for OAuth/webhooks
└── packages/
    ├── core/         # Shared types and session management
    ├── claude-parser/# Claude stdout parsing with jq
    ├── claude-runner/# Claude CLI execution wrapper
    ├── edge-worker/  # Edge worker client implementation
    └── ndjson-client/# NDJSON streaming client
```

For a detailed visual representation of how these components interact and map Claude Code sessions to Linear comment threads, see @architecture.md.

## Testing Best Practices

### Prompt Assembly Tests

When working with prompt assembly tests in `packages/edge-worker/test/prompt-assembly*.test.ts`:

**CRITICAL: Always assert the ENTIRE prompt, never use partial checks like `.toContain()`**

- Use `.expectUserPrompt()` with the complete expected prompt string
- Use `.expectSystemPrompt()` with the complete expected system prompt (or `undefined`)
- Use `.expectComponents()` to verify all prompt components
- Use `.expectPromptType()` to verify the prompt type
- Always call `.verify()` to execute all assertions

This ensures comprehensive test coverage and catches regressions in prompt structure, formatting, and content. Partial assertions with `.toContain()` are too weak and can miss important changes.

**Example**:
```typescript
// ✅ CORRECT - Full prompt assertion
await scenario(worker)
  .newSession()
  .withUserComment("Test comment")
  .expectUserPrompt(`<user_comment>
  <author>Test User</author>
  <timestamp>2025-01-27T12:00:00Z</timestamp>
  <content>
Test comment
  </content>
</user_comment>`)
  .expectSystemPrompt(undefined)
  .expectPromptType("continuation")
  .expectComponents("user-comment")
  .verify();

// ❌ INCORRECT - Partial assertion (too weak)
const result = await scenario(worker)
  .newSession()
  .withUserComment("Test comment")
  .build();
expect(result.userPrompt).toContain("<user_comment>");
expect(result.userPrompt).toContain("Test User");
```

## Common Commands

### Monorepo-wide Commands (run from root)
```bash
# Install dependencies for all packages
pnpm install

# Build all packages
pnpm build

# Build lint for the entire repository
pnpm lint

# Run tests across all packages
pnpm test

# Run tests only in packages directory (recommended)
pnpm test:packages:run

# Run TypeScript type checking
pnpm typecheck

# Development mode (watch all packages)
pnpm dev
```

### App-specific Commands

#### CLI App (`apps/cli/`)
```bash
# Start the agent
pnpm start

# Development mode with auto-restart
pnpm dev

# Run tests
pnpm test
pnpm test:watch  # Watch mode

# Local development setup (link development version globally)
pnpm build                    # Build all packages first
pnpm uninstall cyrus-ai -g    # Remove published version
cd apps/cli                   # Navigate to CLI directory
pnpm install -g .            # Install local version globally
pnpm link -g .               # Link local development version
```

#### Electron App (`apps/electron/`)
```bash
# Development mode
pnpm dev

# Build for production
pnpm build:all

# Run electron in dev mode
pnpm electron:dev
```

#### Proxy App (`apps/proxy/`)
```bash
# Start proxy server
pnpm start

# Development mode with auto-restart
pnpm dev

# Run tests
pnpm test
```

### Package Commands (all packages follow same pattern)
```bash
# Build the package
pnpm build

# TypeScript type checking
pnpm typecheck

# Run tests
pnpm test        # Watch mode
pnpm test:run    # Run once

# Development mode (TypeScript watch)
pnpm dev
```

## Linear State Management

The agent automatically moves issues to the "started" state when assigned. Linear uses standardized state types:

- **State Types Reference**: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/enums/ProjectStatusType
- **Standard Types**: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`
- **Issue Assignment Behavior**: When an issue is assigned to the agent, it automatically transitions to a state with `type === 'started'` (In Progress)

## Important Development Notes

1. **Edge-Proxy Architecture**: The project is transitioning to separate OAuth/webhook handling from Claude processing.

2. **Dependencies**: 
   - The claude-parser package requires `jq` to be installed on the system
   - Uses pnpm as package manager (v10.11.0)
   - TypeScript for all new packages

3. **Git Worktrees**: When processing issues, the agent creates separate git worktrees. If a `cyrus-setup.sh` script exists in the repository root, it's executed in new worktrees for project-specific initialization.

4. **Testing**: Uses Vitest for all packages. Run tests before committing changes.

## Development Workflow

When working on this codebase, follow these practices:

1. **Before submitting a Pull Request**:
   - Update `CHANGELOG.md` under the `## [Unreleased]` section with your changes
   - Use appropriate subsections: `### Added`, `### Changed`, `### Fixed`, `### Removed`
   - Include brief, clear descriptions of what was changed and why
   - Run `pnpm test:packages` to ensure all package tests pass
   - Run `pnpm typecheck` to verify TypeScript compilation
   - Consider running `pnpm build` to ensure the build succeeds

2. **Changelog Format**:
   - Follow [Keep a Changelog](https://keepachangelog.com/) format
   - **Focus only on end-user impact**: Write entries from the perspective of users running the `cyrus` CLI binary
   - Avoid technical implementation details, package names, or internal architecture changes
   - Be concise but descriptive about what users will experience differently
   - Group related changes together
   - Example: "New comments now feed into existing sessions" NOT "Implemented AsyncIterable<SDKUserMessage> for ClaudeRunner"

## Key Code Paths

- **Linear Integration**: `apps/cli/services/LinearIssueService.mjs`
- **Claude Execution**: `packages/claude-runner/src/ClaudeRunner.ts`
- **Session Management**: `packages/core/src/session/`
- **Edge Worker**: `packages/edge-worker/src/EdgeWorker.ts`
- **OAuth Flow**: `apps/proxy/src/services/OAuthService.mjs`

## Testing MCP Linear Integration

To test the Linear MCP (Model Context Protocol) integration in the claude-runner package:

1. **Setup Environment Variables**:
   ```bash
   cd packages/claude-runner
   # Create .env file with your Linear API token
   echo "LINEAR_API_TOKEN=your_linear_token_here" > .env
   ```

2. **Build the Package**:
   ```bash
   pnpm build
   ```

3. **Run the Test Script**:
   ```bash
   node test-scripts/simple-claude-runner-test.js
   ```

The test script demonstrates:
- Loading Linear API token from environment variables
- Configuring the official Linear HTTP MCP server
- Listing available MCP tools
- Using Linear MCP tools to fetch user info and issues
- Proper error handling and logging

The script will show:
- Whether the MCP server connects successfully
- What Linear tools are available
- Current user information
- Issues in your Linear workspace

This integration is automatically available in all Cyrus sessions - the EdgeWorker automatically configures the official Linear MCP server for each repository using its Linear token.

## Publishing

**Important: Always publish packages in the correct order to ensure proper dependency resolution.**

### Pre-Publishing Checklist

1. **Update CHANGELOG.md**: 
   - Move items from `## [Unreleased]` to a new versioned section
   - Use the CLI version number (e.g., `## [0.1.22] - 2025-01-06`)
   - Focus on end-user impact from the perspective of the `cyrus` CLI

2. **Commit all changes**:
   ```bash
   git add -A
   git commit -m "Prepare release v0.1.XX"
   git push
   ```

### Publishing Workflow

1. **Install dependencies from root**:
   ```bash
   pnpm install  # Ensures all workspace dependencies are up to date
   ```

2. **Build all packages from root first**:
   ```bash
   pnpm build  # Builds all packages to ensure dependencies are resolved
   ```

3. **Publish packages in dependency order**:

   **IMPORTANT**: Publish in this exact order to avoid dependency resolution issues:

   ```bash
   # 1. Packages with no internal dependencies
   cd packages/ndjson-client && pnpm publish --access public --no-git-checks
   cd ../..
   pnpm install  # Update lockfile

   # 2. Packages that depend on external deps only
   cd packages/claude-runner && pnpm publish --access public --no-git-checks
   cd ../..
   pnpm install  # Update lockfile

   # 3. Core package (depends on claude-runner)
   cd packages/core && pnpm publish --access public --no-git-checks
   cd ../..
   pnpm install  # Update lockfile

   # 4. Simple agent runner (depends on claude-runner)
   cd packages/simple-agent-runner && pnpm publish --access public --no-git-checks
   cd ../..
   pnpm install  # Update lockfile

   # 5. Edge worker (depends on core, claude-runner, ndjson-client, simple-agent-runner)
   cd packages/edge-worker && pnpm publish --access public --no-git-checks
   cd ../..
   pnpm install  # Update lockfile
   ```

4. **Finally publish the CLI**:
   ```bash
   pnpm install  # Final install to ensure all deps are latest
   cd apps/cli && pnpm publish --access public --no-git-checks
   cd ../..
   ```

5. **Create git tag and push**:
   ```bash
   git tag v0.1.XX
   git push origin <branch-name>
   git push origin v0.1.XX
   ```

**Key Notes:**
- Always use `--no-git-checks` flag to publish from feature branches
- Run `pnpm install` after each publish to update the lockfile
- The `simple-agent-runner` package MUST be published before `edge-worker`
- Build all packages once at the start, then publish without rebuilding
- This ensures `workspace:*` references resolve to published versions

## 🏎️ Driving the Lamborghini CLI

The **Cyrus CLI Platform** is a premium command-line interface for testing and controlling Cyrus agent sessions. It's designed with beautiful output, excellent help, activity pagination, and professional error handling - the "Lamborghini of CLIs."

### Quick Start

**1. Build the packages:**
```bash
pnpm install
pnpm build
```

**2. Start the CLI server:**
```bash
node start-cli-server.mjs
```

The server will start on port 3457 (default) and display beautiful colored output with the RPC endpoint.

**3. Use the CLI tool:**
```bash
# Check server health
packages/core/src/issue-tracker/adapters/cli-tool.mjs ping

# View all commands
packages/core/src/issue-tracker/adapters/cli-tool.mjs help

# Get command-specific help
packages/core/src/issue-tracker/adapters/cli-tool.mjs viewSession --help
```

### Premium Features

- ✨ **Beautiful Colored Output** - Uses ANSI colors (no dependencies)
- 📄 **Activity Pagination** - `--limit` and `--offset` flags for large datasets
- 🔍 **Activity Search** - `--search` flag to filter activities
- 💡 **Per-Command Help** - Every command has `--help`
- 🏥 **Health Commands** - `ping`, `status`, `version`
- 🔗 **Connection Feedback** - Shows RPC URL on every command
- ⚡ **assignIssue Command** - Assign/reassign issues easily
- 🚀 **Portable Server** - No absolute paths required
- ❌ **Professional Errors** - Actionable error messages with suggestions

### Essential Commands

**Health & Status:**
```bash
cli-tool.mjs ping              # Check if server is running
cli-tool.mjs status            # Get version, uptime, platform info
cli-tool.mjs version           # Show version only
```

**Working with Issues:**
```bash
# Create an issue
cli-tool.mjs createIssue --title "Fix bug" --description "Critical"

# Assign to agent
cli-tool.mjs assignIssue --issue-id issue-1 --assignee-id agent-user-1

# Create comment with agent mention (triggers session)
cli-tool.mjs createComment --issue-id issue-1 --body "Fix this" --mention-agent
```

**Managing Sessions:**
```bash
# Start a session
cli-tool.mjs startSession --issue-id issue-1

# View session (with pagination)
cli-tool.mjs viewSession --session-id session-1 --limit 10

# View next page
cli-tool.mjs viewSession --session-id session-1 --limit 10 --offset 10

# Search activities
cli-tool.mjs viewSession --session-id session-1 --search "error"

# Send message to session
cli-tool.mjs promptSession --session-id session-1 --message "Add tests"

# Stop session
cli-tool.mjs stopSession --session-id session-1
```

### Testing the Lamborghini CLI

**Run the comprehensive test drive:**
```bash
./test-drive-lamborghini-cli.sh
```

This automated script tests:
- All health commands
- Help system (general + per-command)
- Issue and member creation
- assignIssue command
- Agent session creation
- Activity pagination with 15+ activities
- Activity search functionality
- Error handling edge cases
- Beautiful colored output

The test drive runs completely automated (with pauses for review) and verifies every premium feature works correctly.

### Common Workflows

**Workflow 1: Create issue, assign to agent, monitor session**
```bash
# Create issue
cli-tool.mjs createIssue --title "Refactor API" --description "Clean up endpoints"
# Output: { "id": "issue-1", ... }

# Assign to agent (triggers session via event)
cli-tool.mjs assignIssue --issue-id issue-1 --assignee-id agent-user-1

# Or manually start session
cli-tool.mjs startSession --issue-id issue-1
# Output: { "agentSessionId": "session-1", ... }

# Monitor progress (paginated)
cli-tool.mjs viewSession --session-id session-1 --limit 5

# Add activities accumulate...

# View next page
cli-tool.mjs viewSession --session-id session-1 --limit 5 --offset 5

# Search for specific activity
cli-tool.mjs viewSession --session-id session-1 --search "completed"
```

**Workflow 2: Paginating large activity lists**
```bash
# Session has 100+ activities

# View most recent 20 (default)
cli-tool.mjs viewSession --session-id session-1

# View most recent 10
cli-tool.mjs viewSession --session-id session-1 --limit 10

# View activities 20-30
cli-tool.mjs viewSession --session-id session-1 --limit 10 --offset 20

# Search for errors in last 50
cli-tool.mjs viewSession --session-id session-1 --search "error" --limit 50
```

**Workflow 3: Scripted automation**
```bash
#!/bin/bash
# Monitor session in real-time

SESSION_ID="session-1"
LAST_OFFSET=0

while true; do
  clear
  echo "=== Session $SESSION_ID (refreshing every 5s) ==="
  cli-tool.mjs viewSession --session-id "$SESSION_ID" --limit 5 --offset $LAST_OFFSET
  sleep 5
done
```

### Activity Pagination Details

**Features:**
- **Most Recent First**: Activities sorted reverse chronological
- **Configurable Limit**: `--limit N` (default: 20, shows first N activities)
- **Offset-Based**: `--offset N` (skip first N activities)
- **Full-Text Search**: `--search "term"` (searches body, type, ID)
- **Navigation Hints**: Shows "→ More available, use --offset X" automatically
- **Count Display**: Shows "showing X of Y total"

**Examples:**
```bash
# First page (most recent 20)
cli-tool.mjs viewSession --session-id S --limit 20 --offset 0

# Second page (next 20)
cli-tool.mjs viewSession --session-id S --limit 20 --offset 20

# Third page (next 20)
cli-tool.mjs viewSession --session-id S --limit 20 --offset 40

# Search and paginate
cli-tool.mjs viewSession --session-id S --search "test" --limit 10 --offset 0
```

### Environment Variables

**CYRUS_PORT**: Server port (default: 3457)
```bash
# Start server on custom port
CYRUS_PORT=8080 node start-cli-server.mjs

# Use CLI with custom port
CYRUS_PORT=8080 cli-tool.mjs ping
```

**DEBUG**: Enable stack traces
```bash
DEBUG=1 cli-tool.mjs createIssue --title "Test"
```

### Troubleshooting

**Server won't start:**
- Check if port 3457 is already in use
- Try a different port: `CYRUS_PORT=8080 node start-cli-server.mjs`
- Build packages first: `pnpm build`

**CLI can't connect:**
- Verify server is running
- Check port matches: `CYRUS_PORT=8080 cli-tool.mjs ping`
- Look for errors in `/tmp/cyrus-cli-server.log`

**Activities not showing:**
- Session may be new (no activities yet)
- Add test activity: `cli-tool.mjs promptSession --session-id S --message "test"`
- Check offset isn't beyond total count

**Module not found:**
- Run `pnpm install` and `pnpm build`
- Ensure you're in the repo root directory

### Documentation

- **CLI_TOOL_README.md** - Comprehensive CLI documentation
- **test-drive-lamborghini-cli.sh** - Automated test script
- **packages/core/src/issue-tracker/adapters/cli-tool.mjs** - CLI tool source
- **packages/core/src/issue-tracker/adapters/CLIRPCServer.ts** - RPC server
- **start-cli-server.mjs** - Server startup script

### Architecture

```
┌──────────────────┐
│  cli-tool.mjs    │  ← Beautiful CLI with colors, help, pagination
│  (Client)        │
└────────┬─────────┘
         │ HTTP POST /cli/rpc (JSON-RPC)
         ↓
┌──────────────────────┐
│  CLIRPCServer.ts     │  ← Fastify server, RPC endpoint handler
│  (EdgeWorker/Core)   │     Handles: ping, status, assignIssue, viewSession, etc.
└────────┬─────────────┘
         │
         ↓
┌─────────────────────────────┐
│  CLIIssueTrackerService.ts  │  ← In-memory storage
│  (implements                │     Stores: issues, comments, sessions, activities
│   IIssueTrackerService)     │     Events: session created, activity added, etc.
└─────────────────────────────┘
```

### Development Workflow

**Adding a new command:**

1. **Add to `cli-tool.mjs`:**
   - Add case to switch statement in `main()`
   - Add entry to `showHelp()` function
   - Add complete help to `showCommandHelp()` object

2. **Add to `CLIRPCServer.ts`:**
   - Add to `RPCCommand` type union
   - Add handler in `handleCommand()` switch

3. **Add to `CLIIssueTrackerService.ts`:**
   - Implement service method if needed
   - Follow existing patterns

4. **Update docs:**
   - Add to `CLI_TOOL_README.md`
   - Add to `test-drive-lamborghini-cli.sh`
   - Update this section of `CLAUDE.md`

**Example: Adding `listSessions` command:**

```typescript
// cli-tool.mjs
case "listSessions": {
  method = "listAgentSessions";
  rpcParams = {};
  break;
}

// Add to showHelp():
console.log(`    ${c.command("listSessions")}             List all agent sessions`);

// Add to showCommandHelp():
listSessions: {
  description: "List all agent sessions",
  usage: "cli-tool.mjs listSessions",
  options: [],
  examples: ["cli-tool.mjs listSessions"],
}

// CLIRPCServer.ts
export type RPCCommand =
  | ... existing ...
  | { method: "listAgentSessions"; params?: Record<string, never> };

case "listAgentSessions": {
  const sessions = Array.from(this.issueTrackerService.getState().agentSessions.values());
  return { success: true, data: sessions };
}
```

### Tips & Best Practices

1. **Always check server is running first**: `cli-tool.mjs ping`
2. **Use --help liberally**: Every command has detailed help
3. **Paginate large datasets**: Use `--limit` and `--offset` for 100+ activities
4. **Search before paginating**: `--search "term"` filters first, then paginates
5. **Watch most recent**: Default sort shows newest first (perfect for monitoring)
6. **Script it**: CLI is designed for bash scripts and automation
7. **Test with test drive**: Run `./test-drive-lamborghini-cli.sh` after changes

### Why "Lamborghini CLI"?

This CLI is built with premium quality:
- ✨ Beautiful, professional output (think Vercel CLI, Railway CLI)
- 📄 Handles large datasets elegantly (pagination > scrolling)
- 💡 Self-documenting (excellent help system)
- 🔍 Powerful search (find what you need fast)
- ❌ Guides users with errors (never leaves you stuck)
- 🚀 Production-ready (portable, testable, maintainable)

It's not just functional - it's a joy to use. That's the Lamborghini standard.

