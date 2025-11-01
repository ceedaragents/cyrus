# Cyrus Browser Demo

Browser-based interactive emulator for Cyrus CLI. This application provides a web interface for testing and developing Cyrus with real-time activity updates, user input, and session management.

## Overview

The browser emulator is the **primary testing framework** for all Cyrus I/O abstractions, providing two modes:

- 🎭 **Emulator Mode**: Mock data for rapid testing without credentials
- 🤖 **Real Mode**: Actual Claude Code execution for integration testing

Key features:

- ✅ **Real-time Activity Display**: See Claude's thought process and tool executions
- ✅ **Interactive Messaging**: Send messages and provide feedback
- ✅ **Session Persistence**: Sessions saved to filesystem
- ✅ **No External Dependencies**: Embedded ClaudeRunner in real mode
- ✅ **Simple Workflow**: Single command to start

## Quick Start

### Emulator Mode (Mock Data - No Credentials Needed)

```bash
cd apps/browser-demo
pnpm build
pnpm start:emulator
# Open http://localhost:3000
```

This mode uses mock data and instant responses - perfect for UI development and testing without Claude API access.

### Real Mode (Actual Claude Code)

```bash
cd apps/browser-demo
pnpm build

# Set up authentication (choose ONE):
export CLAUDE_CODE_OAUTH_TOKEN="your-token-here"  # Recommended
# OR
export ANTHROPIC_API_KEY="your-api-key"

pnpm start
# Open http://localhost:3000
```

This mode runs actual Claude Code sessions - use for integration testing and verifying real behavior.

## Features

- 🌐 **Browser-Based UI**: Clean web interface with real-time updates
- 💬 **Real-time Updates**: See agent activity as it happens via WebSocket
- 📝 **Interactive Messaging**: Send messages to the agent during execution
- 🛑 **Stop Signal**: Click button to send stop signal to agent
- 📜 **Scrollable History**: Auto-scrolling activity log
- 🎭 **Emulator Mode**: Mock components for testing without credentials
- 🤖 **Real Mode**: Embedded ClaudeRunner for actual Claude sessions
- 🔌 **WebSocket Communication**: Efficient real-time bidirectional updates

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Browser Demo Server (Node.js)              │
│                        (server.ts)                           │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Wires together:
                   │
    ┌──────────────┼──────────────┬──────────────┬────────────┐
    │              │              │              │            │
    ▼              ▼              ▼              ▼            ▼
┌────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐  ┌─────────┐
│ Mock   │   │  Mock    │   │ Browser │   │  File   │  │  Orc    │
│ Agent  │   │  Issue   │   │Renderer │   │ Storage │  │         │
│ Runner │   │ Tracker  │   │         │   │         │  │         │
└────────┘   └──────────┘   └─────────┘   └─────────┘  └─────────┘
    │              │              │              │            │
    │              │              │              │            │
    │              │              │              │            │
    └──────────────┴──────────────┴──────────────┴────────────┘
                                  │
                                  │ WebSocket
                                  ▼
                          ┌───────────────┐
                          │  Browser UI   │
                          │ (HTML + JS)   │
                          └───────────────┘
```

### Component Responsibilities

1. **MockAgentRunner**: Simulates Claude with realistic events
2. **MockIssueTracker**: Simulates Linear with a demo issue
3. **BrowserRenderer**: Sends activity updates to browser via WebSocket
4. **FileSessionStorage**: Persists session state to filesystem
5. **Orchestrator**: Coordinates all components and routes events
6. **Express Server**: Serves static files and handles WebSocket connections
7. **Browser UI**: Displays activity and handles user input

## Installation

From the monorepo root:

```bash
pnpm install
pnpm build
```

## Usage

### Available Scripts

| Script | Description | Use Case |
|--------|-------------|----------|
| `pnpm start` | Real mode (default) | Integration testing with actual Claude |
| `pnpm start:emulator` | Emulator mode | UI development, no credentials needed |
| `pnpm start:real` | Real mode (explicit) | Same as `pnpm start` |
| `pnpm build` | Build TypeScript | Before running |
| `pnpm typecheck` | Type checking | Development |

### Command-Line Options

```bash
# Run with custom port
pnpm start --port 8080

# Run in emulator mode
pnpm start --emulator

# Get help
pnpm start --help
```

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `CLAUDE_CODE_OAUTH_TOKEN` | OAuth token from `claude setup-token` | Real mode only |
| `ANTHROPIC_API_KEY` | Alternative to OAuth token | Real mode only |
| `CYRUS_HOME` | Session storage directory | Optional (default: `~/.cyrusd`) |
| `PORT` | Server port | Optional (default: `3000`) |

## How It Works

### Server Side

1. **Express Server**: Serves static HTML/CSS/JS files
2. **WebSocket Server**: Handles real-time bidirectional communication
3. **BrowserRenderer**: Implements the `Renderer` interface, sends JSON messages to browser
4. **Orchestrator**: Same orchestration logic as CLI demo
5. **Mock Components**: Mock implementations for testing

### Browser Side

1. **WebSocket Client**: Connects to server and receives updates
2. **UI Updates**: Real-time rendering of activities
3. **User Input**: Sends messages and stop signals back to server
4. **Auto-scroll**: Automatically scrolls to show latest activity

### Message Flow

```
Browser → WebSocket → BrowserRenderer → Orchestrator → AgentRunner
                                              │
                                              ▼
Browser ← WebSocket ← BrowserRenderer ← Agent Events
```

## UI Features

### Activity Log

- **Real-time updates**: Activities appear as they happen
- **Color-coded types**: Different colors for text, tool-use, errors, etc.
- **Icons**: Visual indicators for each activity type
- **Timestamps**: Precise timing for each activity
- **Auto-scroll**: Automatically scrolls to latest activity

### Message Input

- **Text field**: Type messages to send to the agent
- **Send button**: Click or press Enter to send
- **Disabled when stopped**: Input disabled when session completes

### Stop Button

- **Emergency stop**: Halt agent execution at any time
- **Graceful handling**: Agent receives stop signal and can clean up

### Status Indicators

- **Connection status**: Shows WebSocket connection state
- **Session status**: Running (pulsing), Complete (green), Error (red)
- **Session info**: Displays issue title and ID

## Development

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

### Development Mode

Watch for changes and rebuild:

```bash
pnpm dev
```

## Project Structure

```
apps/browser-demo/
├── src/
│   ├── server.ts              # Main server entry point
│   ├── BrowserRenderer.ts     # Renderer implementation for browser
│   ├── MockAgentRunner.ts     # Simulated agent (reused from CLI demo)
│   └── MockIssueTracker.ts    # Simulated issue tracker (reused)
├── public/
│   ├── index.html             # Browser UI structure
│   └── app.js                 # Browser client logic
├── package.json               # Package configuration
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## Modes Comparison

| Aspect | Emulator Mode | Real Mode |
|--------|---------------|-----------|
| **Authentication** | None required | OAuth token or API key |
| **Speed** | Instant responses | Real Claude latency |
| **Data** | Mock issues/activities | Actual file operations |
| **Use Case** | UI dev, rapid testing | Integration testing |
| **Claude Behavior** | Simulated with preset responses | Real Claude Code execution |
| **File System** | Mock operations | Actual file reads/writes |
| **Sessions** | Saved to disk | Saved to disk |

## Workflow Comparison: Before vs After

### Before (Complex - Two Processes)

```bash
# Terminal 1: Start Cyrus CLI edge worker
cd apps/cli
CYRUS_SERVER_PORT=8080 pnpm start --cyrus-home=/path/to/.cyrus

# Terminal 2: Start browser demo pointing to CLI
cd apps/browser-demo
CYRUS_SERVER_URL=http://localhost:8080 pnpm dev
```

### After (Simple - One Command)

```bash
# Emulator mode (mock data)
cd apps/browser-demo
pnpm start:emulator

# Real mode (actual Claude)
cd apps/browser-demo
export CLAUDE_CODE_OAUTH_TOKEN="..."
pnpm start
```

## Verification

### Emulator Mode Verification

```bash
cd apps/browser-demo
pnpm build
pnpm start:emulator
# Open http://localhost:3000
```

**Expected behavior:**
- ✅ Server starts without requiring credentials
- ✅ Mock issue appears automatically
- ✅ Mock activities stream in real-time
- ✅ Can send messages and get instant mock responses
- ✅ Session completes with mock summary

### Real Mode Verification

```bash
cd apps/browser-demo
pnpm build
export CLAUDE_CODE_OAUTH_TOKEN="your-token"
pnpm start
# Open http://localhost:3000
```

**Expected behavior:**
- ✅ Server validates authentication
- ✅ Real ClaudeRunner initializes
- ✅ Can create issues or load existing ones
- ✅ See actual Claude thoughts and tool executions
- ✅ Real file operations (Read, Edit, Bash, etc.)
- ✅ Session persists to `~/.cyrusd/sessions/browser-demo/`

### Error Handling Verification

```bash
# Test without credentials (should fail gracefully)
cd apps/browser-demo
pnpm build
unset CLAUDE_CODE_OAUTH_TOKEN
unset ANTHROPIC_API_KEY
pnpm start
```

**Expected output:**
```
❌ Error: Authentication required for real mode
   Set one of the following environment variables:
   - CLAUDE_CODE_OAUTH_TOKEN (recommended, get via: claude setup-token)
   - ANTHROPIC_API_KEY
   Or run with --emulator flag for emulator mode
```

## Expected Visual Appearance

The UI should look like a terminal emulator with:
- Dark theme (black/dark gray background)
- Monospace font
- Color-coded activity types
- Icons for each activity (emojis)
- Clean, minimal design
- Responsive layout

## Troubleshooting

### Authentication Error (Real Mode)

```
❌ Error: Authentication required for real mode
```

**Solution:** Set up authentication before starting:
```bash
# Option 1: OAuth token (recommended)
export CLAUDE_CODE_OAUTH_TOKEN="$(claude setup-token)"

# Option 2: API key
export ANTHROPIC_API_KEY="your-api-key"

# Or use emulator mode instead
pnpm start:emulator
```

### Both Auth Methods Set

```
❌ Error: Both ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN are set
```

**Solution:** Use only one authentication method:
```bash
unset ANTHROPIC_API_KEY
# OR
unset CLAUDE_CODE_OAUTH_TOKEN
```

### Server Won't Start

Make sure dependencies are installed:
```bash
cd apps/browser-demo
pnpm install
pnpm build
```

### Browser Shows "Disconnected"

1. Check server is running
2. Refresh the browser page
3. Check console for errors (F12)

### No Activities Appearing

1. Check server console for errors
2. Verify WebSocket connection (should see "New browser client connected")
3. Refresh browser page

### Port 3000 Already in Use

Use a different port:
```bash
pnpm start --port 8080
```

Then open: http://localhost:8080

## Technical Notes

- **No external dependencies in real mode**: Embedded ClaudeRunner handles everything
- **No build step for browser code**: HTML/JS served directly
- **TypeScript only for server**: Browser uses vanilla JavaScript
- **WebSocket for real-time**: Efficient bidirectional communication
- **Session persistence**: All sessions saved to `CYRUS_HOME/sessions/browser-demo/`
- **Same orchestrator**: Works with both mock and real agent runners

## Key Differences from Previous Architecture

### What Changed

1. **No separate CLI process needed**: Browser demo now embeds ClaudeRunner directly
2. **Flag renamed**: `--demo` → `--emulator` for clarity
3. **Real mode is default**: Emulator mode requires explicit flag
4. **Simplified workflow**: Single command instead of two terminals

### What Stayed the Same

- All core abstractions (AgentRunner, IssueTracker, Renderer, Storage)
- Session persistence mechanism
- WebSocket communication protocol
- Browser UI and interaction model

## Related Issues

- **CYPACK-300**: Enable real Claude testing through browser emulator (this implementation)
- **CYPACK-298**: Rename --demo to --emulator flag
- **CYPACK-264**: Renderer abstraction (parent architecture)
- **CYPACK-278**: Original browser demo implementation
- **CYPACK-272**: Session orchestrator

## License

MIT
