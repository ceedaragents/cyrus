# F1 CLI - Testing Framework for Cyrus

A beautiful command-line interface for testing and interacting with the Cyrus agent system. The F1 CLI provides a comprehensive set of commands for managing issues, sessions, and agent activities without external dependencies.

## Features

- ✨ **Beautiful colored output** using ANSI escape codes
- 🚀 **Zero external dependencies** for output formatting
- 📝 **Comprehensive help** for each command
- 🔍 **Debug-friendly** with RPC URL displayed on every command
- 🎯 **Type-safe** with absolutely zero `any` types
- ⚡ **Fast** using Bun runtime
- 🎨 **Professional error messages** with helpful suggestions

## Installation

```bash
# Install dependencies
pnpm install

# Build the CLI
pnpm build
```

## Usage

The F1 CLI provides the following commands:

### Health & Status Commands

```bash
# Health check
./f1 ping

# Server status
./f1 status

# Version information
./f1 version
```

### Issue Management Commands

```bash
# Create a new issue
./f1 create-issue --title "Fix authentication bug" --description "Users cannot log in"

# Assign issue to a user
./f1 assign-issue --issue-id "issue-123" --assignee-id "user-456"

# Create a comment on an issue
./f1 create-comment --issue-id "issue-123" --body "Working on this now"

# Create a comment with agent mention
./f1 create-comment --issue-id "issue-123" --body "Need help" --mention-agent
```

### Session Management Commands

```bash
# Start an agent session on an issue
./f1 start-session --issue-id "issue-123"

# View session details
./f1 view-session --session-id "session-456"

# View session with pagination
./f1 view-session --session-id "session-456" --limit 20 --offset 10

# Search activities in a session
./f1 view-session --session-id "session-456" --search "error"

# Send a message to active session
./f1 prompt-session --session-id "session-456" --message "Please continue"

# Stop an active session
./f1 stop-session --session-id "session-456"
```

## Environment Variables

- `CYRUS_PORT` - Port for F1 server (default: 3457)

## Configuration

The CLI connects to the F1 server via JSON-RPC over HTTP:

```
http://localhost:${CYRUS_PORT}/cli/rpc
```

The RPC endpoint URL is displayed at the start of every command for easy debugging.

## Development

```bash
# Install dependencies
pnpm install

# Build TypeScript
pnpm build

# Type checking
pnpm typecheck

# Run tests
pnpm test:run

# Watch mode
pnpm dev
```

## Architecture

The F1 CLI is built with:

- **Commander.js** for CLI parsing and command management
- **TypeScript** for type safety
- **Bun** runtime for fast execution
- **Custom utilities** for RPC calls and formatting (zero external dependencies)

### Project Structure

```
apps/f1/
├── f1                      # Bash script entry point
├── src/
│   ├── cli.ts             # Main CLI entry point
│   ├── commands/          # Command implementations
│   │   ├── ping.ts
│   │   ├── status.ts
│   │   ├── version.ts
│   │   ├── createIssue.ts
│   │   ├── assignIssue.ts
│   │   ├── createComment.ts
│   │   ├── startSession.ts
│   │   ├── viewSession.ts
│   │   ├── promptSession.ts
│   │   └── stopSession.ts
│   └── utils/             # Shared utilities
│       ├── colors.ts      # ANSI color helpers
│       ├── rpc.ts         # JSON-RPC client
│       └── output.ts      # Output formatting
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Type Safety

The F1 CLI has **absolutely zero `any` types**. All code is fully typed with TypeScript strict mode enabled.

## Error Handling

All commands provide professional error messages with helpful suggestions:

```
✗ Failed to create issue: RPC Error (404): Issue not found
  Please check that:
    - The F1 server is running
    - The issue ID is correct
```

## Colors

The CLI uses ANSI escape codes for beautiful colored output:

- 🟢 Green - Success messages
- 🔴 Red - Error messages
- 🟡 Yellow - Warning messages
- 🔵 Cyan - Informational messages
- ⚪ Gray - Debug/metadata

## License

Part of the Cyrus project.
