# CYPACK-385: Merge Resolution Plan

## Status
INCOMPLETE - Merge in progress with partial resolution

## What Was Done

### ✅ Completed
1. CHANGELOG.md - Resolved by keeping unreleased section and adding v0.2.1 release from main
2. packages/core/src/config-types.ts - Resolved by keeping both `platform` (HEAD) and `linearWorkspaceSlug` (main) config fields
3. Added RepositoryRouter import to EdgeWorker.ts
4. Added repository Router property to EdgeWorker class

### ⚠️ Incomplete
The EdgeWorker.ts merge is complex and requires:

1. **Add repositoryRouter initialization in constructor** - Need to create RepositoryRouterDeps that uses IIssueTrackerService instead of Linear SDK
2. **Add missing methods from main**:
   - `getCachedRepository()`
   - `postRepositorySelectionActivity()`
   - `handleRepositorySelectionResponse()`
   - `mergeSubroutineDisallowedTools()`
   - `extractWorkspaceSlug()`
3. **Fix null safety** - Many places where `repository` can be null need null checks
4. **Fix AgentSessionManager** - Remove `linearClient` references
5. **Delete test file** - packages/edge-worker/test/EdgeWorker.repository-routing.test.ts was deleted in main

## Key Architectural Constraints

From CLAUDE.md:
1. **NO `any` types** - Use proper TypeScript types
2. **EdgeWorker must be platform-agnostic** - Zero Linear-specific logic
3. **NO runtime type detection** - No `typeof issue.labels === "function"`
4. **NO direct Linear SDK calls** - Only use IIssueTrackerService
5. **NO dual-interface shimming** - Single abstraction only
6. **NO await on synchronous properties** - `identifier`, `title`, `branchName`, `description` are strings

## Critical Code Changes Needed

### 1. RepositoryRouterDeps Initialization

Main's version (WRONG - uses Linear SDK):
```typescript
const repositoryRouterDeps: RepositoryRouterDeps = {
    fetchIssueLabels: async (issueId: string, workspaceId: string) => {
        const linearClient = this.getLinearClientForWorkspace(workspaceId);
        const issue = await linearClient.issue(issueId);
        return await this.fetchIssueLabels(issue);
    },
    getLinearClient: (workspaceId: string) => {
        return this.getLinearClientForWorkspace(workspaceId);
    },
};
```

Needed version (CORRECT - uses IIssueTrackerService):
```typescript
const repositoryRouterDeps: RepositoryRouterDeps = {
    fetchIssueLabels: async (issueId: string, workspaceId: string) => {
        // Find repository for this workspace
        const repo = Array.from(this.repositories.values()).find(
            r => r.linearWorkspaceId === workspaceId
        );
        if (!repo) return [];

        // Use issue tracker service
        const issueTracker = this.issueTrackers.get(repo.id);
        if (!issueTracker) return [];

        return await issueTracker.getIssueLabels(issueId);
    },
};
```

### 2. Add Missing IIssueTrackerService Methods

The `getIssueLabels(issueId: string): Promise<string[]>` method needs to be added to:
- IIssueTrackerService interface (in cyrus-core)
- LinearIssueTrackerService implementation (in cyrus-linear-event-transport)
- CLIIssueTrackerService implementation (in cyrus-core)

### 3. Workspace Slug Handling

Main added workspace slug extraction for fixing Linear profile URLs (#497).

Use session.metadata approach (from HEAD):
```typescript
// Store in session metadata when creating session
session.metadata = {
    ...session.metadata,
    workspaceSlug: this.extractWorkspaceSlug(issue.url),
};

// Use when loading subroutine prompts
const workspaceSlug = session.metadata?.workspaceSlug;
const subroutinePrompt = await this.loadSubroutinePrompt(
    nextSubroutine,
    workspaceSlug,
);
```

## Testing Requirements

After completing the merge:

1. **Architecture verification**:
   ```bash
   # NO occurrences of these patterns in EdgeWorker.ts:
   grep "typeof.*==.*function" packages/edge-worker/src/EdgeWorker.ts
   grep "await issue\\.identifier" packages/edge-worker/src/EdgeWorker.ts
   grep "await issue\\.title" packages/edge-worker/src/EdgeWorker.ts
   grep "linearClient\\." packages/edge-worker/src/EdgeWorker.ts
   ```

2. **TypeScript compilation**:
   ```bash
   pnpm typecheck
   ```

3. **Test suite**:
   ```bash
   pnpm test:packages:run
   ```

4. **Specific tests**:
   - packages/edge-worker/test/EdgeWorker.async-property-bugs.test.ts (verify no await on sync properties)
   - packages/edge-worker/test/RepositoryRouter.test.ts (verify repository routing works)

## Next Steps

**Option A: Continue current merge** (RECOMMENDED)
1. Complete EdgeWorker.ts resolution following this plan
2. Fix AgentSessionManager references
3. Handle test file deletion
4. Run verification

**Option B: Abort and restart** (if too broken)
1. `git merge --abort` (need to fix pnpm-lock.yaml first)
2. Start fresh merge with `git merge origin/main --no-commit`
3. Use this plan as guide for systematic resolution

## Files Modified So Far

```
M  CHANGELOG.md (resolved)
M  packages/core/src/config-types.ts (resolved)
M  packages/edge-worker/src/EdgeWorker.ts (partial - needs completion)
```

## Estimated Remaining Work

- EdgeWorker.ts completion: 2-3 hours (many intricate changes)
- AgentSessionManager fixes: 30 minutes
- Test file cleanup: 5 minutes
- Verification and testing: 1 hour

Total: ~4 hours of focused work

## Related Issues

- CYPACK-306: Parent issue (MCP tool reorganization)
- CYPACK-376: Linear SDK property types fix
- #484: Repository selection signal support
- #488: Subroutine disallowedTools
- #468: Stream compacting status
- #497: Workspace slug for Linear profile URLs
