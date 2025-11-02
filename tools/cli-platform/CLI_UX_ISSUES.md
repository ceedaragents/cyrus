# CLI Platform User Experience Issues

## Summary
Tested the CLI platform as an end-user attempting to fix a bug in a simple JavaScript project. Multiple critical issues prevent the CLI platform from being usable for actual work.

## Test Scenario
- Created custom config directory: `/tmp/cyrus-cli-test/config`
- Created simple project with a bug: `/tmp/cyrus-cli-test/simple-project/calculator.js`
- Bug: `multiply()` function adds instead of multiplying
- Goal: Use CLI platform to assign issue to agent and get it fixed

## Critical Issues Found

### 1. **Server Startup Script Requires Absolute Paths**
**Severity**: High
**Impact**: End-users cannot easily create portable server startup scripts

**Problem**: When creating a custom server startup script, the import path must be absolute:
```javascript
// This fails:
import { EdgeWorker } from '../../../packages/edge-worker/dist/EdgeWorker.js';

// This works:
import { EdgeWorker } from '/Users/agentops/code/cyrus-workspaces/CYPACK-306/packages/edge-worker/dist/EdgeWorker.js';
```

**Expected**: Should be able to use relative imports or have a published package to import from.

**Workaround**: Use absolute paths, but this breaks portability.

---

### 2. **Inconsistent RPC Endpoint Documentation**
**Severity**: Medium
**Impact**: Users get confused about which endpoint to use

**Problem**:
- Server startup message says: `📡 RPC endpoint: http://localhost:3458/rpc`
- Actual endpoint is: `http://localhost:3458/cli/rpc`
- CLI tool defaults to port 3457, must set `CYRUS_PORT=3458`

**Expected**:
- Documentation should match actual endpoint
- CLI tool should show what URL it's connecting to
- Should have a `--url` flag to override RPC endpoint directly

---

### 3. **No Feedback on RPC Connection**
**Severity**: Medium
**Impact**: Users don't know if CLI tool is connecting to the right server

**Problem**: CLI tool doesn't show:
- What RPC URL it's connecting to
- Whether connection succeeded
- Server version or status

**Expected**: CLI tool should show:
```
Connecting to http://localhost:3458/cli/rpc...
✅ Connected to Cyrus CLI Server v0.2.0
```

---

### 4. **Agent Sessions Created But Never Execute**
**Severity**: CRITICAL
**Impact**: The entire CLI platform is non-functional for actual work

**Problem**:
- `startSession` command creates a session successfully
- Session status remains "pending" forever
- No agent actually starts working
- No error messages
- No way to know what's wrong

**Reproduction**:
1. Create issue: `createIssue --title "Fix bug"`
2. Start session: `startSession --issue-id issue-1`
3. Result: Session created with status "pending", no activities, agent never runs

**Root Cause**: CLIIssueTrackerService creates sessions but doesn't trigger EdgeWorker to actually spawn an agent process. The CLI platform is missing the critical integration between session creation and agent execution.

**Expected**:
- Session creation should trigger agent execution
- Status should change to "running" when agent starts
- Activities should be logged as agent works
- Session should complete or fail with a result

---

### 5. **No Progress Visibility**
**Severity**: High
**Impact**: Users have no idea if agent is working or stuck

**Problem**:
- `viewSession` shows only status and empty activities array
- No way to see:
  - Agent logs
  - Current task
  - Progress percentage
  - Estimated completion time
  - Error messages

**Expected**: `viewSession` should show:
```json
{
  "session": {
    "id": "session-2",
    "status": "running",
    "currentTask": "Analyzing calculator.js",
    "progress": "2/5 steps completed",
    "logs": [
      "Started agent session",
      "Reading calculator.js",
      "Identified bug in multiply function"
    ]
  },
  "activities": [...]
}
```

---

### 6. **No Command to Check Server Status**
**Severity**: Medium
**Impact**: Users can't verify server is running before executing commands

**Problem**: No command like:
- `lambo.mjs ping` - Check if server is responding
- `lambo.mjs status` - Get server status
- `lambo.mjs version` - Get server version

**Expected**: Add health check commands.

---

### 7. **getState Command Output is Too Large**
**Severity**: Low
**Impact**: Debugging command floods terminal

**Problem**: `getState` dumps entire system state with no pagination or filtering.

**Expected**:
- Add pagination: `getState --limit 10 --offset 0`
- Add filtering: `getState --type sessions`
- Add summary mode: `getState --summary`

---

### 8. **No Way to Assign Agent to Issue**
**Severity**: Medium
**Impact**: Users must manually assign agent or use mention syntax

**Problem**: Linear allows assigning issues to users. CLI platform should allow:
```bash
lambo.mjs assignIssue --issue-id issue-1 --assignee-id agent-user-1
```

**Expected**: Add `assignIssue` command or `--assignee` flag to `createIssue`.

---

### 9. **No Help for Individual Commands**
**Severity**: Low
**Impact**: Users must remember all flags for each command

**Problem**: Can't run:
```bash
lambo.mjs createIssue --help
lambo.mjs startSession --help
```

**Expected**: Each command should have its own help.

---

### 10. **Error Messages Lack Detail**
**Severity**: Medium
**Impact**: Hard to debug when things go wrong

**Problem**: Errors just show generic messages, no:
- Stack traces (with --debug flag)
- Suggestions for fixes
- Related documentation links

**Expected**: Better error messages with actionable guidance.

---

## Most Critical Issue

**🚨 Issue #4 is the blocker**: Agent sessions are created but never execute. This makes the entire CLI platform unusable for actual work. Without fixing this, none of the other improvements matter because the core functionality doesn't work.

## Recommended Fix Priority

1. **CRITICAL**: Fix agent session execution (Issue #4)
2. **HIGH**: Add progress visibility (Issue #5)
3. **HIGH**: Server startup portability (Issue #1)
4. **MEDIUM**: Add health check commands (Issue #6)
5. **MEDIUM**: Fix RPC endpoint confusion (Issue #2)
6. **MEDIUM**: Add connection feedback (Issue #3)
7. **MEDIUM**: Add assignIssue command (Issue #8)
8. **LOW**: Add per-command help (Issue #9)
9. **LOW**: Improve getState pagination (Issue #7)
10. **LOW**: Better error messages (Issue #10)

## Test Environment

- **Config directory**: `/tmp/cyrus-cli-test/config`
- **Project**: `/tmp/cyrus-cli-test/simple-project`
- **Server port**: 3458
- **CLI tool**: `packages/core/src/issue-tracker/adapters/lambo.mjs`
- **Test file**: `calculator.js` with multiply bug

## Conclusion

The CLI platform successfully implements the IIssueTrackerService interface and RPC server, but **it cannot perform actual agent work**. The missing piece is the integration between CLIIssueTrackerService and EdgeWorker's agent execution system. Sessions are created in memory but never trigger the agent processing loop.
