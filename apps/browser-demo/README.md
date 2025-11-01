# Cyrus Browser Demo

Browser-based interactive emulator for the Cyrus CLI demo. This application provides a web interface that demonstrates the orchestrator → renderer → UI flow with real-time activity updates, user input, and session management.

## Overview

This is a **key deliverable for CYPACK-278**, demonstrating:

- ✅ **BrowserRenderer**: Real-time activity display via WebSocket
- ✅ **Orchestrator**: Coordination between all components
- ✅ **Mock Components**: Simulated agent and issue tracker
- ✅ **Interactive UI**: Send messages, view activity, stop sessions
- ✅ **Web Interface**: Browser-based alternative to CLI demo

## Features

- 🌐 **Browser-Based UI**: Clean web interface with real-time updates
- 💬 **Real-time Updates**: See agent activity as it happens via WebSocket
- 📝 **Interactive Messaging**: Send messages to the agent during execution
- 🛑 **Stop Signal**: Click button to send stop signal to agent
- 📜 **Scrollable History**: Auto-scrolling activity log
- 🎭 **Emulator Mode**: Mock components for testing without credentials
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

1. **MockAgentRunner**: Simulates Claude with realistic events (emulator mode)
2. **MockIssueTracker**: Simulates Linear with an emulated issue
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

### Quick Start

```bash
cd apps/browser-demo
pnpm start
```

Then open your browser to: **http://localhost:3000**

The application will automatically:
- Start the orchestrator
- Detect the pre-assigned emulated issue
- Begin a mock agent session
- Display real-time activity in the browser

### Custom Port

```bash
PORT=8080 pnpm start
```

### Custom Cyrus Home

```bash
CYRUS_HOME=/tmp/cyrus pnpm start
```

## How It Works

### Server Side

1. **Express Server**: Serves static HTML/CSS/JS files
2. **WebSocket Server**: Handles real-time bidirectional communication
3. **BrowserRenderer**: Implements the `Renderer` interface, sends JSON messages to browser
4. **Orchestrator**: Same orchestration logic as CLI implementation
5. **Mock Components**: Mock implementations for emulator mode

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
│   ├── MockAgentRunner.ts     # Simulated agent (for emulator mode)
│   └── MockIssueTracker.ts    # Simulated issue tracker (for emulator mode)
├── public/
│   ├── index.html             # Browser UI structure
│   └── app.js                 # Browser client logic
├── package.json               # Package configuration
├── tsconfig.json              # TypeScript configuration
└── README.md                  # This file
```

## Comparison with CLI Implementation

| Feature | CLI Implementation | Browser Implementation |
|---------|----------|--------------|
| **UI Framework** | React/Ink (terminal) | Vanilla HTML/JS (browser) |
| **Renderer** | CLIRenderer | BrowserRenderer |
| **Communication** | Direct (same process) | WebSocket |
| **Display** | Terminal UI | Web page |
| **Accessibility** | Requires terminal access | Access via browser |
| **Use Case** | Local development | Remote access, screenshots |

## Verification

This app fulfills all acceptance criteria from CYPACK-278:

- ✅ Simple web page (HTML + vanilla JS) that runs locally
- ✅ Includes MockAgentRunner and MockIssueTracker for emulator mode
- ✅ Displays real-time activity log (text events, tool-use events)
- ✅ Shows message input field at bottom (like Linear's "message Cyrus")
- ✅ Supports stop button during agent execution
- ✅ Displays session status (running, complete, error) with visual indicators
- ✅ Extremely simple to build and run: `npm run start`
- ✅ Provides clear verification instructions (see below)

## Verification Instructions

To verify this implementation works correctly:

### 1. Start the Demo

```bash
cd apps/browser-demo
pnpm start
```

**Expected output:**
```
🚀 Starting Cyrus Browser Demo Server...

📦 Initializing components...
   ✓ Mock Agent Runner
   ✓ Mock Issue Tracker
   ✓ Browser Renderer
   ✓ File Session Storage
   ✓ Agent Session Orchestrator

🎬 Starting orchestrator...
   ✓ Orchestrator watching for issues

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Browser Demo Server running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📍 URL: http://localhost:3000

   Press Ctrl+C to stop the server
```

### 2. Open Browser

Navigate to: **http://localhost:3000**

### 3. Verify UI Elements

The page should display:
- **Header**: "Cyrus CLI Demo - Browser Emulator"
- **Connection status**: Green "● Connected"
- **Session header**: Shows issue title "Demo: Build a new feature (DEMO-1)"
- **Status indicator**: Pulsing green dot (running)
- **Activity log**: Activities appearing in real-time
- **Message input**: Text field at bottom
- **Send button**: Enabled during session
- **Stop button**: Enabled during session

### 4. Verify Real-time Activity

You should see activities appearing automatically:
1. "Session started for issue: Demo: Build a new feature"
2. "Analyzing the issue..."
3. Tool use: Glob, Read, Edit
4. Text responses from agent
5. Eventually: "Session completed" with summary

### 5. Test Interactive Messaging

1. Type a message in the input field: "Can you add more tests?"
2. Press Enter or click Send
3. Verify the agent responds with: "Received your message..."
4. Verify new activities appear

### 6. Test Stop Button

1. If session is still running, click "Stop"
2. Verify session status changes to "complete"
3. Verify stop message appears in activity log
4. Verify input field becomes disabled

### 7. Verify Auto-scroll

- Activity log should automatically scroll to show latest activity
- Scrollbar should be at the bottom

## Expected Visual Appearance

The UI should look like a terminal emulator with:
- Dark theme (black/dark gray background)
- Monospace font
- Color-coded activity types
- Icons for each activity (emojis)
- Clean, minimal design
- Responsive layout

## Troubleshooting

### Server won't start

Make sure dependencies are installed:
```bash
cd /Users/agentops/code/cyrus-workspaces/CYPACK-278
pnpm install
pnpm build
```

### Browser shows "Disconnected"

1. Check server is running
2. Refresh the browser page
3. Check console for errors (F12)

### No activities appearing

1. Check server console for errors
2. Verify WebSocket connection (should see "New browser client connected")
3. Refresh browser page

### Port 3000 already in use

Use a different port:
```bash
PORT=8080 pnpm start
```

Then open: http://localhost:8080

## Technical Notes

- **No build step for browser code**: HTML/JS served directly
- **TypeScript only for server**: Browser uses vanilla JavaScript
- **WebSocket for real-time**: Efficient bidirectional communication
- **Mock components available**: MockAgentRunner and MockIssueTracker for emulator mode
- **Same orchestrator**: Proves architecture works with different renderers

## Future Enhancements

Potential improvements:
- Add React for more complex UI
- Support multiple concurrent sessions
- Add session history/replay
- File upload/attachment support
- Theme customization
- Mobile-responsive design

## Related Issues

- **CYPACK-278**: Browser demo (this implementation)
- **CYPACK-264**: Renderer abstraction (parent issue)
- **CYPACK-270**: CLI renderer implementation
- **CYPACK-272**: Session orchestrator
- **CYPACK-267**: Claude agent adapter

## License

MIT
