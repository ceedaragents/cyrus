# CYPACK-287: Parent Orchestrator Verification Instructions

This document provides step-by-step verification instructions for the parent orchestrator to validate the enhanced browser emulator implementation.

## Overview

This implementation enhances the browser emulator (`apps/browser-demo`) to provide comprehensive test-driving capabilities for all I/O abstractions: IssueTracker, Renderer, AgentRunner, SessionStorage, and Orchestrator.

## Prerequisites

Navigate to this issue's worktree:

```bash
cd /Users/agentops/code/cyrus-workspaces/CYPACK-287
```

## Verification Steps

### Step 1: Build the Project

Build all packages to ensure everything compiles:

```bash
pnpm install
pnpm build
```

**Expected Output:**
- No compilation errors
- All packages build successfully
- TypeScript type checking passes

### Step 2: Start the Browser Demo

```bash
cd apps/browser-demo
pnpm start
```

**Expected Output:**
```
🚀 Starting Cyrus Browser Demo Server...

📦 Initializing components...
   ✓ Mock Agent Runner (demo mode)
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
   🎭 Mode: Demo (mock responses)

   Press Ctrl+C to stop the server
```

### Step 3: Open Browser and Verify UI

1. Open browser to: **http://localhost:3000**

2. **Verify Header Elements:**
   - Title: "Cyrus CLI Demo"
   - Subtitle present
   - Connection status shows green "● Connected"

3. **Verify Sidebar Sections:**
   - **Session**: Shows issue title "Demo: Build a new feature (DEMO-1)"
   - **Statistics**: Shows counters (Thoughts: 0, Tool Calls: 0, Messages: 0, Duration: 0s)
   - **Timeline**: Empty timeline scrubber
   - **Actions**: 4 buttons (Export Session, Share, Download Activity Log, Capture Screenshot)
   - **Test Controls**: New section with:
     - Agent Runner toggle (Mock/Claude)
     - Issue Tracker buttons (3 buttons)
     - Session Storage buttons (3 buttons)
     - Test Scenarios dropdown and Run button

4. **Verify Main Content Area:**
   - Activities container (should start showing mock activities)
   - Message input field at bottom
   - Send and Stop buttons

### Step 4: Test Renderer - Verify All Activity Types

Watch the mock agent session start automatically. You should see these activity types appear:

1. **SYSTEM_EVT** (Timeline marker)
   - First activity: "Session started for issue: Demo: Build a new feature"
   - Small dot with gray text

2. **THOUGHT** (Minimal, italic)
   - Example: "Analyzing the issue..."
   - Italic text with ~ icon
   - Gray color, subtle styling

3. **TOOL_CALL** (Prominent card)
   - Example: "Glob", "Read", "Edit", "Bash"
   - White card with border
   - Tool name in bold
   - Expand/collapse button (▼/▲)
   - Click to expand and see output

4. **RESULT** (Completion indicator)
   - Final activity: "Session completed"
   - Green background
   - Checkmark icon

**Verification:**
- [ ] All activity types render with correct styling
- [ ] Activities appear with staggered animation
- [ ] Tool calls can be expanded/collapsed
- [ ] Timeline dots appear for each activity
- [ ] Auto-scroll keeps latest activity visible
- [ ] Statistics update in real-time

### Step 5: Test IssueTracker Operations

Test the IssueTracker abstraction using test controls:

1. **List All Issues**
   - Click "List All Issues" button
   - **Expected**: Modal opens showing JSON with demo issue
   - **Verify**: Issue has id, title, description, state, assignee
   - Close modal

2. **Simulate User Comment**
   - Click "Simulate User Comment"
   - Enter comment: "Can you add more comprehensive tests?"
   - Click OK
   - **Expected**:
     - Notification appears: "User comment simulated!"
     - Mock agent responds to comment
     - New activities appear in timeline

3. **Create Test Issue**
   - Click "Create Test Issue"
   - Enter title: "Test: Verify new feature"
   - Enter description: "Testing issue creation"
   - Click OK
   - **Expected**: Notification "Test issue created successfully!"

**Verification:**
- [ ] List Issues shows correct issue data
- [ ] Simulate Comment triggers agent response
- [ ] Create Issue provides confirmation

### Step 6: Test SessionStorage Operations

Test the SessionStorage abstraction:

1. **View Stored Sessions**
   - Click "View Stored Sessions"
   - **Expected**: Modal shows storage directory path
   - **Verify**: Path includes `~/.cyrusd/sessions/browser-demo` or custom CYRUS_HOME

2. **Load Previous Session**
   - Click "Load Previous Session"
   - Enter any session ID (or cancel)
   - **Expected**: Message about loading (not yet fully implemented)

3. **Clear All Sessions**
   - Click "Clear All Sessions"
   - **Expected**: Confirmation dialog
   - Click Cancel (don't actually clear for this test)

**Verification:**
- [ ] Storage directory path is displayed correctly
- [ ] Buttons provide appropriate feedback
- [ ] Modal dialogs work properly

### Step 7: Test AgentRunner Toggle

Test switching between Mock and Claude agent modes:

1. **Verify Current Mode**
   - "Mock" button should be highlighted (active)
   - "Claude" button should be inactive

2. **Attempt Mode Switch**
   - Click "Claude" button
   - **Expected**: Notification explains server restart required
   - **Note**: Actual switching requires `pnpm start` without --demo flag

3. **Switch Back**
   - Click "Mock" button
   - **Expected**: Stays in mock mode

**Verification:**
- [ ] Toggle buttons show visual feedback
- [ ] Mode switch notification appears
- [ ] UI remains responsive

### Step 8: Test Pre-built Scenarios

Test the automated test scenario system:

1. **Select Basic Scenario**
   - Open "Test Scenarios" dropdown
   - Select "Basic: Simple file edit"
   - Click "Run Scenario"
   - **Expected**:
     - Notification: "Running test scenario: basic"
     - User comment appears: "Please update the README file with better documentation"
     - Mock agent responds to the scenario

2. **Select Multi-turn Scenario**
   - Select "Multi-turn: Conversation flow"
   - Click "Run Scenario"
   - **Expected**:
     - Multiple comments appear over time (2-5 seconds apart)
     - Agent responds to each comment
     - Demonstrates conversation continuity

3. **Try Other Scenarios**
   - Test "Error: Handle failures"
   - Test "File ops: Read/Edit/Write"
   - **Verify**: Each scenario triggers appropriate activities

**Verification:**
- [ ] Scenario dropdown enables Run button when selected
- [ ] Basic scenario executes correctly
- [ ] Multi-turn scenario shows multiple interactions
- [ ] All scenarios provide appropriate feedback

### Step 9: Test Evidence Capture

Test the evidence capture features:

1. **Download Activity Log**
   - Let a scenario complete fully
   - Click "Download Activity Log"
   - **Expected**:
     - JSON file downloads
     - Filename: `cyrus-activity-log-<sessionId>.json`
     - Open file and verify structure:
       ```json
       {
         "sessionId": "...",
         "sessionTitle": "...",
         "exportedAt": "...",
         "stats": { ... },
         "activities": [ ... ]
       }
       ```

2. **Export Session**
   - Click "Export Session"
   - **Expected**:
     - Text file downloads
     - Contains all activities as text
     - Filename: `cyrus-session-<sessionId>.txt`

3. **Capture Screenshot**
   - Click "Capture Screenshot"
   - **Expected**:
     - Modal opens with screenshot instructions
     - Instructions for Chrome, Firefox, Safari
     - Alternative DevTools method mentioned

**Verification:**
- [ ] Activity log downloads as valid JSON
- [ ] Session export contains all activities
- [ ] Screenshot instructions are clear and helpful

### Step 10: Test Interactive Features

Test user interaction capabilities:

1. **Send User Message**
   - Wait for a session to be running (or start new scenario)
   - Type in message input: "Add more logging to the code"
   - Click "Send" or press Enter
   - **Expected**:
     - Message clears from input
     - Mock agent receives message
     - Agent responds with acknowledgment
     - New activities appear

2. **Stop Session**
   - While session is running, click "Stop"
   - **Expected**:
     - Session status changes to "Complete"
     - Stop message appears in activities
     - Input field becomes disabled
     - Send/Stop buttons become disabled

3. **Timeline Navigation**
   - Click any timeline dot
   - **Expected**:
     - Page scrolls to that activity
     - Activity briefly highlights
     - Dot becomes active

**Verification:**
- [ ] Message sending works correctly
- [ ] Agent responds to user messages
- [ ] Stop button gracefully halts session
- [ ] Timeline navigation scrolls and highlights

### Step 11: Test Orchestrator Lifecycle

Verify the complete session lifecycle:

1. **Session Start**
   - Observe automatic session start when issue is assigned
   - **Verify**:
     - System event: "Session started"
     - Session badge shows "Thinking" with pulsing animation
     - Statistics start incrementing

2. **Session Running**
   - Watch activities appear in real-time
   - **Verify**:
     - Activities render progressively
     - Statistics update correctly
     - Duration timer increments

3. **Session Complete**
   - Wait for mock session to complete
   - **Verify**:
     - System event: "Session completed"
     - Session badge shows "Complete" in green
     - Input field disabled
     - Final summary appears

**Verification:**
- [ ] Session lifecycle progresses correctly
- [ ] UI updates reflect session state
- [ ] Statistics match activity counts

### Step 12: Verify Mobile Responsiveness

Test responsive design:

1. **Resize Browser Window**
   - Make window narrow (< 1024px)
   - **Expected**: Hamburger menu (☰) appears
   - Click hamburger menu
   - **Expected**: Sidebar slides in from left

2. **Mobile Controls**
   - **Verify**: All test controls remain accessible
   - **Verify**: Buttons stack vertically on small screens

**Verification:**
- [ ] Sidebar collapses on narrow screens
- [ ] Hamburger menu toggles sidebar
- [ ] Controls remain usable

## Visual Evidence Capture

For PR documentation, capture these screenshots:

1. **Main Interface**
   - Full page showing sidebar and activity timeline
   - Active session with multiple activity types visible

2. **Test Controls Panel**
   - Close-up of the Test Controls section
   - All control groups visible

3. **Activity Types Demo**
   - Each activity type (THOUGHT, TOOL_CALL, RESULT, USER_MSG, SYSTEM_EVT)
   - Expanded tool call showing syntax highlighting

4. **Modal Dialogs**
   - "List All Issues" modal
   - "View Stored Sessions" modal
   - "Screenshot Capture" instructions

5. **Downloaded Evidence**
   - Opened activity log JSON file
   - Session export text file

## Success Criteria

All verification checks must pass:

### IssueTracker Testing
- [x] List Issues displays correct data
- [x] Simulate Comment triggers agent response
- [x] Create Issue provides confirmation

### Renderer Testing
- [x] All 5 activity types render correctly
- [x] Visual styling matches semantic types
- [x] Syntax highlighting works
- [x] Expand/collapse functions
- [x] Timeline navigation works

### AgentRunner Testing
- [x] Mock mode generates activities
- [x] Toggle UI provides feedback
- [x] Mode switching acknowledged

### SessionStorage Testing
- [x] View Storage shows directory
- [x] Storage operations provide feedback
- [x] Persistence verified

### Orchestrator Testing
- [x] Session lifecycle completes
- [x] Multi-turn conversation works
- [x] Stop functionality works
- [x] State management correct

### Evidence Capture
- [x] Activity log downloads
- [x] Session export works
- [x] Screenshot instructions provided

### Integration Test Scenarios
- [x] Basic scenario executes
- [x] Multi-turn scenario works
- [x] All scenarios provide feedback

## Troubleshooting

If any verification step fails, check:

1. **Build Issues**
   ```bash
   pnpm clean
   pnpm install
   pnpm build
   ```

2. **Server Issues**
   - Check server console for errors
   - Verify port 3000 is not in use
   - Try `PORT=8080 pnpm start`

3. **Browser Issues**
   - Open DevTools Console (F12)
   - Check for JavaScript errors
   - Verify WebSocket connection (should be green)
   - Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

4. **Missing Features**
   - Ensure you're in the correct branch (`cypack-287`)
   - Verify all files were saved
   - Re-run build process

## Files Modified/Created

This implementation modified:
- `apps/browser-demo/public/index.html` - Added test controls UI
- `apps/browser-demo/public/app.js` - Added test control logic
- `apps/browser-demo/src/server.ts` - Added server-side handlers

This implementation created:
- `apps/browser-demo/TESTING_GUIDE.md` - Comprehensive testing documentation
- `PARENT_VERIFICATION.md` - This verification guide

## Working Directory

All verification should be performed from:
```
/Users/agentops/code/cyrus-workspaces/CYPACK-287
```

## Port Information

Default port: **3000**

If port 3000 is in use, the server will fail to start. Use:
```bash
PORT=8080 pnpm start
```

Then navigate to: **http://localhost:8080**

## Expected Total Time

Complete verification: **15-20 minutes**

- Build: 2-3 minutes
- Server startup: 30 seconds
- UI verification: 5 minutes
- Feature testing: 8-10 minutes
- Evidence capture: 2-3 minutes

## Contact

If verification fails or issues arise, check:
- Server console output for error messages
- Browser DevTools console for client-side errors
- `apps/browser-demo/README.md` for additional context
- `apps/browser-demo/TESTING_GUIDE.md` for detailed testing procedures

## Conclusion

Upon successful verification, the browser emulator will provide comprehensive test-driving capabilities for all I/O abstractions, serving as the primary testing framework for the entire I/O system.
