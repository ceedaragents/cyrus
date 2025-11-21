# gemini-runner Package Guide

This package provides a provider-agnostic wrapper around the Gemini CLI that implements the `IAgentRunner` interface from `cyrus-core`.

## Overview

**GeminiRunner** translates between Gemini CLI's streaming JSON format and the Claude SDK message types, enabling seamless integration of Google's Gemini models into the Cyrus agent framework.

## Key Features

### 1. Result Message Coercion

Unlike Claude's CLI which includes final assistant content in result messages, Gemini's result messages contain only metadata (status, stats, duration). GeminiRunner solves this by:

- **Tracking** the last assistant message emitted during execution
- **Extracting** text content from the tracked message
- **Injecting** actual response content into result messages

**Implementation:**
- `GeminiRunner.lastAssistantMessage` - Private field tracking most recent assistant message
- `GeminiRunner.getLastAssistantMessage()` - Public accessor for external use
- `geminiEventToSDKMessage()` - Accepts optional `lastAssistantMessage` parameter to coerce result content

**Why this matters:**
Without coercion, result messages would always say "Session completed successfully" instead of containing the actual final output. This breaks EdgeWorker's expectation that result messages contain summary content from final subroutines.

### 2. Single-Turn Mode Support

Summary subroutines (like `concise-summary`, `question-answer`) need to run in single-turn mode to prevent unnecessary back-and-forth. GeminiRunner enables this through:

**Auto-Generated Settings:**
- On first spawn, creates `~/.gemini/settings.json` if missing
- Generates `-shortone` aliases for all main Gemini models:
  - `gemini-3-pro-preview-shortone`
  - `gemini-2.5-pro-shortone`
  - `gemini-2.5-flash-shortone`
  - `gemini-2.5-flash-lite-shortone`
- Each alias configured with `maxSessionTurns: 1`
- Enables `previewFeatures: true` for latest Gemini capabilities

**EdgeWorker Integration:**
- When `subroutine.singleTurn === true`, EdgeWorker appends `-shortone` to model name
- Example: `gemini-2.5-flash` → `gemini-2.5-flash-shortone`
- This ensures Gemini CLI enforces single-turn constraint

**Reference:**
- Gemini CLI Configuration: https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/configuration.md

### 3. Streaming Stdin Support

GeminiRunner supports both string and streaming prompt modes:

**String Mode:**
```typescript
await runner.start("Analyze this codebase");
```

**Streaming Mode:**
```typescript
await runner.startStreaming("Initial task");
runner.addStreamMessage("Additional context");
runner.addStreamMessage("More details");
runner.completeStream(); // Closes stdin to trigger processing
```

**Critical Implementation Details:**
- Initial prompt written to stdin **immediately** after spawn (line 253)
- Stdin remains **open** for `addStreamMessage()` calls
- Stdin closed only in `completeStream()` (line 118)
- Prevents gemini CLI's 500ms timeout from firing prematurely

**How Gemini CLI stdin works:**
1. 500ms timeout starts when process spawns
2. If **no data** arrives within 500ms → assumes no piped input, continues
3. Once **data arrives** → cancels timeout, waits for stdin close (`end` event)
4. Continues reading chunks until stdin closes

**Test Coverage:** `test-scripts/test-stdin-direct.ts` proves multiple stdin writes work correctly.

## Testing

### Integration Tests

The package includes comprehensive integration tests in `test-scripts/`:

#### test-stdin-direct.ts
**Purpose:** Proves stdin streaming works with real gemini CLI

**What it tests:**
- Multiple stdin writes accepted by gemini process
- Gemini processes all input after stdin closes
- Response includes content from all 3 prompts

**Usage:**
```bash
cd packages/gemini-runner
export GEMINI_API_KEY='your-key-here'
bun test-scripts/test-stdin-direct.ts
```

**Expected output:**
```
✅ Gemini process spawned successfully
✅ All 3 prompts written to stdin
✅ Stdin closed
✅ SUCCESS - Multiple stdin writes worked!
```

#### test-result-and-singleturn.ts
**Purpose:** Verifies result coercion and single-turn mode

**What it tests:**
1. **Result Message Coercion**
   - Result message contains actual assistant response
   - NOT generic "Session completed successfully"
   - Content matches last assistant message

2. **Single-Turn Mode**
   - `-shortone` model aliases work
   - Session completes in 0-1 turns
   - maxSessionTurns constraint enforced

3. **Settings Auto-Generation**
   - `~/.gemini/settings.json` created if missing
   - All 4 `-shortone` aliases present
   - Each alias has `maxSessionTurns: 1`

**Usage:**
```bash
cd packages/gemini-runner
export GEMINI_API_KEY='your-key-here'
bun test-scripts/test-result-and-singleturn.ts
```

**Expected output:**
```
📝 Test 1: Result Message Content Coercion
   ✅ Result message contains actual assistant response
   ✅ Result coercion working correctly

🔄 Test 2: Single-Turn Mode
   ✅ Completed in 1 turn(s)
   ✅ Single-turn mode working correctly

⚙️  Test 3: Settings.json Auto-Generation
   ✅ All -shortone aliases present
   ✅ All aliases have maxSessionTurns: 1

✅ All Tests Passed!
```

### Prerequisites

**Required:**
- GEMINI_API_KEY environment variable
- Gemini CLI: `npm install -g @google/gemini-cli@0.17.0`
- Bun runtime (for test execution)

**Optional:**
- `~/.gemini/settings.json` (auto-generated if missing)

### Running Tests

```bash
# Install Gemini CLI (one-time setup)
npm install -g @google/gemini-cli@0.17.0

# Set API key
export GEMINI_API_KEY='your-gemini-api-key'

# Build the package first
cd packages/gemini-runner
pnpm build

# Run stdin streaming test
bun test-scripts/test-stdin-direct.ts

# Run comprehensive integration test
bun test-scripts/test-result-and-singleturn.ts
```

## Architecture

### Message Flow

```
Gemini CLI Process
       ↓ (stdout: NDJSON stream)
handleGeminiEvent()
       ↓
geminiEventToSDKMessage(event, sessionId, lastAssistantMessage)
       ↓
Track if type === "assistant" → this.lastAssistantMessage
       ↓
emitMessage() → onMessage callback
       ↓
EdgeWorker → AgentSessionManager → Linear
```

### Key Files

- **GeminiRunner.ts** (lines 70-71) - Track last assistant message field
- **GeminiRunner.ts** (line 234) - Call `ensureGeminiSettings()` before spawn
- **GeminiRunner.ts** (lines 397-399) - Capture assistant messages
- **GeminiRunner.ts** (line 253) - Write initial prompt to stdin immediately
- **adapters.ts** (lines 172-183) - Extract content for result coercion
- **settingsGenerator.ts** - Auto-generate `~/.gemini/settings.json`

### Integration Points

**EdgeWorker Coordination:**
- EdgeWorker checks `subroutine.singleTurn` flag
- If true: appends `-shortone` to model name
- Passes `maxTurns: 1` to runner config
- GeminiRunner uses model alias from settings.json

**Result Message Usage:**
- AgentSessionManager relies on `result.result` containing final content
- Without coercion, would post generic message to Linear
- With coercion, posts actual assistant summary

## Common Issues

### Issue: "Gemini process hangs"
**Cause:** Stdin not written immediately after spawn
**Solution:** Initial prompt written at line 253 before any other operations

### Issue: "Result says 'Session completed successfully'"
**Cause:** Result coercion not working
**Debug:** Check that `lastAssistantMessage` is being captured
**Verify:** Run `test-result-and-singleturn.ts` to confirm coercion

### Issue: "Single-turn mode not working"
**Cause:** Missing `-shortone` aliases in settings.json
**Solution:** Delete `~/.gemini/settings.json` and restart (auto-regenerates)
**Verify:** Check settings.json has `maxSessionTurns: 1` for aliases

### Issue: "Multiple stdin writes fail"
**Cause:** Stdin closed prematurely
**Solution:** Only close stdin in `completeStream()`, not after initial write
**Verify:** Run `test-stdin-direct.ts` to confirm streaming works

## Contributing

When modifying GeminiRunner:

1. **Run tests** before committing:
   ```bash
   pnpm build
   bun test-scripts/test-stdin-direct.ts
   bun test-scripts/test-result-and-singleturn.ts
   ```

2. **Preserve critical behaviors:**
   - Stdin written immediately (line 253)
   - Stdin kept open for streaming
   - Last assistant message tracked
   - Settings.json auto-generation

3. **Update tests** if changing:
   - Result message structure
   - Single-turn mode behavior
   - Stdin handling logic

4. **Document** any new edge cases or Gemini CLI quirks discovered
