# Race Condition Reproduction Test - Cyrus Subroutine Transition Bug

## Root Cause Analysis

### The Race Condition

The critical bug occurs during subroutine transitions when there's a **race between two asynchronous operations**:

1. **ClaudeRunner's query loop completion** (natural termination after result message)
2. **EdgeWorker.resumeClaudeSession() calling existingRunner.stop()** (forced termination)

### Sequence of Events Leading to Crash

```
Time T0: ClaudeRunner receives result message
    ├─ Line 461: emit("message", message)
    │   └─> AgentSessionManager.handleClaudeMessage()
    │       └─> AgentSessionManager.completeSession()
    │           └─> AgentSessionManager.handleProcedureCompletion()
    │               └─> resumeNextSubroutine callback (EdgeWorker)
    │                   └─> EdgeWorker.resumeClaudeSession()
    │                       └─> Line 4866: existingRunner.stop()  ⚠️
    │                           └─> Line 580: abortController.abort()  ❌ ABORT SIGNAL
    │
    ├─ Line 469: streamingPrompt.complete()
    │
    └─ Continue query loop iteration...

Time T1: Query loop attempts next iteration
    ├─ AbortController has been aborted (by existingRunner.stop())
    └─> AbortError thrown by Claude SDK
        └─> Error propagates up: "Claude Code process aborted by user"
```

### The Problem

**The race occurs because:**

1. The `result` message triggers `handleProcedureCompletion()` via the `onMessage` callback
2. This **immediately** calls `resumeNextSubroutine()` which calls `resumeClaudeSession()`
3. `resumeClaudeSession()` calls `existingRunner.stop()` at line 4866
4. `stop()` calls `abortController.abort()` at line 580
5. **BUT** the ClaudeRunner's query loop is still running (hasn't exited yet)
6. The abort signal terminates the query iterator mid-flight
7. This causes an `AbortError` exception instead of clean completion

### Why This Is Intermittent

The race condition is timing-dependent:

- **Fast transitions**: If `resumeClaudeSession()` is called before the query loop exits naturally, you get the abort error
- **Slow transitions**: If the query loop exits before `resumeClaudeSession()` is called, it works fine
- **Network latency**, **system load**, and **async scheduling** determine the winner

---

## Test Pseudocode

```typescript
describe("Subroutine Transition Race Condition", () => {
  test("should reproduce AbortError when transitioning between subroutines", async () => {
    // ARRANGE: Set up a multi-subroutine procedure
    const procedure = {
      subroutines: [
        { name: "first-task", prompt: "Do task 1", requiresApproval: false },
        { name: "second-task", prompt: "Do task 2", requiresApproval: false }
      ]
    };

    const mockLinearClient = createMockLinearClient();
    const mockRepository = createMockRepository();

    // Create EdgeWorker with procedure
    const edgeWorker = new EdgeWorker({
      linearClient: mockLinearClient,
      cyrusHome: "/tmp/test-cyrus-home",
      repositories: [mockRepository]
    });

    // Create session manager with procedure router
    const sessionManager = new AgentSessionManager(mockLinearClient);
    const procedureRouter = new ProcedureRouter(procedure);
    sessionManager.setProcedureRouter(procedureRouter);

    // Register resumeNextSubroutine callback
    sessionManager.setResumeCallback(async (sessionId) => {
      await edgeWorker.resumeNextSubroutine(sessionId);
    });

    // Create initial session
    const session = await edgeWorker.createSession({
      issueId: "test-issue-123",
      repositoryId: mockRepository.id,
      procedure: procedure
    });

    // Mock ClaudeRunner to simulate result message
    let firstRunnerStopCalled = false;
    let abortControllerAborted = false;

    const mockClaudeRunner = {
      startStreaming: jest.fn().mockImplementation(async () => {
        // Simulate streaming with delay
        await delay(100);

        // Emit result message (this triggers the race)
        const resultMessage = {
          type: "result",
          subtype: "success",
          result: "Task completed",
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50 }
        };

        // This will trigger onMessage callback -> completeSession -> resumeNextSubroutine
        mockClaudeRunner.emit("message", resultMessage);

        // Simulate the query loop continuing (hasn't exited yet)
        // This is where the race happens
        await delay(50); // Query loop still running

        // If stop() was called during this delay, abortController is aborted
        if (abortControllerAborted) {
          throw new Error("AbortError: Claude Code process aborted by user");
        }
      }),

      stop: jest.fn().mockImplementation(() => {
        firstRunnerStopCalled = true;
        abortControllerAborted = true;
        console.log("[MockRunner] stop() called - aborting controller");
      }),

      isStreaming: jest.fn().mockReturnValue(false),

      emit: jest.fn((event, data) => {
        if (event === "message") {
          // Trigger the onMessage callback synchronously
          edgeWorker.handleClaudeMessage(session.id, data, mockRepository.id);
        }
      })
    };

    // Inject mock runner into session
    sessionManager.addClaudeRunner(session.id, mockClaudeRunner);

    // ACT: Start the first subroutine
    try {
      await mockClaudeRunner.startStreaming("Start first task");

      // ASSERT: This should fail with AbortError due to race condition
      fail("Expected AbortError to be thrown");

    } catch (error) {
      // ASSERT: Verify this is the race condition error
      expect(error.message).toContain("AbortError");
      expect(error.message).toContain("aborted by user");
      expect(firstRunnerStopCalled).toBe(true);
      expect(abortControllerAborted).toBe(true);
    }
  });

  test("should demonstrate the timing dependency of the race", async () => {
    // This test shows that if we add a delay before resumeNextSubroutine,
    // the race doesn't occur

    const sessionManager = new AgentSessionManager(mockLinearClient);

    // Add artificial delay to resumeNextSubroutine
    sessionManager.setResumeCallback(async (sessionId) => {
      await delay(200); // Wait for query loop to complete naturally
      await edgeWorker.resumeNextSubroutine(sessionId);
    });

    // Same setup as before...
    // This time the test should PASS (no abort error)
    // because the query loop completes before stop() is called
  });
});
```

---

## Key Test Assertions

1. **Verify stop() is called**: `expect(firstRunnerStopCalled).toBe(true)`
2. **Verify AbortError occurs**: `expect(error.message).toContain("AbortError")`
3. **Verify timing dependency**: Second test with delay should NOT throw
4. **Verify intermediate state**: Query loop is still running when stop() is called

---

## Expected Test Output (FAILING)

```
❌ Subroutine Transition Race Condition › should reproduce AbortError

  Error: AbortError: Claude Code process aborted by user
      at ClaudeRunner.startStreaming (ClaudeRunner.ts:580)
      at EdgeWorker.resumeClaudeSession (EdgeWorker.ts:4866)
      at AgentSessionManager.handleProcedureCompletion (AgentSessionManager.ts:407)

  Logs:
    [ClaudeRunner] Got result message, completing streaming prompt
    [AgentSessionManager] Subroutine completed, advancing to next: second-task
    [ClaudeRunner] Stopping Claude session
    [MockRunner] stop() called - aborting controller

  FAIL: AbortError thrown during subroutine transition
```

---

## Fix Strategy (Not Implemented Yet)

The fix should address the race condition by ensuring the ClaudeRunner **completes naturally** before calling `stop()`:

### Option 1: Wait for query loop completion
```typescript
// In resumeClaudeSession(), before calling stop():
if (existingRunner) {
  // Wait for the query loop to complete if it's finishing
  if (existingRunner.isCompleting()) {
    await existingRunner.waitForCompletion();
  }
  existingRunner.stop();
}
```

### Option 2: Don't call stop() if already completing
```typescript
// In resumeClaudeSession():
if (existingRunner && !existingRunner.isCompleting()) {
  existingRunner.stop();
}
```

### Option 3: Make stop() idempotent and safe during completion
```typescript
// In ClaudeRunner.stop():
stop(): void {
  // Don't abort if we're in the final stages of completion
  if (this.isCompleting) {
    console.log("[ClaudeRunner] Session completing naturally, skipping abort");
    return;
  }

  if (this.abortController) {
    console.log("[ClaudeRunner] Stopping Claude session");
    this.abortController.abort();
    this.abortController = null;
  }
  // ... rest of cleanup
}
```

---

## Files Involved in Bug

- **packages/claude-runner/src/ClaudeRunner.ts**:
  - Line 580: `abortController.abort()` called in `stop()`
  - Lines 419-478: Query loop that gets aborted mid-flight
  - Line 469: `streamingPrompt.complete()` called on result message

- **packages/edge-worker/src/EdgeWorker.ts**:
  - Line 4866: `existingRunner.stop()` called during transition
  - Lines 4837-4962: `resumeClaudeSession()` method

- **packages/edge-worker/src/AgentSessionManager.ts**:
  - Lines 217-255: `completeSession()` triggered by result message
  - Lines 260-433: `handleProcedureCompletion()` calls resumeNextSubroutine
  - Line 407: Callback triggers `resumeNextSubroutine()`

---

## Reproduction Steps (Manual)

1. Create a Linear issue with multiple subroutines (e.g., debugger procedure with 3+ steps)
2. Assign to Cyrus agent
3. Wait for first subroutine to complete
4. Observe logs during transition to second subroutine
5. ~50% of the time, you'll see the AbortError in logs
6. Agent stops responding and session is left in broken state

---

## Success Criteria for Fix

- ✅ No AbortError during subroutine transitions
- ✅ Query loop completes naturally before stop() is called
- ✅ Test passes consistently (no intermittent failures)
- ✅ No memory leaks from incomplete cleanup
- ✅ All existing subroutine transition tests still pass
