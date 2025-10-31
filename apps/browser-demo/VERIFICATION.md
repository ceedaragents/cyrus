# Browser Demo Verification Instructions

## Overview

The browser-based interactive CLI demo emulator successfully demonstrates the Cyrus orchestrator → renderer → UI flow with real-time activity updates, user input capabilities, and session management.

## Quick Start

### 1. Build and Start the Demo

From the **repository root** (`/Users/agentops/code/cyrus-workspaces/CYPACK-278/`):

```bash
# Build the browser demo (if not already built)
cd apps/browser-demo
pnpm build

# Start the demo server
pnpm start
```

**Alternative: Run from root with custom port**
```bash
cd apps/browser-demo
PORT=3333 pnpm start
```

### 2. Access the Demo

Once the server starts, you'll see output like:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Browser Demo Server running!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   📍 URL: http://localhost:3000
   📂 Public directory: /path/to/apps/browser-demo/public
   💾 Sessions directory: /Users/agentops/.cyrusd/sessions/browser-demo

   🎯 Open the URL in your browser to see the interactive demo
   📊 The demo will automatically start with a mock agent session
```

**Open the URL** (default: `http://localhost:3000`) in your web browser.

## Expected Behavior

### Initial View

When you open the browser demo, you should see:

1. **Header Section**
   - Title: "🚀 Cyrus CLI Demo - Browser Emulator"
   - Subtitle: "Interactive demonstration of Cyrus agent orchestrator and renderer system"
   - Connection Status: "● Connected" (green)

2. **Session Panel**
   - Session status indicator (pulsing green dot for "running")
   - Issue title: "Demo: Build a new feature"
   - Issue ID: "(demo-issue-1)"

3. **Activity Log**
   - Real-time scrolling activity feed showing:
     - Session start message
     - Agent thoughts (💬 text)
     - Tool usage (🛠️ tool-use) with JSON-formatted input
     - Progress updates
     - Session completion summary (✅ complete)

4. **Input Controls (at bottom)**
   - Message input field: "Type your message to the agent..."
   - "Send" button (green)
   - "Stop" button (red)
   - Keyboard hint: "Press Enter to send message • Click Stop to halt agent execution"

### Activity Log Content

The demo automatically generates realistic agent activity including:

- **Session Start**: Initial session startup message
- **Text Events**: Agent analysis and commentary
  - "Analyzing the issue..."
  - "I found the relevant files..."
  - "I've reviewed the existing code..."
  - etc.
- **Tool Use Events**: Simulated tool calls with formatted JSON
  - `Glob` - File pattern matching
  - `Read` - Reading files
  - `Edit` - Code modifications
  - `Bash` - Running commands
- **Completion Event**: Final summary with:
  - Number of turns
  - Tools used count
  - Files modified list
  - Exit code
  - Summary message

### Session States

The demo demonstrates three session states:

1. **Running** (green pulsing dot)
   - Input field is enabled
   - Can send messages
   - Can stop execution

2. **Complete** (green solid dot)
   - Input field is disabled
   - Shows completion summary

3. **Error** (red solid dot)
   - Input field is disabled
   - Shows error details

### User Interaction Features

While the session is running, you can:

1. **Send Messages**
   - Type a message in the input field
   - Press Enter or click "Send"
   - The agent will acknowledge your message and continue working

2. **Stop Execution**
   - Click the "Stop" button
   - The session will gracefully halt

**Note**: The default demo session completes quickly (~10 seconds), so you may need to refresh the page to test interaction features with a new session.

## Technical Verification

### Architecture Components

The demo successfully integrates:

1. **MockAgentRunner** (`src/MockAgentRunner.ts`)
   - Generates realistic agent events
   - Simulates tool usage and completion
   - Handles user messages during execution

2. **MockIssueTracker** (`src/MockIssueTracker.ts`)
   - Provides demo issue data
   - Simulates Linear issue tracking

3. **BrowserRenderer** (`src/BrowserRenderer.ts`)
   - Implements the Renderer interface
   - Converts agent events to JSON messages
   - Broadcasts via WebSocket to browser clients

4. **AgentSessionOrchestrator** (from `cyrus-orchestrator` package)
   - Coordinates agent runner, issue tracker, and renderer
   - Manages session lifecycle
   - Handles event routing

5. **Client-Side UI** (`public/index.html`, `public/app.js`)
   - Establishes WebSocket connection
   - Renders activity feed in real-time
   - Handles user input and sends to server

### WebSocket Communication

The demo uses WebSocket for real-time bidirectional communication:

**Server → Client Messages:**
- `session:update` - Session state updates with activity feed

**Client → Server Messages:**
- `user:message` - User text input
- `user:stop` - Stop signal

### File Structure

```
apps/browser-demo/
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── src/
│   ├── server.ts          # Express + WebSocket server
│   ├── BrowserRenderer.ts # Renderer implementation
│   ├── MockAgentRunner.ts # Mock agent for demo
│   └── MockIssueTracker.ts# Mock issue tracker
├── public/
│   ├── index.html         # Browser UI
│   └── app.js             # Client-side JavaScript
└── dist/                  # Compiled JavaScript (after build)
```

## Verification Checklist

- [x] Server starts without errors
- [x] Browser UI loads at http://localhost:3000 (or configured port)
- [x] WebSocket connection establishes (shows "● Connected")
- [x] Session automatically starts with demo issue
- [x] Activity log displays real-time events
- [x] Events include proper formatting and icons
- [x] Tool use events show JSON-formatted input
- [x] Session completes with summary
- [x] UI properly disables input after completion
- [x] Browser UI is responsive and scrollable
- [x] Auto-scroll keeps latest activity visible

## Screenshots

Screenshots were captured during testing:

1. **Initial View**: Shows the browser demo loaded with activity log
   - Saved to: `~/Downloads/browser-demo-initial-view-*.png`

2. **Completed Session**: Shows a full session with all events and completion summary
   - Saved to: `~/Downloads/browser-demo-completed-session-*.png`

## Common Issues & Solutions

### Port Already in Use

If port 3000 is already in use:
```bash
PORT=3333 pnpm start
```

### WebSocket Connection Fails

- Ensure the server is running
- Check that no firewall is blocking the connection
- Verify the correct port in browser URL matches server port

### No Activity Appears

- Check browser console for JavaScript errors
- Verify WebSocket connection status in header
- Check server logs for errors

## Stop the Server

Press `Ctrl+C` in the terminal to gracefully shut down the server.

## Additional Notes

- The demo uses a mock agent runner, so no actual Claude API calls are made
- Sessions are stored in `~/.cyrusd/sessions/browser-demo/`
- The demo automatically starts a new session on server startup
- Refresh the browser page to trigger a new session
- The orchestrator runs continuously and will process any new issues

## Success Criteria Met

✅ Simple web page running locally
✅ Reuses MockAgentRunner and MockIssueTracker
✅ Displays real-time activity log with text and tool-use events
✅ Shows message input field (like Linear's "message Cyrus")
✅ Supports stop button during execution
✅ Displays session status with visual indicators
✅ Extremely simple to run: `cd apps/browser-demo && pnpm start`
✅ Screenshots provided showing working demo

## Conclusion

The browser-based demo successfully proves that the I/O abstractions work correctly:
- Orchestrator manages session lifecycle
- Renderer converts events to browser-friendly format
- Real-time WebSocket communication works bidirectionally
- UI provides an intuitive visualization of agent activity

This demo can be used for:
- Presentations and demonstrations
- Testing renderer implementations
- Debugging orchestrator behavior
- Verifying event flow without terminal access
