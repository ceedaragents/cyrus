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


## How Cyrus Works

When a Linear issue is assigned to Cyrus, the following sequence occurs:

1. **Issue Detection & Routing**: The EdgeWorker receives a webhook from Linear and routes the issue to the appropriate repository based on configured patterns or workspace catch-all rules.

2. **Workspace Isolation**: A dedicated Git worktree is created for each issue (e.g., `worktrees/DEF-1/`) with a sanitized branch name derived from the issue identifier. This ensures complete isolation between concurrent tasks.

3. **AI Classification**: The issue content is analyzed to determine its type (`code`, `question`, `research`, etc.) and the appropriate procedure is selected (e.g., `full-development` for coding tasks).

4. **Subroutine Execution**: For development tasks, Claude executes a sequence of subroutines:
   - **coding-activity**: Implements the requested feature/fix
   - **verifications**: Runs tests, type checks, and linting
   - **git-gh**: Commits changes and creates pull requests
   - **concise-summary**: Generates a final summary for Linear

5. **Mid-Implementation Prompting**: Users can add comments to the Linear issue while Claude is working. These comments are streamed into the active session, allowing real-time guidance (e.g., "Also add a modulo method while you're at it").

6. **Activity Tracking**: Every thought and action is posted back to Linear as activities, providing full visibility into what Claude is doing.

### Example Interaction

A typical session flow:
```
[GitService] Fetching latest changes from remote...
[GitService] Creating git worktree at .../worktrees/DEF-1 from origin/main
[EdgeWorker] Workspace created at: .../worktrees/DEF-1
[EdgeWorker] AI routing decision: Classification: code, Procedure: full-development
[ClaudeRunner] Session ID assigned by Claude: c5c1fc00-...
[AgentSessionManager] Created thought activity activity-6
[AgentSessionManager] Created action activity activity-7
... (Claude implements the feature)
[ClaudeRunner] Session completed with 84 messages
[AgentSessionManager] Subroutine completed, advancing to next: verifications
```

### Test Drives

To see Cyrus in action, refer to the test drives in `apps/f1/test-drives/`. These documents showcase real interactions demonstrating:
- How issues are processed end-to-end
- Mid-implementation prompting in action
- Subroutine transitions and activity logging
- Final repository state after completion

The F1 (Formula 1) testing framework provides a controlled environment to test Cyrus without affecting production Linear workspaces.

## Working with SDKs

When examining or working with a package SDK:

1. First, install the dependencies:
   ```bash
   pnpm install
   ```

2. Locate the specific SDK in the `node_modules` directory to examine its structure, types, and implementation details.

3. Review the SDK's documentation, source code, and type definitions to understand its API and usage patterns.

## Navigating GitHub Repositories

When you need to examine source code from GitHub repositories (especially when GitHub's authentication blocks normal navigation):

**Use uuithub.com instead of github.com:**

```
# Instead of:
https://github.com/google-gemini/gemini-cli/blob/main/src/file.ts

# Use:
https://uuithub.com/google-gemini/gemini-cli/blob/main/src/file.ts
```

This proxy service provides unauthenticated access to GitHub content, making it ideal for:
- Reading source code files
- Browsing directory structures
- Examining schemas and configuration files
- Investigating third-party library implementations

Simply replace `github.com` with `uuithub.com` in any GitHub URL.

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


## Gemini CLI for Testing

The project uses Google's Gemini CLI for testing the GeminiRunner implementation. Install the specific version:

```bash
npm install -g @google/gemini-cli@0.17.0
```

This ensures consistency when running integration tests that interact with the Gemini API.

### Gemini Configuration Reference

For detailed information about Gemini CLI configuration options (settings.json structure, model aliases, previewFeatures, etc.), refer to:
- **Official Documentation**: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md

The GeminiRunner automatically generates a `~/.gemini/settings.json` file with single-turn model aliases and preview features enabled if one doesn't already exist.
