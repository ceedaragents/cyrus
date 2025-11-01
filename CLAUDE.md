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

3. **Do Not Commit Random Markdown Files**:
   - **NEVER commit standalone markdown files** for documentation, notes, or evidence purposes
   - Test-drive evidence must be included in **Linear comments** or **PR descriptions**, not committed as files
   - This includes files like `TEST_DRIVE_EVIDENCE.md`, `NOTES.md`, `TODO.md`, etc.
   - Exception: Only commit markdown files that are part of the official documentation structure (like `CLAUDE.md`, `README.md`, `CHANGELOG.md`, or files in a `docs/` directory)
   - See the [Browser Emulator Testing Framework](#browser-emulator-testing-framework) section for proper evidence formats

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

## Browser Demo Interactive Element Selectors

The browser demo (`apps/browser-demo`) contains the following interactive elements with their CSS selectors for testing and automation:

### Sidebar Controls
- **Sidebar Toggle**: `#sidebarToggle` - Hamburger menu (☰) to show/hide sidebar on mobile
- **Export Session Button**: `#exportBtn` - Button with text "Export Session"
- **Share Button**: `#shareBtn` - Button with text "Share"

### Activity Controls
- **Expand/Collapse Buttons**: `.expand-btn` - Toggle buttons for tool call details
  - Each has unique ID: `#expand-activity_{activityId}` (e.g., `#expand-activity_1761959638058_d63z5l`)
  - Shows ▼ when collapsed, ▲ when expanded
- **Copy Buttons**: `.copy-btn` - Buttons to copy tool call input/output to clipboard
  - Located within `.activity.tool-call` elements
  - Text: "Copy"

### Timeline Navigation
- **Timeline Dots**: `.timeline-dot` - Navigation dots for jumping to specific activities
  - Multiple dots representing each activity in the timeline
- **System Event Dots**: `.system-dot` - Special dots for system events (session start/complete)

### Message Controls
- **Send Button**: `#sendBtn` - Button to send messages to Claude agent
- **Stop Button**: `#stopBtn` - Button to stop/cancel running agent
- **Message Input**: `#messageInput` - Text input field for typing messages

### Activity-Specific Selectors
- **Tool Call Activity**: `.activity.tool-call` - Container for tool execution activities
- **Thought Activity**: `.activity.thought` - Container for agent thoughts (italic text with ~ icon)
- **System Event**: `.activity.system-evt` - Container for system events
- **Result Activity**: `.activity.result` - Container for completion results

### Targeted Selectors for Specific Tools
- **Glob Tool Call**: `.activity.tool-call:has(.tool-name:text("Glob"))`
- **Read Tool Call**: `.activity.tool-call:has(.tool-name:text("Read"))`
- **Edit Tool Call**: `.activity.tool-call:has(.tool-name:text("Edit"))`
- **Bash Tool Call**: `.activity.tool-call:has(.tool-name:text("Bash"))`

### Connection Status
- **Connection Status Indicator**: `.connection-status` - Shows "Connected" or "Disconnected"
  - Classes: `.connection-status.connected` or `.connection-status.disconnected`

### Session Information
- **Session Title**: `.session-title` - Displays the issue title
- **Session ID**: `.session-id` - Displays the issue identifier
- **Session Status Badge**: `.session-status` - Shows session state (Complete, Running, etc.)

## Browser Emulator Testing Framework

**CRITICAL REQUIREMENT**: The browser emulator (`apps/browser-demo`) is the **mandatory testing framework** for all Cyrus development work. NO pull request can be merged without evidence of test-driving changes in the emulator.

### Purpose and Philosophy

The browser demo is not just a demonstration tool - it is a comprehensive Linear emulator and testing framework for the entire I/O abstraction system. It provides a controlled, Linear-like environment for testing all core abstractions:

- **IssueTracker**: Issue and comment management APIs
- **Renderer**: Activity rendering and UI updates
- **AgentRunner**: Claude Code execution and session handling
- **SessionStorage**: Session persistence and state management

The emulator serves dual purposes:

1. **Testing Framework**: Validates that I/O abstractions work correctly before shipping
2. **Visual Proof**: Provides concrete evidence that changes function as intended

If a feature cannot be tested in the emulator, the emulator must be enhanced first to support that testing capability. This ensures our abstractions remain testable and well-designed.

### Mandatory Development Workflow

Every PR must follow this workflow:

1. **Build Feature**: Implement your changes in the relevant packages
2. **Enhance Emulator** (if needed): If the emulator cannot test your changes, enhance it first
3. **Test-Drive**: Run your changes in the emulator and verify behavior
4. **Capture Evidence**: Document test results with screenshots, session logs, or interaction flows
5. **Submit PR**: Include test-drive evidence in your PR description

### What Qualifies as Test-Drive Evidence

Your PR must include one or more of the following:

**Screenshots**: Visual proof of emulator UI showing:
- Expected behavior working correctly
- Error handling functioning properly
- State transitions happening as designed
- Activity timeline showing proper sequencing

**Session Logs**: Exported session data demonstrating:
- Correct prompt assembly
- Proper tool execution
- Expected state changes
- Accurate persistence behavior

**Interaction Flows**: Step-by-step descriptions showing:
- User actions taken in emulator
- Agent responses observed
- State changes verified
- Edge cases tested

**Example Evidence Format**:
```markdown
## Emulator Test-Drive Evidence

### Test Scenario: Sub-agent delegation with parent feedback

1. Started session with issue "Create user authentication"
2. Agent created 3 sub-issues
3. Verified activity panel shows delegation events
4. Provided feedback via message input
5. Confirmed sub-agent received feedback in activity log

Screenshots:
- Initial delegation: [screenshot-delegation.png]
- Feedback flow: [screenshot-feedback.png]
- Final state: [screenshot-complete.png]

Session log: Available at apps/browser-demo/sessions/test-delegation-20250131.json
```

### Running the Emulator

The emulator supports two modes:

**Demo Mode** (Standalone):
```bash
cd apps/browser-demo
pnpm install
pnpm dev
```

Opens at http://localhost:3000 with mock Linear environment. Use this for rapid iteration and testing without Linear API dependencies.

**Real Mode** (Connected to Cyrus):
```bash
# Terminal 1: Start Cyrus edge worker
cd apps/cli
CYRUS_SERVER_PORT=8080 pnpm start --cyrus-home=/path/to/.cyrus

# Terminal 2: Start browser demo with Cyrus connection
cd apps/browser-demo
CYRUS_SERVER_URL=http://localhost:8080 pnpm dev
```

Opens at http://localhost:3000 connected to real Cyrus instance. Use this for integration testing with actual Linear issues.

### Relationship to Linear Integration

The emulator and real Linear integration work together:

- **Emulator**: Provides fast, controlled testing environment with mock Linear API
- **Linear Integration**: Connects to real Linear workspace via `apps/cli` and edge worker

Key differences:

| Aspect | Emulator | Real Linear |
|--------|----------|-------------|
| **Speed** | Instant responses | Network latency |
| **Data** | Mock issues/comments | Real workspace data |
| **State** | In-memory only | Persisted to Linear |
| **Testing** | Rapid iteration | Integration validation |
| **Required for PR** | Yes - must test-drive | No - but recommended |

**Best practice**: Test-drive in emulator first, then validate with real Linear integration before shipping.

### Interactive Element Selectors

For detailed selector documentation to use in automated testing or interaction scripts, see the [Browser Demo Interactive Element Selectors](#browser-demo-interactive-element-selectors) section above.

### Why This Requirement Exists

This requirement ensures:

1. **Abstractions Stay Testable**: If you can't test it in the emulator, the abstraction design needs work
2. **Visual Verification**: Screenshots prove the feature works before code review
3. **Regression Prevention**: Emulator tests catch breaking changes early
4. **Documentation**: Test evidence serves as living documentation of feature behavior
5. **Quality Bar**: Forces thorough testing before PR submission

**Remember**: The emulator is not optional - it is a core development requirement that keeps our abstractions clean, testable, and reliable.

