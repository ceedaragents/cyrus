# F1 Testing Framework - Developer Documentation

This documentation provides guidance to Claude Code when working with the F1 testing framework.

## Project Overview

The F1 Testing Framework is an end-to-end observable testing platform for the Cyrus agent system. It provides a CLI-based issue tracker that simulates Linear's functionality without requiring external dependencies.

**Key Features:**
- In-memory issue tracking (CLIIssueTrackerService)
- CLI platform mode for EdgeWorker
- Beautiful CLI interface with ANSI colors
- RPC server for CLI-to-EdgeWorker communication
- Zero external dependencies for testing
- Zero `any` types throughout the codebase

## Architecture

The F1 framework follows this flow:

```
CLI Commands (f1 binary)
         ↓
   JSON-RPC over HTTP
         ↓
   CLIRPCServer (Fastify)
         ↓
   CLIIssueTrackerService (in-memory)
         ↓
   EdgeWorker (platform: "cli")
         ↓
   Claude Code Sessions
```

For detailed architecture information, see `/spec/f1/ARCHITECTURE.md`.

## File Structure

```
apps/f1/
├── f1                    # CLI binary (bash script calling bun)
├── server.ts             # Server startup script
├── src/
│   ├── cli.ts            # CLI entry point using Commander.js
│   ├── commands/         # CLI command implementations
│   │   ├── assignIssue.ts
│   │   ├── createComment.ts
│   │   ├── createIssue.ts
│   │   ├── ping.ts
│   │   ├── promptSession.ts
│   │   ├── startSession.ts
│   │   ├── status.ts
│   │   ├── stopSession.ts
│   │   ├── version.ts
│   │   └── viewSession.ts
│   └── utils/
│       ├── colors.ts     # ANSI color utilities (zero dependencies)
│       ├── output.ts     # Formatted output helpers
│       └── rpc.ts        # RPC client for CLI-server communication
├── test-drives/          # Test drive logs and findings
├── CLAUDE.md             # This file
└── README.md             # User-facing documentation
```

## Running the F1 Server

The F1 server starts an EdgeWorker in CLI platform mode:

```bash
# Start with default settings
bun run server.ts

# Or use pnpm scripts
pnpm run server

# Custom configuration
CYRUS_PORT=3457 CYRUS_REPO_PATH=/path/to/repo bun run server.ts

# Development mode with auto-reload
pnpm run server:dev
```

**Environment Variables:**
- `CYRUS_PORT` - Server port (default: 3457)
- `CYRUS_REPO_PATH` - Repository path (default: current working directory)

The server automatically:
- Creates temporary directories in `/tmp/cyrus-f1-*`
- Configures EdgeWorker with `platform: "cli"`
- Starts Fastify server on the specified port
- Registers RPC endpoints at `/cli/rpc`
- Displays beautiful colored connection info

## Using the F1 CLI

Once the server is running, use the CLI to interact with it:

```bash
# Health check
./f1 ping

# Server status
./f1 status

# Create an issue
./f1 create-issue --title "Test Issue" --description "Test description"

# Assign issue to user
./f1 assign-issue --issue-id <id> --assignee-id <user-id>

# Start an agent session
./f1 start-session --issue-id <id>

# View session activities
./f1 view-session --session-id <id>

# Prompt session with user message
./f1 prompt-session --session-id <id> --message "Continue working"

# Stop session
./f1 stop-session --session-id <id>
```

**CLI Features:**
- Beautiful colored output using ANSI escape codes
- Comprehensive help for each command (`./f1 <command> --help`)
- Debug-friendly with RPC URL displayed on every command
- Professional error messages with suggestions
- Uses Bun for fast startup

## Configuration Details

### Server Configuration (server.ts)

The server creates an EdgeWorker with the following configuration:

```typescript
const config: EdgeWorkerConfig = {
  platform: "cli" as const,
  repositories: [repository],
  cyrusHome: CYRUS_HOME,
  serverPort: CYRUS_PORT,
  serverHost: "localhost",
  defaultModel: "sonnet",
  defaultFallbackModel: "haiku",
};
```

**Key Points:**
- `platform: "cli"` - Enables CLI mode
- No Cloudflare tunnel in CLI mode
- No Linear API required
- Uses CLIIssueTrackerService instead of LinearIssueTrackerService
- CLIRPCServer registered at `/cli/rpc`

### CLI RPC Client (src/utils/rpc.ts)

The CLI communicates with the server using JSON-RPC over HTTP:

```typescript
interface RPCRequest<TParams> {
  method: RPCCommand;
  params: TParams;
}

interface RPCResponse<TData> {
  success: boolean;
  data?: TData;
  error?: string;
}
```

## Testing

```bash
# Run tests
pnpm test

# Type checking
pnpm typecheck

# Build
pnpm build
```

**Testing Best Practices:**
- Always write tests for new commands
- Use Vitest for all tests
- Ensure zero `any` types
- Test error handling paths
- Mock RPC responses for CLI tests

## Development Workflow

### Adding a New CLI Command

1. Create command file in `src/commands/`
2. Implement command with proper types
3. Add RPC method to CLIRPCServer (in core package)
4. Register command in `src/cli.ts`
5. Add tests
6. Update README.md with command documentation

### Modifying the Server

The server is designed to be minimal. Most logic lives in:
- EdgeWorker (packages/edge-worker)
- CLIIssueTrackerService (packages/core)
- CLIRPCServer (packages/core)

Only modify server.ts for:
- Configuration changes
- Environment variable handling
- Startup/shutdown logic
- Connection info display

## Color Usage Guidelines

The F1 framework uses consistent ANSI colors:

- **Green** - Success, completion
- **Red** - Errors, failures
- **Yellow** - Warnings, important info
- **Cyan** - Labels, metadata
- **Gray/Dim** - Secondary info, timestamps
- **Bold** - Important values, headings

Example:
```typescript
import { success, error, cyan, bold } from './utils/colors.js';

console.log(success('Operation completed'));
console.log(error('Operation failed'));
console.log(`${cyan('Status:')} ${bold('ready')}`);
```

## Common Issues

### Server won't start
- Check if port is already in use
- Verify CYRUS_REPO_PATH exists
- Ensure all packages are built (`pnpm build` from root)

### CLI can't connect to server
- Verify server is running (`./f1 ping`)
- Check RPC_URL environment variable
- Default is `http://localhost:3457/cli/rpc`

### TypeScript errors
- Run `pnpm build` from root to build all packages
- Check tsconfig.json includes all necessary files
- Verify workspace dependencies are resolved

## Related Files

- `/spec/f1/ARCHITECTURE.md` - Complete architecture documentation
- `/packages/core/src/issue-tracker/adapters/CLIIssueTrackerService.ts` - In-memory issue tracker
- `/packages/core/src/issue-tracker/adapters/CLIRPCServer.ts` - RPC server implementation
- `/packages/edge-worker/src/EdgeWorker.ts` - EdgeWorker with CLI platform support

## Important Notes

1. **Zero Dependencies for Output**: The CLI uses raw ANSI escape codes, no chalk or other dependencies
2. **Type Safety**: Absolutely zero `any` types in the codebase
3. **Bun Runtime**: Both server and CLI use Bun for fast startup
4. **Temporary Directories**: Server creates temporary directories, no state persistence
5. **Single Repository Mode**: F1 currently supports one repository per server instance
6. **No Authentication**: CLI mode doesn't require Linear tokens or authentication

## Verification

To verify the F1 framework works end-to-end:

```bash
# 1. Build everything
pnpm install && pnpm build

# 2. Start F1 server in one terminal
cd apps/f1
pnpm run server

# 3. In another terminal, test CLI commands
cd apps/f1
./f1 ping                                    # Should return pong
./f1 status                                  # Should show server status
./f1 create-issue --title "Test"             # Should create issue
./f1 start-session --issue-id <id>           # Should start session
./f1 view-session --session-id <session-id>  # Should show activities
./f1 stop-session --session-id <session-id>  # Should stop session
```

All commands should complete successfully with beautiful colored output.
