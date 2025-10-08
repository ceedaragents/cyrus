# Analysis: `claudeSessionId` Parameter in `resumeNextSubroutine` Callback

## Summary

The `claudeSessionId` parameter passed to the `resumeNextSubroutine` callback is **redundant** and can be safely retrieved from `session.claudeSessionId` instead. However, there is a **critical bug** where the callback advances the subroutine index twice.

## Data Flow Analysis

### 1. Where `claudeSessionId` Comes From

In `AgentSessionManager.ts`, line 275-281:
```typescript
const claudeSessionId = session.claudeSessionId;
if (!claudeSessionId) {
    console.error(
        `[AgentSessionManager] No Claude session ID found for procedure session`,
    );
    return;
}
```

The `claudeSessionId` is retrieved from `session.claudeSessionId`, validated, and then passed to the callback at line 298-301.

### 2. When `session.claudeSessionId` is Set

In `AgentSessionManager.ts`, line 116:
```typescript
linearSession.claudeSessionId = claudeSystemMessage.session_id;
```

This happens in `updateAgentSessionWithClaudeSessionId()` when the first "system init" message is received from Claude during session startup.

### 3. Callback Invocation Point

The callback is invoked at line 298-301 in `AgentSessionManager.ts`:
```typescript
await this.resumeNextSubroutine(
    linearAgentActivitySessionId,
    claudeSessionId,  // This is session.claudeSessionId
);
```

**At this point, `session.claudeSessionId` is guaranteed to be available because:**
- It was just validated on line 275-281
- The session object is the same one used throughout the flow

### 4. Callback Implementation

In `EdgeWorker.ts`, line 240-263, the callback:
```typescript
async (
    linearAgentActivitySessionId: string,
    claudeSessionId: string,  // Redundant parameter
) => {
    // Get the session
    const session = agentSessionManager.getSession(
        linearAgentActivitySessionId,
    );

    // This line could just use session.claudeSessionId!
    this.procedureRouter.advanceToNextSubroutine(
        session,
        claudeSessionId,
    );
}
```

## Critical Bug Found

### Double-Advance Issue

The callback advances the subroutine **twice**:

1. **First advance** in `AgentSessionManager.ts` line 293:
   ```typescript
   // Advance procedure state
   this.procedureRouter.advanceToNextSubroutine(session, claudeSessionId);

   // Then trigger callback
   if (this.resumeNextSubroutine) {
       await this.resumeNextSubroutine(...);
   }
   ```

2. **Second advance** in `EdgeWorker.ts` line 260-263:
   ```typescript
   // Advance to next subroutine (AGAIN!)
   this.procedureRouter.advanceToNextSubroutine(
       session,
       claudeSessionId,
   );
   ```

### Impact

This bug causes the procedure router to skip subroutines:
- Subroutine 1 completes
- AgentSessionManager advances to subroutine 2
- Callback advances again to subroutine 3
- Subroutine 2 is never executed!

### Root Cause

The commit `f325cf5` ("Refactor: Clean up subroutine transition callback signature") introduced this bug. The commit message states:

> "Fixed to use passed claudeSessionId parameter instead of session property"

But this change accidentally left the `advanceToNextSubroutine` call in the callback, when it should have been removed since AgentSessionManager already handles the advance.

## Conclusion

### Question 1: Is the parameter necessary?
**No.** The `claudeSessionId` parameter is redundant because:
- `session.claudeSessionId` is always available when the callback is invoked
- It's guaranteed to be set before the callback is triggered
- It's the same value that's being passed as the parameter

### Question 2: Any scenarios where parameter differs?
**No.** The parameter comes directly from `session.claudeSessionId` at line 275, so they are identical.

### Question 3: Should we remove the parameter?
**Yes, but fixing the double-advance bug is more critical.**

## Recommended Fixes

### Priority 1: Fix Double-Advance Bug

Remove the `advanceToNextSubroutine` call from `EdgeWorker.ts` line 260-263:

```typescript
async (
    linearAgentActivitySessionId: string,
    claudeSessionId: string,
) => {
    console.log(
        `[Subroutine Transition] Advancing to next subroutine for session ${linearAgentActivitySessionId}`,
    );

    // Get the session
    const session = agentSessionManager.getSession(
        linearAgentActivitySessionId,
    );
    if (!session) {
        console.error(
            `[Subroutine Transition] Session ${linearAgentActivitySessionId} not found`,
        );
        return;
    }

    // REMOVE THIS - it's already done by AgentSessionManager
    // this.procedureRouter.advanceToNextSubroutine(
    //     session,
    //     claudeSessionId,
    // );

    // Get next subroutine (already advanced by caller)
    const nextSubroutine =
        this.procedureRouter.getCurrentSubroutine(session);

    // ... rest of callback ...
}
```

### Priority 2: Remove Redundant Parameter (Optional Refactor)

After fixing the bug, optionally simplify the callback signature:

```typescript
// In AgentSessionManager.ts
private resumeNextSubroutine?: (
    linearAgentActivitySessionId: string,
    // Remove claudeSessionId parameter
) => Promise<void>;

// In EdgeWorker.ts
async (linearAgentActivitySessionId: string) => {
    const session = agentSessionManager.getSession(linearAgentActivitySessionId);
    // Use session.claudeSessionId directly wherever needed
}
```

However, this refactor is **optional** since keeping the parameter doesn't cause functional issues (just slight redundancy).

## Test Verification Needed

After fixing the double-advance bug, verify:
1. All subroutines in a procedure execute in order
2. No subroutines are skipped
3. Subroutine history correctly records each subroutine completion
4. The `currentSubroutineIndex` advances by exactly 1 per subroutine
