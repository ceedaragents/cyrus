# F1 - Fast CLI for Cyrus Platform

A modern TypeScript CLI tool for testing the Cyrus agent platform. Built with Bun runtime and Commander.js.

## Features

- ✨ **TypeScript**: Fully typed with strict type checking
- 🎨 **Beautiful Output**: Colored, formatted terminal output  
- 📄 **Pagination**: View large datasets efficiently
- 🔍 **Search**: Filter activities with full-text search
- 💡 **Excellent Help**: Built-in help for every command
- 🚀 **Fast**: Powered by Bun runtime
- 🛠️ **Modular**: Clean, DRY code architecture

## Quick Start

```bash
# From repository root
./apps/f1/f1 --help

# From f1 directory
cd apps/f1
./f1 --help
```

## Available Commands

### Health & Status
```bash
./f1 ping        # Check server connectivity
./f1 status      # Get server status
./f1 version     # Show version
```

### Issue Management
```bash
./f1 createIssue --title "Fix bug" --description "Details"
./f1 assignIssue --issue-id issue-1 --assignee-id user-1
```

### Agent Sessions
```bash
./f1 startSession --issue-id issue-1
./f1 viewSession --session-id session-1 --limit 10
./f1 promptSession --session-id session-1 --message "Add tests"
./f1 stopSession --session-id session-1
```

## Documentation

- **[Commands Reference](./docs/COMMANDS.md)** - Complete CLI command documentation
- **[RPC API Reference](./docs/RPC_API.md)** - Low-level HTTP/JSON-RPC API
- **[Test Drives](./test-drives/)** - Real-world usage examples and UX findings

## Development

```bash
# Start server
bun run apps/f1/server.ts

# Type checking
pnpm --filter cyrus-f1 typecheck

# Linting
pnpm biome check apps/f1/src/

# Build
pnpm --filter cyrus-f1 build

# Run test drive
./apps/f1/test-drive-f1.sh
```

## License

MIT
