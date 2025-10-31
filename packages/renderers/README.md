# @cyrus/renderers

Renderer implementations for Cyrus - Abstract interfaces for rendering agent activity to various output channels.

## Overview

This package provides implementations of the `Renderer` interface from `cyrus-interfaces`, which abstracts how agent activity is displayed to users. Currently includes the Linear comment renderer.

## Installation

```bash
pnpm add @cyrus/renderers
```

## Available Renderers

### LinearRenderer

Posts agent activity to Linear issue comments, maintaining the existing Cyrus behavior of providing updates through Linear's comment system.

**Features:**
- Session start/complete notifications
- Activity rendering (thoughts, actions, responses, errors, elicitations, prompts)
- Tool usage tracking
- Markdown formatting support
- Comment threading (root comments or replies)
- Verbose and non-verbose formatting modes

## Usage

```typescript
import { LinearRenderer } from '@cyrus/renderers/linear';
import type { IssueTracker, Member } from 'cyrus-interfaces';

// Configure the renderer
const renderer = new LinearRenderer({
  issueTracker: myIssueTracker, // IssueTracker implementation
  agentMember: {
    id: 'agent-123',
    name: 'Cyrus Agent',
    email: 'agent@cyrus.ai',
  },
  rootCommentId: 'comment-456', // Optional: Thread all activity as replies
  verboseFormatting: true, // Optional: Use emoji and detailed formatting (default: true)
});

// Start a session
await renderer.renderSessionStart({
  id: 'session-123',
  issueId: 'issue-456',
  issueTitle: 'Implement new feature',
  startedAt: new Date(),
});

// Render agent activity
await renderer.renderActivity('session-123', {
  id: 'act-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  content: {
    type: 'thought',
    body: 'I need to analyze the requirements',
  },
});

// Render text response
await renderer.renderText('session-123', 'Here is my analysis...');

// Render tool usage
await renderer.renderToolUse('session-123', 'FileRead', { path: 'config.ts' });

// Complete the session
await renderer.renderComplete('session-123', {
  turns: 10,
  toolsUsed: 5,
  filesModified: ['file1.ts', 'file2.ts'],
  summary: 'Successfully implemented the feature',
  exitCode: 0,
});

// Handle errors
await renderer.renderError('session-123', new Error('Something went wrong'));
```

## Activity Types

LinearRenderer supports all AgentActivity types from the Linear SDK:

- **thought**: Internal reasoning/thinking
- **action**: Tool execution with parameters and optional results
- **response**: Agent's text response
- **error**: Error messages
- **elicitation**: Requests for user input
- **prompt**: Prompts requesting user action

## Formatting

### Verbose Mode (default)

```markdown
🚀 **Session Started**

Working on: **Implement new feature**
Started at: 2025-01-27T12:00:00Z

---

💭 **Thinking**

I need to analyze the requirements

---

🔧 **Action: FileRead**

**Parameters:**
```
config.ts
```

**Result:**
```
export const config = { ... }
```

---

✅ **Session Complete**

**Duration:** 5m 30s
**Turns:** 10
**Tools Used:** 5
**Exit Code:** 0

**Files Modified:**
- `file1.ts`
- `file2.ts`

**Summary:**
Successfully implemented the feature
```

### Non-Verbose Mode

```markdown
Starting work on: Implement new feature

---

I need to analyze the requirements

---

**FileRead**
```
config.ts
```

Result:
```
export const config = { ... }
```

---

Completed in 5m 30s

Files modified:
- file1.ts
- file2.ts

Successfully implemented the feature
```

## Comment Threading

By default, all activities are posted as root-level comments. To thread all activity as replies to a specific comment:

```typescript
const renderer = new LinearRenderer({
  issueTracker: myIssueTracker,
  agentMember: myAgent,
  rootCommentId: 'parent-comment-id', // All activity becomes replies to this comment
});
```

## User Input

The `getUserInput()` method returns an empty async iterable for Linear, since user input is handled through webhooks rather than real-time streaming. The EdgeWorker handles Linear webhooks and feeds user input into the system separately.

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Type check
pnpm typecheck
```

## Testing

The package includes comprehensive unit tests with >80% coverage. Tests use a mock IssueTracker to avoid real Linear API calls:

```bash
pnpm test:run
```

Coverage report:
```
File               | % Stmts | % Branch | % Funcs | % Lines
-------------------|---------|----------|---------|--------
LinearRenderer.ts  |   88.23 |    85.24 |     100 |   88.23
```

## License

MIT
