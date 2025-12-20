# OpenCode Runner Test Scripts

Manual test scripts for verifying OpenCodeRunner functionality.

## Prerequisites

1. Build the package:
   ```bash
   cd packages/opencode-runner
   pnpm build
   ```

2. Ensure OpenCode SDK is installed globally:
   ```bash
   npm install -g @opencode-ai/sdk@1.0.167
   ```

3. Set up your environment with OpenCode API credentials if needed.

## Available Tests

### test-without-init.js

Tests that OpenCode sessions work without calling `session.init()`, which was hanging indefinitely in SDK v1.0.167.

**Purpose**: Verify the fix that skips `session.init()` and relies on `promptAsync` to handle initialization internally.

**Usage**:
```bash
node test-scripts/test-without-init.js
```

**Expected Output**:
- ✅ Session starts successfully
- ✅ OpenCode responds to the prompt
- ✅ Session completes without hanging
- ✅ No indefinite hangs or timeouts

**What It Tests**:
- OpenCode server startup
- Session creation (without init call)
- Prompt sending via promptAsync
- Message streaming
- Session completion
- Graceful cleanup

## Known Issues

- **Session.init() Hanging**: The `session.init()` method hangs indefinitely with OpenCode SDK v1.0.167. This is a known issue and is intentionally skipped in the OpenCodeRunner implementation.

## Debugging

If a test fails:
1. Check OpenCode SDK version: `opencode --version`
2. Verify API credentials are set
3. Check the logs in `~/.cyrus/logs/`
4. Ensure no other OpenCode processes are running
5. Try a clean reinstall of OpenCode SDK
