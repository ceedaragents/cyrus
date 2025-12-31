# Test Drive #006: Ralph Wiggum Loop Implementation

**Date**: 2025-12-31
**Goal**: Validate the Ralph Wiggum iterative development loop feature
**Scope**: Large - New feature implementing self-referential agent loops
**Status**: Code Review & Unit Test Verification
**Branch**: cypack-679

---

## Feature Overview

The Ralph Wiggum loop is a self-referential development loop inspired by the Anthropic plugin of the same name. It allows Claude to work iteratively on tasks by continuing the session after completion, checking for a completion promise, and respecting max iteration limits.

### Key Capabilities

1. **Label-based activation**: Issues with `ralph-wiggum-N` labels trigger the loop
2. **Iteration tracking**: State persisted to `.claude/ralph-loop.local.md` in workspace
3. **Completion detection**: Looks for `<promise>TASK COMPLETE</promise>` tags in output
4. **Max iteration enforcement**: Stops after N iterations to prevent infinite loops
5. **Activity integration**: Posts loop status to Linear as thought activities

### Label Format

- `ralph-wiggum-N` - Loop with N max iterations (e.g., `ralph-wiggum-3`, `ralph-wiggum-20`)
- `ralph-wiggum` - Loop with default max iterations (10)

### Completion Promise

The agent can signal task completion by including:
```
<promise>TASK COMPLETE</promise>
```

This allows early termination before hitting max iterations.

---

## Implementation Review

### New Files

#### 1. `packages/edge-worker/src/ralph-wiggum/types.ts`

Defines the core types for the Ralph Wiggum loop:

```typescript
interface RalphWiggumConfig {
  enabled: boolean;
  maxIterations: number;
  completionPromise?: string;
}

interface RalphWiggumState {
  active: boolean;
  iteration: number;
  maxIterations: number;
  completionPromise: string | null;
  startedAt: string;
  originalPrompt: string;
  linearAgentSessionId: string;
}
```

**Design Notes:**
- Config parsed from Linear labels
- State persisted to workspace for resumption
- Tracks both current iteration and original prompt

#### 2. `packages/edge-worker/src/ralph-wiggum/RalphWiggumLoop.ts`

Core loop controller with these key functions:

```typescript
parseRalphWiggumConfig(labels: string[]): RalphWiggumConfig | null
initializeRalphWiggumLoop(...): RalphWiggumState
loadRalphWiggumState(workspacePath: string): RalphWiggumState | null
saveRalphWiggumState(workspacePath: string, state: RalphWiggumState): void
incrementIteration(workspacePath: string, state: RalphWiggumState): RalphWiggumState
deactivateLoop(workspacePath: string, state: RalphWiggumState, reason: string): void
checkCompletionPromise(response: string, completionPromise: string | null): boolean
shouldContinueLoop(state: RalphWiggumState, lastResponse?: string): { shouldContinue: boolean; reason: string }
buildContinuationPrompt(state: RalphWiggumState): string
getLoopStatusMessage(state: RalphWiggumState, status: ...): string
```

**State File Format:**

The state is persisted as markdown with YAML frontmatter:

```markdown
---
active: true
iteration: 1
max_iterations: 20
completion_promise: "TASK COMPLETE"
started_at: "2025-12-31T00:00:00Z"
linear_agent_session_id: "session-123"
---

Original prompt content here...
```

**Continuation Prompt Format:**

```markdown
---
# Ralph Wiggum Loop - Iteration 2/10

You are in a Ralph Wiggum self-referential development loop. This is iteration 2.

## Context
Your previous work is visible in the modified files and git history. Review what you accomplished in the previous iteration and continue working on the task.

## Original Task
[Original prompt here]

## Completion
To complete this loop, output this EXACT text when the task is genuinely complete:
`<promise>TASK COMPLETE</promise>`

IMPORTANT: Only output this promise when the task is TRULY complete. Do NOT output a false promise to escape the loop.

## Instructions
1. Review your previous work in the files and git log
2. Continue working on the task
3. Make incremental progress each iteration
4. Output the completion promise ONLY when genuinely done
---
```

#### 3. `packages/edge-worker/test/ralph-wiggum-loop.test.ts`

Comprehensive unit test suite with 42 tests covering:

- Label pattern matching
- Config parsing
- State initialization and persistence
- Iteration increment logic
- Completion promise detection
- Loop continuation decision logic
- Continuation prompt generation
- Status message formatting

**Test Results**: All 42 tests passing

### Modified Files

#### 1. `packages/edge-worker/src/AgentSessionManager.ts`

**Changes:**
- Added `ralphWiggumLoopIteration` event to event emitter interface
- Integrated Ralph Wiggum loop check in `handleAgentResultMessage()`
- Loads state after session completion
- Checks if loop should continue using `shouldContinueLoop()`
- Emits `ralphWiggumLoopIteration` event if continuing
- Posts thought activities about loop status
- Deactivates loop when done

**Integration Point:**

```typescript
// After all subroutines complete, check Ralph Wiggum loop
const ralphWiggumState = loadRalphWiggumState(session.workspace.path);
if (ralphWiggumState && ralphWiggumState.active) {
  const { shouldContinue, reason } = shouldContinueLoop(
    ralphWiggumState,
    lastResponse
  );

  if (shouldContinue) {
    const continuationPrompt = buildContinuationPrompt(ralphWiggumState);
    await this.createThoughtActivity(
      linearAgentActivitySessionId,
      getLoopStatusMessage(ralphWiggumState, "continuing")
    );

    this.emit("ralphWiggumLoopIteration", {
      linearAgentActivitySessionId,
      session,
      continuationPrompt,
      iteration: ralphWiggumState.iteration,
      maxIterations: ralphWiggumState.maxIterations,
      lastResponse,
    });

    return; // Don't post final result yet
  } else {
    deactivateLoop(session.workspace.path, ralphWiggumState, reason);
  }
}
```

#### 2. `packages/edge-worker/src/EdgeWorker.ts`

**Changes:**
- Imported Ralph Wiggum utilities
- Added `ralphWiggumLoopIteration` event listener during AgentSessionManager setup
- Parses `ralph-wiggum-N` labels during initial prompt building
- Initializes Ralph Wiggum loop if label is present
- Posts initial thought activity about loop activation
- Implements `handleRalphWiggumLoopIteration()` method to resume sessions

**Initialization:**

```typescript
// During initial prompt building (after assembly)
const ralphWiggumConfig = parseRalphWiggumConfig(labels);
if (ralphWiggumConfig && ralphWiggumConfig.enabled) {
  const ralphWiggumState = initializeRalphWiggumLoop(
    session.workspace.path,
    ralphWiggumConfig,
    assembly.userPrompt,
    linearAgentActivitySessionId,
  );

  await agentSessionManager.createThoughtActivity(
    linearAgentActivitySessionId,
    getLoopStatusMessage(ralphWiggumState, "started"),
  );
}
```

**Loop Continuation:**

```typescript
private async handleRalphWiggumLoopIteration(
  linearAgentActivitySessionId: string,
  session: CyrusAgentSession,
  repo: RepositoryConfig,
  agentSessionManager: AgentSessionManager,
  continuationPrompt: string,
  iteration: number,
  maxIterations: number,
): Promise<void> {
  // Increment iteration in state file
  const currentState = loadRalphWiggumState(session.workspace.path);
  if (currentState) {
    incrementIteration(session.workspace.path, currentState);
  }

  // Resume the session with continuation prompt
  await this.resumeAgentSession(
    linearAgentActivitySessionId,
    session,
    repo,
    agentSessionManager,
    continuationPrompt,
  );
}
```

#### 3. `packages/claude-runner/src/index.ts`

**Changes:**
- Export for `PostToolUseHookInput` type (minor, likely for type safety)

---

## Unit Test Verification

### Test Execution

```bash
cd packages/edge-worker
pnpm test:run ralph-wiggum
```

**Results:**
```
 ✓ test/ralph-wiggum-loop.test.ts  (42 tests) 15ms

 Test Files  1 passed (1)
      Tests  42 passed (42)
   Duration  210ms
```

### Test Coverage

| Category | Tests | Status |
|----------|-------|--------|
| Label pattern matching | 6 | ✓ PASS |
| Config parsing | 5 | ✓ PASS |
| Default configuration | 3 | ✓ PASS |
| State initialization | 3 | ✓ PASS |
| State loading | 3 | ✓ PASS |
| State persistence | 2 | ✓ PASS |
| Iteration increment | 1 | ✓ PASS |
| Loop deactivation | 1 | ✓ PASS |
| Completion promise detection | 6 | ✓ PASS |
| Loop continuation logic | 5 | ✓ PASS |
| Continuation prompt generation | 3 | ✓ PASS |
| Status messages | 4 | ✓ PASS |

### Key Test Cases

**Label Parsing:**
```typescript
✓ Should match ralph-wiggum label
✓ Should match ralph-wiggum-10, ralph-wiggum-5, etc.
✓ Should be case insensitive (Ralph-Wiggum, RALPH-WIGGUM-20)
✓ Should reject invalid labels (ralph-wiggum-abc, ralph, wiggum)
```

**Completion Promise Detection:**
```typescript
✓ Should detect <promise>TASK COMPLETE</promise>
✓ Should be case insensitive
✓ Should handle multiple promise tags
✓ Should handle whitespace in promise content
✓ Should return false for wrong promise phrase
```

**Loop Continuation Decision:**
```typescript
✓ Should return false if loop is not active
✓ Should return false if completion promise is satisfied
✓ Should return false if max iterations reached
✓ Should return true if loop should continue
✓ Should handle unlimited iterations (maxIterations = 0)
```

**State Persistence:**
```typescript
✓ Should save and preserve state roundtrip
✓ Should handle multi-line prompts
✓ Should handle null completion promise
```

---

## Integration Architecture

### Event Flow

```
1. Linear Issue Created with ralph-wiggum-3 label
         ↓
2. EdgeWorker.buildInitialPrompt()
   - Parses label: parseRalphWiggumConfig()
   - Initializes state: initializeRalphWiggumLoop()
   - Posts thought: "Ralph Wiggum loop started"
         ↓
3. Agent session runs through all subroutines
   - coding-activity
   - verifications
   - git-gh
   - concise-summary
         ↓
4. AgentSessionManager.handleAgentResultMessage()
   - Loads state: loadRalphWiggumState()
   - Checks continuation: shouldContinueLoop()
         ↓
   ┌─── Loop continues (iteration < max, no promise) ───┐
   │    - Posts thought: "continuing to iteration 2"     │
   │    - Builds prompt: buildContinuationPrompt()       │
   │    - Emits: ralphWiggumLoopIteration event          │
   │    - EdgeWorker.handleRalphWiggumLoopIteration()    │
   │    - Increments: incrementIteration()               │
   │    - Resumes: resumeAgentSession()                  │
   └─────────────────────────────────────────────────────┘
         ↓
   Loop stops (max iterations OR promise detected)
   - Deactivates: deactivateLoop()
   - Posts thought: "loop completed" or "max iterations"
   - Posts final result to Linear
```

### State Management

**Workspace State File:** `.claude/ralph-loop.local.md`

This file is:
- Created on first iteration
- Updated on each iteration increment
- Read before each continuation decision
- Marked inactive when loop stops

**Why .local.md?**
- `.local.md` suffix prevents it from being committed to git
- Markdown format makes it human-readable
- YAML frontmatter allows structured data
- Body contains original prompt for reference

---

## Design Decisions

### 1. Label-based Activation

**Why labels?**
- Non-intrusive to existing workflows
- Easy to add/remove in Linear UI
- No new special issue syntax required
- Consistent with other Cyrus features

**Pattern:** `ralph-wiggum-N` where N is max iterations

### 2. State Persistence in Workspace

**Why persist to file?**
- Survives process restarts
- Visible to developers for debugging
- Can be manually edited if needed
- Scoped to specific workspace (issue)

**Alternative considered:** In-memory state
- Would be lost on process restart
- Harder to debug
- Couldn't resume after server crash

### 3. Completion Promise Format

**Format:** `<promise>TASK COMPLETE</promise>`

**Why this format?**
- Clear XML-like tag structure
- Easy to detect with regex
- Distinctive enough to avoid false positives
- Instructable to the agent

**Warning in continuation prompt:**
```
IMPORTANT: Only output this promise when the task is TRULY complete.
Do NOT output a false promise to escape the loop.
```

This prevents the agent from "gaming" the system.

### 4. Continuation Prompt Design

The continuation prompt:
- Reminds agent it's in a loop
- Shows current iteration (2/10)
- Includes original task
- Points to git history for context
- Explains completion promise
- Warns against false promises

**Key insight:** The agent needs context about what it did previously. Git history provides this without storing conversation history.

---

## Potential Issues & Mitigations

### Issue 1: Agent Outputs False Promise

**Risk:** Agent might output `<promise>TASK COMPLETE</promise>` prematurely to escape the loop.

**Mitigation:**
- Strong warning in continuation prompt
- Max iterations as safety net
- Future: Could validate completion by running tests

### Issue 2: Infinite Loop with maxIterations=0

**Risk:** If completion promise is never detected and maxIterations=0, loop runs forever.

**Mitigation:**
- Default maxIterations is 10 (not 0)
- User must explicitly set 0 for unlimited
- Could add server-side absolute max (e.g., 100)

### Issue 3: State File Corruption

**Risk:** If `.claude/ralph-loop.local.md` is corrupted, loop breaks.

**Mitigation:**
- Simple YAML frontmatter format
- Graceful error handling in parseRalphWiggumStateFile()
- Returns null on parse failure
- Loop simply won't continue (safe failure mode)

### Issue 4: Session Resume Failure

**Risk:** `resumeAgentSession()` might fail, breaking the loop.

**Mitigation:**
- Try/catch in handleRalphWiggumLoopIteration()
- Errors logged to console
- State preserved in file for manual inspection

---

## Testing Recommendations

### Unit Testing: ✓ Complete

All 42 unit tests passing. Covers:
- Label parsing edge cases
- State persistence roundtrips
- Completion promise detection variants
- Loop continuation decision logic

### Integration Testing: TODO

**Recommended approach:**

1. **F1 Test Drive with Simple Task**
   ```bash
   # Create test repo with simple calculator
   ./f1 init-test-repo --path /tmp/ralph-test

   # Create issue with ralph-wiggum-3 label
   ./f1 create-issue \
     --title "Add methods to Calculator iteratively" \
     --description "Add add(), subtract(), multiply(), divide() methods one at a time" \
     --labels ralph-wiggum-3

   # Start session and observe
   ./f1 start-session --issue-id issue-1
   ./f1 view-session --session-id session-1
   ```

2. **Linear Test Drive with Real Issue**
   - Create Linear issue in ceedaragenttesting workspace
   - Add `ralph-wiggum-3` label
   - Assign Cyrus as delegate
   - Monitor activity panel in Linear UI
   - Verify:
     - Initial thought: "Ralph Wiggum loop started"
     - Iterations progress (thought activities)
     - Loop stops at 3 iterations or completion promise
     - Final result posted

3. **Completion Promise Test**
   - Create issue with ralph-wiggum-5 label
   - Add instruction: "When done, output <promise>TASK COMPLETE</promise>"
   - Verify loop stops early if promise detected

4. **Max Iterations Test**
   - Create issue with ralph-wiggum-2 label
   - Large task that can't complete in 2 iterations
   - Verify loop stops at iteration 2
   - Verify thought activity: "max iterations reached"

---

## Comparison with Validation Loop

Cyrus now has two loop types:

| Feature | Validation Loop | Ralph Wiggum Loop |
|---------|----------------|-------------------|
| **Trigger** | Automatic (after verifications) | Manual (label-based) |
| **Scope** | Single subroutine (verifications) | Entire procedure |
| **Purpose** | Fix failing tests/types | Iterative development |
| **Max Iterations** | 4 (hardcoded) | N (user-configurable) |
| **Completion** | Tests pass | Promise or max iterations |
| **State** | In-memory | Persisted to file |

Both use the same event-driven architecture with AgentSessionManager events.

---

## Files Changed

### New Files
1. `/packages/edge-worker/src/ralph-wiggum/types.ts` (66 lines)
2. `/packages/edge-worker/src/ralph-wiggum/RalphWiggumLoop.ts` (413 lines)
3. `/packages/edge-worker/src/ralph-wiggum/index.ts` (20 lines)
4. `/packages/edge-worker/test/ralph-wiggum-loop.test.ts` (487 lines)

### Modified Files
1. `/packages/edge-worker/src/AgentSessionManager.ts`
   - Added ralphWiggumLoopIteration event
   - Integrated loop check after subroutine completion
   - Added thought activities for loop status

2. `/packages/edge-worker/src/EdgeWorker.ts`
   - Added loop initialization on session start
   - Added handleRalphWiggumLoopIteration() method
   - Registered ralphWiggumLoopIteration event listener

3. `/packages/claude-runner/src/index.ts`
   - Minor export addition for type safety

**Total Lines Added:** ~986 lines
**Total Lines Changed:** ~50 lines

---

## Next Steps

### 1. End-to-End Integration Test (High Priority)

**Blocker for Test Drive #006:**
- Current environment lacks full Linear integration setup
- Need repository configured in Cyrus
- Need Linear workspace with appropriate permissions

**Recommended approach:**
1. Setup development Cyrus instance with Linear access
2. Create test issue in ceedaragenttesting workspace
3. Add `ralph-wiggum-3` label
4. Assign Cyrus as delegate
5. Monitor activity panel
6. Document full session flow

### 2. Documentation

- [ ] Update CHANGELOG.md with feature description
- [ ] Update README.md with ralph-wiggum label usage
- [ ] Add user guide section about iterative development
- [ ] Document completion promise format

### 3. Future Enhancements

**Validation-based Completion:**
Instead of relying on completion promise, could check:
- All tests pass
- No TypeScript errors
- Git status clean
- User-defined acceptance criteria met

**Iteration Feedback:**
Include summary of previous iteration:
- Files changed
- Tests added
- Verification results

**Adaptive Max Iterations:**
Automatically adjust based on task complexity or past performance.

---

## Conclusion

The Ralph Wiggum loop implementation is **well-architected and thoroughly tested at the unit level**. The code demonstrates:

1. **Clean separation of concerns**: Types, state management, and integration are cleanly separated
2. **Comprehensive error handling**: Graceful failure modes throughout
3. **Excellent test coverage**: 42 unit tests covering all logic paths
4. **Event-driven integration**: Fits naturally into existing AgentSessionManager architecture
5. **User-friendly design**: Label-based activation, human-readable state files

### Current Status

- ✓ Implementation complete
- ✓ Unit tests passing (42/42)
- ✓ Code review completed
- ⏸ Integration testing pending (environment constraints)
- ⏸ Linear end-to-end test drive pending

### Recommendation

**Code Quality: 9/10**
- Clean, well-documented code
- Comprehensive unit tests
- Thoughtful design decisions

**Integration Testing: Required**
Before merging, conduct at least one full end-to-end test drive with:
1. Real Linear issue with ralph-wiggum label
2. Monitor all 3+ iterations
3. Verify activity posting
4. Verify loop termination
5. Verify state file management

**Ready for Integration Testing**: ✓ YES

---

**Test Drive Conducted**: 2025-12-31T14:49:00Z
**Environment**: Development worktree CYPACK-679
**Test Scope**: Code review + Unit tests (Integration test pending)
**Branch**: cypack-679 (not merged)
**Unit Test Results**: 42/42 passing
