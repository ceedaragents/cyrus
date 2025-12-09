# Test Drives

This directory contains logs and findings from F1 test drives.

## Purpose

Use this directory to document:
- End-to-end test runs
- Agent behavior observations
- Performance metrics
- Bug findings
- Feature validation results

## Format

Create a new file for each test drive with the naming convention:
```
YYYY-MM-DD-<test-name>.md
```

Example: `2025-01-27-basic-issue-workflow.md`

## Template

```markdown
# Test Drive: [Name]

**Date:** YYYY-MM-DD
**Tester:** [Name]
**Objective:** [What you're testing]

## Setup

- Server port: [port]
- Repository: [path]
- Commands run: [list]

## Results

### Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

### Observations

[Your observations here]

### Issues Found

[List any issues, bugs, or unexpected behavior]

### Metrics

- Session start time: [time]
- First response time: [time]
- Total duration: [time]

## Conclusion

[Summary of findings]
```

## Test Drive History

### 004 - Cyrus-Tools HTTP MCP Verification (2025-12-09)
- **File:** `004-cyrus-tools-http-mcp-verification.md`
- **Objective:** Verify cyrus-tools HTTP MCP server implementation
- **Score:** 9/10 ✅
- **Key Results:**
  - MCP server registration working correctly
  - Two cyrus-tools successfully called (linear_agent_session_create, linear_get_agent_sessions)
  - Console logging patterns verified
  - EdgeWorker integration confirmed
  - Authentication errors expected in F1 (no real Linear token)

### 003 - Git Worktree Fix Verification (2025-12-05)
- **File:** `003-git-worktree-fix-verification.md`
- **Objective:** Verify git worktree creation fix
- **Score:** 9.5/10 ✅
- **Key Results:**
  - Git worktree properly populated with files
  - Session tracking working correctly
  - Files correctly checked out from repository

### 002 - Unit Tests Rate Limiter (2025-12-05)
- **File:** `002-unit-tests-rate-limiter.md`
- **Objective:** Validate F1 protocol and activity tracking
- **Score:** 9/10 ✅
- **Key Results:**
  - Issue creation: 10/10
  - EdgeWorker: 8/10
  - Renderer: 10/10
  - 40 activities tracked successfully
  - Pagination working correctly
