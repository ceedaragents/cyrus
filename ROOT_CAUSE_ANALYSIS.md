# Root Cause Analysis: CLI Platform Session Execution Bug (CYPACK-316)

## Bug Summary

**Issue**: CLI platform successfully creates agent sessions via RPC API, but sessions remain in "pending" status forever. The EdgeWorker never picks up these sessions and spawns agent processes.

## Investigation Timeline

### 1. Session Creation Flow ✅ Working
- `CLIRPCServer` receives RPC call to `startAgentSessionOnIssue()`
- `CLIIssueTrackerService.createAgentSessionOnIssue()` creates session in memory (line 602-634 in CLIIssueTrackerService.ts)
- Session is stored with status "pending"
- **Event is emitted**: `this.emit("agentSessionCreated", { session, issue })` (line 627)

### 2. Event Transport ✅ Working
- `CLIEventTransport` listens to `agentSessionCreated` event (line 109-137 in CLIEventTransport.ts)
- Event is transformed into `AgentEvent` format with:
  - `type: "AgentSessionEvent"`
  - `action: "created"`
  - `data.agentSession` containing session info
- Event is delivered via `this.emit("event", event)` (line 170)

### 3. EdgeWorker Event Handling ⚠️ PARTIALLY Working
- EdgeWorker initializes event transport in `initializeComponents()` (line 354-358 in EdgeWorker.ts)
- Event listener is registered: `this.agentEventTransport.on("event", ...)` (line 361-365)
- `handleAgentEvent()` is called with the event (line 364)
- Type guard `isAgentSessionCreatedEvent(event)` checks `type === "AgentSessionEvent" && action === "created"` (line 144-146 in AgentEvent.ts)

### 4. Session Execution ❌ NOT Working

**Root Cause Identified**: `handleAgentSessionCreatedWebhook()` is NOT being called despite events being emitted and type guards passing.

## Root Cause Analysis

The failing test reveals the issue:

```typescript
// Test expectation that FAILS:
expect(handleSessionCreatedSpy).toHaveBeenCalled();
// ❌ Error: expected "handleAgentSessionCreatedWebhook" to be called at least once
```

### Why is `handleAgentSessionCreatedWebhook()` not being called?

Looking at `handleAgentEvent()` (line 972-1035 in EdgeWorker.ts):

```typescript
private async handleAgentEvent(event: AgentEvent, repos: RepositoryConfig[]): Promise<void> {
  // Find the appropriate repository for this event
  const repository = await this.findRepositoryForEvent(event, repos);
  if (!repository) {
    // Event is silently dropped!
    return;
  }

  // Handle specific event types
  if (isAgentSessionCreatedEvent(event)) {
    await this.handleAgentSessionCreatedWebhook(event, repository);
  }
}
```

**The bug is in `findRepositoryForEvent()`!**

### Hypothesis: Repository Routing Failure

Let's examine `findRepositoryForEvent()` (line 1061-1071 in EdgeWorker.ts):

```typescript
private async findRepositoryForEvent(
  event: AgentEvent,
  repos: RepositoryConfig[],
): Promise<RepositoryConfig | null> {
  const workspaceId = event.organizationId;
  if (!workspaceId) return repos[0] || null; // Fallback to first repo

  // Get issue information from webhook
  let issueId: string | undefined;
  let teamKey: string | undefined;
  let issueIdentifier: string | undefined;
  // ... (continues with Linear-specific routing logic)
}
```

**Problem**: This method expects Linear-specific fields like:
- `event.organizationId` to match `repository.linearWorkspaceId`
- Team keys from `event.agentSession.issue.team.key`
- Project routing based on Linear projects

**For CLI events:**
- `organizationId` is set to `"cli-org"` (line 116 in CLIEventTransport.ts)
- But repository config has NO `linearWorkspaceId` when `platform: "cli"`
- Team keys are not set in CLI mode
- The routing logic fails to find a matching repository

### The Missing Piece

CLI repositories need special routing logic because:
1. They don't have `linearWorkspaceId`
2. They don't have `teamKeys`
3. They use `platform: "cli"` to identify themselves

## Evidence from Test

```typescript
// Test configuration
mockConfig = {
  repositories: [{
    id: "test-cli-repo",
    platform: "cli" as const,  // ← This is the key
    // NO linearWorkspaceId
    // NO teamKeys
  }]
};
```

When the event arrives with `organizationId: "cli-org"`, `findRepositoryForEvent()` tries to match it against `linearWorkspaceId` which doesn't exist for CLI repos, so it returns `null` and the event is dropped.

## Root Cause Summary

**The bug is in `EdgeWorker.findRepositoryForEvent()`**:
- It only handles Linear-specific repository routing
- It has no logic to route events from CLI platform
- When a CLI event arrives, the repository lookup fails
- The event is silently dropped without calling `handleAgentSessionCreatedWebhook()`
- No agent process is spawned
- Session stays in "pending" forever

## Reproduction Test

Created `test/EdgeWorker.cli-session-execution.test.ts` which:
1. Creates EdgeWorker with CLI platform configuration
2. Creates an issue via `CLIIssueTrackerService`
3. Creates an agent session via `createAgentSessionOnIssue()`
4. Verifies that:
   - ❌ Event reaches `handleAgentEvent` (passes - event is delivered)
   - ❌ `handleAgentSessionCreatedWebhook` is called (FAILS - not called)
   - ❌ ClaudeRunner is created (FAILS - no runner)

## Affected Code Paths

1. **packages/edge-worker/src/EdgeWorker.ts**:
   - `findRepositoryForEvent()` (line 1061+) - needs CLI routing logic

2. **packages/core/src/issue-tracker/adapters/CLIEventTransport.ts**:
   - Event structure may need adjustment to match routing expectations

3. **packages/edge-worker/test/EdgeWorker.cli-session-execution.test.ts**:
   - Failing test that reproduces the bug

## Next Steps for Fix

The fix should add CLI-aware routing logic to `findRepositoryForEvent()`:

```typescript
// Pseudo-code for fix
if (event.organizationId === "cli-org") {
  // Find repository with platform: "cli"
  return repos.find(r => r.platform === "cli") || repos[0];
}
```

Or alternatively, check if any repository has `platform: "cli"` and route CLI events to it automatically.
