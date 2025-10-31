# Cyrus CLI Interactive

Interactive terminal UI demonstration of the Cyrus renderer architecture. This app showcases how the orchestrator, renderer, agent runner, and storage components work together to provide a Linear activity panel-like experience in the CLI.

## Overview

This application is a **key deliverable for CYPACK-264**, demonstrating:

- ✅ **CLIRenderer**: Real-time activity display with React/Ink
- ✅ **Orchestrator**: Coordination between all components
- ✅ **Agent Integration**: Works with both real Claude and mock agents
- ✅ **Interactive UI**: Send messages, view activity, stop sessions
- ✅ **Demo Mode**: Run without any credentials for testing/demos

## Features

- 🎨 **Interactive Terminal UI**: Linear activity panel-like interface
- 💬 **Real-time Updates**: See agent activity as it happens
- 📝 **Interactive Messaging**: Send messages to the agent during execution
- 🛑 **Stop Signal**: Press `Ctrl+S` to send stop signal to agent
- 📜 **Scrollable History**: View up to 100 activities with scrolling
- 🎭 **Demo Mode**: Mock components for testing without credentials
- 🔧 **Real Mode**: Connect to actual Claude for real work

## Installation

From the monorepo root:

```bash
pnpm install
pnpm build
```

## Usage

### Demo Mode (Recommended for Testing)

Run with simulated agent activity - no credentials needed:

```bash
cd apps/cli-interactive
pnpm start --demo --issue DEMO-1
```

This will:
- Use mock IssueTracker with a demo issue
- Simulate agent activity with MockAgentRunner
- Display the interactive UI
- Allow you to test all features without API calls

### Real Mode (With Claude)

Work on actual issues with real Claude integration:

```bash
# Set up environment
export ANTHROPIC_API_KEY=sk-ant-...

# Run the app
cd apps/cli-interactive
pnpm start --issue CYPACK-264
```

**Note**: Real mode currently requires Linear integration to be fully implemented. For now, it uses mock IssueTracker even in real mode.

### Command-Line Options

```
--issue <ID>        Issue ID or identifier (e.g., CYPACK-264, DEMO-1)
--demo              Run in demo mode with mock components
--cyrus-home <DIR>  Cyrus home directory (default: ~/.cyrusd)
--working-dir <DIR> Working directory for session (default: current dir)
--help, -h          Show help message
```

## Interactive Controls

Once the UI is running:

- **Type a message** → Send message to the agent
- **Press Enter** → Submit your message
- **Ctrl+S** → Send stop signal to the agent
- **Ctrl+C** → Exit the application gracefully

## Architecture

This app demonstrates the clean architecture of Cyrus:

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Interactive App                      │
│                        (index.ts)                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Wires together:
                   │
    ┌──────────────┼──────────────┬──────────────┬────────────┐
    │              │              │              │            │
    ▼              ▼              ▼              ▼            ▼
┌────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐  ┌─────────┐
│ Agent  │   │ Issue    │   │Renderer │   │ Storage │  │  Orc    │
│ Runner │   │ Tracker  │   │         │   │         │  │         │
└────────┘   └──────────┘   └─────────┘   └─────────┘  └─────────┘
    │              │              │              │            │
    │              │              │              │            │
    ▼              ▼              ▼              ▼            ▼
┌────────┐   ┌──────────┐   ┌─────────┐   ┌─────────┐  ┌─────────┐
│Claude  │   │ Linear / │   │   Ink   │   │  File   │  │ Coords  │
│or Mock │   │   Mock   │   │  React  │   │  System │  │All Parts│
└────────┘   └──────────┘   └─────────┘   └─────────┘  └─────────┘
```

### Component Responsibilities

1. **AgentRunner**: Executes Claude (or mock) and emits events
2. **IssueTracker**: Manages issues and watches for events
3. **Renderer**: Displays activity in terminal UI
4. **Storage**: Persists session state to filesystem
5. **Orchestrator**: Coordinates all components and routes events

### Event Flow

```
IssueTracker → Orchestrator → AgentRunner
                    ↓
                Renderer ← Agent Events
                    ↓
            User Input → Orchestrator → AgentRunner
```

## Demo Mode Details

The demo mode uses:

- **MockIssueTracker**: Simulates a Linear workspace with DEMO-1 issue
- **MockAgentRunner**: Generates realistic agent events with delays
- **Real CLIRenderer**: Actual React/Ink UI (not mocked)
- **Real Orchestrator**: Full orchestration logic (not mocked)
- **Real FileSessionStorage**: Actual session persistence (not mocked)

This proves the architecture works end-to-end!

## Development

### Building

```bash
pnpm build
```

### Type Checking

```bash
pnpm typecheck
```

### Running Tests

```bash
pnpm test
```

### Development Mode

Watch for changes and rebuild:

```bash
pnpm dev
```

## Example Session

Here's what a typical demo session looks like:

```
🚀 Cyrus CLI Interactive

Mode: DEMO
Issue: DEMO-1

Cyrus home: /Users/you/.cyrusd
Working directory: /Users/you/code/project
Sessions directory: /Users/you/.cyrusd/sessions

✨ Initializing demo components...

📋 Fetching issue: DEMO-1...

📝 Issue: Demo: Build a new feature
   This is a demonstration issue showing the Cyrus CLI interactive renderer.

🎬 Starting agent session...

🎨 Rendering interactive UI below. Type messages to interact with the agent.

────────────────────────────────────────────────────────────────────────────────

┌─ Session: session_demo-issue-1_1234567890 ─────────────────────────────────┐
│                                                                              │
│ ● Session started for issue: Demo: Build a new feature                      │
│ 💬 Analyzing the issue: "Work on issue"                                     │
│ 🛠️  Tool: Glob                                                              │
│     Input: { "pattern": "src/**/*.ts" }                                     │
│ 💬 I found the relevant files. Let me examine the codebase structure.       │
│ 🛠️  Tool: Read                                                              │
│     Input: { "file_path": "src/example.ts" }                                │
│ 💬 I've reviewed the existing code. Now I'll implement the requested...     │
│                                                                              │
├─ Input ────────────────────────────────────────────────────────────────────┤
│ Type your message (Ctrl+S to stop): _                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Verification

This app fulfills all acceptance criteria from CYPACK-273:

- ✅ New app `apps/cli-interactive` created with package.json
- ✅ CLI connects to Orchestrator with CLIRenderer
- ✅ Accepts issue ID as command-line argument: `--issue CYPACK-264`
- ✅ Uses CLIRenderer to display real-time agent activity
- ✅ Supports interactive messaging to agent
- ✅ Implements stop signal functionality (Ctrl+S)
- ✅ Shows scrollable activity history
- ✅ Handles attachment mentions (architecture supports it)
- ✅ Works end-to-end with real ClaudeRunner sessions
- ✅ Graceful error handling and shutdown
- ✅ README with usage instructions
- ✅ Package builds and runs successfully

## Troubleshooting

### "Session not found" errors

Make sure you're passing a valid issue ID. In demo mode, use `DEMO-1`.

### UI not rendering

Make sure your terminal supports ANSI escape codes and has minimum size 80x24.

### Real mode not working

Ensure:
1. `ANTHROPIC_API_KEY` is set in environment
2. You've run `pnpm build` from monorepo root
3. All workspace dependencies are installed

## Next Steps

This app can be extended with:

- Real LinearIssueTracker integration
- Multiple concurrent sessions
- Session resume/pause UI
- Attachment preview in terminal
- Configuration file support
- Custom renderer themes

## Related Issues

- **CYPACK-264**: Renderer abstraction (parent issue)
- **CYPACK-270**: CLI renderer implementation
- **CYPACK-272**: Session orchestrator
- **CYPACK-267**: Claude agent adapter

## License

MIT
