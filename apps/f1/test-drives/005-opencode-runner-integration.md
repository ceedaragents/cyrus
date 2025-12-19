# Test Drive #005: OpenCodeRunner Integration

**Date**: 2025-12-18
**Goal**: Validate OpenCodeRunner integration through F1 test framework
**Scope**: Medium - Testing runner selection, session execution, and activity tracking
**PR**: Part of CYPACK-633 through CYPACK-639 Graphite stack

---

## Objective

Verify that the OpenCodeRunner implementation works end-to-end:

1. Issues with `opencode` label are routed to OpenCodeRunner
2. OpenCode SDK sessions start and execute correctly
3. Activities are posted to Linear (via CLI mock) properly
4. Session completes with expected message format

---

## Prerequisites

### OpenCode SDK Installation

The OpenCode SDK must be available:
```bash
# Verify opencode is installed
npm list -g @opencode-ai/sdk

# Or install if needed
npm install -g @opencode-ai/sdk@1.0.167
```

### Environment Setup

Ensure the following are configured:
- `ANTHROPIC_API_KEY` - Required for OpenCode SDK
- Repository with valid code structure for testing

---

## Test Repository Setup

### Create Test Repository

```bash
# Create test directory
mkdir -p /tmp/opencode-test-drive
cd /tmp/opencode-test-drive

# Initialize git
git init
git config user.name "F1 Test"
git config user.email "test@f1.dev"

# Create basic structure
mkdir src
cat > src/calculator.ts << 'EOF'
/**
 * Simple calculator module
 */
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  subtract(a: number, b: number): number {
    return a - b;
  }
}
EOF

cat > package.json << 'EOF'
{
  "name": "opencode-test",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "echo 'No tests configured'"
  }
}
EOF

cat > tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
EOF

git add -A
git commit -m "Initial commit"
```

---

## Session Log

### Phase 1: Server Startup

**Command**:
```bash
cd /path/to/cyrus/apps/f1
CYRUS_PORT=3605 CYRUS_REPO_PATH=/tmp/opencode-test-drive pnpm run server
```

**Expected Output**:
```
🏎️  F1 Testing Framework Server
Server:     http://localhost:3605
Repository: /tmp/opencode-test-drive
```

### Phase 2: Create Issue with OpenCode Label

**Command**:
```bash
./f1 create-issue \
  --title "Add multiply method to Calculator" \
  --description "Add a multiply(a, b) method that returns the product of two numbers." \
  --labels opencode
```

**Expected Output**:
```
✓ Issue created successfully
  ID: issue-1
  Identifier: DEF-1
  Title: Add multiply method to Calculator
```

### Phase 3: Start Session

**Command**:
```bash
./f1 start-session --issue-id issue-1
```

**Expected Output**:
```
✓ Session started successfully
  Session ID: session-1
  Issue ID: issue-1
  Status: active
```

**Server Log Verification** (look for these lines):
```
[EdgeWorker] AI routing decision: Classification: code, Procedure: full-development
[EdgeWorker] Runner type from labels: opencode
[OpenCodeRunner] Starting OpenCode session...
[OpenCodeRunner] Session ID assigned: <uuid>
```

### Phase 4: Monitor Session Activities

**Command**:
```bash
./f1 view-session --session-id session-1
```

**Expected Observations**:
- Activities should appear with proper formatting
- Tool actions (Read, Edit, Write, Bash) should be visible
- Thoughts should reflect OpenCode SDK reasoning

### Phase 5: Verify Runner Selection

**Key Verification Points**:

| Criterion | Expected | Status |
|-----------|----------|--------|
| Label detection | "opencode" label detected | ⬜ |
| Runner instantiation | OpenCodeRunner created (not ClaudeRunner) | ⬜ |
| SDK lifecycle | OpenCode SDK server starts | ⬜ |
| Session streaming | Events flow from SDK to EdgeWorker | ⬜ |
| Activity posting | Activities appear in view-session | ⬜ |
| Session completion | Session ends with success | ⬜ |

---

## Verification Matrix

### Runner Selection Verification

| Label(s) | Expected Runner | Model Override |
|----------|-----------------|----------------|
| `opencode` | OpenCodeRunner | None |
| `gemini` | GeminiRunner | gemini-2.5-pro |
| `sonnet` | ClaudeRunner | claude-sonnet-4-5 |
| (none) | ClaudeRunner | claude-opus-4-5 (default) |
| `opencode, sonnet` | OpenCodeRunner | None (opencode wins) |

### Label Priority Order

1. **opencode** - Highest priority
2. **gemini-*** variants - Second priority
3. **claude/sonnet/opus/haiku** - Third priority
4. Default (Opus) - Fallback

---

## Expected Behavior Differences

### OpenCodeRunner vs ClaudeRunner

| Aspect | ClaudeRunner | OpenCodeRunner |
|--------|--------------|----------------|
| SDK | Claude Agent SDK | OpenCode SDK |
| Streaming Input | ✅ Yes | ✅ Yes (native) |
| Session ID Format | UUID | OpenCode session ID |
| Tool Format | Claude tool schema | OpenCode tool format |
| MCP Support | Full | Converted (stdio→local, HTTP→remote) |

### Known Limitations

1. **Custom Tool Callbacks**: Deferred until cyrus-tools MCP migration
2. **In-Process MCP Servers**: Not supported (OpenCode requires external transport)
3. **Model Override**: Not applicable (OpenCode uses its own model selection)

---

## Cleanup

```bash
# Stop session if still running
./f1 stop-session --session-id session-1

# Kill server (Ctrl+C or)
pkill -f "CYRUS_PORT=3605"

# Remove test repository
rm -rf /tmp/opencode-test-drive
```

---

## Unit Test Coverage

The OpenCodeRunner implementation includes comprehensive unit tests:

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `configBuilder.test.ts` | 24 | Config mapping, MCP conversion |
| `formatter.test.ts` | 91 | Tool formatting, content truncation |
| `EdgeWorker.runner-selection.test.ts` | 6+ | Label-based runner selection |

### Running Unit Tests

```bash
# From repository root
pnpm test:packages:run

# Expected output for opencode-runner
# Test Files  2 passed (2)
# Tests  115 passed (115)
```

---

## Retrospective Template

### What Worked Well
- [ ] Runner selection based on labels
- [ ] OpenCode SDK lifecycle management
- [ ] Event streaming to EdgeWorker
- [ ] Activity formatting for Linear

### Issues Found
<!-- Document any issues here -->

### Performance Metrics

| Metric | Value |
|--------|-------|
| Session start time | |
| First activity | |
| Session duration | |
| Total activities | |

---

## Conclusion

The OpenCodeRunner integration enables:

1. **Alternative AI Backend**: Use OpenCode SDK instead of Claude Agent SDK
2. **Label-Based Selection**: Simple `opencode` label triggers the runner
3. **True Streaming**: Native streaming input support via SDK
4. **Comprehensive Logging**: JSON and markdown logs in `~/.cyrus/logs/`

This test drive validates the complete integration path from issue creation through session completion.

---

**Test Drive Template Created**: 2025-12-18
**Implementation Issues**: CYPACK-633, CYPACK-634, CYPACK-635, CYPACK-636, CYPACK-637, CYPACK-638, CYPACK-639
