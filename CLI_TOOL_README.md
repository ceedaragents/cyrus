# Cyrus CLI Tool - Command-Line Interface

The Cyrus CLI tool provides a simple command-line interface for interacting with the Cyrus CLI IssueTracker platform.

## Quick Start

### 1. Start the Cyrus CLI Server

```bash
node start-cli-server.mjs
```

The server will start on port 3457 by default. You can specify a different port:

```bash
CYRUS_PORT=8080 node start-cli-server.mjs
# or
node start-cli-server.mjs 8080
```

### 2. Use the CLI Tool

Once the server is running, you can use the CLI tool from another terminal:

```bash
# Create an issue
packages/core/src/issue-tracker/adapters/cli-tool.mjs createIssue \
  --title "Fix authentication bug" \
  --description "Users cannot log in with OAuth"

# Create a comment
packages/core/src/issue-tracker/adapters/cli-tool.mjs createComment \
  --issue-id issue-1 \
  --body "This is blocking production" \
  --mention-agent

# Start an agent session
packages/core/src/issue-tracker/adapters/cli-tool.mjs startSession \
  --issue-id issue-1

# View the session
packages/core/src/issue-tracker/adapters/cli-tool.mjs viewSession \
  --session-id session-1

# List all members
packages/core/src/issue-tracker/adapters/cli-tool.mjs fetchMembers
```

## Installation (Optional)

For easier access, create aliases or symlinks:

```bash
# Add to your ~/.bashrc or ~/.zshrc
alias cyrus-cli='packages/core/src/issue-tracker/adapters/cli-tool.mjs'
alias cyrus-server='node start-cli-server.mjs'

# Or create a symlink
ln -s $(pwd)/packages/core/src/issue-tracker/adapters/cli-tool.mjs /usr/local/bin/cyrus-cli
ln -s $(pwd)/start-cli-server.mjs /usr/local/bin/cyrus-server
```

Then you can use:

```bash
cyrus-server           # Start server
cyrus-cli fetchMembers # Use CLI tool
```

## Available Commands

### Issue Management

**Create an issue:**
```bash
cli-tool.mjs createIssue --title "Issue title" [--description "Description"]
```

Example:
```bash
cli-tool.mjs createIssue --title "Fix login bug" --description "OAuth is broken"
```

### Comment Management

**Create a comment:**
```bash
cli-tool.mjs createComment --issue-id <id> --body "Comment text" [--mention-agent]
```

Example:
```bash
cli-tool.mjs createComment --issue-id issue-1 --body "@cyrus please fix" --mention-agent
```

The `--mention-agent` flag triggers an agent session automatically.

### Agent Session Management

**Start a session on an issue:**
```bash
cli-tool.mjs startSession --issue-id <id>
```

**Start a session on a comment:**
```bash
cli-tool.mjs startSessionOnComment --comment-id <id>
```

**View session details:**
```bash
cli-tool.mjs viewSession --session-id <id>
```

**Send a prompt to a session:**
```bash
cli-tool.mjs promptSession --session-id <id> --message "Your prompt here"
```

**Stop a session:**
```bash
cli-tool.mjs stopSession --session-id <id>
```

### Team & Labels

**List all labels:**
```bash
cli-tool.mjs fetchLabels
```

**List all team members:**
```bash
cli-tool.mjs fetchMembers
```

**Create a label:**
```bash
cli-tool.mjs createLabel --name "bug" [--color "#ff0000"]
```

**Create a team member:**
```bash
cli-tool.mjs createMember --name "John Doe" [--email "john@example.com"]
```

### Debugging

**Get entire state:**
```bash
cli-tool.mjs getState
```

This returns the complete in-memory state including all issues, comments, sessions, labels, and users.

## Environment Variables

- `CYRUS_PORT` - Port where Cyrus server is running (default: 3457)

Set the port when using the CLI tool:

```bash
CYRUS_PORT=8080 cli-tool.mjs fetchMembers
```

## Examples

### Complete Workflow

```bash
# Terminal 1: Start server
node start-cli-server.mjs

# Terminal 2: Interact with server

# 1. Create an issue
cli-tool.mjs createIssue --title "Implement dark mode" \
  --description "Add dark mode toggle to settings"

# Output: { "id": "issue-1", "identifier": "CLI-1", ... }

# 2. Create a comment mentioning the agent
cli-tool.mjs createComment --issue-id issue-1 \
  --body "@cyrus can you implement this?" \
  --mention-agent

# This automatically triggers an agent session

# 3. List all issues (via getState)
cli-tool.mjs getState | jq '.issues'

# 4. View team members
cli-tool.mjs fetchMembers

# 5. Start another session manually
cli-tool.mjs startSession --issue-id issue-1

# 6. View the session
cli-tool.mjs viewSession --session-id session-1
```

### Integration with Scripts

```bash
#!/bin/bash
# create-issue-and-assign.sh

# Create an issue
ISSUE_JSON=$(cli-tool.mjs createIssue --title "$1" --description "$2")
ISSUE_ID=$(echo "$ISSUE_JSON" | jq -r '.id')

echo "Created issue: $ISSUE_ID"

# Start an agent session on it
SESSION_JSON=$(cli-tool.mjs startSession --issue-id "$ISSUE_ID")
SESSION_ID=$(echo "$SESSION_JSON" | jq -r '.agentSessionId')

echo "Started session: $SESSION_ID"

# View the session
cli-tool.mjs viewSession --session-id "$SESSION_ID"
```

Usage:
```bash
./create-issue-and-assign.sh "Fix bug" "This is urgent"
```

### CI/CD Integration

```yaml
# .github/workflows/test.yml
name: Test with Cyrus CLI

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Start Cyrus CLI server
        run: |
          node start-cli-server.mjs &
          sleep 3

      - name: Create test issue
        run: |
          cli-tool.mjs createIssue \
            --title "CI Test Issue" \
            --description "Automated test"

      - name: Run tests
        run: npm test
```

## Help

View all available commands:

```bash
cli-tool.mjs help
# or
cli-tool.mjs --help
# or
cli-tool.mjs
```

## Troubleshooting

**Error: Cannot connect to Cyrus server**
```
❌ Error: Cannot connect to Cyrus server at http://localhost:3457/cli/rpc
   Make sure Cyrus is running with CLI platform enabled.
   Set CYRUS_PORT environment variable if using a different port.
```

Solution: Make sure `start-cli-server.mjs` is running.

**Port already in use**
```
Error: listen EADDRINUSE: address already in use
```

Solution: Use a different port:
```bash
CYRUS_PORT=8080 node start-cli-server.mjs
CYRUS_PORT=8080 cli-tool.mjs fetchMembers
```

**Unknown command**
```
❌ Error: Unknown command: xyz
```

Solution: Run `cli-tool.mjs help` to see available commands.

## Files

- `start-cli-server.mjs` - Starts Cyrus EdgeWorker with CLI platform
- `packages/core/src/issue-tracker/adapters/cli-tool.mjs` - CLI tool for RPC commands
- `test-cli-platform.mjs` - Integration test script
- `packages/core/src/issue-tracker/adapters/CLI_USAGE.md` - Complete API reference

## See Also

- [CLI_USAGE.md](packages/core/src/issue-tracker/adapters/CLI_USAGE.md) - Complete API reference with HTTP/JSON-RPC details
- [test-cli-platform.mjs](test-cli-platform.mjs) - Integration test examples
