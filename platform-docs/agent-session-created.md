# Agent Session Created Event

This document defines the expected behaviors when an `agentSessionCreated` event is triggered in Cyrus. This is a behind-the-scenes behavior that is **not logged** to the agent activity feed visible to end users.

## Overview

When a Linear issue is assigned to Cyrus (or the agent is @mentioned), the `agentSessionCreated` webhook triggers a sequence of operations that prepare the workspace for the agent to work in.

---

## Event Triggers

The `agentSessionCreated` event is triggered by:

1. **Delegation**: Issue assigned to the agent user
2. **@mention**: User mentions the agent in a comment

---

## Worktree Creation Behavior

### When a Worktree IS Created

A git worktree is created when:
- Repository is auto-matched to the issue (via configured patterns or workspace catch-all)
- Repository is already cached from a previous session on this issue

**Sequence** (`EdgeWorker.ts`):
```
agentSessionCreated webhook (line 1503)
    ↓
handleAgentSessionCreatedWebhook
    ↓
Repository routing (determineRepositoryForWebhook)
    ↓
initializeAgentRunner (line 1580)
    ↓
createLinearAgentSession (line 1662)
    ↓
GitService.createGitWorktree (line 1432)
    ↓
Worktree ready at /worktrees/{ISSUE-ID}/
```

### When Worktree Creation is DEFERRED

If multiple repositories could match and user selection is needed:
- Routing returns `type: "needs_selection"`
- User is shown repository options in Linear
- Worktree creation happens later via `handleRepositorySelectionResponse`

### When Worktree Creation is SKIPPED

- No matching repository found (`type: "none"`)
- Missing issue data
- Missing agentSessionManager for repository

---

## Implementation Details

### Critical Code Path

**File**: `packages/edge-worker/src/EdgeWorker.ts`

| Method | Lines | Purpose |
|--------|-------|---------|
| `handleAgentSessionCreatedWebhook` | 1503-1586 | Receives webhook, routes to repository |
| `initializeAgentRunner` | 1600-1900+ | Initializes runner and starts session |
| `createLinearAgentSession` | 1413-1495 | Creates workspace and session |

**File**: `packages/edge-worker/src/GitService.ts`

| Method | Lines | Purpose |
|--------|-------|---------|
| `createGitWorktree` | 173-452 | Creates git worktree with fallback |

### Worktree Creation Logic

**Location**: `EdgeWorker.ts:1428-1432`
```typescript
const workspace = this.config.handlers?.createWorkspace
    ? await this.config.handlers.createWorkspace(fullIssue, repository)
    : await this.gitService.createGitWorktree(fullIssue, repository);
```

Supports custom handler override for non-standard workspace creation.

### Workspace Path

**Location**: `GitService.ts:200`
```typescript
const workspacePath = join(repository.workspaceBaseDir, issue.identifier);
```

Example: `/Users/agentops/.cyrus/worktrees/CYPACK-639`

---

## Conditional Behavior Summary

| Trigger | Repository Match | Result |
|---------|------------------|--------|
| agentSessionCreated | Auto-matched | ✅ Worktree created |
| agentSessionCreated | Cached | ✅ Worktree created |
| agentSessionCreated | Needs selection | ⏳ Deferred to user selection |
| agentSessionCreated | No match | ❌ Skipped (webhook ends) |
| agentSessionPrompted | Selection response | ✅ Worktree created |
| agentSessionPrompted | Existing session | ❌ Uses cached workspace |

---

## Additional Behaviors

### Issue State Transition

Before worktree creation, the issue is moved to "started" state (`EdgeWorker.ts:1426`):
```typescript
await this.setIssueStatus(fullIssue, "started", agentSession);
```

### Setup Script Execution

After worktree creation, repository-specific setup scripts are executed (`GitService.ts:384-433`):
- Unix: `cyrus-setup.sh`
- Windows: `cyrus-setup.ps1`, `cyrus-setup.cmd`, `cyrus-setup.bat`

### Existing Worktree Detection

If a worktree already exists for the issue, it is reused (`GitService.ts:205-223`).

---

## Visibility Note

**Current Status**: This behavior is NOT logged to the agent activity feed.

**Consideration**: Logging worktree creation as an activity could provide users with visibility into:
- Which repository was selected
- That the workspace is ready
- Any setup script execution results

This would improve transparency about the agent's initialization phase.
