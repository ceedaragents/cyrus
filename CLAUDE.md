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

```
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

## Code Quality Standards

### Strict TypeScript - NO `any` Types

**CRITICAL RULE**: NEVER use `any` type in this codebase. Always use proper TypeScript types.

**Why**: The `any` type defeats TypeScript's purpose and allows bugs to slip through. This codebase maintains strict typing discipline.

**What to use instead**:
- **Generic types**: `<T>` for truly polymorphic code
- **Union types**: `string | number` when multiple types are valid
- **Interface types**: Define proper interfaces for objects
- **`unknown`**: For truly unknown values that require type checking before use
- **Type assertions**: `as Type` only when you have verified the type (sparingly)

**Bad Examples (NEVER DO THIS)**:
```typescript
const issue: any = await fetchIssue();  // ❌ NO
const labels = (issue as any).labels(); // ❌ NO
function process(data: any) { }         // ❌ NO
```

**Good Examples**:
```typescript
const issue: Issue = await fetchIssue();              // ✅ YES
const issue: LinearIssue = await fetchLinearIssue();  // ✅ YES
function process<T>(data: T) { }                      // ✅ YES
function process(data: unknown) {                     // ✅ YES
  if (isIssue(data)) {
    // Now data is typed as Issue
  }
}
```

### Architecture: Platform-Agnostic Layers

**CRITICAL RULE**: EdgeWorker and other high-level components must have ZERO platform-specific logic.

**Platform-specific code belongs ONLY in**:
- `LinearIssueTrackerService` - Linear SDK-specific implementation
- `CLIIssueTrackerService` - CLI platform-specific implementation
- Other `*IssueTrackerService` implementations

**EdgeWorker must NEVER**:
- Check `typeof issue.labels === "function"`
- Use runtime type detection to distinguish platforms
- Call Linear SDK methods directly
- Have any awareness of which platform it's running on
- **NEVER use dual-interface shimming** - Code like this is FORBIDDEN:
  ```typescript
  // ❌ NEVER DO THIS - Dual interface shimming is FORBIDDEN
  const labelNames = typeof issue.labels === "function"
    ? (await issue.labels()).nodes.map((l) => l.name)
    : (issue.labels as Array<{name: string}>).map((l) => l.name);
  ```

**EdgeWorker must ONLY**:
- Call methods on the `IIssueTrackerService` interface
- Work with platform-agnostic types (`Issue`, `Comment`, `Label`, etc.)
- Trust that the service implementations handle platform differences
- **Use a SINGLE abstraction** - If you need label names, call `issueTrackerService.getIssueLabels(issueId)`

**Why this matters**:
Dual-interface shimming (checking types at runtime to handle different platforms) defeats the entire purpose of the abstraction layer. It creates hidden coupling, makes the code brittle, and violates the separation of concerns. If EdgeWorker needs data, the `IIssueTrackerService` interface should provide a method to get it in a platform-agnostic way.

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

## MCP Server Architecture

### Basic Issue Tracker Server (`packages/edge-worker/src/tools/basic-issue-tracker.ts`)

**Purpose**: Provides a CLI-compatible MCP server that replicates the 5 core tools from Linear's official MCP server. This allows the CLI platform to offer the same essential issue tracking tools that Linear provides, creating a consistent interface for agents across both platforms.

**Tools Provided**:
- `create_comment` - Create comments on issues
- `create_issue` - Create new issues with optional parent (sub-issue support)
- `get_issue` - Fetch detailed issue information
- `list_labels` - List available issue labels
- `list_teams` - List workspace teams

**Platform Usage**:
- **CLI Platform**: Uses this server via `createBasicIssueTrackerServer()` with `CLIIssueTrackerService`
- **Linear Platform**: Uses Linear's official HTTP MCP server directly (https://mcp.linear.app/mcp)

**Design Goal**: Platform parity - agents should be able to use the same tool names (`create_issue`, `get_issue`, etc.) regardless of whether they're running in CLI mode or Linear mode.

### Issue Tracker Tools Server (`packages/edge-worker/src/tools/index.ts`)

**Purpose**: Provides platform-agnostic **extended** tools for advanced agent workflows, particularly orchestrator agents that manage child agent sessions.

**Tools Provided**:
- `issue_tracker_upload_file` - Upload files for use in issues/comments
- `issue_tracker_agent_session_create` - Create agent session on an issue
- `issue_tracker_agent_session_create_on_comment` - Create agent session on a comment thread
- `issue_tracker_agent_give_feedback` - Provide feedback to child agent sessions
- `issue_tracker_get_child_issues` - Fetch all child issues (sub-issues)

**Platform Usage**:
- **CLI Platform**: Uses `createIssueTrackerToolsServer()` with `CLIIssueTrackerService`
- **Linear Platform**: Uses `createCyrusToolsServer()` (from Linear event transport package) with Linear API client

**Design Goal**: Platform-agnostic orchestration - orchestrator agents need these advanced session management tools regardless of the underlying issue tracker platform.



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

## 🏎️ F1 - Fast CLI for Testing

The **F1 CLI** is a modern TypeScript command-line interface for testing and controlling Cyrus agent sessions. Built with Bun and Commander.js, it features beautiful output, excellent help, activity pagination, and professional error handling.

### Quick Start

**1. Build the packages:**
```bash
pnpm install
pnpm build
```

**2. Start the CLI server:**
```bash
bun run apps/f1/server.ts
```

The server will start on port 3457 (default) and display beautiful colored output with the RPC endpoint.

**3. Use F1:**
```bash
# Check server health
./apps/f1/f1 ping

# View all commands
./apps/f1/f1 --help

# Get command-specific help
./apps/f1/f1 viewSession --help
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
./apps/f1/f1 ping              # Check if server is running
./apps/f1/f1 status            # Get version, uptime, platform info
./apps/f1/f1 version           # Show version only
```

**Working with Issues:**
```bash
# Create an issue
./apps/f1/f1 createIssue --title "Fix bug" --description "Critical"

# Assign to agent
./apps/f1/f1 assignIssue --issue-id issue-1 --assignee-id agent-user-1

# Create comment with agent mention (triggers session)
./apps/f1/f1 createComment --issue-id issue-1 --body "Fix this" --mention-agent
```

**Managing Sessions:**
```bash
# Start a session
./apps/f1/f1 startSession --issue-id issue-1

# View session (with pagination)
./apps/f1/f1 viewSession --session-id session-1 --limit 10

# View next page
./apps/f1/f1 viewSession --session-id session-1 --limit 10 --offset 10

# Search activities
./apps/f1/f1 viewSession --session-id session-1 --search "error"

# Send message to session
./apps/f1/f1 promptSession --session-id session-1 --message "Add tests"

# Stop session
./apps/f1/f1 stopSession --session-id session-1
```

### Testing F1

**Run the comprehensive test drive:**
```bash
./tools/cli-platform/test-drive-f1.sh
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
./apps/f1/f1 createIssue --title "Refactor API" --description "Clean up endpoints"
# Output: { "id": "issue-1", ... }

# Assign to agent (triggers session via event)
./apps/f1/f1 assignIssue --issue-id issue-1 --assignee-id agent-user-1

# Or manually start session
./apps/f1/f1 startSession --issue-id issue-1
# Output: { "agentSessionId": "session-1", ... }

# Monitor progress (paginated)
./apps/f1/f1 viewSession --session-id session-1 --limit 5

# Add activities accumulate...

# View next page
./apps/f1/f1 viewSession --session-id session-1 --limit 5 --offset 5

# Search for specific activity
./apps/f1/f1 viewSession --session-id session-1 --search "completed"
```

**Workflow 2: Paginating large activity lists**
```bash
# Session has 100+ activities

# View most recent 20 (default)
./apps/f1/f1 viewSession --session-id session-1

# View most recent 10
./apps/f1/f1 viewSession --session-id session-1 --limit 10

# View activities 20-30
./apps/f1/f1 viewSession --session-id session-1 --limit 10 --offset 20

# Search for errors in last 50
./apps/f1/f1 viewSession --session-id session-1 --search "error" --limit 50
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
  ./apps/f1/f1 viewSession --session-id "$SESSION_ID" --limit 5 --offset $LAST_OFFSET
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
./apps/f1/f1 viewSession --session-id S --limit 20 --offset 0

# Second page (next 20)
./apps/f1/f1 viewSession --session-id S --limit 20 --offset 20

# Third page (next 20)
./apps/f1/f1 viewSession --session-id S --limit 20 --offset 40

# Search and paginate
./apps/f1/f1 viewSession --session-id S --search "test" --limit 10 --offset 0
```

### Environment Variables

**CYRUS_PORT**: Server port (default: 3457)
```bash
# Start server on custom port
CYRUS_PORT=8080 bun run apps/f1/server.ts

# Use CLI with custom port
CYRUS_PORT=8080 ./apps/f1/f1 ping
```

**DEBUG**: Enable stack traces
```bash
DEBUG=1 ./apps/f1/f1 createIssue --title "Test"
```

### Troubleshooting

**Server won't start:**
- Check if port 3457 is already in use
- Try a different port: `CYRUS_PORT=8080 bun run apps/f1/server.ts`
- Build packages first: `pnpm build`

**CLI can't connect:**
- Verify server is running
- Check port matches: `CYRUS_PORT=8080 ./apps/f1/f1 ping`
- Look for errors in `/tmp/cyrus-cli-server.log`

**Activities not showing:**
- Session may be new (no activities yet)
- Add test activity: `./apps/f1/f1 promptSession --session-id S --message "test"`
- Check offset isn't beyond total count

**Module not found:**
- Run `pnpm install` and `pnpm build`
- Ensure you're in the repo root directory

### Documentation

- **apps/f1/README.md** - F1 CLI platform overview and usage
- **tools/cli-platform/CLI_TOOL_README.md** - Comprehensive CLI documentation
- **tools/cli-platform/test-drive-f1.sh** - Automated test script
- **apps/f1/f1** - CLI tool source
- **apps/f1/server.ts** - Server startup script (run with `bun run apps/f1/server.ts`)
- **apps/f1/test-drives/** - Real-world usage test drives and UX findings
- **packages/core/src/issue-tracker/adapters/CLIRPCServer.ts** - RPC server

### Architecture

```
┌──────────────────┐
│  ./apps/f1/f1    │  ← Beautiful CLI with colors, help, pagination
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

1. **Add to `./apps/f1/f1`:**
   - Add case to switch statement in `main()`
   - Add entry to `showHelp()` function
   - Add complete help to `showCommandHelp()` object

2. **Add to `packages/core/src/issue-tracker/adapters/CLIRPCServer.ts`:**
   - Add to `RPCCommand` type union
   - Add handler in `handleCommand()` switch

3. **Add to `packages/core/src/issue-tracker/adapters/CLIIssueTrackerService.ts`:**
   - Implement service method if needed
   - Follow existing patterns

4. **Update docs:**
   - Add to `tools/cli-platform/CLI_TOOL_README.md`
   - Add to `tools/cli-platform/test-drive-f1.sh`
   - Update this section of `CLAUDE.md`

**Example: Adding `listSessions` command:**

```javascript
// ./apps/f1/f1
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
  usage: "./apps/f1/f1 listSessions",
  options: [],
  examples: ["./apps/f1/f1 listSessions"],
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

1. **Always check server is running first**: `./apps/f1/f1 ping`
2. **Use --help liberally**: Every command has detailed help
3. **Paginate large datasets**: Use `--limit` and `--offset` for 100+ activities
4. **Search before paginating**: `--search "term"` filters first, then paginates
5. **Watch most recent**: Default sort shows newest first (perfect for monitoring)
6. **Script it**: CLI is designed for bash scripts and automation
7. **Test with test drive**: Run `./tools/cli-platform/test-drive-f1.sh` after changes

### Why "F1"?

This CLI is built with premium quality (Formula 1 standard):
- ✨ Beautiful, professional output (think Vercel CLI, Railway CLI)
- 📄 Handles large datasets elegantly (pagination > scrolling)
- 💡 Self-documenting (excellent help system)
- 🔍 Powerful search (find what you need fast)
- ❌ Guides users with errors (never leaves you stuck)
- 🚀 Production-ready (portable, testable, maintainable)

It's not just functional - it's a joy to use. That's the F1 (Formula 1) standard.

---

## 🧪 Real-World Test Drives

The `test-drives/` directory contains documented experiences of using the F1 CLI platform for actual development tasks. These test drives serve as UX research, product validation, and design input for improvements.

### Running a Test Drive

When asked to "test drive the system" or "run a real test drive", follow this process:

**1. Choose a realistic development goal:**
- Small-to-medium scope (e.g., add utility function, fix bug, refactor module)
- Something you would actually do in real development
- Achievable in 10-20 minutes

**2. Start the F1 server:**
```bash
bun run apps/f1/server.ts &
./apps/f1/f1 ping
```

**3. Create a timestamped log file:**
```bash
# Format: apps/f1/test-drives/NNN-description.md
# Example: apps/f1/test-drives/001-rate-limiter-feature.md
```

**4. Execute the development workflow:**
- Create an issue with realistic title/description
- Assign to agent
- Start session and monitor progress
- Send messages/guidance as needed
- Use pagination, search, and other features
- Stop session when complete

**5. Document UX observations in real-time:**
- Note what feels good (✅) and what feels frustrating (😐)
- Record exact commands and outputs
- Capture "feels like" impressions
- Take screenshots if helpful
- Track timing (how long each phase takes)

**6. Write a final retrospective:**
- Score the experience (X/10)
- List strengths and weaknesses
- Identify top 3 feature requests
- Note if you would use it daily
- Provide actionable improvement suggestions

**7. Commit and push the test drive:**
```bash
git add apps/f1/test-drives/
git commit -m "Add test drive: [description]" --no-verify
git push origin <branch>
```

### Test Drive Structure

Each test drive should include:

```markdown
# Test Drive #NNN: [Goal Description]

**Date**: YYYY-MM-DD
**Goal**: [One sentence]
**Scope**: Small/Medium/Large
**Developer Persona**: [Who you're simulating]

---

## Development Session Log

### HH:MM - [Phase Name]

**Action**: [What you did]
**Command**: [Exact command run]
**Output**: [Key output received]

**UX Notes**:
- ✅ What worked well
- 😐 What felt awkward
- 🤔 What's missing
- ❤️ What delighted you

**Feel**: [One sentence impression]

---

## Final Retrospective

### What Worked Really Well ✅
[List strengths]

### What Needs Improvement 😐
[List weaknesses with specific suggestions]

### Missing Features 🤔
[Feature requests]

### Overall Experience Score
**UX Quality**: X/10
**Developer Productivity**: X/10
**Engagement**: X/10

### Would I Use This Daily?
[Yes/No with reasoning]

### Key Quote
> "[Memorable quote from experience]"

---

**Test Drive Complete**: [Timestamp]
```

### Existing Test Drives

See `apps/f1/test-drives/README.md` for a catalog of completed test drives and their findings.

**Quick Links:**
- [Test Drive #001](apps/f1/test-drives/001-rate-limiter-feature.md) - Rate Limiter Feature (8.5/10)
- [Summary of Findings](apps/f1/test-drives/SUMMARY.md)
- [Improvement Roadmap](apps/f1/test-drives/IMPROVEMENT_IDEAS.md)

### Design Principles from Test Drives

Based on real-world usage:

1. **Progressive Disclosure** - Show essentials first, details on demand
2. **Immediate Feedback** - Confirm every action with clear output
3. **Human-Readable** - Prefer summaries over raw data dumps
4. **Guided Experience** - Suggest next steps at every stage
5. **Visual Hierarchy** - Use colors/emojis to aid scanning
6. **Error Recovery** - Make mistakes obvious and fixable

### When to Run Test Drives

- **After major features** - Validate new functionality works well
- **Before releases** - Ensure quality hasn't regressed
- **When questioning UX** - Get empirical data on pain points
- **Periodically** - Build a time-series of UX quality
- **Different personas** - Junior dev, senior dev, PM, designer

