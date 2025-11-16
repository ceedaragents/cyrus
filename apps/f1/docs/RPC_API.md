# F1 RPC API Reference

Low-level RPC API documentation for the F1 CLI platform. This guide is for developers who need direct HTTP/JSON-RPC access to the CLI issue tracker.

**For end-users**: See [Commands Reference](./COMMANDS.md) for the user-friendly F1 CLI tool.

## Overview

The F1 platform provides a command-line interface for testing and development of Cyrus agent workflows without requiring Linear integration.

## Features

- **In-Memory State**: All issues, comments, sessions, labels, and users stored in memory
- **HTTP/JSON-RPC Control**: Full control via HTTP POST requests
- **Platform Agnostic**: Works with the same IIssueTrackerService interface as Linear
- **Event Emission**: Emits AgentEvents for issue assignments, comment mentions, and agent sessions
- **Test-Friendly**: Perfect for integration tests and local development

## Quick Start

### 1. Configure EdgeWorker

```typescript
import { EdgeWorker } from "cyrus-edge-worker";

const edgeWorker = new EdgeWorker({
  cyrusHome: "/path/to/cyrus-home",
  serverPort: 3457,
  repositories: [
    {
      id: "my-repo",
      name: "My Repository",
      repositoryPath: "/path/to/repo",
      baseBranch: "main",
      workspaceBaseDir: "/path/to/worktrees",
      platform: "cli",  // ← Use CLI platform
      linearWorkspaceId: "test-workspace",
      teamKeys: ["TEST"],
    },
  ],
  agentHandle: "cyrus",        // The agent's name/handle
  agentUserId: "agent-user-1", // The agent's user ID
});

await edgeWorker.start();
```

### 2. Make RPC Calls

```typescript
const RPC_URL = "http://localhost:3457/cli/rpc";

async function rpc(method, params = {}) {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  return await response.json();
}

// Create an issue
const issue = await rpc("createIssue", {
  title: "Test Issue",
  description: "This is a test",
});

// Create a comment
const comment = await rpc("createComment", {
  issueId: issue.data.id,
  body: "Test comment",
  mentionAgent: true, // Triggers agent session if true
});

// Start an agent session
const session = await rpc("startAgentSessionOnIssue", {
  issueId: issue.data.id,
});
```

## Available RPC Commands

### Issue Management

#### `createIssue`
Create a new issue.

**Parameters:**
- `title` (string, required): Issue title
- `description` (string, optional): Issue description
- `options` (object, optional): Additional options

**Returns:**
```json
{
  "success": true,
  "data": {
    "id": "issue-1",
    "identifier": "CLI-1",
    "title": "Test Issue",
    "description": "This is a test",
    "url": "https://example.com/issue/CLI-1",
    "teamId": "team-1",
    "team": {...},
    "state": {...},
    "labels": [],
    "createdAt": "2025-11-02T00:00:00.000Z",
    "updatedAt": "2025-11-02T00:00:00.000Z"
  }
}
```

### Comment Management

#### `createComment`
Create a comment on an issue.

**Parameters:**
- `issueId` (string, required): Issue ID
- `body` (string, required): Comment body
- `mentionAgent` (boolean, optional): If true, triggers agent session

**Returns:**
```json
{
  "success": true,
  "data": {
    "id": "comment-1",
    "body": "Test comment",
    "userId": "cli-user-1",
    "user": {...},
    "issueId": "issue-1",
    "createdAt": "2025-11-02T00:00:00.000Z",
    "updatedAt": "2025-11-02T00:00:00.000Z"
  }
}
```

### Agent Session Management

#### `startAgentSessionOnIssue`
Start an agent session on an issue.

**Parameters:**
- `issueId` (string, required): Issue ID

**Returns:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "agentSessionId": "session-1",
    "lastSyncId": 0
  }
}
```

#### `startAgentSessionOnComment`
Start an agent session on a root comment.

**Parameters:**
- `commentId` (string, required): Root comment ID (not a reply)

**Returns:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "agentSessionId": "session-2",
    "lastSyncId": 0
  }
}
```

#### `viewAgentSession`
View agent session details.

**Parameters:**
- `sessionId` (string, required): Agent session ID

**Returns:**
```json
{
  "success": true,
  "data": {
    "session": {
      "id": "session-1",
      "issueId": "issue-1",
      "status": "pending",
      "type": "issue",
      "creatorId": "cli-user-1",
      "creator": {...},
      "startedAt": "2025-11-02T00:00:00.000Z",
      "createdAt": "2025-11-02T00:00:00.000Z",
      "updatedAt": "2025-11-02T00:00:00.000Z"
    },
    "activities": []
  }
}
```

#### `promptAgentSession`
Send a prompt to an agent session.

**Parameters:**
- `sessionId` (string, required): Agent session ID
- `message` (string, required): Prompt message

**Returns:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "activity": {...}
  }
}
```

#### `stopAgentSession`
Stop an agent session.

**Parameters:**
- `sessionId` (string, required): Agent session ID

**Returns:**
```json
{
  "success": true,
  "data": {
    "success": true,
    "session": {...}
  }
}
```

### Team & User Management

#### `fetchLabels`
Get all labels.

**Parameters:** None

**Returns:**
```json
{
  "success": true,
  "data": [
    {
      "id": "label-1",
      "name": "bug",
      "color": "#ff0000"
    }
  ]
}
```

#### `fetchMembers`
Get all team members.

**Parameters:** None

**Returns:**
```json
{
  "success": true,
  "data": [
    {
      "id": "user-1",
      "name": "Test User",
      "email": "user@example.com",
      "url": "https://example.com/user"
    }
  ]
}
```

#### `createLabel`
Create a new label.

**Parameters:**
- `name` (string, required): Label name
- `options` (object, optional): Additional options

**Returns:**
```json
{
  "success": true,
  "data": {
    "id": "label-1",
    "name": "bug",
    "color": "#ff0000"
  }
}
```

#### `createMember`
Create a new team member.

**Parameters:**
- `name` (string, required): Member name
- `options` (object, optional): Additional options (email, etc.)

**Returns:**
```json
{
  "success": true,
  "data": {
    "id": "user-2",
    "name": "New User",
    "email": "newuser@example.com",
    "url": "https://example.com/newuser"
  }
}
```

### State Inspection

#### `getState`
Get the entire in-memory state (useful for debugging).

**Parameters:** None

**Returns:**
```json
{
  "success": true,
  "data": {
    "issues": {...},
    "comments": {...},
    "agentSessions": {...},
    "labels": [...],
    "users": [...],
    "currentUser": {...},
    "agentHandle": "cyrus"
  }
}
```

## Example Test Script

See `test-cli-platform.mjs` in the repository root for a complete working example that demonstrates:

1. Starting EdgeWorker with CLI platform
2. Creating issues via RPC
3. Creating comments
4. Starting agent sessions
5. Viewing session details
6. Fetching labels and members
7. Proper cleanup

## Event Emission

The CLI platform emits the same AgentEvents as Linear:

- `AgentSessionCreated` - When a session is created
- `AgentSessionPrompted` - When a prompt is sent to a session
- `IssueAssigned` - When an issue is assigned to the agent
- `CommentMention` - When the agent is mentioned in a comment
- `NewComment` - When a new comment is created

## Use Cases

### Integration Testing
```typescript
describe("Agent Workflows", () => {
  let edgeWorker;

  beforeAll(async () => {
    edgeWorker = new EdgeWorker({
      cyrusHome: tmpdir(),
      serverPort: 3458,
      repositories: [{
        platform: "cli",
        // ... other config
      }],
    });
    await edgeWorker.start();
  });

  it("should process issue assignments", async () => {
    const issue = await rpc("createIssue", {
      title: "Test Issue",
    });
    // Agent should automatically process the issue
    await waitFor(() => checkIssueProcessed(issue.data.id));
  });

  afterAll(async () => {
    await edgeWorker.stop();
  });
});
```

### Local Development
```bash
# Terminal 1: Start Cyrus with CLI platform
node start-cli-mode.js

# Terminal 2: Send commands
curl -X POST http://localhost:3457/cli/rpc \
  -H "Content-Type: application/json" \
  -d '{"method":"createIssue","params":{"title":"Fix bug"}}'
```

### CI/CD Testing
```yaml
- name: Test Cyrus CLI
  run: |
    node test-cli-platform.mjs
    # Tests should complete without external dependencies
```

## Differences from Linear Platform

1. **No Persistence**: State is in-memory only (lost on restart)
2. **No Network**: All operations are local
3. **Simplified IDs**: Uses sequential IDs (issue-1, comment-2, etc.)
4. **Mock URLs**: Returns placeholder URLs for resources
5. **No Attachments**: File upload returns mock responses
6. **No GraphQL**: Direct method calls instead of GraphQL queries

## Tips

- Use unique ports for each test to avoid conflicts
- Agent sessions trigger automatically when agent is mentioned
- The `agentHandle` config determines when the agent is "mentioned"
- Use `getState` RPC command for debugging state issues
- All timestamps are in ISO 8601 format
- The CLI platform is NOT meant for production use

## Troubleshooting

**Port already in use:**
```
Error: listen EADDRINUSE: address already in use
```
Solution: Change `serverPort` in config or stop other instances.

**Session not found:**
```
Error: Agent session not found
```
Solution: Check that you're using the correct `agentSessionId` from the create response.

**Agent not responding:**
```
Session created but no activity
```
Solution: Verify `agentHandle` matches the name used in mentions.
