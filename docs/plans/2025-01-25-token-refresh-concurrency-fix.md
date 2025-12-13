# Token Refresh Concurrency Fix

## The Problem

Linear's refresh tokens are unique per request. When multiple Linear API calls fail with 401 simultaneously (e.g., token expired), each one independently attempts to refresh the OAuth token. This creates a race condition:

```
Request A gets 401 → refreshes → gets new token T1, refresh token R1
Request B gets 401 → refreshes → gets new token T2, refresh token R2
Request C gets 401 → refreshes → gets new token T3, refresh token R3
```

**The issue:** Linear's refresh tokens are single-use. When Linear issues R2, it invalidates R1. When it issues R3, it invalidates R2.

The result is unpredictable - whichever request saves last "wins", but the intervening refresh tokens have already been invalidated by Linear. This can leave the system in an inconsistent state where the stored refresh token has already been consumed.

## The Solution: Promise Coalescing

Instead of each request performing its own refresh, we coalesce concurrent refresh attempts into a single operation leveraging promises inot a queue. This eliminates simultaneous request and changes them to one after the other.

```typescript
private pendingRefreshes = new Map<string, Promise<{ success: boolean; newToken?: string }>>();

async refreshLinearToken(repositoryId: string): Promise<{ success: boolean; newToken?: string }> {
  const repo = this.repositories.get(repositoryId);
  const workspaceId = repo?.linearWorkspaceId;

  // If refresh already in progress for this workspace, wait for it
  const pending = this.pendingRefreshes.get(workspaceId);
  if (pending) {
    return pending;
  }

  // Start new refresh, store the promise
  const refreshPromise = this.doRefresh(repositoryId);
  this.pendingRefreshes.set(workspaceId, refreshPromise);

  try {
    return await refreshPromise;
  } finally {
    this.pendingRefreshes.delete(workspaceId);
  }
}
```

## How It Works

```
t0:  Request A gets 401
     → calls refreshLinearToken()
     → no pending promise exists
     → creates promise, starts HTTP request to Linear

t1:  Request B gets 401 (A's request still in flight)
     → calls refreshLinearToken()
     → pending promise EXISTS
     → returns same promise, waits for A's result

t2:  Request C gets 401 (A's request still in flight)
     → calls refreshLinearToken()
     → pending promise EXISTS
     → returns same promise, waits for A's result

t3:  A's HTTP request completes with new token
     → A, B, and C all receive the same result
     → all three retry their original API call with the new token
```

**One refresh, three beneficiaries.** The refresh token is used exactly once.

## Why This Works

The window for coalescing is the duration of the HTTP refresh request (typically 100-500ms). Since all 401 errors occur because they're using the same expired token, they happen within milliseconds of each other - well within the coalescing window.

If a request arrives just after the refresh completes, it will start a new refresh - but this is fine because:
1. It uses the newly obtained (valid) refresh token
2. The system is in a consistent state
3. It simply gets another token pair (slightly wasteful but correct)

## Benefits

- **Simple**: Just a Map of pending promises
- **No external dependencies**: Uses JavaScript's native promise semantics
- **Correct**: Guarantees only one refresh per workspace at a time
- **Efficient**: Concurrent requests share a single HTTP round-trip
