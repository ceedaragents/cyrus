# Browser Demo - Comprehensive Testing Guide

This guide explains how to use the enhanced browser demo to test all I/O abstractions in the Cyrus system.

## Overview

The browser demo now serves as a comprehensive testing framework for all I/O abstractions:
- **IssueTracker**: Create/update/list issues, simulate user interactions
- **Renderer**: Verify all activity types render correctly
- **AgentRunner**: Toggle between Mock and Claude implementations
- **SessionStorage**: View/load/manage persisted sessions
- **Orchestrator**: Test session lifecycle and multi-session management

## Quick Start

### 1. Start the Browser Demo

```bash
cd apps/browser-demo
pnpm start
```

Open your browser to **http://localhost:3000**

### 2. Navigate the Interface

The UI is divided into three main areas:
- **Header**: Connection status and session info
- **Sidebar**: Session stats, timeline, test controls
- **Main Area**: Live activity feed and user input

## Test Controls Panel

The sidebar contains a comprehensive **Test Controls** section with the following features:

### Agent Runner Toggle

Test switching between Mock and Claude agent implementations:

- **Mock**: Simulated agent responses (no credentials needed)
- **Claude**: Real Claude Code execution (requires authentication)

**Note**: Changing runner modes requires server restart. Use `--emulator` flag for mock mode, omit for Claude mode.

### Issue Tracker Controls

Test IssueTracker abstraction:

1. **Create Test Issue**
   - Creates a new demo issue
   - Prompts for title and description
   - Automatically assigns to agent

2. **List All Issues**
   - Displays all issues in the tracker
   - Shows issue metadata (ID, title, state, assignee)
   - Opens in modal dialog

3. **Simulate User Comment**
   - Adds a user comment to current session
   - Triggers agent to process the comment
   - Demonstrates multi-turn conversation flow

### Session Storage Controls

Test SessionStorage abstraction:

1. **View Stored Sessions**
   - Shows session storage directory
   - Displays metadata about stored sessions
   - Useful for verifying persistence

2. **Load Previous Session**
   - Prompts for session ID
   - Attempts to restore previous session state
   - Demonstrates session continuity

3. **Clear All Sessions**
   - Removes all stored session data
   - Requires confirmation
   - Useful for resetting test environment

### Test Scenarios

Pre-built test scenarios for complex workflows:

1. **Basic: Simple file edit**
   - Simulates basic file modification
   - Tests Read → Edit workflow
   - Quick verification of core functionality

2. **Multi-turn: Conversation flow**
   - Sends multiple user comments over time
   - Tests back-and-forth interaction
   - Verifies conversation context preservation

3. **Error handling**
   - Attempts operations that should fail
   - Verifies error reporting and recovery
   - Tests resilience of abstractions

4. **File ops: Read/Edit/Write**
   - Complete file operation workflow
   - Tests all file-related tools
   - Verifies file persistence

5. **Long: Extended session**
   - Complex multi-step feature implementation
   - Tests session duration handling
   - Verifies resource management

## Evidence Capture

The demo includes built-in evidence capture for PR verification:

### Export Session

- Downloads session data as text file
- Includes all activities and metadata
- Useful for sharing session results

### Download Activity Log

- Exports complete activity log as JSON
- Includes:
  - Session ID and title
  - Export timestamp
  - Statistics (thoughts, tool calls, messages)
  - Full activity history
- Use for automated analysis or archival

### Capture Screenshot

- Provides instructions for browser screenshot tools
- Ensures high-quality evidence capture
- Works across all major browsers

## Renderer Verification

The browser demo visually demonstrates all Renderer activity types:

### Activity Types

1. **THOUGHT** (Minimal, italic)
   - Agent's internal reasoning
   - Displayed with ~ icon
   - Subtle gray styling

2. **TOOL_CALL** (Prominent card)
   - Tool name and icon
   - Expandable input/output
   - Copy button for code
   - Syntax highlighting

3. **RESULT** (Success/Error indicator)
   - Completion status
   - Color-coded (green/red)
   - Clear icon (✓/✗)

4. **USER_MSG** (User input)
   - User avatar
   - Message content
   - Timestamp

5. **SYSTEM_EVT** (Timeline marker)
   - Session start/complete
   - System-level events
   - Timeline dots

### Visual Features

- **Staggered animations**: Activities appear with smooth transitions
- **Syntax highlighting**: Code blocks use Prism.js
- **Auto-scroll**: Automatically follows latest activity
- **Timeline scrubber**: Jump to any activity
- **Statistics**: Real-time counters for activity types

## Orchestrator Testing

Test Orchestrator lifecycle management:

### Session Lifecycle

1. **Start Session**
   - Automatic when issue assigned
   - Watch for "Session started" system event

2. **Send Messages**
   - Use message input field
   - Verify agent responds
   - Check conversation continuity

3. **Stop Session**
   - Click Stop button
   - Verify graceful shutdown
   - Check session complete event

### Multi-Session Support

While the demo defaults to single-session mode, the architecture supports multiple concurrent sessions. Test by:

1. Viewing session stats
2. Monitoring session state badges
3. Verifying storage handles multiple sessions

## Integration Test Workflow

Complete end-to-end testing workflow:

### 1. Environment Setup

```bash
# Clean start
cd apps/browser-demo
pnpm build
pnpm start
```

### 2. Verify All Abstractions

#### IssueTracker
- Create test issue
- List issues
- Verify issue appears

#### Renderer
- Check all activity types render
- Verify visual styling
- Test expand/collapse
- Check syntax highlighting

#### AgentRunner
- Run mock scenario
- Verify mock activities appear
- (Optional) Switch to Claude mode and verify real execution

#### SessionStorage
- Run a scenario
- View stored sessions
- Verify persistence directory

#### Orchestrator
- Watch session lifecycle
- Send user messages
- Verify multi-turn conversation
- Stop session gracefully

### 3. Capture Evidence

- Download activity log
- Export session
- Capture screenshot
- Document results

### 4. Run Test Scenarios

Execute each scenario and verify:
- Activities render correctly
- No errors in console
- Expected behavior occurs
- Session completes successfully

## Troubleshooting

### Server Won't Start

```bash
# Rebuild packages
cd /path/to/cyrus
pnpm build
cd apps/browser-demo
pnpm start
```

### No Activities Appearing

1. Check browser console for errors
2. Verify WebSocket connection (green dot)
3. Refresh the page
4. Check server logs

### Test Controls Not Working

1. Verify WebSocket connection
2. Check server logs for test control messages
3. Ensure server is in correct mode (emulator vs. real)

### Session Storage Issues

1. Check CYRUS_HOME environment variable
2. Verify sessions directory exists
3. Check file permissions

## Advanced Testing

### Custom Test Scenarios

Add custom scenarios by editing `src/server.ts`:

```typescript
const scenarios: Record<string, () => void> = {
  "my-custom-scenario": () => {
    console.log("[Scenario] Running my custom scenario");
    // Your scenario logic here
  },
};
```

### Programmatic Testing

The browser demo can be automated using Playwright or Selenium:

```javascript
// Example Playwright test
await page.goto('http://localhost:3000');
await page.click('#createIssueBtn');
await page.fill('input[type="text"]', 'Test Issue');
await page.click('button:has-text("OK")');
```

### Performance Testing

Monitor performance metrics:
- Activity rendering speed
- WebSocket message latency
- Memory usage over long sessions
- Storage I/O performance

## Best Practices

1. **Start Clean**: Clear storage between major test runs
2. **Document Everything**: Use activity log export for documentation
3. **Test Both Modes**: Verify abstractions work with both Mock and Claude runners
4. **Capture Evidence**: Always screenshot successful test runs
5. **Check Console**: Monitor browser and server console for errors
6. **Incremental Testing**: Test one abstraction at a time before integration tests

## Verification Checklist

Use this checklist for comprehensive verification:

- [ ] IssueTracker: Created test issue successfully
- [ ] IssueTracker: Listed all issues
- [ ] IssueTracker: Simulated user comment
- [ ] Renderer: All 5 activity types render correctly
- [ ] Renderer: Expand/collapse works for tool calls
- [ ] Renderer: Syntax highlighting appears
- [ ] Renderer: Timeline navigation works
- [ ] AgentRunner: Mock mode produces activities
- [ ] AgentRunner: (Optional) Claude mode works
- [ ] SessionStorage: View storage shows directory
- [ ] SessionStorage: Sessions persist between runs
- [ ] Orchestrator: Session lifecycle completes
- [ ] Orchestrator: Multi-turn conversation works
- [ ] Orchestrator: Stop button halts execution
- [ ] Evidence: Activity log downloads as JSON
- [ ] Evidence: Session export works
- [ ] Evidence: Screenshots captured
- [ ] Scenarios: All 5 test scenarios run successfully

## Support

For issues or questions:
- Check server console output
- Review browser DevTools console
- See README.md for general setup
- Check VERIFICATION.md for deployment verification
