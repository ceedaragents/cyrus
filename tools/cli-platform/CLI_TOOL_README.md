# 🏎️ Cyrus CLI Tool - Premium Command-Line Interface

The **F1 (Formula 1) of CLIs** - A beautiful, professional command-line interface for the Cyrus platform with premium UX, excellent help, activity pagination, and search.

## ✨ Premium Features

- **🎨 Beautiful Output**: Colored, formatted output with emojis
- **📄 Activity Pagination**: View large datasets with `--limit` and `--offset`
- **🔍 Activity Search**: Filter activities with `--search`
- **💡 Excellent Help**: Per-command help with `--help` flag
- **🏥 Health Commands**: `ping`, `status`, `version` for server health
- **🔗 Connection Feedback**: Shows RPC URL and connection status
- **⚡ Progress Indicators**: Real-time feedback for all operations
- **❌ Professional Errors**: Actionable error messages with suggestions
- **🚀 Portable Server**: Start server without absolute paths

## Quick Start

### 1. Start the CLI Server

```bash
# Default port (3457)
bun run apps/f1/server.ts

# Custom port
CYRUS_PORT=8080 bun run apps/f1/server.ts
# or
bun run apps/f1/server.ts 8080
```

The server will display:
```
🏎️  Cyrus CLI Platform Server

   Starting up...

   Directory: /tmp/cyrus-cli-server
   Port: 3457

✅ Server is running!

   RPC Endpoint:

   http://localhost:3457/cli/rpc

   Quick Start:

   # Check server health
   ./apps/f1/f1 ping

   # Create an issue
   ./apps/f1/f1 createIssue --title "Test Issue"

   # View all commands
   ./apps/f1/f1 help

   Press Ctrl+C to stop.
```

### 2. Use the CLI Tool

```bash
# Check if server is running
packages/core/src/issue-tracker/adapters/./apps/f1/f1 ping

# View all commands
packages/core/src/issue-tracker/adapters/./apps/f1/f1 help

# Get help for a specific command
packages/core/src/issue-tracker/adapters/./apps/f1/f1 createIssue --help
```

## Installation (Optional)

Create aliases for easier access:

```bash
# Add to your ~/.bashrc or ~/.zshrc
alias cyrus-cli='packages/core/src/issue-tracker/adapters/./apps/f1/f1'
alias cyrus-server='node start-./apps/f1/f1'

# Or create symlinks
ln -s $(pwd)/packages/core/src/issue-tracker/adapters/./apps/f1/f1 /usr/local/bin/cyrus-cli
ln -s $(pwd)/start-./apps/f1/f1 /usr/local/bin/cyrus-server
```

Then use:
```bash
cyrus-server           # Start server
cyrus-cli ping         # Use CLI tool
cyrus-cli help         # View help
```

## Commands Reference

### 🏥 Health & Status

#### ping
Check server connectivity.

```bash
cyrus-cli ping
```

**Output:**
```
🏓 Pinging Cyrus server...

→ Connecting to http://localhost:3457/cli/rpc...
✓ Connected

✅ Server is responding
   URL: http://localhost:3457/cli/rpc
```

#### status
Get detailed server status and version.

```bash
cyrus-cli status
```

**Output:**
```
📊 Fetching server status...

→ Connecting to http://localhost:3457/cli/rpc...
✓ Connected

✅ Server Status

   Version: 1.0.0
   Platform: cli
   Mode: in-memory
   Uptime: 5m 32s
   URL: http://localhost:3457/cli/rpc
```

#### version
Show server version (compact output).

```bash
cyrus-cli version
```

**Output:**
```
1.0.0
```

### 📝 Issue Management

#### createIssue
Create a new issue.

```bash
cyrus-cli createIssue --title <title> [options]

# Options:
#   --title         Issue title (required)
#   --description   Issue description
#   --assignee-id   User ID to assign
#   --team-id       Team ID (default: team-1)
#   --state-id      Workflow state ID (default: state-todo)
```

**Examples:**
```bash
# Basic issue
cyrus-cli createIssue --title "Fix login bug"

# Issue with description
cyrus-cli createIssue \
  --title "Add dark mode" \
  --description "Implement dark mode toggle in settings"

# Assign to agent immediately
cyrus-cli createIssue \
  --title "Refactor API" \
  --assignee-id agent-user-1
```

#### assignIssue
Assign or reassign an issue to a user.

```bash
cyrus-cli assignIssue --issue-id <id> --assignee-id <user-id>

# Options:
#   --issue-id      Issue ID (required)
#   --assignee-id   User ID to assign (omit to unassign)
```

**Examples:**
```bash
# Assign to agent
cyrus-cli assignIssue --issue-id issue-1 --assignee-id agent-user-1

# Reassign to another user
cyrus-cli assignIssue --issue-id issue-1 --assignee-id user-2

# Unassign
cyrus-cli assignIssue --issue-id issue-1
```

### 💬 Comment Management

#### createComment
Create a comment on an issue.

```bash
cyrus-cli createComment --issue-id <id> --body <text> [options]

# Options:
#   --issue-id       Issue ID (required)
#   --body           Comment text (required)
#   --mention-agent  Mention agent (triggers session)
```

**Examples:**
```bash
# Regular comment
cyrus-cli createComment \
  --issue-id issue-1 \
  --body "This is blocking production"

# Mention agent (triggers session)
cyrus-cli createComment \
  --issue-id issue-1 \
  --body "Please fix this urgently" \
  --mention-agent
```

### 🤖 Agent Sessions

#### startSession
Start an agent session on an issue.

```bash
cyrus-cli startSession --issue-id <id>
```

**Example:**
```bash
cyrus-cli startSession --issue-id issue-1
```

#### startSessionOnComment
Start an agent session on a root comment.

```bash
cyrus-cli startSessionOnComment --comment-id <id>
```

**Example:**
```bash
cyrus-cli startSessionOnComment --comment-id comment-1
```

#### viewSession
View agent session with **pagination** and **search**.

```bash
cyrus-cli viewSession --session-id <id> [options]

# Options:
#   --session-id   Session ID (required)
#   --limit        Number of activities to show (default: 20)
#   --offset       Starting offset (default: 0)
#   --search       Search term to filter activities
```

**Output:**
```
→ Connecting to http://localhost:3457/cli/rpc...
✓ Connected

✅ Agent Session

   ID: session-1
   Status: pending
   Type: issue
   Issue ID: issue-1
   Created: 1/27/2025, 10:30:00 AM
   Updated: 1/27/2025, 10:35:00 AM

📝 Activities (showing 10 of 25)

1. activity-25 [STOP]
   1/27/2025, 10:35:00 AM • Prompt
   STOP

2. activity-24
   1/27/2025, 10:34:50 AM • Prompt
   Test activity 15

...

→ More activities available. Use --offset 10 to see next page.
```

**Examples:**
```bash
# View first 10 activities
cyrus-cli viewSession --session-id session-1 --limit 10

# View next 10 activities
cyrus-cli viewSession --session-id session-1 --limit 10 --offset 10

# Search for errors
cyrus-cli viewSession --session-id session-1 --search "error"

# Search and limit
cyrus-cli viewSession --session-id session-1 --search "bug" --limit 5
```

**Activity Pagination Features:**
- ✅ Most recent activities first (reverse chronological)
- ✅ Configurable page size with `--limit`
- ✅ Offset-based pagination with `--offset`
- ✅ Full-text search with `--search` (searches body, type, and ID)
- ✅ Shows total count and current page range
- ✅ Helpful navigation hints for next/previous pages

#### promptSession
Send a message to an agent session.

```bash
cyrus-cli promptSession --session-id <id> --message <text>
```

**Example:**
```bash
cyrus-cli promptSession \
  --session-id session-1 \
  --message "Please add error handling"
```

#### stopSession
Stop a running agent session.

```bash
cyrus-cli stopSession --session-id <id>
```

**Example:**
```bash
cyrus-cli stopSession --session-id session-1
```

### 👥 Team & Labels

#### fetchMembers
List all team members.

```bash
cyrus-cli fetchMembers
```

#### createMember
Create a new team member.

```bash
cyrus-cli createMember --name <name> [--email <email>]
```

**Examples:**
```bash
cyrus-cli createMember --name "Alice"
cyrus-cli createMember --name "Bob" --email "bob@example.com"
```

#### fetchLabels
List all labels.

```bash
cyrus-cli fetchLabels
```

#### createLabel
Create a new label.

```bash
cyrus-cli createLabel --name <name> [--color <hex>]
```

**Examples:**
```bash
cyrus-cli createLabel --name "bug"
cyrus-cli createLabel --name "urgent" --color "#ff0000"
```

### 🐛 Debugging

#### getState
Get entire in-memory state (for debugging).

```bash
cyrus-cli getState
```

**Output:** Complete JSON dump of:
- Issues
- Comments
- Sessions
- Labels
- Users
- Teams
- Workflow states

## Environment Variables

### CYRUS_PORT
Server port (default: 3457)

**Usage:**
```bash
# Set before starting server
CYRUS_PORT=8080 node start-./apps/f1/f1

# Set when using CLI tool
CYRUS_PORT=8080 cyrus-cli ping
```

### DEBUG
Enable debug mode for stack traces.

```bash
DEBUG=1 cyrus-cli createIssue --title "Test"
```

## Error Handling

The CLI provides professional, actionable error messages:

### Missing Required Parameter
```bash
$ cyrus-cli createIssue

❌ Missing required parameter: --title

   Run ./apps/f1/f1 createIssue --help for usage.
```

### Connection Failed
```bash
$ cyrus-cli ping

❌ Cannot connect to Cyrus server

   Server URL: http://localhost:3457/cli/rpc
   Make sure the CLI server is running.
   Start it with: node start-./apps/f1/f1
```

### Unknown Command
```bash
$ cyrus-cli unknownCommand

❌ Unknown command: unknownCommand

   Run ./apps/f1/f1 help to see all commands.
   Run ./apps/f1/f1 unknownCommand --help for command-specific help.
```

### Invalid Resource
```bash
$ cyrus-cli viewSession --session-id invalid-999

❌ Error: Agent session not found: invalid-999
```

## Complete Workflow Examples

### Example 1: Create Issue and Start Session

```bash
# 1. Create an issue
cyrus-cli createIssue \
  --title "Fix authentication bug" \
  --description "Users cannot login with OAuth"

# Output: { "id": "issue-1", "identifier": "CLI-1", ... }

# 2. Assign to agent
cyrus-cli assignIssue --issue-id issue-1 --assignee-id agent-user-1

# 3. Start agent session
cyrus-cli startSession --issue-id issue-1

# Output: { "agentSessionId": "session-1", ... }

# 4. View session progress
cyrus-cli viewSession --session-id session-1 --limit 5

# 5. Send additional instructions
cyrus-cli promptSession \
  --session-id session-1 \
  --message "Make sure to add error handling"

# 6. View updated session
cyrus-cli viewSession --session-id session-1
```

### Example 2: Activity Pagination Workflow

```bash
# Start a session and add many activities
cyrus-cli startSession --issue-id issue-1
# (session-1 is created)

# Add 50+ activities via prompts...
# (activities accumulate over time)

# View most recent 10
cyrus-cli viewSession --session-id session-1 --limit 10

# View next page
cyrus-cli viewSession --session-id session-1 --limit 10 --offset 10

# Search for errors
cyrus-cli viewSession --session-id session-1 --search "error"

# Search for specific activity
cyrus-cli viewSession --session-id session-1 --search "activity-42"
```

### Example 3: Script Integration

```bash
#!/bin/bash
# create-issue-and-assign.sh

# Create issue and capture ID
ISSUE_JSON=$(cyrus-cli createIssue --title "$1" --description "$2")
ISSUE_ID=$(echo "$ISSUE_JSON" | jq -r '.id')

echo "Created issue: $ISSUE_ID"

# Assign to agent
cyrus-cli assignIssue --issue-id "$ISSUE_ID" --assignee-id agent-user-1

# Start session
SESSION_JSON=$(cyrus-cli startSession --issue-id "$ISSUE_ID")
SESSION_ID=$(echo "$SESSION_JSON" | jq -r '.agentSessionId')

echo "Started session: $SESSION_ID"

# Monitor progress
while true; do
  clear
  cyrus-cli viewSession --session-id "$SESSION_ID" --limit 5
  sleep 5
done
```

**Usage:**
```bash
./create-issue-and-assign.sh "Fix bug" "This is urgent"
```

## Testing

### Run the Test Drive Script

```bash
./test-drive-f1.sh
```

This comprehensive test script demonstrates:
- ✅ All health commands
- ✅ Help system (general + per-command)
- ✅ Issue and member creation
- ✅ assignIssue command
- ✅ Agent sessions
- ✅ Activity pagination with 15+ activities
- ✅ Activity search
- ✅ Error handling for edge cases
- ✅ Beautiful formatted output

### Manual Testing Checklist

- [ ] Server starts successfully with colors
- [ ] `ping` shows connection feedback
- [ ] `status` shows version and uptime
- [ ] General `help` displays all commands
- [ ] Per-command `--help` shows detailed usage
- [ ] `createIssue` creates issues with all options
- [ ] `assignIssue` assigns and reassigns users
- [ ] `viewSession` shows paginated activities
- [ ] `--limit` and `--offset` work correctly
- [ ] `--search` filters activities
- [ ] Most recent activities appear first
- [ ] Navigation hints show next/previous pages
- [ ] Error messages are clear and actionable
- [ ] All output uses colors appropriately

## Troubleshooting

### Port Already in Use
```bash
Error: listen EADDRINUSE: address already in use
```

**Solution:** Use a different port:
```bash
CYRUS_PORT=8080 node start-./apps/f1/f1
CYRUS_PORT=8080 cyrus-cli ping
```

### Cannot Connect to Server
```bash
❌ Cannot connect to Cyrus server at http://localhost:3457/cli/rpc
```

**Solutions:**
1. Make sure server is running: `node start-./apps/f1/f1`
2. Check correct port: `CYRUS_PORT=<port> cyrus-cli ping`
3. Verify server log: `cat /tmp/cyrus-cli-server.log`

### Module Not Found
```bash
Error: Cannot find module './packages/edge-worker/dist/EdgeWorker.js'
```

**Solution:** Build packages first:
```bash
pnpm install
pnpm build
```

### Activities Not Showing
If `viewSession` shows no activities:
- Session may be new (no activities yet)
- Try adding activities: `cyrus-cli promptSession --session-id X --message "test"`
- Check `--offset` isn't beyond total count

## Performance Notes

- **Pagination**: Default limit is 20 activities for optimal performance
- **Search**: Full-text search across all activity fields (body, type, ID)
- **In-Memory**: All data stored in memory (resets on server restart)
- **Connection**: Each command makes one RPC call (efficient)

## Architecture

```
┌─────────────────┐
│   ./apps/f1/f1  │  ← Beautiful CLI with colors & help
│   (Client)      │
└────────┬────────┘
         │ HTTP POST /cli/rpc
         ↓
┌─────────────────────┐
│   CLIRPCServer.ts   │  ← RPC endpoint handler
│   (FastifyServer)   │
└────────┬────────────┘
         │
         ↓
┌──────────────────────────┐
│  CLIIssueTrackerService  │  ← In-memory storage
│  (implements             │
│   IIssueTrackerService)  │
└──────────────────────────┘
```

## Contributing

When adding new commands:

1. **Add to `./apps/f1/f1`:**
   - Add case in switch statement
   - Add to `showHelp()` function
   - Add to `showCommandHelp()` with examples

2. **Add to `CLIRPCServer.ts`:**
   - Add to `RPCCommand` type
   - Add handler in `handleCommand()` switch

3. **Add to `CLIIssueTrackerService.ts`:**
   - Implement service method if needed

4. **Update documentation:**
   - Add to this README
   - Add to test drive script
   - Update CLAUDE.md

## Version History

- **v1.0.0** - F1 Release
  - ✨ Beautiful colored output
  - 📄 Activity pagination (`--limit`, `--offset`)
  - 🔍 Activity search (`--search`)
  - 💡 Per-command help (`--help`)
  - 🏥 Health commands (`ping`, `status`, `version`)
  - 🔗 Connection feedback
  - ⚡ assignIssue command
  - 🚀 Portable server startup
  - ❌ Professional error messages
  - 📝 Comprehensive documentation

## See Also

- **CLAUDE.md** - "Driving the F1" guide
- **test-drive-f1.sh** - Comprehensive test script
- **start-./apps/f1/f1** - Server startup script

---

**🏎️  Built with premium quality. Drive with confidence. 🏎️**
