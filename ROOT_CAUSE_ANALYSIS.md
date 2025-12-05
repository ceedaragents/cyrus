# Root Cause Analysis: CLI Issue labels() Method Returns Empty Array

## Executive Summary

The `labels()` method in `createCLIIssue()` always returns an empty array (`{ nodes: [] }`) regardless of whether the issue has `labelIds`. This breaks:
1. EdgeWorker's label-based repository routing
2. Runner selection (Claude vs Gemini) based on issue labels
3. Model override selection via labels
4. Orchestrator/debugger procedure triggering

## Bug Location

**File:** `packages/core/src/issue-tracker/adapters/CLITypes.ts`
**Lines:** 354-361

```typescript
labels(
    _variables?: Omit<
        LinearSDK.LinearDocument.Issue_LabelsQueryVariables,
        "id"
    >,
): Promise<Connection<Label>> {
    return Promise.resolve({ nodes: [] });  // ❌ BUG: Always empty!
},
```

## Root Cause

The `createCLIIssue()` function signature only accepts `CLIIssueData` as a parameter:

```typescript
export function createCLIIssue(data: CLIIssueData): Issue
```

`CLIIssueData` contains `labelIds: string[]` but NOT the actual label objects with their names, colors, and descriptions. The `labels()` method has no way to resolve these IDs into full label objects, so it returns an empty array as a placeholder.

## Data Flow Analysis

### Current (Broken) Flow

```
CLIIssueData { labelIds: ["label-bug", "label-feature"] }
    ↓
createCLIIssue(data)
    ↓
issue.labels() → Promise<{ nodes: [] }>  ❌ Empty!
    ↓
EdgeWorker.fetchIssueLabels() → []
    ↓
determineRunnerFromLabels([]) → defaults to Claude+Sonnet
```

### Expected (Fixed) Flow

```
CLIIssueData { labelIds: ["label-bug"] }
    +
resolvedLabels: [{ id: "label-bug", name: "bug", color: "#ff0000", ... }]
    ↓
createCLIIssue(data, resolvedLabels)
    ↓
issue.labels() → Promise<{ nodes: [bugLabel] }>  ✅ Actual labels!
    ↓
EdgeWorker.fetchIssueLabels() → ["bug"]
    ↓
determineRunnerFromLabels(["bug"]) → correct routing
```

## Impact Assessment

### 1. Repository Routing (Priority 1)
**File:** `packages/edge-worker/src/RepositoryRouter.ts:277-310`

When an issue has routing labels (e.g., `frontend`, `backend`), the label-based routing should trigger first. But because `fetchIssueLabels()` returns empty array, it silently falls through to lower-priority methods.

**Example Failure:**
```typescript
// Repository config
{
  routingLabels: ["frontend"]
}

// Issue created with label "frontend"
// Expected: Routes to frontend repo
// Actual: Falls through to project/team/catch-all routing
```

### 2. Runner Selection
**File:** `packages/edge-worker/src/EdgeWorker.ts:2198-2209`

Labels should control which AI runner processes the issue:
- `gemini-2.5-pro` → GeminiRunner
- `codex` → CodexRunner
- `sonnet`, `opus`, `haiku` → ClaudeRunner with model override

**Example Failure:**
```typescript
// Issue created with label "codex"
// Expected: Uses CodexRunner
// Actual: Uses ClaudeRunner (default)
```

### 3. Orchestrator/Debugger Triggers
**File:** `packages/edge-worker/src/EdgeWorker.ts:4801`

Labels like `orchestrator` should trigger special procedures. Empty labels array prevents this.

## Test Results

Created failing test: `packages/core/src/issue-tracker/adapters/CLIIssueTrackerService.test.ts`

```
❯ should return actual labels when issue has labelIds
  AssertionError: expected [] to have a length of 2 but got +0

❯ should work with EdgeWorker's fetchIssueLabels pattern
  AssertionError: expected [] to include 'codex'
```

Both tests confirm the bug: `labels()` returns empty array even when issue has `labelIds`.

## Workaround (Partial)

The `CLIIssueTrackerService.getIssueLabels()` method works correctly:

```typescript
async getIssueLabels(issueId: string): Promise<string[]> {
    const issue = await this.fetchIssue(issueId);
    const labelNames: string[] = [];
    for (const labelId of issue.labelIds) {
        const labelData = this.state.labels.get(labelId);
        if (labelData) {
            labelNames.push(labelData.name);
        }
    }
    return labelNames;
}
```

**Problem:** This requires knowing the service instance. The `Issue` object's `labels()` method should be self-contained.

## Recommended Fix (Option A)

Modify `createCLIIssue()` to accept resolved label data:

```typescript
export function createCLIIssue(
  data: CLIIssueData,
  resolvedLabels?: CLILabelData[]
): Issue {
  // ... existing code ...

  labels(): Promise<Connection<Label>> {
    if (!resolvedLabels || resolvedLabels.length === 0) {
      return Promise.resolve({ nodes: [] });
    }
    return Promise.resolve({
      nodes: resolvedLabels.map(label => createCLILabel(label))
    });
  },
}
```

Update `CLIIssueTrackerService.fetchIssue()`:

```typescript
async fetchIssue(idOrIdentifier: string): Promise<Issue> {
  // ... find issueData ...

  // Resolve label data from labelIds
  const resolvedLabels = issueData.labelIds
    .map(id => this.state.labels.get(id))
    .filter((l): l is CLILabelData => l !== undefined);

  return createCLIIssue(issueData, resolvedLabels);
}
```

Do the same for:
- `createIssue()` - line 244
- `updateIssue()` - line 404
- `fetchIssueChildren()` - line 283

## Alternative Fix (Option B)

Pass a label resolver callback:

```typescript
export function createCLIIssue(
  data: CLIIssueData,
  labelResolver?: (labelId: string) => CLILabelData | undefined
): Issue
```

**Downside:** More complex implementation, harder to test.

## Dependencies

- `createCLILabel()` function needs to be implemented (similar to `createCLIComment()`)
- All call sites to `createCLIIssue()` need to pass resolved labels
- Tests need to verify label resolution works correctly

## Acceptance Criteria

- [ ] `createCLIIssue().labels()` returns actual label objects when issue has `labelIds`
- [ ] EdgeWorker's `fetchIssueLabels()` returns correct label names for CLI issues
- [ ] Creating issue with `labelIds: ["label-codex"]` triggers CodexRunner
- [ ] Label-based repository routing works with CLI issues
- [ ] All existing tests continue to pass
- [ ] New test cases pass (already created in this branch)

## Files Modified (Planned)

1. `packages/core/src/issue-tracker/adapters/CLITypes.ts`
   - Modify `createCLIIssue()` signature
   - Implement `labels()` method properly
   - Ensure `createCLILabel()` exists

2. `packages/core/src/issue-tracker/adapters/CLIIssueTrackerService.ts`
   - Update `fetchIssue()` to pass resolved labels
   - Update `createIssue()` to pass resolved labels
   - Update `updateIssue()` to pass resolved labels
   - Update `fetchIssueChildren()` to pass resolved labels

3. Tests will automatically pass once fix is implemented

## Test Verification Commands

```bash
# Run the new test
cd packages/core
pnpm test:run CLIIssueTrackerService.test.ts

# Run all core tests
pnpm test:run

# Run edge-worker tests to verify integration
cd ../edge-worker
pnpm test:run
```

## Timeline

This is issue **9 of 9** in the Graphite stack (CYPACK-532).
Previous issue (CYPACK-530) must be merged first as it seeds the labels.
